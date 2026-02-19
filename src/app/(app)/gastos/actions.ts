'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ── Fetch expense categories ────────────────────────────

export async function getExpenseCategories() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { categories: [], error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { categories: [], error: 'Sin perfil' }

  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('workspace_id', profile.workspace_id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) return { categories: [], error: error.message }
  return { categories: data || [], error: null }
}

// ── Create expense (FAB → 3 fields + category) ─────────

interface CreateExpenseInput {
  amount: number
  categoryId: string
  description?: string
  projectId?: string
  expenseDate?: string // ISO string, defaults to today
}

export async function createExpense(input: CreateExpenseInput) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'No autenticado' }

    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', user.id)
      .single()

    if (!profile) return { success: false, error: 'Sin perfil' }

    const workspaceId = profile.workspace_id

    const { data: expense, error } = await supabase
      .from('expenses')
      .insert({
        workspace_id: workspaceId,
        category_id: input.categoryId,
        amount: input.amount,
        description: input.description?.trim() || null,
        project_id: input.projectId || null,
        expense_date: input.expenseDate || new Date().toISOString().split('T')[0],
        source: 'app',
      })
      .select()
      .single()

    if (error) return { success: false, error: `Error creando gasto: ${error.message}` }

    revalidatePath('/numeros')
    revalidatePath('/gastos')
    revalidatePath('/dashboard')
    revalidatePath('/proyectos')

    return { success: true, expenseId: expense!.id }
  } catch (err) {
    console.error('createExpense error:', err)
    return { success: false, error: 'Error inesperado creando gasto' }
  }
}

// ── Get expenses (list) ─────────────────────────────────

export async function getExpenses(filters?: { month?: string; categoryId?: string; projectId?: string }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { expenses: [], error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { expenses: [], error: 'Sin perfil' }

  let query = supabase
    .from('expenses')
    .select('*')
    .eq('workspace_id', profile.workspace_id)
    .order('expense_date', { ascending: false })

  if (filters?.categoryId) {
    query = query.eq('category_id', filters.categoryId)
  }
  if (filters?.projectId) {
    query = query.eq('project_id', filters.projectId)
  }
  if (filters?.month) {
    // month format: YYYY-MM
    const start = `${filters.month}-01`
    const endDate = new Date(start)
    endDate.setMonth(endDate.getMonth() + 1)
    const end = endDate.toISOString().split('T')[0]
    query = query.gte('expense_date', start).lt('expense_date', end)
  }

  const { data, error } = await query

  if (error) return { expenses: [], error: error.message }

  // Fetch categories for labels
  const { data: categories } = await supabase
    .from('expense_categories')
    .select('id, name')
    .eq('workspace_id', profile.workspace_id)

  const catMap = new Map((categories || []).map(c => [c.id, c.name]))

  const expenses = (data || []).map(e => ({
    ...e,
    categoryName: catMap.get(e.category_id) || 'Sin categoría',
  }))

  return { expenses, error: null }
}

// ── Delete expense ──────────────────────────────────────

export async function deleteExpense(expenseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { success: false, error: 'Sin perfil' }

  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId)
    .eq('workspace_id', profile.workspace_id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/numeros')
  revalidatePath('/gastos')
  revalidatePath('/dashboard')

  return { success: true }
}

// ── Fixed expenses CRUD ─────────────────────────────────

export async function getFixedExpenses() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { fixedExpenses: [], error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { fixedExpenses: [], error: 'Sin perfil' }

  const { data, error } = await supabase
    .from('fixed_expenses')
    .select('*')
    .eq('workspace_id', profile.workspace_id)
    .order('created_at', { ascending: true })

  if (error) return { fixedExpenses: [], error: error.message }

  // Fetch categories for labels
  const { data: categories } = await supabase
    .from('expense_categories')
    .select('id, name')
    .eq('workspace_id', profile.workspace_id)

  const catMap = new Map((categories || []).map(c => [c.id, c.name]))

  const fixedExpenses = (data || []).map(f => ({
    ...f,
    categoryName: f.category_id ? catMap.get(f.category_id) || null : null,
  }))

  return { fixedExpenses, error: null }
}

interface CreateFixedExpenseInput {
  description: string
  monthlyAmount: number
  categoryId?: string
}

export async function createFixedExpense(input: CreateFixedExpenseInput) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'No autenticado' }

    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', user.id)
      .single()

    if (!profile) return { success: false, error: 'Sin perfil' }

    const { error } = await supabase
      .from('fixed_expenses')
      .insert({
        workspace_id: profile.workspace_id,
        description: input.description.trim(),
        monthly_amount: input.monthlyAmount,
        category_id: input.categoryId || null,
      })

    if (error) return { success: false, error: `Error: ${error.message}` }

    revalidatePath('/config')
    revalidatePath('/numeros')

    return { success: true }
  } catch (err) {
    console.error('createFixedExpense error:', err)
    return { success: false, error: 'Error inesperado' }
  }
}

export async function deleteFixedExpense(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { success: false, error: 'Sin perfil' }

  const { error } = await supabase
    .from('fixed_expenses')
    .delete()
    .eq('id', id)
    .eq('workspace_id', profile.workspace_id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/config')
  revalidatePath('/numeros')

  return { success: true }
}

export async function toggleFixedExpense(id: string, isActive: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { success: false, error: 'Sin perfil' }

  const { error } = await supabase
    .from('fixed_expenses')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', profile.workspace_id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/config')
  revalidatePath('/numeros')

  return { success: true }
}

