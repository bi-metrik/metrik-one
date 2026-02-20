'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  BarChart3,
  Flame,
  FolderKanban,
  Settings,
  Menu,
  X,
  LogOut,
  Users,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import FAB from './fab'

interface AppShellProps {
  children: React.ReactNode
  fullName: string
  workspaceName: string
  workspaceSlug: string
  role: string
}

// Sidebar adaptativo por rol
const ALL_NAV_ITEMS = [
  { href: '/numeros', label: 'Numeros', icon: BarChart3, roles: ['owner', 'admin', 'read_only'] },
  { href: '/pipeline', label: 'Pipeline', icon: Flame, roles: ['owner', 'admin'] },
  { href: '/proyectos', label: 'Proyectos', icon: FolderKanban, roles: ['owner', 'admin', 'operator'] },
  { href: '/directorio', label: 'Directorio', icon: Users, roles: ['owner', 'admin'] },
  { href: '/config', label: 'Config', icon: Settings, roles: ['owner', 'admin', 'operator'] },
]

function getNavItemsForRole(role: string) {
  return ALL_NAV_ITEMS.filter(item => item.roles.includes(role))
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dueño',
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
}: AppShellProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
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
        {/* Logo */}
        <div className="flex h-14 items-center justify-between px-3">
          <Link href="/numeros" className="flex items-center gap-2 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-black text-sm" style={{ backgroundColor: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)' }}>
              M
            </div>
            {sidebarExpanded && (
              <span className="text-sm font-semibold tracking-tight whitespace-nowrap" style={{ color: 'var(--sidebar-foreground)' }}>
                MéTRIK ONE
              </span>
            )}
          </Link>
          <button
            onClick={() => setSidebarExpanded(!sidebarExpanded)}
            className="hidden md:flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:opacity-80"
            style={{ color: 'var(--sidebar-muted)' }}
          >
            {sidebarExpanded ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Workspace */}
        {sidebarExpanded && (
          <div className="mx-3 mb-2 rounded-md px-2 py-2" style={{ backgroundColor: 'var(--sidebar-accent)' }}>
            <p className="truncate text-xs font-medium" style={{ color: 'var(--sidebar-foreground)' }}>{workspaceName}</p>
            <p className="truncate text-[10px]" style={{ color: 'var(--sidebar-muted)' }}>{workspaceSlug}.metrikone.co</p>
          </div>
        )}

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
                  backgroundColor: isActive ? 'var(--sidebar-accent)' : 'transparent',
                  color: isActive ? 'var(--sidebar-foreground)' : 'var(--sidebar-muted)',
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
                <p className="truncate text-xs font-medium" style={{ color: 'var(--sidebar-foreground)' }}>{fullName}</p>
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
        {/* Mobile header */}
        <header className="flex h-14 items-center justify-between border-b border-border px-4 md:hidden" style={{ backgroundColor: 'var(--sidebar)', color: 'var(--sidebar-foreground)' }}>
          <Link href="/numeros" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg font-black text-xs" style={{ backgroundColor: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)' }}>
              M
            </div>
            <span className="text-sm font-semibold">MéTRIK ONE</span>
          </Link>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="rounded-md p-2 transition-colors hover:opacity-80"
            style={{ color: 'var(--sidebar-muted)' }}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>

        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden" style={{ backgroundColor: 'var(--sidebar)', color: 'var(--sidebar-foreground)' }}>
            <div className="flex h-14 items-center justify-between px-4" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg font-black text-xs" style={{ backgroundColor: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)' }}>
                  M
                </div>
                <span className="text-sm font-semibold">MéTRIK ONE</span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md p-2 transition-colors hover:opacity-80"
                style={{ color: 'var(--sidebar-muted)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4">
              <div className="mb-4 rounded-lg p-3" style={{ backgroundColor: 'var(--sidebar-accent)' }}>
                <p className="text-sm font-medium">{workspaceName}</p>
                <p className="text-[11px]" style={{ color: 'var(--sidebar-muted)' }}>{workspaceSlug}.metrikone.co</p>
              </div>

              <nav className="space-y-1">
                {navItems.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors"
                      style={{
                        backgroundColor: isActive ? 'var(--sidebar-accent)' : 'transparent',
                        color: isActive ? 'var(--sidebar-foreground)' : 'var(--sidebar-muted)',
                      }}
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  )
                })}
              </nav>

              <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)' }}>
                    {initials}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{fullName}</p>
                    <p className="text-[11px]" style={{ color: 'var(--sidebar-muted)' }}>{ROLE_LABELS[role] || role}</p>
                  </div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors"
                  style={{ color: 'oklch(0.7 0.15 25)' }}
                >
                  <LogOut className="h-5 w-5" />
                  Cerrar sesión
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-auto min-h-0 bg-background">
          <div className="p-6">{children}</div>
        </main>
      </div>

      {/* FAB */}
      <FAB role={role} />
    </div>
  )
}
