'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  BarChart3,
  LayoutDashboard,
  Briefcase,
  Store,
  LogOut,
  Users,
  ChevronLeft,
  ChevronRight,
  ArrowLeftRight,
  BookOpen,
  Activity,
  UserCheck,
  MoreHorizontal,
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
  displayRole?: string | null
  isAdminWorkspace?: boolean
  branding?: BrandingProps
  notificationBell?: React.ReactNode
}

// Sidebar adaptativo por rol
const ALL_NAV_ITEMS = [
  { href: '/numeros', label: 'Números', icon: BarChart3, roles: ['owner', 'admin', 'supervisor', 'read_only'] },
  { href: '/tableros', label: 'Tableros', icon: LayoutDashboard, roles: ['owner', 'admin', 'read_only'] },
  { href: '/negocios', label: 'Negocios', icon: Store, roles: ['owner', 'admin', 'supervisor', 'operator'] },
  { href: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight, roles: ['owner', 'admin', 'supervisor', 'read_only'] },
  { href: '/equipo', label: 'Equipo', icon: UserCheck, roles: ['owner', 'admin', 'supervisor'] },
  { href: '/directorio', label: 'Directorio', icon: Users, roles: ['owner', 'admin', 'supervisor', 'operator'] },
  { href: '/mi-negocio', label: 'Mi Negocio', icon: Briefcase, roles: ['owner', 'admin', 'supervisor'] },
]

// D246: Sección contable separada — visible para owner/admin/contador
const CONTABILIDAD_NAV_ITEMS = [
  { href: '/causacion', label: 'Causacion', icon: BookOpen, roles: ['owner', 'admin', 'contador'] },
]

// Admin section — solo owner
const ADMIN_NAV_ITEMS = [
  { href: '/admin/mibolsillo', label: 'Mi Bolsillo', icon: Activity, roles: ['owner'] },
]

// Mobile: 4 primary tabs per role, rest goes to "Más" panel
const MOBILE_PRIMARY_HREFS: Record<string, string[]> = {
  owner: ['/numeros', '/negocios', '/movimientos', '/tableros'],
  admin: ['/numeros', '/negocios', '/movimientos', '/tableros'],
  supervisor: ['/numeros', '/negocios', '/movimientos', '/directorio'],
  operator: ['/negocios', '/directorio'],
  contador: ['/causacion'],
  read_only: ['/numeros', '/movimientos', '/tableros'],
}

function getNavItemsForRole(role: string) {
  return ALL_NAV_ITEMS.filter(item => item.roles.includes(role))
}

function getContabilidadItemsForRole(role: string) {
  return CONTABILIDAD_NAV_ITEMS.filter(item => item.roles.includes(role))
}

