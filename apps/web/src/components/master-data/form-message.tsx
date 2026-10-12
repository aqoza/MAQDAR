import type { ActionState } from '@/lib/forms'
import { cn } from '@/lib/utils'

/** The form-level message of an action result: an alert for errors, a status otherwise. */
export function FormMessage({ state, className }: { state: ActionState; className?: string }) {
  if (!state.message) return null
  const error = state.status === 'error'
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={cn('text-sm', error ? 'text-destructive' : 'text-muted-foreground', className)}
    >
      {state.message}
    </p>
  )
}
