import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('workCalendars')

export default function WorkCalendarsPage({ searchParams }: PageProps<'/locations/calendars'>) {
  return <ListScreen entity="workCalendars" searchParams={searchParams} />
}
