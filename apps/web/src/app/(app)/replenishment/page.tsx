import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PlaceholderPage } from '@/components/placeholder-page'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Replenishment')
  return { title: t('title') }
}

export default function ReplenishmentPage() {
  return <PlaceholderPage namespace="Replenishment" />
}
