import { ListScreen } from '@/components/master-data/list-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('fxRates')

export default function FxRatesPage({ searchParams }: PageProps<'/suppliers/fx-rates'>) {
  return <ListScreen entity="fxRates" searchParams={searchParams} />
}
