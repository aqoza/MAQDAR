'use client'
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { saveDealerReturn, withdrawDealerReturn } from '@/app/(app)/replenishment/returns/actions'
import { returnConditions, returnFields } from '@/lib/dealer-returns'
import { idleState } from '@/lib/forms'
import { ItemCodeInput } from './master-data/item-code-input'
import { LocationCodeInput } from './master-data/location-code-input'
const field = 'min-w-0 w-full rounded-md border bg-background px-3 py-2'
const button =
  'min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50'
export function DealerReturnForm({
  organizationId,
  requestId,
}: {
  organizationId: string
  requestId: string
}) {
  const t = useTranslations('DealerReturns')
  const [state, action, pending] = useActionState(saveDealerReturn, idleState)
  const [edited, setEdited] = useState<string[]>([])
  return (
    <form
      action={action}
      className="space-y-4 workspace-panel"
      onSubmit={() => setEdited([])}
      onChange={(event) => {
        const control = event.target
        if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement))
          return
        const name = control.name || control.id
        if (name)
          setEdited((previous) => (previous.includes(name) ? previous : [...previous, name]))
      }}
    >
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="request_id" value={requestId} />
      <fieldset
        key={JSON.stringify(state.values)}
        disabled={pending}
        className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {returnFields.map((name) => {
          const error = edited.includes(name) ? undefined : state.fieldErrors?.[name]
          const props = {
            id: name,
            name,
            defaultValue: state.values?.[name] ?? '',
            required: name !== 'sale_reference',
            className: field,
            'aria-describedby': error ? `${name}-error` : undefined,
            'aria-invalid': Boolean(error),
          }
          return (
            <div
              key={name}
              className={`grid min-w-0 content-start gap-1 ${name === 'reason' ? 'sm:col-span-2' : ''}`}
            >
              <label htmlFor={name}>{t(name)}</label>
              {name === 'item_code' ? (
                <ItemCodeInput {...props} maxLength={64} />
              ) : name === 'source_code' || name === 'location_code' ? (
                <LocationCodeInput {...props} className={undefined} />
              ) : name === 'unit' ? (
                <select {...props}>
                  <option value="">{t('choose')}</option>
                  {['EA', 'SET', 'L', 'KG'].map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              ) : name === 'condition' ? (
                <select {...props} defaultValue={state.values?.condition ?? 'unknown'}>
                  {returnConditions.map((condition) => (
                    <option key={condition} value={condition}>
                      {t(condition)}
                    </option>
                  ))}
                </select>
              ) : name === 'reason' ? (
                <input {...props} maxLength={1000} />
              ) : (
                <input
                  {...props}
                  type={name === 'requested_date' ? 'date' : 'text'}
                  maxLength={name === 'quantity' ? 32 : 200}
                  inputMode={name === 'quantity' ? 'decimal' : undefined}
                />
              )}
              {error && (
                <p id={`${name}-error`} className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )
        })}
        <label className="flex min-h-11 items-start gap-2 sm:col-span-2 lg:col-span-3">
          <input
            type="checkbox"
            name="confirmed"
            required
            className="mt-1"
            aria-describedby={
              !edited.includes('confirmed') && state.fieldErrors?.confirmed
                ? 'confirmed-error'
                : undefined
            }
          />
          <span>{t('confirmation')}</span>
        </label>
        {!edited.includes('confirmed') && state.fieldErrors?.confirmed && (
          <p id="confirmed-error" className="text-destructive">
            {state.fieldErrors.confirmed}
          </p>
        )}
      </fieldset>
      {state.status === 'error' && (!state.fieldErrors || edited.length === 0) && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <button className={button} disabled={pending}>
        {t(pending ? 'working' : 'save')}
      </button>
    </form>
  )
}
export function DealerReturnWithdrawal({
  organizationId,
  returnId,
}: {
  organizationId: string
  returnId: string
}) {
  const t = useTranslations('DealerReturns')
  const [state, action, pending] = useActionState(withdrawDealerReturn, idleState)
  return (
    <form action={action} className="space-y-3 workspace-panel">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="return_id" value={returnId} />
      <label className="grid gap-1">
        {t('withdrawalReason')}
        <input name="reason" required maxLength={1000} className={field} disabled={pending} />
      </label>
      {state.status === 'error' && (
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
      )}
      <button disabled={pending} className={button}>
        {t(pending ? 'working' : 'withdraw')}
      </button>
    </form>
  )
}
