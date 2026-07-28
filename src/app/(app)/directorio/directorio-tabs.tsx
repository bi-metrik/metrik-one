'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/directorio/contactos', label: 'Contactos' },
  { href: '/directorio/empresas', label: 'Empresas' },
] as const

const TAB_ALIADOS = { href: '/directorio/aliados', label: 'Aliados' } as const

interface Props {
  /** Solo si el workspace tiene modules.aliados (lo resuelve la page server-side). */
  showAliados?: boolean
}

export default function DirectorioTabs({ showAliados = false }: Props) {
  const pathname = usePathname()
  const tabs = showAliados ? [...TABS, TAB_ALIADOS] : [...TABS]

  return (
    <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
      {tabs.map(tab => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
