'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ── Helper: get workspace ──────────────────────────────

async function getWorkspace() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, workspaceId: null, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { supabase, workspaceId: null, error: 'Sin perfil' }
  return { supabase, workspaceId: profile.workspace_id, userId: user.id, error: null }
}

// ── Get single project with full details ────────────────

export async function getProjectDetail(projectId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { project: null, error: error || 'Error' }

  // Parallel fetches
  const [projectRes, expensesRes, timeRes, invoicesRes, paymentsRes, clientsRes] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('workspace_id', workspaceId)
      .single(),
    supabase
      .from('expenses')
      .select('*')
      .eq('project_id', projectId)
      .eq('workspace_id', workspaceId)
      .order('expense_date', { ascending: false }),
    supabase
      .from('time_entries')
      .select('*')
      .eq('project_id', projectId)
      .eq('workspace_id', workspaceId)
      .order('entry_date', { ascending: false }),
    supabase
      .from('invoices')
      .select('*')
      .eq('project_id', projectId)
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
  ])

  if (projectRes.error || !projectRes.data) {
    return { project: null, error: 'Proyecto no encontrado' }
  }

  const project = projectRes.data
  const expenses = expensesRes.data || []
  const timeEntries = timeRes.data || []
  const invoices = invoicesRes.data || []
  const allPayments = paymentsRes.data || []

  // Map payments to invoices
  const invoiceIds = new Set(invoices.map(i => i.id))
  const projectPayments = allPayments.filter(p => invoiceIds.has(p.invoice_id))

  // Categories for expenses
  const { data: categories } = await supabase
    .from('expense_categories')
    .select('id, name')
    .eq('workspace_id', workspaceId)

  const catMap = new Map((categories || []).map(c => [c.id, c.name]))
  const clientMap = new Map((clientsRes.data || []).map(c => [c.id, c.name]))

  // Calculate summaries
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const reworkExpenses = expenses.filter(e => e.is_rework).reduce((s, e) => s + e.amount, 0)
  const totalHours = timeEntries.reduce((s, t) => s + t.hours, 0)
  const totalInvoiced = invoices.reduce((s, i) => s + i.gross_amount, 0)
  const totalCollected = projectPayments.reduce((s, p) => s + p.net_received, 0)
  const totalRetentions = projectPayments.reduce((s, p) => s + p.retention_applied, 0)

  return {
    project: {
      ...project,
      clientName: project.client_id ? clientMap.get(project.client_id) || null : null,
      expenses: expenses.map(e => ({ ...e, categoryName: catMap.get(e.category_id) || 'Sin categoría' })),
      timeEntries,
      invoices,
      payments: projectPayments,
      summary: {
        totalExpenses,
        reworkExpenses,
        totalHours,
        totalInvoiced,
        totalCollected,
        totalRetentions,
        pendingCollection: totalInvoiced - totalCollected,
        budget: project.approved_budget || 0,
        marginPct: project.approved_budget && project.approved_budget > 0
          ? ((project.approved_budget - totalExpenses) / project.approved_budget) * 100
          : 0,
      },
    },
    error: null,
  }
}

// ── Update project status (state machine D175) ──────────

type ProjectStatus = 'active' | 'paused' | 'completed' | 'rework' | 'cancelled' | 'closed'

const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'cancelled'],
  completed: ['active', 'rework', 'closed'],  // D177, D178
  rework: ['completed', 'cancelled'],
  cancelled: ['closed'],
  closed: [],
}

export async function updateProjectStatus(
  projectId: string,
  newStatus: ProjectStatus,
  reason?: string
) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: error || 'Error' }

  // Get current project
  const { data: project } = await supabase
    .from('projects')
    .select('status')
    .eq('id', projectId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!project) return { success: false, error: 'Proyecto no encontrado' }

  const currentStatus = project.status as ProjectStatus
  const validTargets = VALID_TRANSITIONS[currentStatus] || []

  if (!validTargets.includes(newStatus)) {
    return { success: false, error: `No puedes cambiar de ${currentStatus} a ${newStatus}` }
  }

  // D178: Rework requires reason
  if (newStatus === 'rework' && !reason) {
    return { success: false, error: 'Indica la razón del reproceso' }
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }

  if (newStatus === 'rework') {
    updateData.rework_reason = reason
  }

  if (newStatus === 'completed') {
    updateData.progress_pct = 100
  }

  if (newStatus === 'closed') {
    updateData.closed_at = new Date().toISOString()
  }

  const { error: updateErr } = await supabase
    .from('projects')
    .update(updateData)
    .eq('id', projectId)
    .eq('workspace_id', workspaceId)

  if (updateErr) return { success: false, error: updateErr.message }

  revalidatePath('/proyectos')
  revalidatePath(`/proyectos/${projectId}`)
  revalidatePath('/numeros')

  return { success: true }
}

