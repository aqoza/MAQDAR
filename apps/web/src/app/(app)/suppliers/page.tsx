import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('suppliers')

export default function SuppliersPage({ searchParams }: PageProps<'/suppliers'>) {
  return <ListScreen entity="suppliers" searchParams={searchParams} />
}
