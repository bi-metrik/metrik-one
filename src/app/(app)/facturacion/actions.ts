'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getWorkspace() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return null
  return { supabase, workspaceId: profile.workspace_id, role: profile.role, userId: user.id }
}

export async function getFacturacionData(filters?: {
  status?: string
  projectId?: string
  month?: string // YYYY-MM
}) {
  const ctx = await getWorkspace()
  if (!ctx) return { invoices: [], payments: [], projects: [], clients: [], stats: null }

  let query = ctx.supabase
    .from('invoices')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })

  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }
  if (filters?.projectId) {
    query = query.eq('project_id', filters.projectId)
  }
  if (filters?.month) {
    const start = `${filters.month}-01`
    const [y, m] = filters.month.split('-').map(Number)
    const end = new Date(y, m, 0).toISOString().split('T')[0]
    query = query.gte('created_at', start).lte('created_at', end + 'T23:59:59')
  }

  const [invoicesRes, paymentsRes, projectsRes, clientsRes] = await Promise.all([
    query,
    ctx.supabase
      .from('payments')
      .select('*')
      .eq('workspace_id', ctx.workspaceId)
      .order('payment_date', { ascending: false }),
    ctx.supabase
      .from('projects')
      .select('id, name')
      .eq('workspace_id', ctx.workspaceId)
      .order('name'),
    ctx.supabase
      .from('clients')
      .select('id, name')
      .eq('workspace_id', ctx.workspaceId)
      .eq('is_active', true)
      .order('name'),
  ])

  const invoices = invoicesRes.data || []
  const payments = paymentsRes.data || []

  // Calculate stats
  const totalInvoiced = invoices.reduce((s, i) => s + i.gross_amount, 0)
  const totalCollected = payments.reduce((s, p) => s + p.net_received, 0)
  const totalRetentions = payments.reduce((s, p) => s + (p.retention_applied || 0), 0)
  const pendingInvoices = invoices.filter(i => i.status === 'scheduled' || i.status === 'partial')
  const pendingAmount = pendingInvoices.reduce((s, i) => s + i.gross_amount, 0)

  return {
    invoices,
    payments,
    projects: projectsRes.data || [],
    clients: clientsRes.data || [],
    stats: {
      totalInvoiced,
      totalCollected,
      totalRetentions,
      pendingAmount,
      pendingCount: pendingInvoices.length,
    },
  }
}

export async function createInvoice(data: {
  project_id: string
  client_id?: string
  concept: string
  gross_amount: number
  due_date?: string
  invoice_type?: string
  notes?: string
}) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  // Generate next invoice number
  const { count } = await ctx.supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspaceId)

  const invoiceNumber = `CC-${String((count || 0) + 1).padStart(4, '0')}`

  const { data: invoice, error } = await ctx.supabase
    .from('invoices')
    .insert({
      workspace_id: ctx.workspaceId,
      project_id: data.project_id,
      client_id: data.client_id || null,
      concept: data.concept,
      gross_amount: data.gross_amount,
      due_date: data.due_date || null,
      invoice_type: data.invoice_type || 'cuenta_cobro',
      invoice_number: invoiceNumber,
      notes: data.notes || null,
      status: 'scheduled',
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/facturacion')
  revalidatePath('/proyectos')
  return { success: true, invoice }
}

export async function markInvoicePaid(invoiceId: string, data: {
  netReceived: number
  paymentDate?: string
  paymentMethod?: string
}) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  // Get the invoice
  const { data: invoice } = await ctx.supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (!invoice) return { error: 'Factura no encontrada' }

  const retentionApplied = invoice.gross_amount - data.netReceived

  // Record payment
  const { error: payError } = await ctx.supabase
    .from('payments')
    .insert({
      workspace_id: ctx.workspaceId,
      invoice_id: invoiceId,
      net_received: data.netReceived,
      payment_date: data.paymentDate || new Date().toISOString().split('T')[0],
      payment_method: data.paymentMethod || 'transfer',
      retention_applied: retentionApplied,
      source: 'app',
    })

  if (payError) return { error: payError.message }

  // Calculate total collected for this invoice
  const { data: allPayments } = await ctx.supabase
    .from('payments')
    .select('net_received')
    .eq('invoice_id', invoiceId)

  const totalCollected = (allPayments || []).reduce((s, p) => s + p.net_received, 0)

  // Update status
  const newStatus = totalCollected >= invoice.gross_amount * 0.9 ? 'collected' : 'partial'
  await ctx.supabase
    .from('invoices')
    .update({ status: newStatus })
    .eq('id', invoiceId)

  // Check retention anomaly
  let retentionWarning: string | undefined
  const retentionPct = (retentionApplied / invoice.gross_amount) * 100
  if (Math.abs(retentionPct - 11) > 5 && retentionApplied > 0) {
    retentionWarning = `Retención aplicada: ${retentionPct.toFixed(1)}% (teórica: ~11%). Verifica.`
  }

  revalidatePath('/facturacion')
  revalidatePath('/proyectos')
  revalidatePath('/numeros')
  return { success: true, retentionWarning }
}

export async function deleteInvoice(invoiceId: string) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  // Only allow deleting scheduled invoices
  const { data: invoice } = await ctx.supabase
    .from('invoices')
    .select('status')
    .eq('id', invoiceId)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (!invoice) return { error: 'No encontrada' }
  if (invoice.status !== 'scheduled') return { error: 'Solo puedes eliminar facturas pendientes' }

  const { error } = await ctx.supabase
    .from('invoices')
    .delete()
    .eq('id', invoiceId)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { error: error.message }
  revalidatePath('/facturacion')
  return { success: true }
}
