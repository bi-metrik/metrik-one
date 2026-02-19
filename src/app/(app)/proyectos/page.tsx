import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ProyectosBoard from './proyectos-board'

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

  // Parallel fetch: projects, clients, expenses summary, time summary, invoices summary, payments
  const [projectsRes, clientsRes, expensesRes, timeRes, invoicesRes, paymentsRes] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
    supabase
      .from('clients')
      .select('id, name')
      .eq('workspace_id', workspaceId),
    supabase
      .from('expenses')
      .select('project_id, amount, is_rework')
      .eq('workspace_id', workspaceId),
    supabase
      .from('time_entries')
      .select('project_id, hours')
      .eq('workspace_id', workspaceId),
    supabase
      .from('invoices')
      .select('id, project_id, gross_amount')
      .eq('workspace_id', workspaceId),
    supabase
      .from('payments')
      .select('invoice_id, net_received')
      .eq('workspace_id', workspaceId),
  ])

  const rawProjects = projectsRes.data || []
  const clientMap = new Map((clientsRes.data || []).map(c => [c.id, c.name]))

  // Build expense totals per project
  const expenseMap = new Map<string, number>()
  for (const e of (expensesRes.data || [])) {
    if (e.project_id) {
      expenseMap.set(e.project_id, (expenseMap.get(e.project_id) || 0) + e.amount)
    }
  }

  // Build hours totals per project
  const hoursMap = new Map<string, number>()
  for (const t of (timeRes.data || [])) {
    if (t.project_id) {
      hoursMap.set(t.project_id, (hoursMap.get(t.project_id) || 0) + t.hours)
    }
  }

  // Build invoice totals per project
  const invoiceMap = new Map<string, number>()
  const invoiceToProject = new Map<string, string>()
  for (const inv of (invoicesRes.data || [])) {
    if (inv.project_id) {
      invoiceMap.set(inv.project_id, (invoiceMap.get(inv.project_id) || 0) + inv.gross_amount)
      invoiceToProject.set(inv.id, inv.project_id)
    }
  }

  // Build collected totals per project
  const collectedMap = new Map<string, number>()
  for (const pay of (paymentsRes.data || [])) {
    const projId = invoiceToProject.get(pay.invoice_id)
    if (projId) {
      collectedMap.set(projId, (collectedMap.get(projId) || 0) + pay.net_received)
    }
  }

  // Assemble projects with summaries for the kanban board
  const projectsForBoard = rawProjects.map(p => {
    const totalExpenses = expenseMap.get(p.id) || 0
    const budget = p.approved_budget || 0
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      client_id: p.client_id,
      clientName: p.client_id ? clientMap.get(p.client_id) || null : null,
      approved_budget: p.approved_budget,
      rework_reason: p.rework_reason,
      created_at: p.created_at,
      totalExpenses,
      totalHours: hoursMap.get(p.id) || 0,
      totalInvoiced: invoiceMap.get(p.id) || 0,
      totalCollected: collectedMap.get(p.id) || 0,
      marginPct: budget > 0 ? ((budget - totalExpenses) / budget) * 100 : 0,
    }
  })

  return <ProyectosBoard initialProjects={projectsForBoard} />
}
