'use client'
import { startTransition, useActionState, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import {
  loadSourcingOptions,
  type SourcingOptionsState,
} from '@/app/(app)/replenishment/regional-stock/sourcing/actions'
import type { SourcingChoices } from '@/lib/regional-sourcing'
import { idleState } from '@/lib/forms'

export type SourceSelection = {
  location_id: string
  policy_id: string
  maximum: string
  backorders: string
}
export function RegionalSourcingSource({
  organizationId,
  regionId,
  draftId,
  location,
  initial,
  value,
  onChange,
  disabled,
}: {
  organizationId: string
  regionId: string
  draftId: string
  location: { id: string; code: string; name: string }
  initial: SourcingChoices
  value: SourceSelection
  onChange: (value: SourceSelection) => void
  disabled: boolean
}) {
  const t = useTranslations('RegionalSourcing'),
    format = useFormatter()
  const [state, load, pending] = useActionState(
    loadSourcingOptions,
    idleState as SourcingOptionsState,
  )
  const choices = state.choices ?? initial
  const [selectedRevision, setSelectedRevision] = useState<SourcingChoices['revisions'][number]>()
  const revisions =
    selectedRevision && !choices.revisions.some((v) => v.id === selectedRevision.id)
      ? [selectedRevision, ...choices.revisions]
      : choices.revisions
  function fetchOptions(policy: string, page: number, revisionPage: number) {
    const form = new FormData()
    for (const [key, v] of Object.entries({
      organization_id: organizationId,
      region: regionId,
      draft: draftId,
      location: location.id,
      policy,
      page: String(page),
      revisionPage: String(revisionPage),
    }))
      form.set(key, v)
    startTransition(() => load(form))
  }
  const field = 'min-w-0 w-full rounded-md border bg-background px-3 py-2'
  return (
    <fieldset
      disabled={disabled || pending}
      className="min-w-0 space-y-3 rounded-md border p-3"
      aria-label={location.code}
    >
      <legend className="px-1 text-subsection-title">
        <bdi>{location.code}</bdi> · {location.name}
      </legend>
      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        <label className="grid min-w-0 gap-1 text-sm">
          {t('policy')}
          <select
            className={field}
            value={value.policy_id}
            required
            onChange={(e) => {
              onChange({ ...value, policy_id: e.target.value, maximum: '' })
              setSelectedRevision(undefined)
              fetchOptions(e.target.value, choices.page, 1)
            }}
          >
            <option value="">{t('choose')}</option>
            {choices.policies.map((p) => (
              <option key={p.id} value={p.id}>
                {format.dateTime(new Date(p.saved), 'long')} · {p.maximum} · {p.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          {t('maximum')}
          <select
            className={field}
            value={value.maximum}
            required
            disabled={!value.policy_id || pending || choices.policyId !== value.policy_id}
            onChange={(e) => {
              onChange({ ...value, maximum: e.target.value })
              setSelectedRevision(revisions.find((r) => r.id === e.target.value))
            }}
          >
            <option value="">{t('choose')}</option>
            <option value="calculated">{t('calculated')}</option>
            {revisions.map((r) => (
              <option key={r.id} value={r.id}>
                {t('approved', { revision: r.revision })} · {r.maximum}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          {t('backorders')}
          <input
            className={field}
            inputMode="decimal"
            value={value.backorders}
            required
            maxLength={19}
            onChange={(e) => onChange({ ...value, backorders: e.target.value })}
          />
        </label>
      </div>
      {!choices.policies.length && (
        <p role="status" className="text-sm">
          {t('noPolicies')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {choices.pages > 1 && (
          <>
            <span>{t('policyPage', { page: choices.page, pages: choices.pages })}</span>
            <button
              type="button"
              className="min-h-11 underline"
              disabled={choices.page <= 1}
              onClick={() => fetchOptions(value.policy_id, choices.page - 1, choices.revisionPage)}
            >
              {t('previous')}
            </button>
            <button
              type="button"
              className="min-h-11 underline"
              disabled={choices.page >= choices.pages}
              onClick={() => fetchOptions(value.policy_id, choices.page + 1, choices.revisionPage)}
            >
              {t('next')}
            </button>
          </>
        )}
        {value.policy_id && choices.revisionPages > 1 && (
          <>
            <span>
              {t('revisionPage', { page: choices.revisionPage, pages: choices.revisionPages })}
            </span>
            <button
              type="button"
              className="min-h-11 underline"
              disabled={choices.revisionPage <= 1}
              onClick={() => fetchOptions(value.policy_id, choices.page, choices.revisionPage - 1)}
            >
              {t('previousMaxima')}
            </button>
            <button
              type="button"
              className="min-h-11 underline"
              disabled={choices.revisionPage >= choices.revisionPages}
              onClick={() => fetchOptions(value.policy_id, choices.page, choices.revisionPage + 1)}
            >
              {t('nextMaxima')}
            </button>
          </>
        )}
        {pending && <span role="status">{t('working')}</span>}
      </div>
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </fieldset>
  )
}
