'use client'

import { useTranslations } from 'next-intl'
import { startTransition, useActionState } from 'react'
import { ActiveOrganizationField } from '@/components/active-organization'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { idleState } from '@/lib/forms'
import { createApiKey, type ApiKeyActionState } from './actions'
import { ApiKeySecretDialog } from './api-key-secret-dialog'
import type { ScopeOption } from './api-keys'

export type ApiKeyFormProps = {
  scopes: ScopeOption[]
  /** Expiry choices in days, and the preselected one. */
  expiryDays: readonly number[]
  defaultExpiryDays: number
  /** The organization already has `maxActive` active keys: creating is refused anyway. */
  limitReached: boolean
  maxActive: number
}

const initialState: ApiKeyActionState = idleState

/** Sentinel the secret dialog dispatches to drop the key from the action state. */
const DISMISS = 'dismiss'

/**
 * Name, scopes (at least one) and expiry. On success the action returns the new key once in its
 * state; the secret dialog shows it until "Done" dispatches `DISMISS`, which resets the state, so
 * the key lives only in this component's state while the dialog is open. Failed submissions
 * re-fill the fields from `values` (never containing the key).
 */
export function ApiKeyForm({
  scopes,
  expiryDays,
  defaultExpiryDays,
  limitReached,
  maxActive,
}: ApiKeyFormProps) {
  const t = useTranslations('ApiKeys')
  const [state, dispatch, pending] = useActionState(
    async (
      previous: ApiKeyActionState,
      payload: FormData | typeof DISMISS,
    ): Promise<ApiKeyActionState> =>
      payload === DISMISS ? initialState : createApiKey(previous, payload),
    initialState,
  )
  const values = state.values ?? {}
  const errors = state.fieldErrors ?? {}
  const checkedScopes = new Set((values.scopes ?? '').split(',').filter(Boolean))
  const submittedExpiry = Number(values.expires_in_days)
  const expiry = expiryDays.includes(submittedExpiry) ? submittedExpiry : defaultExpiryDays

  return (
    <>
      <form
        action={dispatch}
        className="flex flex-col gap-5"
        aria-labelledby="api-key-form-heading"
      >
        <ActiveOrganizationField />
        <h3 id="api-key-form-heading" className="text-sm font-medium">
          {t('create.title')}
        </h3>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Field className="flex-1" data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="api-key-name">{t('create.name')}</FieldLabel>
            <Input
              id="api-key-name"
              name="name"
              autoComplete="off"
              required
              maxLength={80}
              defaultValue={values.name ?? ''}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby="api-key-name-hint"
            />
            <FieldDescription id="api-key-name-hint">{t('create.nameHint')}</FieldDescription>
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field className="sm:w-48" data-invalid={errors.expires_in_days ? true : undefined}>
            <FieldLabel htmlFor="api-key-expiry">{t('create.expiry')}</FieldLabel>
            <NativeSelect
              id="api-key-expiry"
              name="expires_in_days"
              className="w-full"
              defaultValue={String(expiry)}
              aria-invalid={errors.expires_in_days ? true : undefined}
            >
              {expiryDays.map((days) => (
                <NativeSelectOption key={days} value={String(days)}>
                  {t('create.expiryOption', { days })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError>{errors.expires_in_days}</FieldError>
          </Field>
        </div>
        <FieldSet
          data-invalid={errors.scopes ? true : undefined}
          aria-describedby="api-key-scopes-hint"
          className="gap-3"
        >
          <FieldLegend variant="label">{t('create.scopes')}</FieldLegend>
          <FieldDescription id="api-key-scopes-hint">{t('create.scopesHint')}</FieldDescription>
          <div className="grid gap-3 sm:grid-cols-2">
            {scopes.map((scope) => {
              const id = `api-key-scope-${scope.key}`
              return (
                <div key={scope.value} className="flex items-start gap-2 text-sm">
                  <input
                    id={id}
                    type="checkbox"
                    name="scopes"
                    value={scope.value}
                    defaultChecked={checkedScopes.has(scope.value)}
                    aria-invalid={errors.scopes ? true : undefined}
                    aria-describedby={`${id}-description`}
                    className="accent-primary mt-0.5 size-4 shrink-0"
                  />
                  <div className="flex flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <label htmlFor={id} className="font-medium">
                        {t(`scopes.${scope.key}.label`)}
                      </label>
                      <bdi dir="ltr" className="text-muted-foreground font-mono text-xs">
                        {scope.value}
                      </bdi>
                    </div>
                    <p id={`${id}-description`} className="text-muted-foreground">
                      {t(`scopes.${scope.key}.description`)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
          <FieldError>{errors.scopes}</FieldError>
        </FieldSet>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || limitReached}>
            {pending ? t('create.creating') : t('create.submit')}
          </Button>
          {limitReached ? (
            <p className="text-muted-foreground text-sm">{t('limitReached', { max: maxActive })}</p>
          ) : null}
        </div>
        {state.status === 'error' && state.message ? (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        ) : null}
      </form>
      {state.status === 'success' && state.secret ? (
        <ApiKeySecretDialog
          secret={state.secret}
          name={state.name ?? ''}
          onDone={() => startTransition(() => dispatch(DISMISS))}
        />
      ) : null}
    </>
  )
}
