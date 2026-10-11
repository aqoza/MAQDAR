import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('networkLinks', 'new')

export default function NewNetworkLinkPage() {
  return <EditScreen entity="networkLinks" />
}
