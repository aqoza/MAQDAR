'use client'

import { BanIcon, PlayIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useActionState, useEffect, useRef, useState } from 'react'
import { deleteImport } from '@/app/(app)/imports/actions'
import { ActiveOrganizationField } from '@/components/active-organization'
import { FormMessage } from '@/components/master-data/form-message'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { idleState } from '@/lib/forms'
import {
  apiErrorKey,
  commitFraction,
  createImportClient,
  type ApiErrorKey,
  type ImportStatus,
} from '@/lib/imports/client'
import type { EntityName } from '@/lib/imports/contract'

export type ImportActionsProps = {
  batchId: string
  status: ImportStatus
  /** A committing import without a step for 30 minutes (cancel then abandons it). */
  idle?: boolean
  errorCount: number
  /** Files in any order (commit progress follows load order). */
  files: readonly { file_no: number; entity: EntityName; rows_total: number }[]
  deleteTitle: string
  deleteDescription: string
}

/**
 * What can be done with an import from its page: commit a checked import, continue or resume a
 * stepped commit, abandon or cancel, and delete a finished one. Commits and cancels loop through
 * the route handlers (no files needed); the page re-renders from the server afterwards.
 */
export function ImportActions({
  batchId,
  status,
  idle = false,
  errorCount,
  files,
  deleteTitle,
  deleteDescription,
}: ImportActionsProps) {
  const t = useTranslations('ImportsClient')
  const tCommon = useTranslations('MasterDataClient')
  const router = useRouter()
  const [working, setWorking] = useState<'commit' | 'cancel' | null>(null)
  const [fraction, setFraction] = useState(0)
  const [error, setError] = useState<ApiErrorKey | null>(null)
  const [deleteState, deleteAction, deleting] = useActionState(deleteImport, idleState)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (!working) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [working])

  function client() {
    controller.current ??= new AbortController()
    return createImportClient({ signal: controller.current.signal })
  }

  async function commit(resumeFirst: boolean) {
    setWorking('commit')
    setError(null)
    try {
      const imports = client()
      if (resumeFirst) await imports.resume(batchId)
      await imports.commit(
        batchId,
        (state) => setFraction((current) => Math.max(current, commitFraction(files, state))),
        { status, rows_staged: files.reduce((sum, file) => sum + file.rows_total, 0) },
      )
    } catch (caught) {
      if (controller.current?.signal.aborted) return
      setError(apiErrorKey(caught))
    }
    setWorking(null)
    router.refresh()
  }

  async function cancel() {
    setWorking('cancel')
    setError(null)
    try {
      await client().cancel(batchId)
    } catch (caught) {
      if (controller.current?.signal.aborted) return
      setError(apiErrorKey(caught))
    }
    setWorking(null)
    router.refresh()
  }

  const busy = working !== null
  const canCancel = status === 'staging' || status === 'validated' || status === 'invalid'
  const canDelete = status === 'succeeded' || status === 'canceled' || status === 'expired'

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{t(`apiErrors.${error}`)}</AlertDescription>
        </Alert>
      ) : null}
      {working === 'commit' ? (
        <div className="flex flex-col gap-1.5">
          <Progress value={Math.round(fraction * 1000) / 10} aria-label={t('commit.running')} />
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {t('commit.running')} {t('commit.progress', { percent: fraction })}
          </p>
        </div>
      ) : null}
      {working === 'cancel' ? (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {t('actions.working')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === 'validated' && errorCount === 0 ? (
          <Button type="button" disabled={busy} onClick={() => commit(false)}>
            <PlayIcon aria-hidden="true" />
            {t('actions.commit')}
          </Button>
        ) : null}
        {status === 'committing' ? (
          <Button type="button" disabled={busy} onClick={() => commit(false)}>
            <PlayIcon aria-hidden="true" />
            {t('actions.continueCommit')}
          </Button>
        ) : null}
        {status === 'committing' && idle ? (
          <ConfirmButton
            label={t('actions.abandon')}
            title={t('actions.confirmAbandonTitle')}
            description={t('actions.confirmAbandon')}
            keep={t('actions.keep')}
            disabled={busy}
            onConfirm={cancel}
          />
        ) : null}
        {status === 'failed' ? (
          <>
            <Button type="button" disabled={busy} onClick={() => commit(true)}>
              <RotateCcwIcon aria-hidden="true" />
              {t('actions.resume')}
            </Button>
            <ConfirmButton
              label={t('actions.abandon')}
              title={t('actions.confirmAbandonTitle')}
              description={t('actions.confirmAbandon')}
              keep={t('actions.keep')}
              disabled={busy}
              onConfirm={cancel}
            />
          </>
        ) : null}
        {canCancel ? (
          <ConfirmButton
            label={t('actions.cancel')}
            title={t('actions.confirmCancelTitle')}
            description={t('actions.confirmCancel')}
            keep={t('actions.keep')}
            disabled={busy}
            onConfirm={cancel}
          />
        ) : null}
        {canDelete ? (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" />}>
              <Trash2Icon aria-hidden="true" />
              {t('actions.delete')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
                <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
              </AlertDialogHeader>
              {deleteState.status === 'error' ? <FormMessage state={deleteState} /> : null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>{t('actions.keep')}</AlertDialogCancel>
                <form action={deleteAction}>
                  <ActiveOrganizationField />
                  <input type="hidden" name="batch_id" value={batchId} />
                  <AlertDialogAction
                    type="submit"
                    variant="destructive"
                    disabled={deleting}
                    className="w-full"
                  >
                    {deleting ? tCommon('deleting') : t('actions.delete')}
                  </AlertDialogAction>
                </form>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </div>
  )
}

function ConfirmButton({
  label,
  title,
  description,
  keep,
  disabled,
  onConfirm,
}: {
  label: string
  title: string
  description: string
  keep: string
  disabled: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" disabled={disabled} />}>
        <BanIcon aria-hidden="true" />
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{keep}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
