import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('workCalendars', 'new')

export default function NewWorkCalendarPage() {
  return <EditScreen entity="workCalendars" />
}
