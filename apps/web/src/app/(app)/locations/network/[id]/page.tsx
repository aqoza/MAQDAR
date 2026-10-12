import { EditScreen } from '@/components/master-data/edit-screen'
import { entityMetadata } from '@/lib/master-data/metadata'

export const generateMetadata = () => entityMetadata('networkLinks', 'edit')

export default async function NetworkLinkPage({
  params,
  searchParams,
}: PageProps<'/locations/network/[id]'>) {
  const { id } = await params
  return <EditScreen entity="networkLinks" id={id} searchParams={searchParams} />
}
