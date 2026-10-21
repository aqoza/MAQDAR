'use client'

import { useActionState, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewInstalledDemand,
  saveInstalledDemand,
  type InstalledDemandPreviewState,
} from '@/app/(app)/forecasts/installed-base/demand/actions'
import {
  installedDemandInputSchema,
  parseReplacementRates,
  replacementRateSchema,
  rateTemplate,
  RATE_FILE_BYTES,
} from '@/lib/installed-base-demand'
import type { PopulationReport } from '@/lib/installed-base'
import { idleState } from '@/lib/forms'
import { InstalledBaseDemandReport } from './installed-base-demand-report'

const subscribeHydration = () => () => {}
export function InstalledBaseDemandForm({
  organizationId,
  requestId,
  datasetId,
  population,
  cutoff,
}: {
  organizationId: string
  requestId: string
  datasetId: string
  population: PopulationReport
  cutoff: string
}) {
  const t = useTranslations('InstalledBaseDemand')
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  )
  const [state, preview, pending] = useActionState(
    previewInstalledDemand,
    idleState as InstalledDemandPreviewState,
  )
  const [saved, save, saving] = useActionState(saveInstalledDemand, idleState)
  const [fields, setFields] = useState({ scenario_name: '', cutoff, horizon_days: '28' })
  const [confirmed, setConfirmed] = useState(false)
  const [rates, setRates] = useState(
    population.groups.map((g) => ({
      group_code: g.group_code,
      daily_rate: '',
      source: '',
      available_on: '',
    })),
  )
  const [page, setPage] = useState(1)
  const [reading, setReading] = useState(false)
  const [fileError, setFileError] = useState('')
  const generation = useRef(0)
  const pages = Math.ceil(rates.length / 25)
  const input = {
    dataset_id: datasetId,
    ...fields,
    horizon_days: fields.horizon_days.trim() ? Number(fields.horizon_days) : null,
    confirmed,
    rates,
  }
  const current = installedDemandInputSchema.safeParse(input)
  const report =
    !reading &&
    !fileError &&
    current.success &&
    JSON.stringify(current.data) === JSON.stringify(state.input)
      ? state.report
      : undefined
  const completeRates = rates.filter(
    (r) => replacementRateSchema.safeParse(r).success && r.available_on <= fields.cutoff,
  ).length
  async function readFile(file?: File) {
    const version = ++generation.current
    setReading(true)
    setFileError('')
    try {
      if (!file) return
      if (!file.name.toLowerCase().endsWith('.csv') || file.size > RATE_FILE_BYTES) {
        setFileError(t('csvFile'))
        return
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (version !== generation.current) return
      const result = parseReplacementRates(
        text,
        population.groups.map((g) => g.group_code),
      )
      if (!result.ok)
        setFileError(result.row ? t('csvRow', { row: result.row }) : t(`csvErrors.${result.code}`))
      else {
        const byCode = new Map(result.rates.map((r) => [r.group_code, r]))
        setRates(population.groups.map((g) => byCode.get(g.group_code)!))
        setPage(1)
      }
    } catch {
      if (version === generation.current) setFileError(t('csvFile'))
    } finally {
      if (version === generation.current) setReading(false)
    }
  }
  return (
    <div className="min-w-0 space-y-4">
      <form
        action={preview}
        onReset={(e) => e.preventDefault()}
        className="min-w-0 space-y-4 workspace-panel"
        aria-label={t('entry')}
      >
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="input" value={JSON.stringify(input)} />
        <fieldset
          disabled={!hydrated || pending || saving || reading}
          className="min-w-0 space-y-4"
        >
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            {(['scenario_name', 'cutoff', 'horizon_days'] as const).map((key) => (
              <label key={key} className="grid min-w-0 gap-1 text-sm">
                {t(key)}
                <input
                  required
                  type={key === 'cutoff' ? 'date' : key === 'horizon_days' ? 'number' : 'text'}
                  min={key === 'horizon_days' ? 1 : undefined}
                  max={key === 'horizon_days' ? 90 : undefined}
                  step={key === 'horizon_days' ? 1 : undefined}
                  maxLength={200}
                  value={fields[key]}
                  onChange={(e) => {
                    const value = e.currentTarget.value
                    setFields((f) => ({ ...f, [key]: value }))
                  }}
                  className="min-w-0 w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
            ))}
          </div>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm">{t('csvHelp')}</summary>
            <label className="mt-3 grid gap-1 text-sm">
              {t('csv')}
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void readFile(e.target.files?.[0])}
                className="min-w-0 w-full rounded-md border px-3 py-2"
              />
            </label>
            <a
              className="inline-flex min-h-11 items-center underline"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(rateTemplate(population.groups.map((g) => g.group_code)))}`}
              download="replacement-rates.csv"
            >
              {t('template')}
            </a>
            <p className="text-xs text-muted-foreground">{t('csvContract')}</p>
          </details>
          {fileError && (
            <p role="alert" className="text-sm text-destructive">
              {fileError}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t('rateHelp')}</p>
          <p role="status" className="text-xs">
            {t('rateProgress', { count: completeRates, total: rates.length })}
          </p>
          <div className="space-y-3">
            {rates.slice((page - 1) * 25, page * 25).map((rate) => {
              const group = population.groups.find((g) => g.group_code === rate.group_code)!
              return (
                <fieldset key={rate.group_code} className="min-w-0 rounded-md border p-3">
                  <legend className="max-w-full break-words px-1 text-subsection-title">
                    <bdi>
                      {group.group_code} · {group.group_name}
                    </bdi>
                  </legend>
                  <p className="mb-2 text-xs">
                    {t('installed_quantity')}:{' '}
                    <bdi>
                      {group.installed_quantity} {population.input.unit}
                    </bdi>
                  </p>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(['daily_rate', 'available_on', 'source'] as const).map((key) => (
                      <label
                        key={key}
                        className={`grid min-w-0 gap-1 text-sm ${key === 'source' ? 'sm:col-span-2 lg:col-span-1' : ''}`}
                      >
                        {t(key)}
                        <input
                          required
                          type={key === 'available_on' ? 'date' : 'text'}
                          inputMode={key === 'daily_rate' ? 'decimal' : undefined}
                          maxLength={key === 'source' ? 1000 : key === 'daily_rate' ? 16 : 10}
                          value={rate[key]}
                          onChange={(e) => {
                            const value = e.currentTarget.value
                            setFileError('')
                            setRates((rows) =>
                              rows.map((r) =>
                                r.group_code === rate.group_code ? { ...r, [key]: value } : r,
                              ),
                            )
                          }}
                          className="min-w-0 w-full rounded-md border bg-background px-3 py-2"
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              )
            })}
          </div>
          {pages > 1 && (
            <nav aria-label={t('ratePages')} className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="min-h-11 rounded-md border px-3 disabled:opacity-50"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('previous')}
              </button>
              <span className="text-sm">{t('page', { page, pages })}</span>
              <button
                type="button"
                className="min-h-11 rounded-md border px-3 disabled:opacity-50"
                disabled={page === pages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('next')}
              </button>
            </nav>
          )}
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t('confirm')}
          </label>
          {state.status === 'error' && (
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          )}
          <button
            className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            disabled={pending || saving || reading || !!fileError || !current.success}
          >
            {t(pending ? 'working' : 'preview')}
          </button>
        </fieldset>
      </form>
      {report && (
        <>
          <InstalledBaseDemandReport key={report.fingerprint} report={report} />
          {report.input.confirmed && (
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
