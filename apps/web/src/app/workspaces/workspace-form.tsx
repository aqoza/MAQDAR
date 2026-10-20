'use client'
import { useActionState } from 'react'
import { ArrowRight } from 'lucide-react'
import { findWorkspace } from './actions'
import styles from '../public.module.css'

type Labels = { label: string; action: string; pending: string; error: string }
export function WorkspaceForm({ labels }: { labels: Labels }) {
  const [state, action, pending] = useActionState(findWorkspace, { error: false })
  return (
    <form action={action}>
      <label htmlFor="workspace">{labels.label}</label>
      <div className={styles.inputGroup} dir="ltr">
        <input
          id="workspace"
          name="workspace"
          autoCapitalize="none"
          autoComplete="organization"
          spellCheck={false}
          required
          maxLength={40}
          aria-invalid={state.error || undefined}
          aria-describedby={state.error ? 'workspace-error' : undefined}
        />
        <span>.zeespare.com</span>
      </div>
      {state.error ? (
        <p id="workspace-error" role="alert">
          {labels.error}
        </p>
      ) : null}
      <button className={styles.primary} type="submit" disabled={pending}>
        {pending ? labels.pending : labels.action}
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
