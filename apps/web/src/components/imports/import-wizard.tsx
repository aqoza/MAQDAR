'use client'

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  RotateCcwIcon,
  UploadIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fetchErrorExamples } from '@/app/(app)/imports/actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  apiErrorKey,
  commitFraction,
  contentTypeFor,
  createImportClient,
  extensionOf,
  importLinks,
  type ApiErrorKey,
  type BatchState,
  type CommitResult,
  type CreatedFile,
  type FileState,
  type ImportClient,
} from '@/lib/imports/client'
import {
  IMPORT_LIMITS,
  entitiesInLoadOrder,
  getEntity,
  type ColumnKind,
  type EntityName,
} from '@/lib/imports/contract'
import { setMapping, sourceIndexes } from '@/lib/imports/mapping'
import { leavesPage } from '@/lib/imports/navigation-guard'
import { displayRawCell, normalizeRow, type NormalizeIssue } from '@/lib/imports/normalize'
import { queueOriginals, type OriginalState } from '@/lib/imports/originals'
import type { IssueSummary, ParseSummary } from '@/lib/imports/parse'
import { ParseFailure, createImportParser, type ImportParser } from '@/lib/imports/parse-client'
import { cn } from '@/lib/utils'
import { CountsTable } from './counts-table'
import { ErrorSummary } from './error-summary'
import { ImportFileList, useFileProblem } from './file-list'
import { FormatOptions } from './format-options'
import { MappingTable } from './mapping-table'
import { PartialBanner } from './partial-banner'
import { PreviewTable } from './preview-table'
import { ProgressPanel, type ProgressItem } from './progress-panel'
import { ReadIssues, hasReadIssues } from './read-issues'
import { ImportStatusBadge } from './status-badge'
import {
  appliedRows,
  isFailureCode,
  partialState,
  type ColumnLabelMap,
  type ErrorExample,
  type MatchLabelMap,
  type PreviousFile,
  type PreviousMappings,
  type SummaryFile,
} from './types'
import {
  checkFiles,
  hasMappingErrors,
  isFileReady,
  manifestFor,
  mappingIssuesOf,
  newWizardFile,
  orderForImport,
  parseRequestFor,
  withEntity,
  withInspection,
  withServerFileStates,
  type FileFailure,
  type FileOptions,
  type MappingContext,
  type WizardFile,
} from './wizard-state'

const STEPS = ['files', 'format', 'map', 'check', 'commit'] as const
type Step = (typeof STEPS)[number]

const ACCEPT = '.csv,.tsv,.txt,.xlsx,text/csv,text/plain,text/tab-separated-values'
/** Originals uploaded to Storage at the same time. */
const ORIGINAL_UPLOADS = 2
/**
 * How long sealing a file waits for its original to finish uploading. A stalled upload must not
 * hold the check; the seal then reports the original as missing (a warning only).
 */
const ORIGINAL_WAIT_MS = 5 * 60_000
/** Column kinds shown left to right in the preview (codes, numbers, dates, flags). */
const TEXT_KINDS: ReadonlySet<ColumnKind> = new Set(['text'])

type FilePhase = 'waiting' | 'reading' | 'read' | 'staging' | 'sealing' | 'sealed' | 'failed'
/** The publishable key, inlined by Next (the env schema stays out of the client bundle). */
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

type FileRun = {
  id: string
  fileNo: number
  name: string
  entity: EntityName
  phase: FilePhase
  rowsRead: number
  readFraction: number
  rowsTotal: number | null
  rowsStaged: number
  issues: IssueSummary
  original: OriginalState
  state: FileState | null
}

type RunPhase =
  | 'idle'
  | 'reading'
  | 'creating'
  | 'staging'
  | 'stopped'
  | 'checked'
  | 'committing'
  | 'commitStopped'
  | 'committed'
  | 'canceling'

type RunError =
  | { kind: 'api'; key: ApiErrorKey }
  | { kind: 'file'; name: string; problem: FileFailure }
  | { kind: 'tooManyRows'; count: number }

type RunState = {
  phase: RunPhase
  batchId: string | null
  files: FileRun[]
  batch: BatchState | null
  commit: CommitResult | null
  fraction: number
  error: RunError | null
  examples: ErrorExample[]
  canceled: boolean
}

const IDLE: RunState = {
  phase: 'idle',
  batchId: null,
  files: [],
  batch: null,
  commit: null,
  fraction: 0,
  error: null,
  examples: [],
  canceled: false,
}

const BUSY_PHASES: readonly RunPhase[] = [
  'reading',
  'creating',
  'staging',
  'committing',
  'canceling',
]

/** Mutable details of the running import that never render. */
type Session = {
  client: ImportClient
  controller: AbortController
  ordered: WizardFile[]
  totals: Map<string, number>
  originals: Map<number, Promise<boolean>>
  staged: Map<number, number>
  sealed: Set<number>
}

export type ImportWizardProps = {
  organizationId: string
  /** `?entity=`: the entity of files whose name says nothing. */
  initialEntity: EntityName | null
  displayLabels: ColumnLabelMap
  matchLabels: MatchLabelMap
  previousMappings: PreviousMappings
  previousFiles: readonly PreviousFile[]
}

/** Resolves when `promise` settles or after `ms`, whichever comes first. */
function settleWithin(promise: Promise<unknown> | undefined, ms: number): Promise<void> {
  if (!promise) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    promise.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      () => {
        clearTimeout(timer)
        resolve()
      },
    )
  })
}

function failureOf(error: unknown): FileFailure {
  return error instanceof ParseFailure
    ? error.detail
      ? { code: error.code, detail: error.detail }
      : { code: error.code }
    : { code: 'internal' }
}

/**
 * The import wizard: Files → Format → Map → Check → Commit. Files are read in a Web Worker (or
 * on the main thread when workers are unavailable); the check counts the rows of every file,
 * creates the import, uploads the originals to Storage and stages the normalized rows in load
 * order, sealing each file after its upload settled. Postgres validates every cell; the summary
 * fills in as chunks are accepted. Commits run in one call (up to 5,000 rows) or in steps.
 */
