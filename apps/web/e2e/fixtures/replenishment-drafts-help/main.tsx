import { createRoot } from 'react-dom/client'
import { DirectionProvider } from '@base-ui/react/direction-provider'
import { NextIntlClientProvider } from 'next-intl'
import { ReplenishmentDraftsHelp } from '../../../src/components/replenishment-drafts-help'
import messages from '../../../messages/en.json'
import '../../../src/app/globals.css'

const direction = new URLSearchParams(location.search).get('dir') === 'rtl' ? 'rtl' : 'ltr'
document.documentElement.dir = direction

// Render the production guidance and local copy without requiring a signed-in database fixture.
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="en" messages={{ Replenishment: messages.Replenishment }}>
    <DirectionProvider direction={direction}>
      <main className="space-y-4 p-6">
        <header className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-accent/50 p-4">
          <div>
            <h1 className="text-page-title">Replenishment drafts</h1>
            <p className="text-sm text-muted-foreground">Saved planning drafts</p>
          </div>
          <ReplenishmentDraftsHelp />
        </header>
        <form
          className="workspace-toolbar flex flex-wrap items-end gap-3"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="grid gap-1">
            Search item code
            <input name="q" className="rounded-md border p-2" />
          </label>
          <label className="grid gap-1">
            Location code
            <input name="location" className="rounded-md border p-2" />
          </label>
          <button className="rounded-md bg-primary p-2 text-primary-foreground">Filter</button>
        </form>
        <p>55 saved drafts</p>
      </main>
    </DirectionProvider>
  </NextIntlClientProvider>,
)
