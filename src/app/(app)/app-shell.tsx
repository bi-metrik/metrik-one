'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  BarChart3,
  Funnel,
  FolderKanban,
  Settings,
  LayoutDashboard,
  Menu,
  X,
  LogOut,
  User,
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

// Sidebar items — D42: 4 items + Dashboard
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/numeros', label: 'Números', icon: BarChart3 },
  { href: '/pipeline', label: 'Pipeline', icon: Funnel },
  { href: '/proyectos', label: 'Proyectos', icon: FolderKanban },
  { href: '/config', label: 'Configuración', icon: Settings },
]

export default function AppShell({
  children,
  fullName,
  workspaceName,
  workspaceSlug,
  role,
}: AppShellProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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

  return (
    <div className="flex h-screen">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 flex-col border-r bg-card md:flex">
        {/* Logo + workspace */}
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-lg font-bold">
              MéTRIK <span className="font-normal text-muted-foreground">ONE</span>
            </span>
          </Link>
        </div>

        {/* Workspace name */}
        <div className="border-b px-4 py-3">
          <p className="truncate text-sm font-medium">{workspaceName}</p>
          <p className="text-xs text-muted-foreground">{workspaceSlug}.metrikone.co</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* User section */}
        <div className="border-t p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {initials}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium">{fullName}</p>
              <p className="text-xs capitalize text-muted-foreground">{role}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-4 md:hidden">
          <Link href="/dashboard" className="text-lg font-bold">
            MéTRIK <span className="font-normal text-muted-foreground">ONE</span>
          </Link>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>

        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
          <div className="absolute inset-0 z-50 bg-background md:hidden">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <span className="text-lg font-bold">
                MéTRIK <span className="font-normal text-muted-foreground">ONE</span>
              </span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md p-2 text-muted-foreground hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4">
              <div className="mb-4 rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{workspaceName}</p>
                <p className="text-xs text-muted-foreground">{workspaceSlug}.metrikone.co</p>
              </div>

              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  )
                })}
              </nav>

              <div className="mt-6 border-t pt-4">
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {initials}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{fullName}</p>
                    <p className="text-xs capitalize text-muted-foreground">{role}</p>
                  </div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <LogOut className="h-5 w-5" />
                  Cerrar sesión
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>

      {/* D43: FAB visible en todas las pantallas */}
      <FAB />
    </div>
  )
}
