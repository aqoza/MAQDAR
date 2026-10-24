import { SupplierResponseWorkbench } from '@/components/supplier-response-workbench'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return <SupplierResponseWorkbench family="event" searchParams={searchParams} />
}
