import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('workCalendars', 'edit')

export default async function WorkCalendarPage({
  params,
  searchParams,
}: PageProps<'/locations/calendars/[id]'>) {
  const { id } = await params
  return <EditScreen entity="workCalendars" id={id} searchParams={searchParams} />
}
