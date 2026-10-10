'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { signIn, type SignInState } from './actions'

const initialState: SignInState = {}

export function LoginForm() {
  const t = useTranslations('Auth')
  const [state, formAction, pending] = useActionState(signIn, initialState)

  if (state.sentTo) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-sm">
          {t('magicLinkSent', { email: state.sentTo })}
        </p>
        <p className="text-muted-foreground text-xs">{t('invitationOnly')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder={t('emailPlaceholder')}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="current-password" />
        </Field>
        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
        <Button type="submit" name="intent" value="password" disabled={pending} className="w-full">
          {t('signIn')}
        </Button>
        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          <Separator className="flex-1" />
          <span>{t('orDivider')}</span>
          <Separator className="flex-1" />
        </div>
        <Button
          type="submit"
          name="intent"
          value="magic-link"
          variant="outline"
          disabled={pending}
          className="w-full"
        >
          {t('sendMagicLink')}
        </Button>
      </form>
      <p className="text-muted-foreground text-center text-xs">{t('invitationOnly')}</p>
    </div>
  )
}