function getAdminItemsForRole(role: string) {
  return ADMIN_NAV_ITEMS.filter(item => item.roles.includes(role))
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Empresario',
  admin: 'Admin',
  supervisor: 'Supervisor',
  operator: 'Ejecutor',
  contador: 'Contador',
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
  displayRole,
  isAdminWorkspace,
  branding,
  notificationBell,
}: AppShellProps) {
  const pathname = usePathname()
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)

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
  const adminItems = isAdminWorkspace ? getAdminItemsForRole(role) : []

  // Mobile tab bar: split into primary (visible) and secondary (in "Más" panel)
  const allMobileItems = [...navItems, ...contabilidadItems]
  const primaryHrefs = MOBILE_PRIMARY_HREFS[role] || MOBILE_PRIMARY_HREFS.operator
  const mobilePrimary = allMobileItems.filter(item => primaryHrefs.includes(item.href))
  const mobileSecondary = allMobileItems.filter(item => !primaryHrefs.includes(item.href))
  const showMoreButton = mobileSecondary.length > 0

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

  // Brand lockup: MéTRIK (Bold 700) + one (Light 300) + green line
  const logoFont = 'var(--font-montserrat), Montserrat, sans-serif'

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
            <Link href="/numeros" className="flex-1 overflow-hidden">
              <div className="inline-flex flex-col">
                <div className="flex items-baseline" style={{ fontFamily: logoFont }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9375rem', letterSpacing: '-0.01em', color: 'var(--sidebar-foreground)' }}>MéTRIK</span>
                  <span style={{ fontWeight: 300, fontSize: '0.9375rem', letterSpacing: '-0.005em', color: 'var(--sidebar-foreground)', marginLeft: '0.25rem' }}>one</span>
                </div>
                <div style={{ height: '2px', backgroundColor: '#10B981', borderRadius: '1px', marginTop: '3px' }} />
              </div>
            </Link>
          ) : (
            <Link href="/numeros" className="flex h-8 w-10 shrink-0 items-center justify-center">
              <div className="inline-flex flex-col items-center">
                <div className="flex items-baseline" style={{ fontFamily: logoFont, color: 'var(--sidebar-foreground)' }}>
                  <span style={{ fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em' }}>M</span>
                  <span style={{ fontWeight: 400, fontSize: '0.5625rem' }}>1</span>
                </div>
                <div style={{ height: '1.5px', width: '100%', backgroundColor: '#10B981', borderRadius: '1px', marginTop: '1px' }} />
              </div>
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

        {/* Navigation — contador sees empty navItems, only contabilidad section below */}
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

        {/* Admin section — solo owner */}
        {adminItems.length > 0 && (
          <div className="px-2 pb-1 pt-1" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
            {sidebarExpanded && (
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--sidebar-muted)' }}>
                Admin
              </p>
            )}
            {adminItems.map((item) => {
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
                <p className="truncate text-xs font-bold" style={{ color: 'var(--sidebar-foreground)' }}>{fullName}</p>
                <p className="text-[10px]" style={{ color: 'var(--sidebar-muted)' }}>{displayRole || ROLE_LABELS[role] || role}</p>
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
        {/* Desktop header — greeting + date left, bell + brand logo right */}
        <header className="hidden md:flex h-12 items-center justify-between border-b border-border bg-background px-6 shrink-0">
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold text-foreground">
              Hola {fullName.split(' ')[0]}
            </p>
            <span className="text-muted-foreground">·</span>
            <p className="text-xs font-medium text-muted-foreground">
              {(() => { const d = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return d.charAt(0).toUpperCase() + d.slice(1) })()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {notificationBell}
            {hasLogo && (
              <img src={branding!.logoUrl} alt={workspaceName} className="h-8 max-w-[120px] object-contain" />
            )}
          </div>
        </header>

        {/* Mobile header — MéTRIK isotipo + company logo + avatar/logout */}
        <header className="flex h-14 items-center justify-between border-b border-border px-4 md:hidden" style={{ backgroundColor: 'var(--sidebar)', color: 'var(--sidebar-foreground)' }}>
          <div className="flex items-center gap-3">
            <Link href="/numeros" className="flex items-center shrink-0">
              <div className="inline-flex flex-col items-center">
                <div className="flex items-baseline" style={{ fontFamily: logoFont, color: 'var(--sidebar-foreground)' }}>
                  <span style={{ fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em' }}>M</span>
                  <span style={{ fontWeight: 400, fontSize: '0.5625rem' }}>1</span>
                </div>
                <div style={{ height: '1.5px', width: '100%', backgroundColor: '#10B981', borderRadius: '1px', marginTop: '1px' }} />
              </div>
            </Link>
            {hasLogo && (
              <img src={branding!.logoUrl} alt={workspaceName} className="h-7 max-w-[120px] object-contain" />
            )}
            {!hasLogo && (
              <span className="truncate text-sm font-semibold">{workspaceName}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {notificationBell}
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

        {/* ── Mobile "Más" panel + backdrop ── */}
        {mobileMoreOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/10 md:hidden"
              onClick={() => setMobileMoreOpen(false)}
            />
            <div className="fixed bottom-14 left-3 right-3 z-50 rounded-t-2xl border bg-card shadow-xl md:hidden"
              style={{ paddingBottom: '0' }}
            >
              {mobileSecondary.map((item, i) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMoreOpen(false)}
                    className={`flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors ${
                      i < mobileSecondary.length - 1 ? 'border-b' : ''
                    } ${isActive ? 'text-primary' : 'text-foreground hover:bg-accent/50'}`}
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </>
        )}

        {/* ── Mobile Bottom Tab Bar ── */}
        <nav
          className="flex md:hidden h-14 items-center justify-around border-t border-border bg-background shrink-0"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {mobilePrimary.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMoreOpen(false)}
                className={`flex flex-col items-center gap-0.5 px-1 py-1 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="truncate max-w-[60px]">{item.label}</span>
              </Link>
            )
          })}
          {showMoreButton && (
            <button
              onClick={() => setMobileMoreOpen(!mobileMoreOpen)}
              className={`flex flex-col items-center gap-0.5 px-1 py-1 text-[10px] font-medium transition-colors ${
                mobileMoreOpen ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <MoreHorizontal className="h-5 w-5" />
              <span>Más</span>
            </button>
          )}
        </nav>
      </div>

      {/* FAB */}
      <FAB role={role} />
    </div>
  )
}