const noSubscription = () => () => {}

/** False in the server render and during hydration, true once the page is interactive. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
}

export function ImportWizard({
  organizationId,
  initialEntity,
  displayLabels,
  matchLabels,
  previousMappings,
  previousFiles,
}: ImportWizardProps) {
  const t = useTranslations('ImportsClient')
  const format = useFormatter()
  const problemText = useFileProblem()

  const [step, setStep] = useState<Step>('files')
  const [files, setFiles] = useState<WizardFile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [run, setRun] = useState<RunState>(IDLE)
  const [dragging, setDragging] = useState(false)

  const parserRef = useRef<ImportParser | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const inspectQueue = useRef<Promise<void>>(Promise.resolve())
  const inspectTokens = useRef(new Map<string, number>())
  /** The heading of the step on screen (one card at a time); focus goes there on a step change. */
  const headingRef = useRef<HTMLDivElement | null>(null)
  const shownStep = useRef<Step>(step)
  const lastPhase = useRef<RunPhase>(run.phase)

  // A step change unmounts the button that had focus: move focus to the new step's heading, so
  // keyboard and screen-reader users land in the step (never on the page's first render).
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    headingRef.current?.focus()
  }, [step])
  // "Check files" unmounts once the check starts reading.
  useEffect(() => {
    if (lastPhase.current === 'idle' && run.phase === 'reading') headingRef.current?.focus()
    lastPhase.current = run.phase
  }, [run.phase])

  const context: MappingContext = useMemo(
    () => ({ labels: matchLabels, previous: previousMappings }),
    [matchLabels, previousMappings],
  )
  const previousBySha = useMemo(
    () => new Map(previousFiles.map((file) => [file.sha256, file])),
    [previousFiles],
  )

  const busy = BUSY_PHASES.includes(run.phase)
  const locked = run.batchId !== null || busy
  // A file picked before hydration would reach no change handler and be lost silently.
  const hydrated = useHydrated()

  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    // In-app links (sidebar, header) navigate without unloading the page, which would stop the
    // check or commit silently: ask first, in the capture phase before Next.js handles the click.
    const guard = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement)) return
      const link = {
        href: anchor.href,
        target: anchor.target,
        download: anchor.hasAttribute('download'),
      }
      if (!leavesPage(event, link, window.location.href)) return
      if (!window.confirm(t('leaveWarning'))) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click', guard, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', guard, true)
    }
  }, [busy, t])

  useEffect(
    () => () => {
      sessionRef.current?.controller.abort()
      parserRef.current?.dispose()
    },
    [],
  )

  function getParser(): ImportParser {
    parserRef.current ??= createImportParser()
    return parserRef.current
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Files                                                                                     */
  /* ---------------------------------------------------------------------------------------- */

  function updateFile(id: string, update: (file: WizardFile) => WizardFile) {
    setFiles((current) => current.map((file) => (file.id === id ? update(file) : file)))
  }

  /** Inspections run one at a time (each reads a whole file for its hash); the last one wins. */
  function inspect(id: string, file: File, options: FileOptions) {
    const token = (inspectTokens.current.get(id) ?? 0) + 1
    inspectTokens.current.set(id, token)
    inspectQueue.current = inspectQueue.current.then(async () => {
      if (inspectTokens.current.get(id) !== token) return
      try {
        const result = await getParser().inspect(file, {
          encoding: options.encoding,
          delimiter: options.delimiter,
          sheet: options.sheet,
        })
        if (inspectTokens.current.get(id) !== token) return
        updateFile(id, (current) => withInspection(current, result, context))
      } catch (error) {
        if (inspectTokens.current.get(id) !== token) return
        updateFile(id, (current) => ({ ...current, inspecting: false, failure: failureOf(error) }))
      }
    })
  }

  function addFiles(list: FileList | readonly File[] | null) {
    if (!list || locked) return
    const added = Array.from(list).map((file) =>
      newWizardFile(crypto.randomUUID(), file, initialEntity),
    )
    if (added.length === 0) return
    setFiles((current) => [...current, ...added])
    setRun((current) => (current.canceled || current.error ? IDLE : current))
    for (const file of added) inspect(file.id, file.file, file.options)
  }

  function removeFile(id: string) {
    inspectTokens.current.delete(id)
    setFiles((current) => current.filter((file) => file.id !== id))
    parserRef.current?.release()
  }

  function changeOptions(id: string, patch: Partial<FileOptions>) {
    const file = files.find((candidate) => candidate.id === id)
    if (!file) return
    const options = { ...file.options, ...patch }
    const reread =
      options.encoding !== file.options.encoding ||
      options.delimiter !== file.options.delimiter ||
      options.sheet !== file.options.sheet
    updateFile(id, (current) => ({ ...current, options, inspecting: reread || current.inspecting }))
    if (reread) inspect(id, file.file, options)
  }

  function applyToAll(source: WizardFile) {
    const { decimalSeparator, dateOrder } = source.options
    setFiles((current) =>
      current.map((file) => ({
        ...file,
        options: { ...file.options, decimalSeparator, dateOrder },
      })),
    )
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Check: count, create, upload originals, stage, seal                                       */
  /* ---------------------------------------------------------------------------------------- */

  function patchFileRun(id: string, patch: Partial<FileRun>) {
    setRun((current) => ({
      ...current,
      files: current.files.map((file) => (file.id === id ? { ...file, ...patch } : file)),
    }))
  }

  function setBatch(batch: Partial<BatchState>) {
    setRun((current) => ({
      ...current,
      batch: current.batch ? { ...current.batch, ...batch } : (batch as BatchState),
    }))
  }

  function stop(error: unknown, fileId?: string) {
    if (sessionRef.current?.controller.signal.aborted) return
    setRun((current) => ({
      ...current,
      phase: current.batchId ? 'stopped' : 'idle',
      error: { kind: 'api', key: apiErrorKey(error) },
      files: current.files.map((file) =>
        file.id === fileId ? { ...file, phase: 'failed' } : file,
      ),
    }))
  }

  /**
   * Ends a session: its requests, waits and queued original uploads stop (an upload that already
   * started may finish; its object is removed with the import). Background work of an ended
   * session never touches the state of a newer run.
   */
  function endSession() {
    sessionRef.current?.controller.abort()
    sessionRef.current = null
    parserRef.current?.release()
  }

  function uploadOriginals(session: Session, created: readonly CreatedFile[]) {
    const files = new Map(session.ordered.map((file, index) => [index + 1, file]))
    const results = queueOriginals({
      targets: session.ordered.map((file, index) => {
        const target = created.find((entry) => entry.file_no === index + 1)
        return {
          id: file.id,
          fileNo: index + 1,
          uploadUrl: target?.upload_url ?? null,
          exists: target?.upload_error === 'exists',
          uploadable: extensionOf(file.file.name) !== null,
        }
      }),
      upload: (target) => {
        const file = files.get(target.fileNo)
        const extension = file ? extensionOf(file.file.name) : null
        if (!file || !extension) return Promise.resolve(false)
        return session.client.uploadOriginal(file.file, target.uploadUrl, {
          contentType: contentTypeFor(extension),
          apikey: PUBLISHABLE_KEY,
        })
      },
      onState: (id, original) => {
        if (sessionRef.current === session) patchFileRun(id, { original })
      },
      signal: session.controller.signal,
      limit: ORIGINAL_UPLOADS,
    })
    for (const [fileNo, stored] of results) session.originals.set(fileNo, stored)
  }

  async function stageAll(session: Session, batchId: string) {
    const parser = getParser()
    for (const [index, file] of session.ordered.entries()) {
      const fileNo = index + 1
      if (session.sealed.has(fileNo)) continue
      const total = session.totals.get(file.id) ?? 0
      try {
        patchFileRun(file.id, { phase: 'staging' })
        const startRow = (session.staged.get(fileNo) ?? 0) + 1
        if (startRow <= total) {
          await session.client.stageFile({
            batchId,
            fileNo,
            chunks: parser.parse(file.file, parseRequestFor(file, startRow)),
            onProgress: ({ result }) => {
              session.staged.set(fileNo, result.last_row)
              patchFileRun(file.id, { rowsStaged: result.last_row, state: result.file })
              setBatch(result.batch)
            },
          })
        }
        patchFileRun(file.id, { phase: 'sealing' })
        await settleWithin(session.originals.get(fileNo), ORIGINAL_WAIT_MS)
        const sealed = await session.client.sealFile(batchId, fileNo, total)
        const { batch, ...state } = sealed
        session.sealed.add(fileNo)
        patchFileRun(file.id, { phase: 'sealed', rowsStaged: total, state })
        setBatch(batch)
        if (file.inspect?.format === 'xlsx') parser.release()
      } catch (error) {
        if (error instanceof ParseFailure) {
          setRun((current) => ({
            ...current,
            phase: 'stopped',
            error: { kind: 'file', name: file.file.name, problem: failureOf(error) },
          }))
          patchFileRun(file.id, { phase: 'failed' })
        } else {
          stop(error, file.id)
        }
        return false
      }
    }
    return true
  }

  async function finishCheck(batchId: string) {
    setRun((current) => ({ ...current, phase: 'checked', error: null }))
    const examples = await fetchErrorExamples(batchId).catch(() => [])
    setRun((current) => (current.batchId === batchId ? { ...current, examples } : current))
  }

  async function startCheck() {
    // A previous run (canceled, or stopped and started over) must not keep uploading or reporting.
    endSession()
    const ordered = orderForImport(files)
    const controller = new AbortController()
    const session: Session = {
      client: createImportClient({ signal: controller.signal }),
      controller,
      ordered,
      totals: new Map(),
      originals: new Map(),
      staged: new Map(),
      sealed: new Set(),
    }
    sessionRef.current = session
    setRun({
      ...IDLE,
      phase: 'reading',
      files: ordered.map((file, index) => ({
        id: file.id,
        fileNo: index + 1,
        name: file.file.name,
        entity: file.entity as EntityName,
        phase: 'waiting',
        rowsRead: 0,
        readFraction: 0,
        rowsTotal: null,
        rowsStaged: 0,
        issues: {},
        original: 'pending',
        state: null,
      })),
    })

    // 1. Read every file once: the row counts the import is created with, and read issues.
    const parser = getParser()
    for (const file of ordered) {
      patchFileRun(file.id, { phase: 'reading' })
      const stream = parser.parse(file.file, parseRequestFor(file))
      let summary: ParseSummary
      try {
        for (;;) {
          const next = await stream.next()
          if (next.done) {
            summary = next.value
            break
          }
          patchFileRun(file.id, {
            rowsRead: next.value.rowsRead,
            readFraction: next.value.progress,
          })
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setRun((current) => ({
          ...current,
          phase: 'idle',
          error: { kind: 'file', name: file.file.name, problem: failureOf(error) },
          files: current.files.map((entry) =>
            entry.id === file.id ? { ...entry, phase: 'failed' } : entry,
          ),
        }))
        return
      }
      session.totals.set(file.id, summary.rowsTotal)
      patchFileRun(file.id, {
        phase: 'read',
        rowsTotal: summary.rowsTotal,
        readFraction: 1,
        issues: summary.issues,
      })
    }
    const rows = [...session.totals.values()].reduce((sum, count) => sum + count, 0)
    if (rows > IMPORT_LIMITS.rowsPerBatch) {
      setRun((current) => ({
        ...current,
        phase: 'idle',
        error: { kind: 'tooManyRows', count: rows },
      }))
      return
    }

    // 2. Create the import (idempotent on its id, so the client may retry).
    setRun((current) => ({ ...current, phase: 'creating' }))
    const batchId = crypto.randomUUID()
    let created: CreatedFile[]
    try {
      const result = await session.client.createImport({
        batchId,
        organizationId,
        files: ordered.map((file, index) =>
          manifestFor(file, index + 1, session.totals.get(file.id) ?? 0),
        ),
      })
      const { files: createdFiles, ...batch } = result
      created = createdFiles
      setRun((current) => ({ ...current, phase: 'staging', batchId, batch }))
    } catch (error) {
      stop(error)
      return
    }

    // 3. Originals go to Storage in the background; 4. rows are staged file by file.
    uploadOriginals(session, created)
    if (await stageAll(session, batchId)) await finishCheck(batchId)
  }

  async function retryStaging() {
    const session = sessionRef.current
    const batchId = run.batchId
    if (!session || !batchId) return
    setRun((current) => ({ ...current, phase: 'staging', error: null }))
    if (await stageAll(session, batchId)) await finishCheck(batchId)
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Commit, resume, cancel                                                                    */
  /* ---------------------------------------------------------------------------------------- */

  function fractionFiles() {
    return run.files.map((file) => ({
      file_no: file.fileNo,
      entity: file.entity,
      rows_total: file.rowsTotal ?? 0,
    }))
  }

  async function startCommit() {
    const session = sessionRef.current
    const batchId = run.batchId
    if (!session || !batchId) return
    const filesForFraction = fractionFiles()
    setRun((current) => ({ ...current, phase: 'committing', error: null }))
    try {
      const result = await session.client.commit(
        batchId,
        (state) =>
          setRun((current) => ({
            ...current,
            commit: state,
            batch: state,
            fraction: Math.max(current.fraction, commitFraction(filesForFraction, state)),
          })),
        run.batch,
      )
      if (result.status === 'succeeded') {
        setRun((current) => ({ ...current, phase: 'committed', fraction: 1 }))
      } else {
        setRun((current) => ({ ...current, phase: 'commitStopped' }))
        await refreshAfterStop(session, batchId)
      }
    } catch (error) {
      if (session.controller.signal.aborted) return
      setRun((current) => ({
        ...current,
        phase: 'commitStopped',
        error: { kind: 'api', key: apiErrorKey(error) },
      }))
    }
  }

  /**
   * After a commit stopped (invalid, failed, expired): the files' current states from the server,
   * since the commit records its errors on them (a reference that vanished, a merge that was
   * refused), then examples for the error summary.
   */
  async function refreshAfterStop(session: Session, batchId: string) {
    try {
      const status = await session.client.getImport(batchId)
      if (sessionRef.current !== session) return
      setRun((current) => ({
        ...current,
        files: withServerFileStates(current.files, status.files),
      }))
    } catch {
      // The summary then shows the states from the check; the report link still works.
    }
    const examples = await fetchErrorExamples(batchId).catch(() => [])
    if (sessionRef.current === session) setRun((current) => ({ ...current, examples }))
  }

  async function resumeCommit() {
    const session = sessionRef.current
    const batchId = run.batchId
    if (!session || !batchId) return
    setRun((current) => ({ ...current, phase: 'committing', error: null }))
    try {
      setBatch(await session.client.resume(batchId))
    } catch (error) {
      setRun((current) => ({
        ...current,
        phase: 'commitStopped',
        error: { kind: 'api', key: apiErrorKey(error) },
      }))
      return
    }
    await startCommit()
  }

  async function cancelImport() {
    const session = sessionRef.current
    const batchId = run.batchId
    if (!session || !batchId) return
    const previous = run.phase
    setRun((current) => ({ ...current, phase: 'canceling', error: null }))
    try {
      await session.client.cancel(batchId)
    } catch (error) {
      setRun((current) => ({
        ...current,
        phase: previous,
        error: { kind: 'api', key: apiErrorKey(error) },
      }))
      return
    }
    endSession()
    setRun({ ...IDLE, canceled: true })
    setStep('files')
  }

  function startAnother() {
    endSession()
    setFiles([])
    setActiveId(null)
    setRun(IDLE)
    setStep('files')
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Rendering                                                                                 */
  /* ---------------------------------------------------------------------------------------- */

  const filesCheck = checkFiles(files)
  const repeatedShas = useMemo(() => {
    const seen = new Set<string>()
    const repeated = new Set<string>()
    for (const file of files) {
      const sha = file.inspect?.sha256
      if (!sha) continue
      if (seen.has(sha)) repeated.add(sha)
      seen.add(sha)
    }
    return repeated
  }, [files])
  const mappingOk =
    files.length > 0 && files.every((file) => isFileReady(file) && !hasMappingErrors(file))
  const orderedFiles = orderForImport(files)
  const active = orderedFiles.find((file) => file.id === activeId) ?? orderedFiles[0] ?? null

  const canReach = (target: Step): boolean => {
    if (busy) return target === step
    if (run.batchId !== null) {
      return (
        target === 'check' ||
        (target === 'commit' &&
          ['checked', 'committing', 'commitStopped', 'committed'].includes(run.phase))
      )
    }
    switch (target) {
      case 'files':
        return true
      case 'format':
        return filesCheck.ok
      case 'map':
        return filesCheck.ok
      case 'check':
        return filesCheck.ok && mappingOk
      case 'commit':
        return false
    }
  }

  const errorText = (error: RunError): string => {
    switch (error.kind) {
      case 'api':
        return t(`apiErrors.${error.key}`)
      case 'file':
        return `${error.name}: ${problemText(error.problem)}`
      case 'tooManyRows':
        return t('check.tooManyRows', { count: error.count })
    }
  }

  const stepIndex = STEPS.indexOf(step)
  // Rows a stepped commit saved: the files' merge cursors once known, else the progress so far.
  const mergedRows = appliedRows(
    run.files.flatMap((file) =>
      file.state
        ? [
            {
              merged_through_row: file.state.merged_through_row ?? 0,
              rows_total: file.state.rows_total,
            },
          ]
        : [],
    ),
  )
  const applied =
    mergedRows > 0 ? mergedRows : Math.round(run.fraction * (run.batch?.rows_staged ?? 0))
  const partial = run.batch ? partialState(run.batch, applied) : null

  function checkItem(file: FileRun): ProgressItem {
    const reading = file.phase === 'reading' || file.phase === 'waiting'
    const fraction =
      file.phase === 'waiting'
        ? 0
        : reading
          ? file.readFraction
          : file.phase === 'read'
            ? 0
            : file.rowsTotal
              ? Math.min(1, file.rowsStaged / file.rowsTotal)
              : file.phase === 'sealed'
                ? 1
                : 0
    const issues = (file.state?.error_count ?? 0) + (file.state?.warning_count ?? 0)
    const rows =
      file.phase === 'reading'
        ? t('check.rowsRead', { count: file.rowsRead })
        : file.rowsTotal !== null
          ? t('check.rowsProgress', { done: file.rowsStaged, total: file.rowsTotal })
          : undefined
    const detail =
      issues > 0 && rows
        ? `${rows} · ${t('check.liveIssues', {
            errors: file.state?.error_count ?? 0,
            warnings: file.state?.warning_count ?? 0,
          })}`
        : rows
    return {
      key: file.id,
      title: file.name,
      subtitle: t(`entities.${file.entity}`),
      phase: t(`check.phases.${file.phase}`),
      state:
        file.phase === 'sealed'
          ? 'done'
          : file.phase === 'failed'
            ? 'failed'
            : file.phase === 'waiting' || file.phase === 'read'
              ? 'waiting'
              : 'running',
      fraction,
      detail,
      note: run.batchId ? t(`check.original.${file.original}`) : undefined,
      noteTone: file.original === 'failed' ? 'warning' : 'muted',
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The one live region of the wizard: phase changes only, not every chunk. */}
      <p className="sr-only" role="status">
        {run.phase === 'idle' ? '' : t(`announce.${run.phase}`)}
      </p>
      <nav aria-label={t('steps.label')}>
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((name, index) => {
            const current = name === step
            const reachable = canReach(name)
            return (
              <li key={name}>
                <button
                  type="button"
                  disabled={!reachable || current}
                  aria-current={current ? 'step' : undefined}
                  onClick={() => setStep(name)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    current
                      ? 'border-primary bg-primary text-primary-foreground'
                      : reachable
                        ? 'hover:bg-muted'
                        : 'text-muted-foreground opacity-60',
                  )}
                >
                  <span className="tabular-nums">{format.number(index + 1)}</span>
                  <span>{t(`steps.${name}`)}</span>
                </button>
              </li>
            )
          })}
        </ol>
        <p className="text-muted-foreground mt-2 text-xs">
          {t('stepOf', { step: stepIndex + 1, steps: STEPS.length })}
        </p>
      </nav>

      {run.canceled ? (
        <Alert role="status">
          <AlertDescription>{t('actions.canceled')}</AlertDescription>
        </Alert>
      ) : null}

      {step === 'files' ? (
        <Card>
          <CardHeader>
            <CardTitle ref={headingRef} tabIndex={-1} className="outline-none">
              {t('files.title')}
            </CardTitle>
            <CardDescription>{t('files.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <label
              className={cn(
                'has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-background flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2',
                dragging ? 'border-primary bg-muted' : 'hover:bg-muted/50',
              )}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                addFiles(event.dataTransfer.files)
              }}
            >
              <UploadIcon className="text-muted-foreground size-6" aria-hidden="true" />
              <span>{t('files.drop')}</span>
              <span className="text-muted-foreground text-xs">
                {t('files.limits', { files: IMPORT_LIMITS.filesPerBatch })}
              </span>
              <span className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('files.choose')}
              </span>
              <input
                type="file"
                multiple
                accept={ACCEPT}
                className="sr-only"
                disabled={locked || !hydrated}
                onChange={(event) => {
                  addFiles(event.currentTarget.files)
                  event.currentTarget.value = ''
                }}
              />
            </label>
            <ImportFileList
              files={orderedFiles}
              previousBySha={previousBySha}
              repeatedShas={repeatedShas}
              entityTwice={filesCheck.entityTwice}
              disabled={locked}
              onEntityChange={(id, entity) =>
                updateFile(id, (file) => withEntity(file, entity, context))
              }
              onRemove={removeFile}
            />
            {files.length > 1 ? (
              <p className="text-muted-foreground text-xs">{t('files.loadOrder')}</p>
            ) : null}
            {filesCheck.tooMany ? (
              <p className="text-destructive text-sm">
                {t('files.tooManyFiles', { max: IMPORT_LIMITS.filesPerBatch })}
              </p>
            ) : null}
            {files.length > 0 && filesCheck.needEntity ? (
              <p className="text-muted-foreground text-sm">{t('files.needEntity')}</p>
            ) : null}
            {filesCheck.needReady && !files.some((file) => file.inspecting) ? (
              <p className="text-muted-foreground text-sm">{t('files.needReady')}</p>
            ) : null}
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">{t('files.templates')}</summary>
              <p className="text-muted-foreground mt-2 text-xs">{t('files.templatesHint')}</p>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {entitiesInLoadOrder().map((entity) => (
                  <li key={entity.name}>
                    <a
                      href={importLinks.template(entity.name)}
                      download
                      className={cn(
                        'inline-flex items-center gap-1.5 underline-offset-4 hover:underline',
                        entity.name === initialEntity && 'font-medium',
                      )}
                    >
                      <FileSpreadsheetIcon className="size-4" aria-hidden="true" />
                      {t(`entities.${entity.name}`)}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>
      ) : null}

      {step === 'format' && active ? (
        <Card>
          <CardHeader>
            <CardTitle ref={headingRef} tabIndex={-1} className="outline-none">
              {t('format.title')}
            </CardTitle>
            <CardDescription>{t('format.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FilePicker
              id="format-file"
              label={t('format.file')}
              files={orderedFiles}
              value={active.id}
              onChange={setActiveId}
              entityLabel={(entity) => t(`entities.${entity}`)}
            />
            {active.inspecting ? (
              <p className="text-muted-foreground text-sm" aria-live="polite">
                {t('files.reading')}
              </p>
            ) : active.failure || active.inspect?.problems[0] ? (
              <p className="text-destructive text-sm" role="alert">
                {problemText(active.failure ?? active.inspect?.problems[0] ?? { code: 'internal' })}
              </p>
            ) : null}
            <FormatOptions
              key={active.id}
              file={active}
              disabled={locked || active.inspecting}
              onChange={(patch) => changeOptions(active.id, patch)}
              onApplyToAll={files.length > 1 ? () => applyToAll(active) : undefined}
            />
          </CardContent>
        </Card>
      ) : null}

      {step === 'map' && active && active.entity && active.inspect ? (
        <Card>
          <CardHeader>
            <CardTitle ref={headingRef} tabIndex={-1} className="outline-none">
              {t('map.title')}
            </CardTitle>
            <CardDescription>{t('map.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FilePicker
              id="map-file"
              label={t('map.file')}
              files={orderedFiles}
              value={active.id}
              onChange={setActiveId}
              entityLabel={(entity) => t(`entities.${entity}`)}
              invalid={(file) => hasMappingErrors(file)}
            />
            <MappingTable
              key={active.id}
              entity={active.entity}
              header={active.inspect.header}
              mapping={active.mapping}
              issues={mappingIssuesOf(active)}
              labels={displayLabels[active.entity] ?? {}}
              idPrefix={`map-${active.id}`}
              onChange={(column, index) =>
                updateFile(active.id, (file) => ({
                  ...file,
                  mapping: setMapping(file.mapping, column, index),
                  mappingEdited: true,
                }))
              }
            />
            <MappedPreview file={active} labels={displayLabels[active.entity] ?? {}} />
            {!mappingOk ? (
              <p className="text-muted-foreground text-sm">{t('map.blocking')}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 'check' ? (
        <Card>
          <CardHeader>
            <CardTitle ref={headingRef} tabIndex={-1} className="outline-none">
              {t('check.title')}
            </CardTitle>
            <CardDescription>{t('check.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {run.error ? (
              <Alert variant="destructive">
                <AlertDescription>{errorText(run.error)}</AlertDescription>
              </Alert>
            ) : null}
            {run.phase === 'idle' ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-muted-foreground text-sm">{t('check.keepOpen')}</p>
                <Button type="button" onClick={startCheck} disabled={!filesCheck.ok || !mappingOk}>
                  {t('check.start')}
                </Button>
              </div>
            ) : null}
            {run.files.length > 0 ? (
              <ProgressPanel
                label={t('check.perFile')}
                items={run.files.map((file) => checkItem(file))}
              />
            ) : null}
            {run.phase === 'creating' ? (
              <p className="text-muted-foreground text-sm" aria-live="polite">
                {t('check.creating')}
              </p>
            ) : null}
            {run.phase === 'stopped' || run.phase === 'staging' ? (
              <p className="text-muted-foreground text-sm">{t('check.keepOpen')}</p>
            ) : null}
            {(run.phase === 'staging' || run.phase === 'stopped') &&
            run.files.some(
              (file) => (file.state?.error_count ?? 0) + (file.state?.warning_count ?? 0) > 0,
            ) ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-base font-medium">{t('summary.title')}</h3>
                <ErrorSummary files={summaryFiles(run)} examples={[]} labels={displayLabels} />
              </section>
            ) : null}
            {run.phase === 'stopped' ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={retryStaging}>
                  <RotateCcwIcon aria-hidden="true" />
                  {t('check.retry')}
                </Button>
                <Button type="button" variant="outline" onClick={cancelImport}>
                  {t('check.startOver')}
                </Button>
              </div>
            ) : null}
            {run.phase === 'checked' ||
            run.phase === 'committing' ||
            run.phase === 'commitStopped' ||
            run.phase === 'committed' ? (
              <CheckResults
                run={run}
                labels={displayLabels}
                onCommit={() => setStep('commit')}
                onStartOver={cancelImport}
              />
            ) : null}
            {run.phase === 'canceling' ? (
              <p className="text-muted-foreground text-sm" aria-live="polite">
                {t('actions.working')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 'commit' ? (
        <Card>
          <CardHeader>
            <CardTitle ref={headingRef} tabIndex={-1} className="outline-none">
              {t('commit.title')}
            </CardTitle>
            <CardDescription>{t('commit.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {run.batch ? (
              <div className="flex items-center gap-2 text-sm">
                <ImportStatusBadge status={run.batch.status} />
              </div>
            ) : null}
            {run.error ? (
              <Alert variant="destructive">
                <AlertDescription>{errorText(run.error)}</AlertDescription>
              </Alert>
            ) : null}
            {run.phase === 'checked' ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-muted-foreground text-sm">
                  {(run.batch?.rows_staged ?? 0) <= 5_000
                    ? t('commit.atomic')
                    : t('commit.stepped')}
                </p>
                <Button
                  type="button"
                  onClick={startCommit}
                  disabled={run.batch?.status !== 'validated' || (run.batch?.error_count ?? 0) > 0}
                >
                  {t('commit.start')}
                </Button>
                {run.batch?.status !== 'validated' ? (
                  <p className="text-muted-foreground text-sm">{t('commit.needValid')}</p>
                ) : null}
              </div>
            ) : null}
            {run.phase === 'committing' || run.phase === 'commitStopped' ? (
              <div className="flex flex-col gap-2">
                <Progress
                  value={Math.round(run.fraction * 1000) / 10}
                  aria-label={t('commit.running')}
                />
                <p className="text-muted-foreground text-sm" aria-live="polite">
                  {run.phase === 'committing' ? `${t('commit.running')} ` : null}
                  {t('commit.progress', { percent: run.fraction })}
                </p>
              </div>
            ) : null}
            {partial && run.batch ? (
              <PartialBanner
                done={applied}
                total={run.batch.rows_staged}
                stopped={partial === 'stopped'}
              />
            ) : null}
            {run.phase === 'commitStopped' ? (
              <CommitStopped
                batch={run.batch}
                batchId={run.batchId}
                onResume={resumeCommit}
                onContinue={startCommit}
                onCancel={cancelImport}
                onStartAnother={startAnother}
              />
            ) : null}
            {run.phase === 'commitStopped' &&
            (run.batch?.status === 'invalid' || run.batch?.status === 'failed') ? (
              <ErrorSummary
                files={summaryFiles(run)}
                examples={run.examples}
                labels={displayLabels}
              />
            ) : null}
            {run.phase === 'committed' ? (
              <div className="flex flex-col gap-4">
                <Alert role="status">
                  <AlertTitle>{t('commit.succeeded')}</AlertTitle>
                </Alert>
                <CountsTable counts={run.batch?.counts} />
                <div className="flex flex-wrap gap-2">
                  {run.batchId ? (
                    <Link
                      href={`/imports/${run.batchId}`}
                      prefetch={false}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      {t('commit.viewImport')}
                    </Link>
                  ) : null}
                  <Link
                    href="/imports"
                    prefetch={false}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    {t('commit.history')}
                  </Link>
                  <Button type="button" size="sm" onClick={startAnother}>
                    {t('commit.another')}
                  </Button>
                </div>
              </div>
            ) : null}
            {run.phase === 'canceling' ? (
              <p className="text-muted-foreground text-sm" aria-live="polite">
                {t('actions.working')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 'files' || step === 'format' || step === 'map' ? (
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={stepIndex === 0}
            onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)] ?? 'files')}
          >
            <ArrowLeftIcon className="rtl:rotate-180" aria-hidden="true" />
            {t('actions.back')}
          </Button>
          <Button
            type="button"
            disabled={!canReach(STEPS[stepIndex + 1] ?? 'check')}
            onClick={() => setStep(STEPS[stepIndex + 1] ?? 'check')}
          >
            {t('actions.next')}
            <ArrowRightIcon className="rtl:rotate-180" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function summaryFiles(run: RunState): SummaryFile[] {
  return run.files.flatMap((file) =>
    file.state
      ? [
          {
            file_no: file.fileNo,
            entity: file.entity,
            name: file.name,
            error_counts: file.state.error_counts ?? {},
            error_count: file.state.error_count,
            warning_count: file.state.warning_count,
            errors_stored: file.state.errors_stored,
          },
        ]
      : [],
  )
}

/** A select of the batch's files (format and mapping are set per file). */
function FilePicker({
  id,
  label,
  files,
  value,
  onChange,
  entityLabel,
  invalid,
}: {
  id: string
  label: string
  files: readonly WizardFile[]
  value: string
  onChange: (id: string) => void
  entityLabel: (entity: EntityName) => string
  invalid?: (file: WizardFile) => boolean
}) {
  if (files.length < 2) return null
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="w-full max-w-xl"
      >
        {files.map((file) => (
          <NativeSelectOption key={file.id} value={file.id}>
            {`${invalid?.(file) ? '⚠ ' : ''}${file.file.name}${file.entity ? ` — ${entityLabel(file.entity)}` : ''}`}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

/** The first rows normalized as staging will send them, with what the preview noticed. */
function MappedPreview({
  file,
  labels,
}: {
  file: WizardFile
  labels: Readonly<Record<string, string>>
}) {
  const t = useTranslations('ImportsClient')
  const preview = useMemo(() => {
    if (!file.entity || !file.inspect) return null
    const entity = getEntity(file.entity)
    const sources = sourceIndexes(file.entity, file.mapping)
    const plan = {
      columns: entity.columns,
      sources,
      options: {
        decimalSeparator: file.options.decimalSeparator,
        dateOrder: file.options.dateOrder,
        date1904: file.inspect.date1904,
      },
    }
    const issues: IssueSummary = {}
    const rows = file.inspect.preview.map((cells, rowIndex) =>
      normalizeRow(plan, cells, (issue: NormalizeIssue, columnIndex) => {
        const entry = (issues[issue] ??= { count: 0, examples: [] })
        entry.count += 1
        if (entry.examples.length < 5) {
          entry.examples.push({
            row: rowIndex + 1,
            column: entity.columns[columnIndex]?.name,
            value: displayRawCell(cells[sources[columnIndex] ?? -1]).slice(0, 200),
          })
        }
      }),
    )
    const provided = entity.columns.flatMap((column, index) =>
      sources[index] === null ? [] : [{ column, index }],
    )
    return {
      columns: provided.map(({ column }) => ({
        key: column.name,
        label: labels[column.name] ?? column.name,
        name: column.name,
        ltr: !TEXT_KINDS.has(column.kind),
      })),
      rows: rows.map((row) => provided.map(({ index }) => row[index] ?? null)),
      issues,
    }
  }, [file, labels])

  if (!preview || preview.columns.length === 0 || preview.rows.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t('map.preview')}</h3>
      <p className="text-muted-foreground text-xs">
        {t('map.previewHint', { count: preview.rows.length })}
      </p>
      <PreviewTable columns={preview.columns} rows={preview.rows} emptyLabel={t('summary.empty')} />
      {hasReadIssues(preview.issues) ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium">{t('map.previewIssues')}</h4>
          <ReadIssues issues={preview.issues} labels={labels} />
        </div>
      ) : null}
    </div>
  )
}

/** The outcome of the check: totals per file, read issues, errors with examples, the report. */
function CheckResults({
  run,
  labels,
  onCommit,
  onStartOver,
}: {
  run: RunState
  labels: ColumnLabelMap
  onCommit: () => void
  onStartOver: () => void
}) {
  const t = useTranslations('ImportsClient')
  const format = useFormatter()
  const batch = run.batch
  const errors = batch?.error_count ?? 0
  const warnings = batch?.warning_count ?? 0
  const totals = run.files.reduce(
    (sum, file) => ({
      new: sum.new + (file.state?.rows_new ?? 0),
      existing: sum.existing + (file.state?.rows_existing ?? 0),
    }),
    { new: 0, existing: 0 },
  )
  const filesWithReadIssues = run.files.filter((file) => hasReadIssues(file.issues))
  const checked = run.phase === 'checked'

  return (
    <div className="flex flex-col gap-4">
      {errors > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>{t('check.invalid', { count: errors })}</AlertDescription>
        </Alert>
      ) : (
        <Alert role="status">
          <AlertDescription>
            {t('check.valid', { new: totals.new, existing: totals.existing })}
            {warnings > 0 ? ` ${t('check.warningsOnly', { count: warnings })}` : null}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {checked && errors === 0 && batch?.status === 'validated' ? (
          <Button type="button" onClick={onCommit}>
            {t('actions.next')}
            <ArrowRightIcon className="rtl:rotate-180" aria-hidden="true" />
          </Button>
        ) : null}
        {errors + warnings > 0 && run.batchId ? (
          <a
            href={importLinks.errorReport(run.batchId)}
            className={buttonVariants({ variant: 'outline' })}
          >
            <DownloadIcon aria-hidden="true" />
            {t('check.downloadReport')}
          </a>
        ) : null}
        {checked ? (
          <Button type="button" variant="outline" onClick={onStartOver}>
            {t('check.startOver')}
          </Button>
        ) : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('files.name')}</TableHead>
            <TableHead>{t('files.entity')}</TableHead>
            <TableHead className="text-end">{t('check.rowsTotal')}</TableHead>
            <TableHead className="text-end">{t('check.newRows')}</TableHead>
            <TableHead className="text-end">{t('check.existingRows')}</TableHead>
            <TableHead className="text-end">{t('check.errors')}</TableHead>
            <TableHead className="text-end">{t('check.warnings')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {run.files.map((file) => (
            <TableRow key={file.id}>
              <TableCell className="max-w-64 truncate">
                <bdi title={file.name}>{file.name}</bdi>
              </TableCell>
              <TableCell>{t(`entities.${file.entity}`)}</TableCell>
              <TableCell className="text-end tabular-nums">
                {format.number(file.rowsTotal ?? 0)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {format.number(file.state?.rows_new ?? 0)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {format.number(file.state?.rows_existing ?? 0)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-end tabular-nums',
                  (file.state?.error_count ?? 0) > 0 && 'text-destructive',
                )}
              >
                {format.number(file.state?.error_count ?? 0)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {format.number(file.state?.warning_count ?? 0)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {filesWithReadIssues.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('check.readIssues')}</h3>
          <p className="text-muted-foreground text-xs">{t('check.readIssuesHint')}</p>
          {filesWithReadIssues.map((file) => (
            <div key={file.id} className="flex flex-col gap-1">
              <bdi className="text-sm font-medium">{file.name}</bdi>
              <ReadIssues issues={file.issues} labels={labels[file.entity]} />
            </div>
          ))}
        </section>
      ) : null}
      {errors + warnings > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-base font-medium">{t('summary.title')}</h3>
          <ErrorSummary files={summaryFiles(run)} examples={run.examples} labels={labels} />
        </section>
      ) : null}
    </div>
  )
}

/**
 * Why a commit stopped and what can be done: resume or abandon a failed stepped commit, start
 * over after an invalid one, or start another import once it expired. The error report and the
 * import's page stay one click away.
 */
function CommitStopped({
  batch,
  batchId,
  onResume,
  onContinue,
  onCancel,
  onStartAnother,
}: {
  batch: BatchState | null
  batchId: string | null
  onResume: () => void
  onContinue: () => void
  onCancel: () => void
  onStartAnother: () => void
}) {
  const t = useTranslations('ImportsClient')
  const status = batch?.status
  const failure = batch?.failure_code
  const stopped = status === 'failed' || status === 'invalid' || status === 'expired'
  const issues = (batch?.error_count ?? 0) + (batch?.warning_count ?? 0)
  return (
    <div className="flex flex-col gap-3">
      {stopped ? (
        <Alert variant="destructive">
          <AlertTitle>
            {status === 'invalid'
              ? t('commit.invalid')
              : status === 'expired'
                ? t('commit.expired')
                : t('commit.failed')}
          </AlertTitle>
          {failure && isFailureCode(failure) ? (
            <AlertDescription>{t(`failure.${failure}`)}</AlertDescription>
          ) : null}
        </Alert>
      ) : null}
      {stopped && batchId ? (
        <div className="flex flex-wrap gap-2">
          {issues > 0 ? (
            <a
              href={importLinks.errorReport(batchId)}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <DownloadIcon aria-hidden="true" />
              {t('check.downloadReport')}
            </a>
          ) : null}
          <Link
            href={`/imports/${batchId}`}
            prefetch={false}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('commit.viewImport')}
          </Link>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === 'expired' ? (
          <Button type="button" onClick={onStartAnother}>
            {t('commit.another')}
          </Button>
        ) : null}
        {status === 'failed' ? (
          <>
            <Button type="button" onClick={onResume}>
              {t('actions.resume')}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('actions.abandon')}
            </Button>
          </>
        ) : null}
        {status === 'committing' || status === 'validated' ? (
          <Button type="button" onClick={onContinue}>
            {t('actions.continueCommit')}
          </Button>
        ) : null}
        {status === 'invalid' || status === 'validated' ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('check.startOver')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
