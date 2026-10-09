import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PlaceholderPage } from '@/components/placeholder-page'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Forecasts')
  return { title: t('title') }
}

export default function ForecastsPage() {
  return <PlaceholderPage namespace="Forecasts" />
}
