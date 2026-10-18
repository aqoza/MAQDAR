'use client'

import type { ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { CircleHelp, X } from 'lucide-react'
import styles from './help-side-panel.module.css'

/** Accept translated content from the server without adding client message namespaces. */
export function HelpSidePanel({
  title,
  description,
  closeLabel,
  children,
}: {
  title: string
  description: string
  closeLabel: string
  children: ReactNode
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sm py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0">
        <CircleHelp className="size-4" aria-hidden="true" />
        {title}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-transparent" />
        <Dialog.Popup className={`fixed z-50 flex flex-col border bg-background ${styles.panel}`}>
          <div className={`relative mx-6 shrink-0 border-b pe-12 ${styles.header}`}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Description className={`mt-1 ${styles.description}`}>
              {description}
            </Dialog.Description>
            <Dialog.Close
              aria-label={closeLabel}
              className="absolute top-4 end-0 flex size-11 cursor-pointer items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className={`min-h-0 overflow-y-auto overscroll-contain px-6 ${styles.body}`}>
            {children}
          </div>
          <div className={`mx-6 flex shrink-0 justify-end border-t ${styles.footer}`}>
            <Dialog.Close
              className={`cursor-pointer border px-6 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${styles.closeButton}`}
            >
              {closeLabel}
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
