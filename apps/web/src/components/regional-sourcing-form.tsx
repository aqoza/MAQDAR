'use client'
import { startTransition, useActionState, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewRegionalSourcing,
  saveRegionalSourcing,
  type SourcingPreviewState,
} from '@/app/(app)/replenishment/regional-stock/sourcing/actions'
import { regionalSourcingInputSchema, type SourcingChoices } from '@/lib/regional-sourcing'
import { idleState } from '@/lib/forms'
import { RegionalSourcingSource, type SourceSelection } from './regional-sourcing-source'
import { RegionalSourcingReport } from './regional-sourcing-report'
const subscribe = () => () => {}
export function RegionalSourcingForm({
  organizationId,
  regionId,
  draftId,
  requestId,
  sources,
}: {
  organizationId: string
  regionId: string
  draftId: string
  requestId: string
  sources: { id: string; code: string; name: string; choices: SourcingChoices }[]
}) {
  const t = useTranslations('RegionalSourcing')
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const [selections, setSelections] = useState<SourceSelection[]>(
    sources.map((s) => ({ location_id: s.id, policy_id: '', maximum: '', backorders: '' })),
  )
  const [commitments, setCommitments] = useState(false),
    [lanes, setLanes] = useState(false)
  const [state, preview, pending] = useActionState(
    previewRegionalSourcing,
    idleState as SourcingPreviewState,
  )
  const [saved, save, saving] = useActionState(saveRegionalSourcing, idleState)
  const [submitted, setSubmitted] = useState<string>()
  const input = {
    region_id: regionId,
    draft_id: draftId,
    sources: selections,
    commitments_confirmed: commitments,
    lanes_confirmed: lanes,
  }
  const parsed = regionalSourcingInputSchema.safeParse(input)
  const current =
    parsed.success && state.input && JSON.stringify(parsed.data) === JSON.stringify(state.input)
  const disabled = !hydrated || pending || saving
  const button =
    'min-h-11 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50'
  return (
    <div className="min-w-0 space-y-4">
      <form
        className="min-w-0 space-y-3 workspace-panel"
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          startTransition(() => preview(form))
        }}
      >
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="input" value={JSON.stringify(input)} />
        {sources.map((source, index) => (
          <RegionalSourcingSource
            key={source.id}
            organizationId={organizationId}
            regionId={regionId}
            draftId={draftId}
            location={source}
            initial={source.choices}
            value={selections[index]}
            disabled={disabled}
            onChange={(value) =>
              setSelections((old) =>
                old.map((v) => (v.location_id === value.location_id ? value : v)),
              )
            }
          />
        ))}
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            disabled={disabled}
            checked={commitments}
            onChange={(e) => setCommitments(e.target.checked)}
          />
          <span>{t('commitments')}</span>
        </label>
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            disabled={disabled}
            checked={lanes}
            onChange={(e) => setLanes(e.target.checked)}
          />
          <span>{t('lanes')}</span>
        </label>
        {state.status === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
        <button className={button} disabled={disabled || !parsed.success}>
          {pending ? t('working') : t('preview')}
        </button>
      </form>
      {current && state.report && (
        <>
          <RegionalSourcingReport report={state.report} />
          {state.report.status === 'available' && (
            <form
              action={save}
              onSubmit={() => setSubmitted(state.report!.fingerprint)}
              className="space-y-3 workspace-panel"
            >
              <input type="hidden" name="organization_id" value={organizationId} />
              <input type="hidden" name="input" value={JSON.stringify(parsed.data)} />
              <input type="hidden" name="request_id" value={requestId} />
              <input type="hidden" name="fingerprint" value={state.report.fingerprint} />
              {saved.status === 'error' && submitted === state.report.fingerprint && (
                <p role="alert" className="text-sm text-destructive">
                  {saved.message}
                </p>
              )}
              <button className={button} disabled={disabled}>
                {saving ? t('working') : t('save')}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  )
}
