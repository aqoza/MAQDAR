import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('locations')

export default function LocationsPage({ searchParams }: PageProps<'/locations'>) {
  return <ListScreen entity="locations" searchParams={searchParams} />
}
