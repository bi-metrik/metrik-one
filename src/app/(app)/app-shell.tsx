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
  ArrowLeftRight,
  BookOpen,
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
  { href: '/numeros', label: 'Números', icon: BarChart3, roles: ['owner', 'admin', 'read_only'] },
  { href: '/pipeline', label: 'Pipeline', icon: Flame, roles: ['owner', 'admin'] },
  { href: '/proyectos', label: 'Proyectos', icon: FolderKanban, roles: ['owner', 'admin', 'operator'] },
  { href: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight, roles: ['owner', 'admin', 'read_only'] },
  { href: '/directorio', label: 'Directorio', icon: Users, roles: ['owner', 'admin'] },
  { href: '/mi-negocio', label: 'Mi Negocio', icon: Briefcase, roles: ['owner', 'admin', 'operator'] },
]

// D246: Sección contable separada (futuro: visible para rol contador)
const CONTABILIDAD_NAV_ITEMS = [
  { href: '/causacion', label: 'Causacion', icon: BookOpen, roles: ['owner', 'admin'] },
]

function getNavItemsForRole(role: string) {
  return ALL_NAV_ITEMS.filter(item => item.roles.includes(role))
}

function getContabilidadItemsForRole(role: string) {
  return CONTABILIDAD_NAV_ITEMS.filter(item => item.roles.includes(role))
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Admin',
  operator: 'Operador',
  read_only: 'Lectura',
}

/** Parse hex color to relative luminance (0=black, 1=white) */
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '')
  if (h.length < 6) return 0
  const r = parseInt(h.substring(0, 2), 16) / 255
  const g = parseInt(h.substring(2, 4), 16) / 255
  const b = parseInt(h.substring(4, 6), 16) / 255
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
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
  const contabilidadItems = getContabilidadItemsForRole(role)

  // Dynamic branding: override CSS custom properties when workspace has custom colors
  const brandingStyle: Record<string, string> = {}
  if (branding?.colorPrimario) {
    brandingStyle['--sidebar-primary'] = branding.colorPrimario
    // If primary is light, use dark text for primary-foreground
    if (hexLuminance(branding.colorPrimario) > 0.4) {
      brandingStyle['--sidebar-primary-foreground'] = '#1a1a1a'
    }
  }
  if (branding?.colorSecundario) {
    brandingStyle['--sidebar'] = branding.colorSecundario
    // If sidebar bg is light, use dark text colors for readability
    if (hexLuminance(branding.colorSecundario) > 0.4) {
      brandingStyle['--sidebar-foreground'] = '#1a1a1a'
      brandingStyle['--sidebar-muted'] = '#555555'
      brandingStyle['--sidebar-border'] = '#d4d4d4'
    }
  }

  const hasLogo = !!branding?.logoUrl

  const METRIK_ISOTIPO = 'https://hcxyowictswpibzqxwyj.supabase.co/storage/v1/object/public/metrik-landing/Isotipo_Mk.png'

  return (
    <div className="flex h-dvh overflow-hidden bg-background" style={brandingStyle}>
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

        {/* D246: Contabilidad section — separated from main nav */}
        {contabilidadItems.length > 0 && (
          <div className="px-2 pb-1 pt-1" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
            {sidebarExpanded && (
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--sidebar-muted)' }}>
                Contabilidad
              </p>
            )}
            {contabilidadItems.map((item) => {
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
          </div>
        )}

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
                <p className="truncate text-xs font-bold" style={{ color: 'var(--sidebar-primary-foreground)' }}>{fullName}</p>
                <p className="text-[10px]" style={{ color: 'var(--sidebar-muted)' }}>{ROLE_LABELS[role] || role}</p>
              </div>
            )}
            {sidebarExpanded && (
              <button
                onClick={handleSignOut}
                className="rounded-md p-1 transition-colors hover:opacity-80"
                style={{ color: 'var(--sidebar-muted)' }}
                title="Cerrar sesión"
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
              title="Cerrar sesión"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop header — date left, brand logo right */}
        <header className="hidden md:flex h-12 items-center justify-between border-b border-border bg-background px-6 shrink-0">
          <p className="text-xs font-medium text-muted-foreground">
            {(() => { const d = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return d.charAt(0).toUpperCase() + d.slice(1) })()}
          </p>
          {hasLogo && (
            <img src={branding!.logoUrl} alt={workspaceName} className="h-8 max-w-[120px] object-contain" />
          )}
        </header>

        {/* Mobile header — MéTRIK isotipo + company logo + avatar/logout */}
        <header className="flex h-14 items-center justify-between border-b border-border px-4 md:hidden" style={{ backgroundColor: 'var(--sidebar)', color: 'var(--sidebar-foreground)' }}>
          <div className="flex items-center gap-3">
            <Link href="/numeros" className="flex items-center shrink-0">
              <img src={METRIK_ISOTIPO} alt="MeTRIK" className="h-7 w-7 object-contain" />
            </Link>
            {hasLogo && (
              <img src={branding!.logoUrl} alt={workspaceName} className="h-7 max-w-[120px] object-contain" />
            )}
            {!hasLogo && (
              <span className="truncate text-sm font-semibold">{workspaceName}</span>
            )}
          </div>
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
              title="Cerrar sesión"
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

      {/* FAB */}
      <FAB role={role} />
    </div>
  )
}
