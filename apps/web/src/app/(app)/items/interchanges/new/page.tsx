import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('interchanges', 'new')

export default function NewInterchangePage() {
  return <EditScreen entity="interchanges" />
}
