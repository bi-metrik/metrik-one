'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Sprint 12 — Server-side data aggregation for monthly comparisons
 * and mature metrics (CAC, quotation feedback, etc.)
 */

interface MonthlyAggregate {
  month: string
  monthLabel: string
  ingresos: number
  gastos: number
  margen: number
  proyectos: number
  oportunidades: number
  hoursLogged: number
}

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export async function getMonthlyComparisons(numMonths = 6): Promise<MonthlyAggregate[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) return []

  const workspaceId = profile.workspace_id
  const now = new Date()
  const months: MonthlyAggregate[] = []

  for (let i = numMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const startDate = `${yearMonth}-01`
    const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const endDate = `${yearMonth}-${String(endD.getDate()).padStart(2, '0')}`

    // Parallel fetches for this month
    const [expensesRes, paymentsRes, projectsRes, oppsRes, hoursRes] = await Promise.all([
      supabase
        .from('expenses')
        .select('amount')
        .eq('workspace_id', workspaceId)
        .gte('expense_date', startDate)
        .lte('expense_date', endDate),

      supabase
        .from('payments')
        .select('net_received')
        .eq('workspace_id', workspaceId)
        .gte('payment_date', startDate)
        .lte('payment_date', endDate),

      supabase
        .from('projects')
        .select('id')
        .eq('workspace_id', workspaceId)
        .in('status', ['active', 'rework'])
        .or(`start_date.lte.${endDate},start_date.is.null`),

      supabase
        .from('opportunities')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('stage', 'won')
        .gte('updated_at', startDate)
        .lte('updated_at', endDate + 'T23:59:59'),

      supabase
        .from('time_entries')
        .select('hours')
        .eq('workspace_id', workspaceId)
        .gte('entry_date', startDate)
        .lte('entry_date', endDate),
    ])

    const gastos = (expensesRes.data || []).reduce((s, e) => s + e.amount, 0)
    const ingresos = (paymentsRes.data || []).reduce((s, p) => s + p.net_received, 0)
    const margen = ingresos > 0 ? ((ingresos - gastos) / ingresos) * 100 : 0
    const proyectos = projectsRes.data?.length || 0
    const oportunidades = oppsRes.data?.length || 0
    const hoursLogged = (hoursRes.data || []).reduce((s, h) => s + h.hours, 0)

    months.push({
      month: yearMonth,
      monthLabel: MONTH_LABELS[d.getMonth()],
      ingresos,
      gastos,
      margen,
      proyectos,
      oportunidades,
      hoursLogged,
    })
  }

  return months
}

/**
 * D90: CAC real — available with 5+ opportunities
 * CAC = (Total gastos pre-venta) / (Oportunidades ganadas)
 */
export async function getCACMetrics() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) return null

  const workspaceId = profile.workspace_id

  // Count total opportunities and won
  const [totalOpps, wonOpps, timeEntries] = await Promise.all([
    supabase
      .from('opportunities')
      .select('id', { count: 'exact' })
      .eq('workspace_id', workspaceId),
    supabase
      .from('opportunities')
      .select('id', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .eq('stage', 'won'),
    supabase
      .from('time_entries')
      .select('hours, project_id')
      .eq('workspace_id', workspaceId),
  ])

  const totalCount = totalOpps.count || 0
  const wonCount = wonOpps.count || 0
  const totalHours = (timeEntries.data || []).reduce((s, t) => s + t.hours, 0)

  if (totalCount < 5) {
    return {
      available: false,
      totalOpportunities: totalCount,
      minRequired: 5,
    }
  }

  // Simple CAC: total hours invested / opportunities won
  // Future: add pre-sale expenses
  const conversionRate = totalCount > 0 ? (wonCount / totalCount) * 100 : 0
  const avgHoursPerOpp = totalCount > 0 ? totalHours / totalCount : 0

  return {
    available: true,
    totalOpportunities: totalCount,
    wonOpportunities: wonCount,
    conversionRate,
    avgHoursPerOpp,
    totalHoursInvested: totalHours,
  }
}

/**
 * D91: Project close feedback — compare real vs quoted
 */
export async function getProjectCloseFeedback(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) return null

  // Get project with quote
  const { data: project } = await supabase
    .from('projects')
    .select('*, quotes(*)')
    .eq('id', projectId)
    .eq('workspace_id', profile.workspace_id)
    .single()

  if (!project) return null

  // Get actual expenses for project
  const { data: expenses } = await supabase
    .from('expenses')
    .select('amount, is_rework')
    .eq('project_id', projectId)
    .eq('workspace_id', profile.workspace_id)

  // Get actual hours
  const { data: hours } = await supabase
    .from('time_entries')
    .select('hours')
    .eq('project_id', projectId)
    .eq('workspace_id', profile.workspace_id)

  // Get invoices
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, gross_amount')
    .eq('project_id', projectId)
    .eq('workspace_id', profile.workspace_id)

  // Get payments for those invoices
  const invoiceIds = (invoices || []).map(i => i.id)
  const { data: paymentsData } = invoiceIds.length > 0
    ? await supabase
        .from('payments')
        .select('net_received, invoice_id')
        .eq('workspace_id', profile.workspace_id)
        .in('invoice_id', invoiceIds)
    : { data: [] as { net_received: number; invoice_id: string }[] }

  const actualExpenses = (expenses || []).reduce((s, e) => s + e.amount, 0)
  const reworkExpenses = (expenses || []).filter(e => e.is_rework).reduce((s, e) => s + e.amount, 0)
  const totalHours = (hours || []).reduce((s, h) => s + h.hours, 0)
  const totalInvoiced = (invoices || []).reduce((s, inv) => s + inv.gross_amount, 0)
  const totalReceived = (paymentsData || []).reduce((s, p) => s + p.net_received, 0)

  const quote = Array.isArray(project.quotes) ? project.quotes[0] : project.quotes
  const quotedPrice = quote?.total_price || project.approved_budget || 0
  const quotedCost = quote?.estimated_cost || 0

  const actualMargin = totalReceived > 0
    ? ((totalReceived - actualExpenses) / totalReceived) * 100
    : 0

  const quotedMargin = quotedPrice > 0 && quotedCost > 0
    ? ((quotedPrice - quotedCost) / quotedPrice) * 100
    : 0

  return {
    projectName: project.name,
    quoted: {
      price: quotedPrice,
      cost: quotedCost,
      margin: quotedMargin,
    },
    actual: {
      invoiced: totalInvoiced,
      received: totalReceived,
      expenses: actualExpenses,
      reworkExpenses,
      hours: totalHours,
      margin: actualMargin,
    },
    variance: {
      priceVariance: totalReceived - quotedPrice,
      costVariance: actualExpenses - quotedCost,
      marginVariance: actualMargin - quotedMargin,
      hasRework: reworkExpenses > 0,
    },
  }
}
