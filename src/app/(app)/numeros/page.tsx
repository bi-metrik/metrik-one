import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NumerosClient from './numeros-client'

export default async function NumerosPage() {
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
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthStart = `${currentMonth}-01`
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const monthEnd = nextMonth.toISOString().split('T')[0]

  // Parallel fetches for all Números data
  const [
    expensesResult,
    fixedExpensesResult,
    opportunitiesResult,
    projectsResult,
    paymentsResult,
    fiscalResult,
    // Sprint 12: Extra data for maturity indicators
    categoriesResult,
    waCollabsResult,
    invoicesResult,
    // Sprint 12: Previous months data for comparisons
    prevMonthExpenses,
    prevMonthPayments,
  ] = await Promise.all([
    supabase
      .from('expenses')
      .select('amount, expense_date, category_id, project_id')
      .eq('workspace_id', workspaceId)
      .gte('expense_date', monthStart)
      .lt('expense_date', monthEnd),

    supabase
      .from('fixed_expenses')
      .select('monthly_amount, is_active')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),

    supabase
      .from('opportunities')
      .select('estimated_value, stage, created_at')
      .eq('workspace_id', workspaceId),

    supabase
      .from('projects')
      .select('approved_budget, status, actual_cost, actual_margin_pct')
      .eq('workspace_id', workspaceId),

    supabase
      .from('payments')
      .select('net_received, payment_date')
      .eq('workspace_id', workspaceId)
      .gte('payment_date', monthStart)
      .lt('payment_date', monthEnd),

    supabase
      .from('fiscal_profiles')
      .select('is_complete, is_estimated')
      .eq('workspace_id', workspaceId)
      .single(),

    // Sprint 12: Categories with fixed expenses
    supabase
      .from('expense_categories')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),

    // Sprint 12: WA collaborators count
    supabase
      .from('wa_collaborators')
      .select('id', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),

    // Sprint 12: Invoices count
    supabase
      .from('invoices')
      .select('id', { count: 'exact' })
      .eq('workspace_id', workspaceId),

    // Sprint 12: Previous month expenses
    (() => {
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const prevMonthStr = `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2, '0')}`
      return supabase
        .from('expenses')
        .select('amount')
        .eq('workspace_id', workspaceId)
        .gte('expense_date', `${prevMonthStr}-01`)
        .lt('expense_date', monthStart)
    })(),

    // Sprint 12: Previous month payments
    (() => {
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const prevMonthStr = `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2, '0')}`
      return supabase
        .from('payments')
        .select('net_received')
        .eq('workspace_id', workspaceId)
        .gte('payment_date', `${prevMonthStr}-01`)
        .lt('payment_date', monthStart)
    })(),
  ])

  const expenses = expensesResult.data || []
  const fixedExpenses = fixedExpensesResult.data || []
  const opportunities = opportunitiesResult.data || []
  const projects = projectsResult.data || []
  const payments = paymentsResult.data || []

  const totalExpensesMonth = expenses.reduce((s, e) => s + e.amount, 0)
  const totalFixedExpenses = fixedExpenses.reduce((s, f) => s + f.monthly_amount, 0)
  const totalPaymentsMonth = payments.reduce((s, p) => s + p.net_received, 0)

  const wonOpps = opportunities.filter(o => o.stage === 'won')
  const totalWonValue = wonOpps.reduce((s, o) => s + o.estimated_value, 0)
  const activeProjects = projects.filter(p => p.status === 'active')
  const completedProjects = projects.filter(p => p.status === 'completed' || p.status === 'closed')

  const pipelineValue = opportunities
    .filter(o => !['won', 'lost'].includes(o.stage))
    .reduce((s, o) => s + o.estimated_value, 0)

  const hasExpenses = expenses.length > 0
  const hasFixedExpenses = fixedExpenses.length > 0
  const hasPayments = payments.length > 0
  const hasOpportunities = opportunities.length > 0

  // D52: First visit = no expenses AND no fixed expenses AND no payments
  const isFirstVisit = !hasExpenses && !hasFixedExpenses && !hasPayments && !hasOpportunities

  // Sprint 12: Previous month data
  const prevExpensesTotal = (prevMonthExpenses.data || []).reduce((s, e) => s + e.amount, 0)
  const prevPaymentsTotal = (prevMonthPayments.data || []).reduce((s, p) => s + p.net_received, 0)
  const hasPreviousMonth = prevExpensesTotal > 0 || prevPaymentsTotal > 0

  // Sprint 12: Build months array for comparison (simplified — 2 months)
  const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const monthlyData = hasPreviousMonth ? [
    {
      month: `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`,
      monthLabel: MONTH_LABELS[prevMonthDate.getMonth()],
      ingresos: prevPaymentsTotal,
      gastos: prevExpensesTotal,
      margen: prevPaymentsTotal > 0 ? ((prevPaymentsTotal - prevExpensesTotal) / prevPaymentsTotal) * 100 : 0,
      proyectos: 0, // Simplified for now
      oportunidades: 0,
      hoursLogged: 0,
    },
    {
      month: currentMonth,
      monthLabel: MONTH_LABELS[now.getMonth()],
      ingresos: totalPaymentsMonth + totalWonValue,
      gastos: totalExpensesMonth,
      margen: (totalPaymentsMonth + totalWonValue) > 0
        ? (((totalPaymentsMonth + totalWonValue) - totalExpensesMonth) / (totalPaymentsMonth + totalWonValue)) * 100
        : 0,
      proyectos: activeProjects.length,
      oportunidades: wonOpps.length,
      hoursLogged: 0, // Would need time_entries query
    },
  ] : []

  // Sprint 12: Maturity data (D82)
  const questionsComplete = [hasExpenses, hasFixedExpenses, hasPayments, hasOpportunities, fiscalResult.data?.is_complete].filter(Boolean).length
  const maturityData = {
    questionsComplete,
    projectsClosed: completedProjects.length,
    fixedExpenseCategories: categoriesResult.data?.length || 0,
    waCollaborators: waCollabsResult.count || 0,
    invoicesRegistered: invoicesResult.count || 0,
  }

  const data = {
    totalExpensesMonth,
    totalFixedExpenses,
    totalPaymentsMonth,
    totalWonValue,
    pipelineValue,
    activeProjectsCount: activeProjects.length,
    completedProjectsCount: completedProjects.length,
    totalOpportunities: opportunities.length,
    wonCount: wonOpps.length,
    hasExpenses,
    hasFixedExpenses,
    hasPayments,
    hasOpportunities,
    hasFiscal: fiscalResult.data?.is_complete || false,
    hasFiscalEstimated: fiscalResult.data?.is_estimated || false,
    ingresosMonth: totalPaymentsMonth + totalWonValue,
    gastosMonth: totalExpensesMonth,
    puntoEquilibrio: totalFixedExpenses,
  }

  return (
    <NumerosClient
      data={data}
      isFirstVisit={isFirstVisit}
      monthlyData={monthlyData}
      maturityData={maturityData}
    />
  )
}
