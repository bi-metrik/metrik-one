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

  return <NumerosClient data={data} isFirstVisit={isFirstVisit} />
}
