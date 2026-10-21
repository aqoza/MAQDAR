import Image from 'next/image'
import { Building2 } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { requestSite } from '@/lib/workspaces/request'
import styles from './login.module.css'

/** Shared presentation for sign-in and recovery; workspace selection still follows the host. */
export async function AuthShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  const t = await getTranslations('Auth')
  const common = await getTranslations('Common')
  const workspaceText = await getTranslations('Workspace')
  const { workspace } = await requestSite()

  return (
    <main className={styles.page}>
      <section className={styles.story} aria-label={t('design.storyLabel')}>
        <div className={styles.brand}>
          <Image
            src="/images/auth/zeespare-precision-reversed.svg"
            width={1406}
            height={304}
            alt={common('appName')}
            className={styles.brandLogo}
            priority
          />
          <span className={styles.brandDescriptor}>{t('design.brandDescriptor')}</span>
        </div>
        <div className={styles.storyContent}>
          <h2 className={styles.storyHeadline}>
            <span>{t('design.headline')}</span>
            <span className={styles.headlineAccent}>{t('design.headlineAccent')}</span>
          </h2>
          <p className={styles.storyDescription}>
            {t('design.description')}
            <br />
            {t('design.descriptionNext')}
          </p>
        </div>
        <div className={styles.photograph} aria-hidden="true">
          <Image
            src="/images/auth/industrial-studio.webp"
            alt=""
            width={1536}
            height={1024}
            sizes="(max-width: 767px) 1px, 57vw"
            priority
          />
        </div>
        <div className={styles.storyFooter}>
          <span>{t('design.demandPlanning')}</span>
          <span aria-hidden="true">/</span>
          <span>{t('design.replenishment')}</span>
          <span aria-hidden="true">/</span>
          <span>{t('design.inventoryBalancing')}</span>
        </div>
      </section>
      <section className={styles.signIn} aria-labelledby="login-title">
        <div className={styles.workspaceRow}>
          <span className={styles.workspaceLabel}>
            <Building2 aria-hidden="true" />
            {workspace ? workspaceText('label', { name: workspace.name }) : t('design.workspace')}
          </span>
          <a href="https://zeespare.com/workspaces" className={styles.textLink}>
            {t('design.changeWorkspace')}
          </a>
        </div>
        <div className={styles.formContainer}>
          <div className={styles.formIntro}>
            <p className={styles.welcome}>{t('design.welcome')}</p>
            <h1 id="login-title" className={styles.formHeading}>
              {title}
            </h1>
            <p>{description}</p>
          </div>
          {children}
        </div>
        <footer className={styles.formFooter}>
          <span>{t('design.footerBrand')}</span>
          <nav aria-label={t('design.legal')}>
            <a href="https://zeespare.com/privacy">{t('design.privacy')}</a>
            <a href="https://zeespare.com/terms">{t('design.terms')}</a>
          </nav>
        </footer>
      </section>
    </main>
  )
}
