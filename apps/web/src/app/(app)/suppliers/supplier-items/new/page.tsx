import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('supplierItems', 'new')

export default function NewSupplierItemPage() {
  return <EditScreen entity="supplierItems" />
}
