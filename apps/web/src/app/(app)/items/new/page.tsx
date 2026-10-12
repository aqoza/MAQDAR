import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('items', 'new')

export default function NewItemPage() {
  return <EditScreen entity="items" />
}
