'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { getCachedUser } from '@/lib/supabase/auth-user'

// ── Fetch expense categories ────────────────────────────

export async function getExpenseCategories() {
  const supabase = await createClient()
  const { user } = await getCachedUser()
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
    const { user } = await getCachedUser()
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
        expense_date: input.expenseDate || todayBogotaISO(),
        source: 'app',
      })
      .select()
      .single()

    if (error) return { success: false, error: `Error creando gasto: ${error.message}` }

    revalidatePath('/numeros')
    revalidatePath('/gastos')
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
  const { user } = await getCachedUser()
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
  const { user } = await getCachedUser()
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

  return { success: true }
}

// ── Fixed expenses CRUD ─────────────────────────────────

export async function getFixedExpenses() {
  const supabase = await createClient()
  const { user } = await getCachedUser()
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
  diaPago?: number
  deducible?: boolean
}

export async function createFixedExpense(input: CreateFixedExpenseInput) {
  try {
    const supabase = await createClient()
    const { user } = await getCachedUser()
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
        dia_pago: input.diaPago || null,
        deducible: input.deducible ?? false,
      })

    if (error) return { success: false, error: `Error: ${error.message}` }

    revalidatePath('/config')
    revalidatePath('/mi-negocio')
    revalidatePath('/numeros')

    return { success: true }
  } catch (err) {
    console.error('createFixedExpense error:', err)
    return { success: false, error: 'Error inesperado' }
  }
}

export async function deleteFixedExpense(id: string) {
  const supabase = await createClient()
  const { user } = await getCachedUser()
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
  revalidatePath('/mi-negocio')
  revalidatePath('/numeros')

  return { success: true }
}

export async function toggleFixedExpense(id: string, isActive: boolean) {
  const supabase = await createClient()
  const { user } = await getCachedUser()
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
  revalidatePath('/mi-negocio')
  revalidatePath('/numeros')

  return { success: true }
}

export async function updateFixedExpense(id: string, input: {
  description?: string
  monthlyAmount?: number
  categoryId?: string | null
  diaPago?: number | null
  deducible?: boolean
}) {
  const supabase = await createClient()
  const { user } = await getCachedUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { success: false, error: 'Sin perfil' }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.description !== undefined) updates.description = input.description.trim()
  if (input.monthlyAmount !== undefined) updates.monthly_amount = input.monthlyAmount
  if (input.categoryId !== undefined) updates.category_id = input.categoryId || null
  if (input.diaPago !== undefined) updates.dia_pago = input.diaPago
  if (input.deducible !== undefined) updates.deducible = input.deducible

  const { error } = await supabase
    .from('fixed_expenses')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', profile.workspace_id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  revalidatePath('/numeros')

  return { success: true }
}

// ── Save workspace saldo (first-visit Números) ─────────

export async function saveNumerosSetup(input: { saldoActual?: number; gastosFijosMensual?: number }) {
  try {
    const supabase = await createClient()
    const { user } = await getCachedUser()
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
