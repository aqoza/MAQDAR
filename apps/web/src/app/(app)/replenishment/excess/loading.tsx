import { getTranslations } from 'next-intl/server'
import { ExcessStockHeader } from '@/components/excess-stock-header'
export default async function Loading() {
  return (
    <div className="min-w-0 space-y-4">
      <ExcessStockHeader />
      <p role="status">{(await getTranslations('ExcessStock'))('loading')}</p>
    </div>
  )
}
