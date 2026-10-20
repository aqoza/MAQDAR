import type { Metadata } from 'next'
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  KeyRound,
  Layers3,
  LockKeyhole,
  PackageCheck,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { ZeeSpareMark } from '@/components/zeespare-mark'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LoginForm } from './login-form'
import { PlanningIllustration } from './planning-illustration'
import styles from './login.module.css'

/** `?error=` values the auth routes redirect with, mapped to Auth.errors keys. */
const ERROR_KEYS = {
  link: 'linkInvalid',
  inviteExpired: 'inviteExpired',
} as const

type ErrorQuery = keyof typeof ERROR_KEYS

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth')
  return { title: t('title') }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const t = await getTranslations('Auth')
  const common = await getTranslations('Common')
  const { error } = await searchParams
  const errorKey = error && isErrorQuery(error) ? ERROR_KEYS[error] : null

  return (
    <main className={styles.page}>
      <section className={styles.story} aria-label={t('design.storyLabel')}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <ZeeSpareMark />
          </span>
          <span className={styles.brandWordmark} dir="ltr">
            {common('appName')}
          </span>
          <span className={styles.brandDescriptor}>{t('design.brandDescriptor')}</span>
        </div>
        <div className={styles.storyContent}>
          <p className={styles.eyebrow}>
            <span />
            {t('design.eyebrow')}
          </p>
          <h2 className={styles.storyHeadline}>
            <span>{t('design.headline')}</span>
            <span className={styles.headlineAccent}>{t('design.headlineAccent')}</span>
          </h2>
          <p className={styles.storyDescription}>{t('design.description')}</p>
          <div className={styles.illustration}>
            <PlanningIllustration />
            <div className={styles.networkCaption}>
              <span />
              {t('design.networkCaption')}
              <ArrowUpRight aria-hidden="true" />
            </div>
          </div>
          <div className={styles.capabilities}>
            <div>
              <ChartNoAxesCombined aria-hidden="true" />
              <span>{t('design.forecast')}</span>
            </div>
            <div>
              <Layers3 aria-hidden="true" />
              <span>{t('design.optimize')}</span>
            </div>
            <div>
              <PackageCheck aria-hidden="true" />
              <span>{t('design.replenish')}</span>
            </div>
          </div>
        </div>
        <div className={styles.storyFooter}>
          <span>{t('design.audience')}</span>
          <span aria-hidden="true">↗</span>
        </div>
      </section>

      <section className={styles.signIn} aria-labelledby="login-title">
        <div className={styles.workspaceLabel}>
          <LockKeyhole aria-hidden="true" />
          {t('design.workspace')}
        </div>
        <div className={styles.formContainer}>
          <div className={styles.formIntro}>
            <div className={styles.formKicker}>
              <span className={styles.formEmblem} aria-hidden="true">
                <KeyRound />
              </span>
              <span className={styles.welcome}>{t('design.welcome')}</span>
            </div>
            <h1 id="login-title" className={styles.formHeading}>
              {t('title')}
            </h1>
            <p>{t('design.formDescription')}</p>
          </div>
          {errorKey ? (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{t(`errors.${errorKey}`)}</AlertDescription>
            </Alert>
          ) : null}
          <LoginForm />
        </div>
        <footer className={styles.formFooter}>
          <span>{t('design.footerBrand')}</span>
          <span>{t('design.footerDescription')}</span>
        </footer>
      </section>
    </main>
  )
}

function isErrorQuery(value: string): value is ErrorQuery {
  return Object.hasOwn(ERROR_KEYS, value)
}
