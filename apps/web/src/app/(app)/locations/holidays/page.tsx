import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('holidayOverrides')

export default function HolidayOverridesPage({ searchParams }: PageProps<'/locations/holidays'>) {
  return <ListScreen entity="holidayOverrides" searchParams={searchParams} />
}
