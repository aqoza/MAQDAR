import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('holidayOverrides', 'new')

export default function NewHolidayOverridePage() {
  return <EditScreen entity="holidayOverrides" />
}
