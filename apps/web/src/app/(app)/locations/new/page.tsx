import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('locations', 'new')

export default function NewLocationPage() {
  return <EditScreen entity="locations" />
}
