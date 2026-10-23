import { IntegrationWorkbenchScreen } from '@/components/integration-workbench-screen'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return <IntegrationWorkbenchScreen searchParams={searchParams} family="regional" />
}
