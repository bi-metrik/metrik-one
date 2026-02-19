import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import ProjectDetailClient from './project-detail-client'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params
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

  // Fetch project and all related data
  const [projectRes, expensesRes, timeRes, invoicesRes, paymentsRes, clientsRes, categoriesRes] =
    await Promise.all([
      supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .single(),
      supabase
        .from('expenses')
        .select('*')
        .eq('project_id', id)
        .eq('workspace_id', workspaceId)
        .order('expense_date', { ascending: false }),
      supabase
        .from('time_entries')
        .select('*')
        .eq('project_id', id)
        .eq('workspace_id', workspaceId)
        .order('entry_date', { ascending: false }),
      supabase
        .from('invoices')
        .select('*')
        .eq('project_id', id)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false }),
      supabase
        .from('payments')
        .select('*')
        .eq('workspace_id', workspaceId),
      supabase
        .from('clients')
        .select('id, name')
        .eq('workspace_id', workspaceId),
      supabase
        .from('expense_categories')
        .select('id, name')
        .eq('workspace_id', workspaceId),
    ])

  if (!projectRes.data) notFound()

  const project = projectRes.data
  const expenses = expensesRes.data || []
  const timeEntries = timeRes.data || []
  const invoices = invoicesRes.data || []
  const allPayments = paymentsRes.data || []

  const clientMap = new Map((clientsRes.data || []).map(c => [c.id, c.name]))
  const catMap = new Map((categoriesRes.data || []).map(c => [c.id, c.name]))

  const invoiceIds = new Set(invoices.map(i => i.id))
  const projectPayments = allPayments.filter(p => invoiceIds.has(p.invoice_id))

  // Calculate summary
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const reworkExpenses = expenses.filter(e => e.is_rework).reduce((s, e) => s + e.amount, 0)
  const totalHours = timeEntries.reduce((s, t) => s + t.hours, 0)
  const totalInvoiced = invoices.reduce((s, i) => s + i.gross_amount, 0)
  const totalCollected = projectPayments.reduce((s, p) => s + p.net_received, 0)

  return (
    <ProjectDetailClient
      project={{
        ...project,
        clientName: project.client_id ? clientMap.get(project.client_id) || null : null,
      }}
      expenses={expenses.map(e => ({ ...e, categoryName: catMap.get(e.category_id) || 'Sin categoría' }))}
      timeEntries={timeEntries}
      invoices={invoices}
      payments={projectPayments}
      summary={{
        totalExpenses,
        reworkExpenses,
        totalHours,
        totalInvoiced,
        totalCollected,
        pendingCollection: totalInvoiced - totalCollected,
        budget: project.approved_budget || 0,
        marginPct: project.approved_budget && project.approved_budget > 0
          ? ((project.approved_budget - totalExpenses) / project.approved_budget) * 100
          : 0,
      }}
    />
  )
}
