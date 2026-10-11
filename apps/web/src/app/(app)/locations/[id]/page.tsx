import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('locations', 'edit')

export default async function LocationPage({ params, searchParams }: PageProps<'/locations/[id]'>) {
  const { id } = await params
  return <EditScreen entity="locations" id={id} searchParams={searchParams} />
}
