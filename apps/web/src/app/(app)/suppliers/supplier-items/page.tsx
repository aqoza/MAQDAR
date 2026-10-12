import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('supplierItems')

export default function SupplierItemsPage({
  searchParams,
}: PageProps<'/suppliers/supplier-items'>) {
  return <ListScreen entity="supplierItems" searchParams={searchParams} />
}