// ── Add time entry ──────────────────────────────────────

export async function addTimeEntry(input: {
  projectId: string
  hours: number
  activity?: string
  entryDate?: string
}) {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: error || 'Error' }

  const { error: insertErr } = await supabase
    .from('time_entries')
    .insert({
      workspace_id: workspaceId,
      project_id: input.projectId,
      user_id: userId,
      hours: input.hours,
      activity: input.activity?.trim() || null,
      entry_date: input.entryDate || new Date().toISOString().split('T')[0],
      source: 'app',
    })

  if (insertErr) return { success: false, error: insertErr.message }

  revalidatePath(`/proyectos/${input.projectId}`)
  revalidatePath('/numeros')

  return { success: true }
}

// ── Add invoice (cobro programado) ──────────────────────

export async function addInvoice(input: {
  projectId: string
  concept: string
  grossAmount: number
  dueDate?: string
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: error || 'Error' }

  const { error: insertErr } = await supabase
    .from('invoices')
    .insert({
      workspace_id: workspaceId,
      project_id: input.projectId,
      concept: input.concept.trim(),
      gross_amount: input.grossAmount,
      due_date: input.dueDate || null,
      status: 'scheduled',
    })

  if (insertErr) return { success: false, error: insertErr.message }

  revalidatePath(`/proyectos/${input.projectId}`)
  revalidatePath('/numeros')

  return { success: true }
}

// ── Record payment (cobro recibido) ─────────────────────

export async function recordPayment(input: {
  invoiceId: string
  netReceived: number
  paymentDate?: string
  paymentMethod?: string
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: error || 'Error' }

  // Get invoice to calculate retention
  const { data: invoice } = await supabase
    .from('invoices')
    .select('gross_amount, project_id')
    .eq('id', input.invoiceId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!invoice) return { success: false, error: 'Factura no encontrada' }

  const retentionApplied = invoice.gross_amount - input.netReceived

  // D184: Alert if retention differs >5% from theoretical
  const theoreticalRetentionPct = 11 // Default conservative
  const actualRetentionPct = invoice.gross_amount > 0
    ? (retentionApplied / invoice.gross_amount) * 100
    : 0
  const retentionDiff = Math.abs(actualRetentionPct - theoreticalRetentionPct)

  const { error: insertErr } = await supabase
    .from('payments')
    .insert({
      workspace_id: workspaceId,
      invoice_id: input.invoiceId,
      net_received: input.netReceived,
      payment_date: input.paymentDate || new Date().toISOString().split('T')[0],
      payment_method: input.paymentMethod || 'transfer',
      retention_applied: retentionApplied,
      source: 'app',
    })

  if (insertErr) return { success: false, error: insertErr.message }

  // Update invoice status
  // Check total collected vs gross
  const { data: allPayments } = await supabase
    .from('payments')
    .select('net_received')
    .eq('invoice_id', input.invoiceId)

  const totalCollected = (allPayments || []).reduce((s, p) => s + p.net_received, 0)
  const newStatus = totalCollected >= invoice.gross_amount * 0.9 ? 'collected' : 'partial'

  await supabase
    .from('invoices')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', input.invoiceId)

  revalidatePath(`/proyectos/${invoice.project_id}`)
  revalidatePath('/numeros')

  return {
    success: true,
    retentionWarning: retentionDiff > 5
      ? `La retención aplicada (${actualRetentionPct.toFixed(1)}%) difiere del teórico (${theoreticalRetentionPct}%)`
      : undefined,
  }
}

// ── Get projects list ───────────────────────────────────

export async function getProjects() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { projects: [], error: error || 'Error' }

  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .eq('workspace_id', workspaceId)

  const clientMap = new Map((clients || []).map(c => [c.id, c.name]))

  return {
    projects: (projects || []).map(p => ({
      ...p,
      clientName: p.client_id ? clientMap.get(p.client_id) || null : null,
    })),
    error: null,
  }
}
