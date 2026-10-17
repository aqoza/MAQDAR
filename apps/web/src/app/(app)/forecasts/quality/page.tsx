import { ForecastQuality } from '@/components/forecast-section-quality'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return <ForecastQuality searchParams={searchParams} />
}
