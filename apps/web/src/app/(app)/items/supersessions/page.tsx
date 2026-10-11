import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('supersessions')

export default function SupersessionsPage({ searchParams }: PageProps<'/items/supersessions'>) {
  return <ListScreen entity="supersessions" searchParams={searchParams} />
}
