import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('suppliers', 'new')

export default function NewSupplierPage() {
  return <EditScreen entity="suppliers" />
}
