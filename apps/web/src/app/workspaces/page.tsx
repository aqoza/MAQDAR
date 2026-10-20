import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ZeeSpareMark } from '@/components/zeespare-mark'
import { WorkspaceForm } from './workspace-form'
import styles from '../public.module.css'

export default async function WorkspacesPage() {
  const t = await getTranslations('Workspace')
  const common = await getTranslations('Common')
  return (
    <main className={styles.page}>
      <div className={styles.finder}>
        <Link href="/" className={styles.brand}>
          <ZeeSpareMark />
          <span dir="ltr">{common('appName')}</span>
        </Link>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
        <WorkspaceForm
          labels={{
            label: t('slug'),
            action: t('continue'),
            pending: t('opening'),
            error: t('unknown'),
          }}
        />
        <p>{t('hint')}</p>
      </div>
    </main>
  )
}
