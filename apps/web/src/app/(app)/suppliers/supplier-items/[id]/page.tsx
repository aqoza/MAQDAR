import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('supplierItems', 'edit')

export default async function SupplierItemPage({
  params,
  searchParams,
}: PageProps<'/suppliers/supplier-items/[id]'>) {
  const { id } = await params
  return <EditScreen entity="supplierItems" id={id} searchParams={searchParams} />
}
