import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PlaceholderPage } from '@/components/placeholder-page'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Dashboard')
  return { title: t('title') }
}

export default function DashboardPage() {
  return <PlaceholderPage namespace="Dashboard" />
}
