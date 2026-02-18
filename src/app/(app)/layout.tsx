import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  // Get user profile + workspace
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, workspaces(*)')
    .eq('id', user.id)
    .single()

  if (!profile) {
    // New user — needs onboarding
    redirect('/onboarding')
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar — Sprint 1 */}
      <aside className="hidden w-64 border-r bg-card md:block">
        <div className="flex h-14 items-center border-b px-4">
          <span className="text-lg font-bold">
            MéTRIK <span className="text-muted-foreground font-normal">ONE</span>
          </span>
        </div>
        <nav className="space-y-1 p-4">
          <a href="/numeros" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent">
            Números
          </a>
          <a href="/pipeline" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent">
            Pipeline
          </a>
          <a href="/proyectos" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent">
            Proyectos
          </a>
          <a href="/config" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent">
            Configuración
          </a>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
