import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('brands')

export default function BrandsPage({ searchParams }: PageProps<'/items/brands'>) {
  return <ListScreen entity="brands" searchParams={searchParams} />
}
