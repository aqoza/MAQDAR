import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('supersessions', 'new')

export default function NewSupersessionPage() {
  return <EditScreen entity="supersessions" />
}
