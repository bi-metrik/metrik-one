'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Flame, UserPlus, Receipt, Clock } from 'lucide-react'

interface FABProps {
  role: string
}

interface FABAction {
  label: string
  icon: typeof Flame
  roles: string[]
  color: string
  href?: string
  action?: string
}

const FAB_ACTIONS: FABAction[] = [
  {
    label: 'Nueva oportunidad',
    icon: Flame,
    href: '/nuevo/oportunidad',
    roles: ['owner', 'admin'],
    color: 'bg-orange-500 hover:bg-orange-600',
  },
  {
    label: 'Nuevo contacto',
    icon: UserPlus,
    href: '/nuevo/contacto',
    roles: ['owner', 'admin'],
    color: 'bg-blue-500 hover:bg-blue-600',
  },
  {
    label: 'Registrar gasto',
    icon: Receipt,
    href: '/nuevo/gasto',
    roles: ['owner', 'admin', 'operator'],
    color: 'bg-emerald-500 hover:bg-emerald-600',
  },
  {
    label: 'Iniciar timer',
    icon: Clock,
    action: 'timer',
    roles: ['owner', 'admin', 'operator'],
    color: 'bg-violet-500 hover:bg-violet-600',
  },
]

export default function FAB({ role }: FABProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const visibleActions = FAB_ACTIONS.filter(a => a.roles.includes(role))

  const handleAction = useCallback((action: FABAction) => {
    setOpen(false)
    if (action.action === 'timer') {
      window.dispatchEvent(new Event('metrik-timer-open'))
    } else if (action.href) {
      router.push(action.href)
    }
  }, [router])

  if (visibleActions.length === 0) return null

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Action buttons */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex w-48 flex-col-reverse gap-2">
          {visibleActions.map((action) => {
            const Icon = action.icon
            return (
              <button
                key={action.href ?? action.action}
                onClick={() => handleAction(action)}
                className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all ${action.color}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {action.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Main FAB button */}
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all ${
          open
            ? 'bg-foreground text-background rotate-0'
            : 'bg-primary text-primary-foreground'
        }`}
      >
        {open ? (
          <X className="h-6 w-6" />
        ) : (
          <Plus className="h-6 w-6" />
        )}
      </button>
    </>
  )
}
