import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('networkLinks')

export default function NetworkLinksPage({ searchParams }: PageProps<'/locations/network'>) {
  return <ListScreen entity="networkLinks" searchParams={searchParams} />
}
