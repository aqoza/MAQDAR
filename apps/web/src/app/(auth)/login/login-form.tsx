'use client'

import { useTranslations } from 'next-intl'
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { signIn, type SignInState } from './actions'
import styles from './login.module.css'

const initialState: SignInState = {}

export function LoginForm() {
  const t = useTranslations('Auth')
  const [state, formAction, pending] = useActionState(signIn, initialState)
  const [showPassword, setShowPassword] = useState(false)
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const [intent, setIntent] = useState<'password' | 'magic-link'>('password')

  if (state.sentTo) {
    return (
      <div className={styles.success}>
        <span className={styles.successIcon}>
          <Check aria-hidden="true" />
        </span>
        <div role="status">
          <h2 className="text-section-title">{t('design.checkInbox')}</h2>
          <p>{t('magicLinkSent', { email: state.sentTo })}</p>
        </div>
        <p className="text-muted-foreground text-xs">{t('design.checkSpam')}</p>
        <Button
          variant="outline"
          className={styles.secondaryButton}
          onClick={() => window.location.reload()}
        >
          <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
          {t('design.backToSignIn')}
        </Button>
      </div>
    )
  }

  return (
    <div>
      <form action={formAction} className={styles.form} aria-busy={pending}>
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
              placeholder={t('emailPlaceholder')}
              value={credentials.email}
              onChange={(event) =>
                setCredentials((current) => ({ ...current, email: event.target.value }))
              }
              className={styles.input}
              aria-invalid={state.error === 'invalidEmail' || state.error === 'invalidCredentials'}
              aria-describedby={state.error ? 'login-error' : undefined}
            />
          </div>
        </Field>
        <Field>
          <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
          <div className={styles.passwordWrapper}>
            <LockKeyhole className={styles.fieldIcon} aria-hidden="true" />
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={credentials.password}
              onChange={(event) =>
                setCredentials((current) => ({ ...current, password: event.target.value }))
              }
              placeholder={t('design.passwordPlaceholder')}
              className={styles.input}
              aria-invalid={
                state.error === 'passwordRequired' || state.error === 'invalidCredentials'
              }
              aria-describedby={state.error ? 'login-error' : undefined}
            />
            <button
              type="button"
              className={styles.passwordToggle}
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={t(showPassword ? 'design.hidePassword' : 'design.showPassword')}
              aria-pressed={showPassword}
              aria-controls="password"
            >
              {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
        </Field>
        {state.error ? (
          <p id="login-error" role="alert" className={styles.error}>
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
        <Button
          type="submit"
          name="intent"
          value="password"
          disabled={pending}
          className={styles.primaryButton}
          onClick={() => setIntent('password')}
        >
          {pending && intent === 'password' ? (
            <LoaderCircle aria-hidden="true" className={styles.spinner} />
          ) : null}
          {t('signIn')}
          <span className={styles.buttonArrow}>
            <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
          </span>
        </Button>
        <div className={styles.divider}>
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
          className={styles.secondaryButton}
          onClick={() => setIntent('magic-link')}
        >
          {pending && intent === 'magic-link' ? (
            <LoaderCircle aria-hidden="true" className={styles.spinner} />
          ) : (
            <Mail aria-hidden="true" />
          )}
          {t('sendMagicLink')}
        </Button>
      </form>
      <div className={styles.invitation}>
        <ShieldCheck aria-hidden="true" />
        <p>{t('invitationOnly')}</p>
      </div>
      <p role="status" className="sr-only">
        {pending ? t(intent === 'password' ? 'design.signingIn' : 'design.sendingLink') : ''}
      </p>
    </div>
  )
}
