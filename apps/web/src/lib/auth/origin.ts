import { requestSite } from '@/lib/workspaces/request'

/** Auth URLs use the approved request host, keeping sessions local to each workspace. */
export async function siteOrigin(): Promise<string> {
  return (await requestSite()).origin
}
