import { PolicyWorkbench } from '@/components/forecast-section-workbench'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return <PolicyWorkbench searchParams={searchParams} />
}
