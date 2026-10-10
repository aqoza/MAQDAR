'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { idleState } from '@/lib/forms'
import { setPassword } from './actions'

/** Lets a user who signed in through an e-mail link add a password. */
export function SetPasswordCard({ email }: { email: string }) {
  const t = useTranslations('Settings.account')
  const tAuth = useTranslations('Auth.setPassword')
  const [state, formAction, pending] = useActionState(setPassword, idleState)
  const error = state.fieldErrors?.password

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { email })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">{t('setPassword')}</h3>
            <p className="text-muted-foreground text-sm">{t('setPasswordDescription')}</p>
          </div>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="account-password">{t('password')}</FieldLabel>
            <Input
              id="account-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              aria-invalid={error ? true : undefined}
            />
            <FieldDescription>{tAuth('hint')}</FieldDescription>
            <FieldError>{error}</FieldError>
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {t('save')}
            </Button>
            {state.message ? (
              <p
                role={state.status === 'error' ? 'alert' : 'status'}
                className={state.status === 'error' ? 'text-destructive text-sm' : 'text-sm'}
              >
                {state.message}
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
