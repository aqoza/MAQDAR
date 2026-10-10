'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { idleState } from '@/lib/forms'
import { cn } from '@/lib/utils'
import { setPassword } from './actions'

export function SetPasswordForm({ next }: { next: string }) {
  const t = useTranslations('Auth.setPassword')
  const [state, formAction, pending] = useActionState(setPassword, idleState)
  const passwordError = state.fieldErrors?.password

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field data-invalid={passwordError ? true : undefined}>
        <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={passwordError ? true : undefined}
          aria-describedby="password-hint"
        />
        <FieldDescription id="password-hint">{t('hint')}</FieldDescription>
        {passwordError ? <FieldError>{passwordError}</FieldError> : null}
      </Field>
      {state.status === 'error' && state.message ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {t('submit')}
      </Button>
      <Link href={next} className={cn(buttonVariants({ variant: 'ghost' }), 'w-full')}>
        {t('skip')}
      </Link>
    </form>
  )
}
