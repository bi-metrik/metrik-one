'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  BarChart3,
  Flame,
  FolderKanban,
  Briefcase,
  LogOut,
  Users,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import FAB from './fab'

interface BrandingProps {
  colorPrimario?: string
  colorSecundario?: string
  logoUrl?: string
}

interface AppShellProps {
  children: React.ReactNode
  fullName: string
  workspaceName: string
  workspaceSlug: string
  role: string
  branding?: BrandingProps
}

// Sidebar adaptativo por rol
const ALL_NAV_ITEMS = [
  { href: '/numeros', label: 'Numeros', icon: BarChart3, roles: ['owner', 'admin', 'read_only'] },
  { href: '/pipeline', label: 'Pipeline', icon: Flame, roles: ['owner', 'admin'] },
  { href: '/proyectos', label: 'Proyectos', icon: FolderKanban, roles: ['owner', 'admin', 'operator'] },
  { href: '/directorio', label: 'Directorio', icon: Users, roles: ['owner', 'admin'] },
  { href: '/mi-negocio', label: 'Mi Negocio', icon: Briefcase, roles: ['owner', 'admin', 'operator'] },
]

function getNavItemsForRole(role: string) {
  return ALL_NAV_ITEMS.filter(item => item.roles.includes(role))
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dueno',
  admin: 'Admin',
  operator: 'Operador',
  read_only: 'Lectura',
}

export default function AppShell({
  children,
  fullName,
  workspaceName,
  workspaceSlug,
  role,
  branding,
}: AppShellProps) {
  const pathname = usePathname()
  const [sidebarExpanded, setSidebarExpanded] = useState(true)

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const initials = fullName
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  const navItems = getNavItemsForRole(role)

  // Dynamic branding: override CSS custom properties when workspace has custom colors
  const brandingStyle: Record<string, string> = {}
  if (branding?.colorPrimario) {
    brandingStyle['--sidebar-primary'] = branding.colorPrimario
  }
  if (branding?.colorSecundario) {
    brandingStyle['--sidebar'] = branding.colorSecundario
  }

  const hasLogo = !!branding?.logoUrl

  const METRIK_ISOTIPO = 'https://hcxyowictswpibzqxwyj.supabase.co/storage/v1/object/public/metrik-landing/Isotipo_Mk.png'

  return (
    <div className="flex h-screen overflow-hidden bg-background" style={brandingStyle}>
      {/* ── Desktop Sidebar ── */}
      <aside
        className={`hidden md:flex flex-col shrink-0 transition-all duration-200 ease-in-out ${
          sidebarExpanded ? 'w-56' : 'w-16'
        }`}
        style={{
          backgroundColor: 'var(--sidebar)',
          color: 'var(--sidebar-foreground)',
        }}
      >
        {/* Sidebar header: MéTRIK branding + collapse */}
        <div className="flex h-14 items-center justify-between px-3">
          {sidebarExpanded ? (
            <Link href="/numeros" className="flex items-center gap-2 flex-1 overflow-hidden">
              <img src={METRIK_ISOTIPO} alt="MeTRIK" className="h-7 w-7 shrink-0 object-contain" />
              <span className="truncate text-sm font-semibold" style={{ color: 'var(--sidebar-foreground)' }}>MeTRIK ONE</span>
            </Link>
          ) : (
            <Link href="/numeros" className="flex h-8 w-8 shrink-0 items-center justify-center">
              <img src={METRIK_ISOTIPO} alt="MeTRIK" className="h-7 w-7 object-contain" />
            </Link>
          )}
          <button
            onClick={() => setSidebarExpanded(!sidebarExpanded)}
            className="hidden md:flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:opacity-80"
            style={{ color: 'var(--sidebar-muted)' }}
          >
            {sidebarExpanded ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-2 py-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                title={!sidebarExpanded ? item.label : undefined}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-all ${
                  sidebarExpanded ? '' : 'justify-center'
                } ${
                  isActive
                    ? 'shadow-sm'
                    : 'hover:opacity-90'
                }`}
                style={{
                  backgroundColor: isActive ? 'var(--sidebar-primary)' : 'transparent',
                  color: isActive ? 'var(--sidebar-primary-foreground)' : 'var(--sidebar-muted)',
                }}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {sidebarExpanded && <span>{item.label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* User section */}
        <div className="px-2 pb-3 pt-2" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
          <div className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 ${sidebarExpanded ? '' : 'justify-center'}`}>
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
              style={{ backgroundColor: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)' }}
            >
              {initials}
            </div>
            {sidebarExpanded && (
              <div className="flex-1 overflow-hidden min-w-0">
                <p className="truncate text-xs font-bold" style={{ color: '#ffffff' }}>{fullName}</p>
                <p className="text-[10px]" style={{ color: 'var(--sidebar-muted)' }}>{ROLE_LABELS[role] || role}</p>
              </div>
            )}
            {sidebarExpanded && (
              <button
                onClick={handleSignOut}
                className="rounded-md p-1 transition-colors hover:opacity-80"
                style={{ color: 'var(--sidebar-muted)' }}
                title="Cerrar sesion"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {!sidebarExpanded && (
            <button
              onClick={handleSignOut}
              className="flex w-full justify-center rounded-md p-1.5 mt-1 transition-colors hover:opacity-80"
              style={{ color: 'var(--sidebar-muted)' }}
              title="Cerrar sesion"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop header — workspace brand logo top-right */}
        <header className="hidden md:flex h-12 items-center justify-between border-b border-border bg-background px-6 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="truncate text-xs font-medium text-muted-foreground">{workspaceName}</p>
          </div>
          {hasLogo && (
            <img src={branding!.logoUrl} alt={workspaceName} className="h-8 max-w-[120px] object-contain" />
          )}
        </header>

        {/* Mobile header — MéTRIK logo + avatar/logout */}
        <header className="flex h-14 items-center justify-between border-b border-border px-4 md:hidden" style={{ backgroundColor: 'var(--sidebar)', color: 'var(--sidebar-foreground)' }}>
          <Link href="/numeros" className="flex items-center gap-2">
            <img src={METRIK_ISOTIPO} alt="MeTRIK" className="h-7 w-7 object-contain" />
            <span className="text-sm font-semibold">MeTRIK ONE</span>
          </Link>
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold"
              style={{ backgroundColor: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)' }}
            >
              {initials}
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-md p-1.5 transition-colors hover:opacity-80"
              style={{ color: 'var(--sidebar-muted)' }}
              title="Cerrar sesion"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto min-h-0 bg-background">
          <div className="p-6 pb-24 md:pb-6">{children}</div>
        </main>

        {/* ── Mobile Bottom Tab Bar ── */}
        <nav
          className="flex md:hidden h-14 items-center justify-around border-t border-border bg-background shrink-0"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 px-1 py-1 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="truncate max-w-[60px]">{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>

      {/* FAB — hidden on /numeros (has its own FAB) */}
      {!pathname.startsWith('/numeros') && <FAB role={role} />}
    </div>
  )
}
