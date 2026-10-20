'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowRight, LoaderCircle, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { idleState, type ActionState } from '@/lib/forms'
import { completeRecovery, requestPasswordReset, resetPassword } from './actions'
import styles from '../../(auth)/login/login.module.css'

function Feedback({ state }: { state: ActionState }) {
  return state.status === 'error' ? (
    <p id="recovery-error" role="alert" className={styles.error}>
      {state.message ?? state.fieldErrors?.password}
    </p>
  ) : null
}

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={pending} className={styles.primaryButton}>
      {pending ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : null}
      {children}
      <ArrowRight className={styles.buttonArrow} aria-hidden="true" />
    </Button>
  )
}

export function ForgotPasswordForm() {
  const t = useTranslations('Auth')
  const [state, action, pending] = useActionState(requestPasswordReset, idleState)
  if (state.status === 'success')
    return (
      <div className={styles.success}>
        <p role="status">{state.message}</p>
        <Link href="/login" className={styles.textLink}>
          {t('design.backToSignIn')}
        </Link>
      </div>
    )
  return (
    <form action={action} className={styles.form} aria-busy={pending}>
      <Field>
        <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
        <div className={styles.fieldWrapper}>
          <Mail className={styles.fieldIcon} aria-hidden="true" />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            className={styles.input}
            placeholder={t('emailPlaceholder')}
            aria-describedby={state.status === 'error' ? 'recovery-error' : undefined}
          />
        </div>
      </Field>
      <Feedback state={state} />
      <Submit pending={pending}>{t('recovery.send')}</Submit>
      <Link href="/login" className={styles.textLink}>
        {t('design.backToSignIn')}
      </Link>
    </form>
  )
}

export function RecoveryConfirmationForm({ token, code }: { token?: string; code?: string }) {
  const t = useTranslations('Auth')
  const [state, action, pending] = useActionState(completeRecovery, idleState)
  return (
    <form action={action} className={styles.form} aria-busy={pending}>
      {token ? <input type="hidden" name="token_hash" value={token} /> : null}
      {code ? <input type="hidden" name="code" value={code} /> : null}
      <Feedback state={state} />
      <Submit pending={pending}>{t('recovery.continue')}</Submit>
      <Link href="/auth/forgot-password" className={styles.textLink}>
        {t('recovery.requestAnother')}
      </Link>
    </form>
  )
}

export function ResetPasswordForm() {
  const t = useTranslations('Auth')
  const [state, action, pending] = useActionState(resetPassword, idleState)
  return (
    <form action={action} className={styles.form} aria-busy={pending}>
      <Field>
        <FieldLabel htmlFor="new-password">{t('setPassword.password')}</FieldLabel>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={styles.input}
          style={{ paddingInlineStart: '1rem' }}
          aria-describedby={
            state.status === 'error' ? 'password-hint recovery-error' : 'password-hint'
          }
        />
        <p id="password-hint" className="text-muted-foreground text-xs">
          {t('setPassword.hint')}
        </p>
      </Field>
      <Field>
        <FieldLabel htmlFor="confirmation">{t('recovery.confirmPassword')}</FieldLabel>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={styles.input}
          style={{ paddingInlineStart: '1rem' }}
          aria-describedby={state.status === 'error' ? 'recovery-error' : undefined}
        />
      </Field>
      <Feedback state={state} />
      <Submit pending={pending}>{t('recovery.save')}</Submit>
    </form>
  )
}
