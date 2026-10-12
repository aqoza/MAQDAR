import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('brands', 'new')

export default function NewBrandPage() {
  return <EditScreen entity="brands" />
}
