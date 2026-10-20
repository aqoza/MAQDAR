import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, ArrowUpRight, ChartNoAxesCombined, Layers3, PackageCheck } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { ZeeSpareMark } from '@/components/zeespare-mark'
import { requestSite } from '@/lib/workspaces/request'
import { PlanningIllustration } from './(auth)/login/planning-illustration'
import styles from './public.module.css'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Public')
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: 'https://zeespare.com' },
  }
}

export default async function Home() {
  if ((await requestSite()).kind !== 'public') redirect('/dashboard')
  const t = await getTranslations('Public')
  const common = await getTranslations('Common')
  const capabilities = [
    { key: 'forecast', icon: ChartNoAxesCombined },
    { key: 'inventory', icon: Layers3 },
    { key: 'replenish', icon: PackageCheck },
  ] as const
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        {t('skip')}
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label={common('appName')}>
          <ZeeSpareMark />
          <span dir="ltr">{common('appName')}</span>
        </Link>
        <nav aria-label={t('navigation')}>
          <a className={styles.navLink} href="#platform">
            {t('platform')}
          </a>
          <Link className={styles.login} href="/workspaces">
            {t('clientLogin')}
            <ArrowUpRight />
          </Link>
        </nav>
      </header>
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span />
              {t('eyebrow')}
            </p>
            <h1 id="hero-title">
              {t('headline')}
              <em>{t('headlineAccent')}</em>
            </h1>
            <p className={styles.description}>{t('description')}</p>
            <a href="#platform" className={styles.primary}>
              {t('explore')}
              <ArrowRight />
            </a>
            <p className={styles.audience}>{t('audience')}</p>
          </div>
          <div className={styles.visual}>
            <div className={styles.visualTop}>
              <span>{t('visualTitle')}</span>
              <span>01 — 03</span>
            </div>
            <PlanningIllustration />
            <div className={styles.visualBottom}>
              <span className={styles.signal} />
              {t('visualCaption')}
              <ArrowUpRight />
            </div>
          </div>
        </section>
        <section className={styles.platform} id="platform" aria-labelledby="platform-title">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>{t('platformEyebrow')}</p>
            <h2 id="platform-title">{t('platformTitle')}</h2>
            <p>{t('platformDescription')}</p>
          </div>
          <div className={styles.capabilities}>
            {capabilities.map(({ key, icon: Icon }, index) => (
              <article key={key}>
                <div className={styles.capabilityTop}>
                  <Icon />
                  <span>0{index + 1}</span>
                </div>
                <h3>{t(`${key}.title`)}</h3>
                <p>{t(`${key}.description`)}</p>
              </article>
            ))}
          </div>
        </section>
        <section className={styles.pilot} aria-labelledby="pilot-title">
          <div>
            <p className={styles.eyebrow}>{t('pilotEyebrow')}</p>
            <h2 id="pilot-title">{t('pilotTitle')}</h2>
          </div>
          <div>
            <p>{t('pilotDescription')}</p>
            <Link href="/workspaces">
              {t('openWorkspace')}
              <ArrowRight />
            </Link>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span dir="ltr">{common('appName')}</span>
        <p>{t('footer')}</p>
        <Link href="/workspaces">{t('clientLogin')}</Link>
      </footer>
    </div>
  )
}
