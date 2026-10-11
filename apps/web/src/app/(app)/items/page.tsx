import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('items')

export default function ItemsPage({ searchParams }: PageProps<'/items'>) {
  return <ListScreen entity="items" searchParams={searchParams} />
}
