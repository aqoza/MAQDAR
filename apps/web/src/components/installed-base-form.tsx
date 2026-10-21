'use client'

import { useActionState, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewPopulation,
  savePopulation,
  type PopulationPreviewState,
} from '@/app/(app)/forecasts/installed-base/actions'
import {
  populationInputSchema,
  parsePopulationCsv,
  populationTemplate,
  POPULATION_FILE_BYTES,
  type PopulationRow,
} from '@/lib/installed-base'
import { idleState } from '@/lib/forms'
import { InstalledBaseReport } from './installed-base-report'

const subscribeHydration = () => () => {}

export function InstalledBaseForm({
  organizationId,
  requestId,
  defaults,
}: {
  organizationId: string
  requestId: string
  defaults: { as_of: string; available_on: string }
}) {
  const t = useTranslations('InstalledBase')
  // Controlled inputs must not accept edits before their change handlers are attached.
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  )
  const [state, preview, pending] = useActionState(
    previewPopulation,
    idleState as PopulationPreviewState,
  )
  const [saved, save, saving] = useActionState(savePopulation, idleState)
  const [fields, setFields] = useState({
    item_code: '',
    location_code: '',
    dataset_name: '',
    unit: '',
    source: '',
    ...defaults,
  })
  const [confirmed, setConfirmed] = useState(false)
  const [nonOverlapping, setNonOverlapping] = useState(false)
  const [rows, setRows] = useState<PopulationRow[]>([])
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const generation = useRef(0)
  const current = populationInputSchema.safeParse({
    ...fields,
    confirmed,
    non_overlapping: nonOverlapping,
    rows,
  })
  const report =
    !reading && current.success && JSON.stringify(current.data) === JSON.stringify(state.input)
      ? state.report
      : undefined
  async function readFile(file?: File) {
    const version = ++generation.current
    setRows([])
    setFileError('')
    setReading(true)
    try {
      if (!file) return
      if (!file.name.toLowerCase().endsWith('.csv') || file.size > POPULATION_FILE_BYTES) {
        setFileError(t('csvFile'))
        return
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (version !== generation.current) return
      const result = parsePopulationCsv(text)
      if (!result.ok)
        setFileError(result.row ? t('csvRow', { row: result.row }) : t(`csvErrors.${result.code}`))
      else setRows(result.rows)
    } catch {
      if (version === generation.current) setFileError(t('csvFile'))
    } finally {
      if (version === generation.current) setReading(false)
    }
  }
  return (
    <div className="space-y-4">
      <form
        action={preview}
        onReset={(e) => e.preventDefault()}
        className="space-y-4 workspace-panel"
        aria-label={t('entry')}
      >
        <input type="hidden" name="organization_id" value={organizationId} />
        <input
          type="hidden"
          name="input"
          value={JSON.stringify({ ...fields, confirmed, non_overlapping: nonOverlapping, rows })}
        />
        <fieldset disabled={!hydrated || saving || pending} className="min-w-0 space-y-4">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                'item_code',
                'location_code',
                'dataset_name',
                'unit',
                'as_of',
                'available_on',
              ] as const
            ).map((key) => (
              <label key={key} className="grid min-w-0 gap-1 text-sm">
                {t(key)}
                <input
                  required
                  value={fields[key]}
                  type={key === 'as_of' || key === 'available_on' ? 'date' : 'text'}
                  maxLength={key === 'unit' ? 80 : key === 'dataset_name' ? 200 : 100}
                  onChange={(e) => {
                    const value = e.currentTarget.value
                    setFields((previous) => ({ ...previous, [key]: value }))
                  }}
                  className="min-w-0 w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
            ))}
            <label className="grid min-w-0 gap-1 text-sm sm:col-span-2">
              {t('source')}
              <textarea
                required
                maxLength={2000}
                rows={2}
                value={fields.source}
                onChange={(e) => {
                  const source = e.currentTarget.value
                  setFields((previous) => ({ ...previous, source }))
                }}
                className="min-w-0 w-full rounded-md border bg-background px-3 py-2"
              />
            </label>
          </div>
          <div className="grid gap-2">
            <label className="grid gap-1 text-sm">
              {t('csv')}
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={pending || saving}
                onChange={(e) => void readFile(e.target.files?.[0])}
                className="min-w-0 w-full rounded-md border px-3 py-2"
              />
            </label>
            <a
              className="w-fit underline"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(populationTemplate)}`}
              download="installed-base-template.csv"
            >
              {t('template')}
            </a>
            <p className="text-xs text-muted-foreground">{t('csvContract')}</p>
            {fileError && (
              <p role="alert" className="text-sm text-destructive">
                {fileError}
              </p>
            )}
            {rows.length > 0 && (
              <p role="status" className="text-xs">
                {t('loaded', { count: rows.length })}
              </p>
            )}
          </div>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t('confirm')}
          </label>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={nonOverlapping}
              onChange={(e) => setNonOverlapping(e.target.checked)}
            />
            {t('confirmNonOverlap')}
          </label>
          {state.status === 'error' && (
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          )}
          <button
            className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            disabled={pending || reading || saving || !rows.length}
          >
            {t(pending ? 'working' : 'preview')}
          </button>
        </fieldset>
      </form>
      {report && (
        <>
          <InstalledBaseReport key={report.fingerprint} report={report} />
          {report.input.confirmed && report.input.non_overlapping && (
            <form action={save} className="space-y-2">
              {Object.entries({
                organization_id: organizationId,
                input: JSON.stringify(report.input),
                request_id: requestId,
                fingerprint: report.fingerprint,
              }).map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}
              {saved.status === 'error' && (
                <p role="alert" className="text-sm text-destructive">
                  {saved.message}
                </p>
              )}
              <button
                className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                disabled={saving || pending}
              >
                {t(saving ? 'working' : 'save')}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  )
}
