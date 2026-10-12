import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('interchanges', 'edit')

export default async function InterchangePage({
  params,
  searchParams,
}: PageProps<'/items/interchanges/[id]'>) {
  const { id } = await params
  return <EditScreen entity="interchanges" id={id} searchParams={searchParams} />
}
