import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('supersessions', 'edit')

export default async function SupersessionPage({
  params,
  searchParams,
}: PageProps<'/items/supersessions/[id]'>) {
  const { id } = await params
  return <EditScreen entity="supersessions" id={id} searchParams={searchParams} />
}
