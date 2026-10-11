import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('interchanges')

export default function InterchangesPage({ searchParams }: PageProps<'/items/interchanges'>) {
  return <ListScreen entity="interchanges" searchParams={searchParams} />
}
