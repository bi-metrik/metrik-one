import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FolderKanban, ArrowRight } from 'lucide-react'
import Link from 'next/link'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: 'Activo', color: 'bg-green-500' },
  completed: { label: 'Completado', color: 'bg-blue-500' },
  cancelled: { label: 'Cancelado', color: 'bg-red-500' },
  paused: { label: 'Pausado', color: 'bg-yellow-500' },
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)
}

export default async function ProyectosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/onboarding')

  const workspaceId = profile.workspace_id

  // Fetch projects
  const { data: rawProjects } = await supabase
    .from('projects')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  // Fetch clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .eq('workspace_id', workspaceId)

  const clientMap = new Map((clients || []).map(c => [c.id, c.name]))
  const projectList = (rawProjects || []).map(p => ({
    ...p,
    clientName: p.client_id ? clientMap.get(p.client_id) || null : null,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Proyectos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todos tus proyectos nacen del Pipeline. {projectList.length > 0 ? `${projectList.length} proyecto${projectList.length === 1 ? '' : 's'}` : ''}
        </p>
      </div>

      {projectList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <FolderKanban className="mx-auto h-12 w-12 text-muted-foreground/30" />
          <h3 className="mt-4 text-sm font-medium">Sin proyectos aún</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Cuando marques una oportunidad como &ldquo;Ganada&rdquo; en el Pipeline, tu proyecto aparecerá aquí automáticamente.
          </p>
          <Link
            href="/pipeline"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Ir al Pipeline
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {projectList.map((project) => {
            const status = STATUS_LABELS[project.status] || { label: project.status, color: 'bg-gray-500' }
            return (
              <div
                key={project.id}
                className="flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
              >
                <div className="flex-1 min-w-0">
                  {project.clientName && (
                    <p className="text-xs text-muted-foreground">{project.clientName}</p>
                  )}
                  <p className="font-medium truncate">{project.name}</p>
                  {project.approved_budget && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {formatCurrency(project.approved_budget)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${status.color}`} />
                  <span className="text-xs font-medium text-muted-foreground">{status.label}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
