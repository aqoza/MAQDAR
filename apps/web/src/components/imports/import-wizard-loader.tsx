'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'
import type { ImportWizardProps } from './import-wizard'

/**
 * Loads the wizard in the browser only. It needs JavaScript to read files anyway, and keeping it
 * out of server rendering keeps its parser (SheetJS, about 156 KiB gzipped) and the parse worker
 * out of the Cloudflare Worker bundle.
 */
const ImportWizard = dynamic(
  () => import('./import-wizard').then((module) => module.ImportWizard),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-48 w-full" />
      </div>
    ),
  },
)

export function ImportWizardLoader(props: ImportWizardProps) {
  return <ImportWizard {...props} />
}
