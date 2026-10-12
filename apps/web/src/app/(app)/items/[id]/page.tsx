import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('items', 'edit')

export default async function ItemPage({ params, searchParams }: PageProps<'/items/[id]'>) {
  const { id } = await params
  return <EditScreen entity="items" id={id} searchParams={searchParams} />
}
