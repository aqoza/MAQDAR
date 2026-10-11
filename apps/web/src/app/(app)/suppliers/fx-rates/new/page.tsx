import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('fxRates', 'new')

export default function NewFxRatePage() {
  return <EditScreen entity="fxRates" />
}
