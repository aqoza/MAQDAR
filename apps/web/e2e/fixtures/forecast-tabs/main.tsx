import { createRoot } from 'react-dom/client'
import { ForecastTabs } from '../../../src/components/forecast-tabs'
import messages from '../../../messages/en.json'
import styles from '../../../src/components/forecast-workspace.module.css'

const planning = messages.Planning
const tabs = [
  { key: 'readiness', label: planning.submit },
  { key: 'quality', label: planning.quality },
  { key: 'workbench', label: planning.workbench },
  { key: 'classify', label: planning.classify },
  { key: 'forecast', label: planning.forecast },
  { key: 'prepare', label: planning.prepare },
]

// Exercise the production component and CSS with stateful content, without an auth/database stack.
createRoot(document.getElementById('root')!).render(
  <main className={styles.workspace}>
    <ForecastTabs
      label={planning.workspace.tools}
      tabs={tabs}
      panels={tabs.map((tab) => (
        <form key={tab.key} onSubmit={(event) => event.preventDefault()}>
          <h2>{tab.label}</h2>
          <label>
            Location code
            <input name="location" />
          </label>
        </form>
      ))}
    />
  </main>,
)
