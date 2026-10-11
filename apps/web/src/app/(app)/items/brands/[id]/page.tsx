import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('brands', 'edit')

export default async function BrandPage({ params, searchParams }: PageProps<'/items/brands/[id]'>) {
  const { id } = await params
  return <EditScreen entity="brands" id={id} searchParams={searchParams} />
}
