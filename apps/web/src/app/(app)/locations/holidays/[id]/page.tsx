import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('holidayOverrides', 'edit')

export default async function HolidayOverridePage({
  params,
  searchParams,
}: PageProps<'/locations/holidays/[id]'>) {
  const { id } = await params
  return <EditScreen entity="holidayOverrides" id={id} searchParams={searchParams} />
}
