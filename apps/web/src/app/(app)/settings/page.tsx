import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings')
  return { title: t('title') }
}

export default async function SettingsPage() {
  const t = await getTranslations('Settings')
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('language.title')}</CardTitle>
          <CardDescription>{t('language.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LocaleSwitcher />
        </CardContent>
      </Card>
    </>
  )
}
