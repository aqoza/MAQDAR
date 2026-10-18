'use client'

import { useActionState, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewEventSupplier,
  saveEventSupplier,
  type EventSupplierPreviewState,
} from '@/app/(app)/replenishment/events/suppliers/actions'
import { idleState } from '@/lib/forms'
import { EventSupplierReport } from './event-supplier-report'

export function EventSupplierForm({
  organizationId,
  draftId,
  requestId,
  cutoff,
}: {
  organizationId: string
  draftId: string
  requestId: string
  cutoff: string
}) {
  const t = useTranslations('EventSuppliers')
  const id = useId()
  const [supplier, setSupplier] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [state, preview, pending] = useActionState(
    previewEventSupplier,
    idleState as EventSupplierPreviewState,
  )
  const [saved, save, saving] = useActionState(saveEventSupplier, idleState)
  const report =
    state.input?.draft_id === draftId &&
    state.input?.supplier_code === supplier.trim() &&
    state.input?.terms_confirmed === confirmed
      ? state.report
      : undefined
  const hidden = { organization_id: organizationId, draft_id: draftId }
  const button = 'rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50'
  return (
    <div className="space-y-4">
      <form
        action={preview}
        onReset={(event) => event.preventDefault()}
        className="space-y-3 workspace-panel"
        aria-label={t('entry')}
      >
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div className="grid max-w-sm gap-1">
          <label htmlFor={id}>{t('supplier')}</label>
          <input
            id={id}
            name="supplier_code"
            required
            maxLength={64}
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2"
          />
        </div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="terms_confirmed"
            value="true"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 shrink-0"
          />
          <span>{t('confirmation', { date: cutoff })}</span>
        </label>
        <button disabled={pending} className={button}>
          {t(pending ? 'previewing' : 'preview')}
        </button>
        {state.message && <p role="alert">{state.message}</p>}
      </form>
      {report && (
        <>
          <EventSupplierReport report={report} />
          <form action={save} className="space-y-3" aria-label={t('save')}>
            {Object.entries({
              ...hidden,
              supplier_code: report.input.supplier_code,
              terms_confirmed: String(confirmed),
              request_id: requestId,
              fingerprint: report.fingerprint,
            }).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <button disabled={saving} className={button}>
              {t(saving ? 'saving' : 'save')}
            </button>
            {saved.message && <p role="alert">{saved.message}</p>}
          </form>
        </>
      )}
    </div>
  )
}
