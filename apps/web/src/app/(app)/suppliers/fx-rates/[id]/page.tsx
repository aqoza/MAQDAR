import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('fxRates', 'edit')

export default async function FxRatePage({
  params,
  searchParams,
}: PageProps<'/suppliers/fx-rates/[id]'>) {
  const { id } = await params
  return <EditScreen entity="fxRates" id={id} searchParams={searchParams} />
}
