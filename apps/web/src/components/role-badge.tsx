import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { Role } from '@/lib/auth/roles'

/** The translated name of a membership role as a small pill. Works in server and client trees. */
export function RoleBadge({
  role,
  variant = 'secondary',
  className,
}: {
  role: Role
  variant?: 'default' | 'secondary' | 'outline'
  className?: string
}) {
  const t = useTranslations('Roles')
  return (
    <Badge variant={variant} className={className}>
      {t(role)}
    </Badge>
  )
}
