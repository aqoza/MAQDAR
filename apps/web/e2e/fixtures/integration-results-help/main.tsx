import { createRoot } from 'react-dom/client'
import { DirectionProvider } from '@base-ui/react/direction-provider'
import { NextIntlClientProvider } from 'next-intl'
import { IntegrationResultsHelp } from '../../../src/components/integration-results-help'
import messages from '../../../messages/en.json'
import '../../../src/app/globals.css'

const direction = new URLSearchParams(location.search).get('dir') === 'rtl' ? 'rtl' : 'ltr'
document.documentElement.dir = direction

// Exercise the production drawer independently of authentication and database fixtures.
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="en" messages={messages}>
    <DirectionProvider direction={direction}>
      <main className="p-6">
        <IntegrationResultsHelp />
        <label className="block">
          Supplier code
          <input className="border" />
        </label>
        <p>93 package/system results</p>
      </main>
    </DirectionProvider>
  </NextIntlClientProvider>,
)
