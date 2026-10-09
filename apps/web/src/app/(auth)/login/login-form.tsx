'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { signIn, type SignInState } from './actions'

const initialState: SignInState = {}

export function LoginForm() {
  const t = useTranslations('Auth')
  const [state, formAction, pending] = useActionState(signIn, initialState)

  if (state.sentTo) {
    return (
      <p role="status" className="text-sm">
        {t('magicLinkSent', { email: state.sentTo })}
      </p>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={t('emailPlaceholder')}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t('password')}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" />
      </div>
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
  )
}
