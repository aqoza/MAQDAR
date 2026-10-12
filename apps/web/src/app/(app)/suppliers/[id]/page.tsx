import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('suppliers', 'edit')

export default async function SupplierPage({ params, searchParams }: PageProps<'/suppliers/[id]'>) {
  const { id } = await params
  return <EditScreen entity="suppliers" id={id} searchParams={searchParams} />
}
