'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from 'lucide-react'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { signIn, type SignInState } from './actions'
import styles from './login.module.css'

const initialState: SignInState = {}

export function LoginForm() {
  const t = useTranslations('Auth')
  const [state, formAction, pending] = useActionState(signIn, initialState)
  const [showPassword, setShowPassword] = useState(false)
  const [credentials, setCredentials] = useState({ email: '', password: '' })

  return (
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
            maxLength={254}
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
        <div className={styles.passwordLabel}>
          <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
          <Link href="/auth/forgot-password" className={styles.textLink}>
            {t('recovery.forgot')}
          </Link>
        </div>
        <div className={styles.passwordWrapper}>
          <LockKeyhole className={styles.fieldIcon} aria-hidden="true" />
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
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
      <Button type="submit" disabled={pending} className={styles.primaryButton}>
        {pending ? <LoaderCircle aria-hidden="true" className={styles.spinner} /> : null}
        {t('signIn')}
        <ArrowRight aria-hidden="true" className={styles.buttonArrow} />
      </Button>
      <p role="status" className="sr-only">
        {pending ? t('design.signingIn') : ''}
      </p>
    </form>
  )
}