// ── Workspace config (Mi tarifa) ────────────────────────

export async function getWorkspaceConfig() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { config: null, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { config: null, error: 'Sin perfil' }

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', profile.workspace_id)
    .single()

  if (!workspace) return { config: null, error: 'Sin workspace' }

  // Get fixed expenses total
  const { data: fixedExps } = await supabase
    .from('fixed_expenses')
    .select('monthly_amount, is_active')
    .eq('workspace_id', profile.workspace_id)

  const fixedExpensesTotal = (fixedExps || [])
    .filter(f => f.is_active)
    .reduce((sum, f) => sum + f.monthly_amount, 0)

  // Get fiscal profile
  const { data: fiscal } = await supabase
    .from('fiscal_profiles')
    .select('*')
    .eq('workspace_id', profile.workspace_id)
    .single()

  return {
    config: {
      workspace,
      fixedExpensesTotal,
      fixedExpensesCount: (fixedExps || []).filter(f => f.is_active).length,
      fiscalProfile: fiscal,
    },
    error: null,
  }
}

// ── Números data fetcher ────────────────────────────────

export async function getNumerosData() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { data: null, error: 'Sin perfil' }

  const workspaceId = profile.workspace_id
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthStart = `${currentMonth}-01`
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const monthEnd = nextMonth.toISOString().split('T')[0]

  // Parallel fetches for performance
  const [
    expensesResult,
    fixedExpensesResult,
    opportunitiesResult,
    projectsResult,
    paymentsResult,
    workspaceResult,
    fiscalResult,
  ] = await Promise.all([
    // Current month expenses
    supabase
      .from('expenses')
      .select('amount, expense_date, category_id, project_id')
      .eq('workspace_id', workspaceId)
      .gte('expense_date', monthStart)
      .lt('expense_date', monthEnd),

    // Active fixed expenses
    supabase
      .from('fixed_expenses')
      .select('monthly_amount, is_active')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),

    // Pipeline opportunities (won this month)
    supabase
      .from('opportunities')
      .select('estimated_value, stage, created_at')
      .eq('workspace_id', workspaceId),

    // Projects
    supabase
      .from('projects')
      .select('approved_budget, status, actual_cost, actual_margin_pct')
      .eq('workspace_id', workspaceId),

    // Payments received this month
    supabase
      .from('payments')
      .select('net_received, payment_date')
      .eq('workspace_id', workspaceId)
      .gte('payment_date', monthStart)
      .lt('payment_date', monthEnd),

    // Workspace for saldo data (stored in workspace or separate)
    supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .single(),

    // Fiscal profile
    supabase
      .from('fiscal_profiles')
      .select('is_complete, is_estimated')
      .eq('workspace_id', workspaceId)
      .single(),
  ])

  // ── Calculate Números ──

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
  const hasFiscal = fiscalResult.data?.is_complete || false
  const hasFiscalEstimated = fiscalResult.data?.is_estimated || false

  return {
    data: {
      // Raw totals
      totalExpensesMonth,
      totalFixedExpenses,
      totalPaymentsMonth,
      totalWonValue,
      pipelineValue,
      activeProjectsCount: activeProjects.length,
      completedProjectsCount: completedProjects.length,
      totalOpportunities: opportunities.length,
      wonCount: wonOpps.length,

      // Flags for states
      hasExpenses,
      hasFixedExpenses,
      hasPayments,
      hasOpportunities,
      hasFiscal,
      hasFiscalEstimated,

      // For P1: ¿Cuánta plata tengo?
      // Ingresos mes - Gastos mes = flujo neto
      ingresosMonth: totalPaymentsMonth + totalWonValue, // cobros + valor ganado
      gastosMonth: totalExpensesMonth,

      // For P4: ¿Cuánto necesito vender?
      // Punto de equilibrio = gastos fijos / (1 - costo variable %)
      puntoEquilibrio: totalFixedExpenses > 0
        ? totalFixedExpenses
        : 0,
    },
    error: null,
  }
}

// ── Save workspace saldo (first-visit Números) ─────────

export async function saveNumerosSetup(input: { saldoActual?: number; gastosFijosMensual?: number }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'No autenticado' }

    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', user.id)
      .single()

    if (!profile) return { success: false, error: 'Sin perfil' }

    // If they gave us a global fixed expenses amount and there aren't any yet, create one
    if (input.gastosFijosMensual && input.gastosFijosMensual > 0) {
      // Check if they already have fixed expenses
      const { data: existing } = await supabase
        .from('fixed_expenses')
        .select('id')
        .eq('workspace_id', profile.workspace_id)
        .limit(1)

      if (!existing || existing.length === 0) {
        // D239: Global amount first, breakdown later
        await supabase
          .from('fixed_expenses')
          .insert({
            workspace_id: profile.workspace_id,
            description: 'Gastos fijos mensuales (global)',
            monthly_amount: input.gastosFijosMensual,
          })
      }
    }

    revalidatePath('/numeros')
    revalidatePath('/config')

    return { success: true }
  } catch (err) {
    console.error('saveNumerosSetup error:', err)
    return { success: false, error: 'Error inesperado' }
  }
}
