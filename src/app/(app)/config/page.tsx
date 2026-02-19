import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ConfigClient from './config-client'

export default async function ConfigPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/onboarding')

  const workspaceId = profile.workspace_id

  // Parallel fetches
  const [fixedResult, categoriesResult, fiscalResult, teamCountResult, staffResult, bankAccountsResult, monthlyTargetsResult] = await Promise.all([
    supabase
      .from('fixed_expenses')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true }),

    supabase
      .from('expense_categories')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),

    supabase
      .from('fiscal_profiles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single(),

    // Sprint 9: Team member count
    supabase
      .from('profiles')
      .select('id', { count: 'exact' })
      .eq('workspace_id', workspaceId),

    // F7: Staff
    supabase
      .from('staff')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .order('full_name'),

    // F18: Bank accounts
    supabase
      .from('bank_accounts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at'),

    // F25: Monthly targets (current year)
    supabase
      .from('monthly_targets')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('year', new Date().getFullYear())
      .order('month'),
  ])

  const fixedExpenses = fixedResult.data || []
  const categories = categoriesResult.data || []
  const fiscalProfile = fiscalResult.data
  const teamMemberCount = teamCountResult.count || 1
  const staffMembers = staffResult.data || []
  const bankAccounts = bankAccountsResult.data || []
  const monthlyTargets = monthlyTargetsResult.data || []

  // Build category map for fixed expenses
  const catMap = new Map(categories.map(c => [c.id, c.name]))
  const fixedWithCat = fixedExpenses.map(f => ({
    ...f,
    categoryName: f.category_id ? catMap.get(f.category_id) || null : null,
  }))

  const activeFixed = fixedExpenses.filter(f => f.is_active)
  const totalFixed = activeFixed.reduce((s, f) => s + f.monthly_amount, 0)

  // D241: Checklist items
  const checklist = [
    {
      key: 'perfil-fiscal',
      label: 'Perfil fiscal',
      description: 'Tu tipo de persona, régimen e IVA',
      status: fiscalProfile?.is_complete
        ? 'complete' as const
        : fiscalProfile?.is_estimated
        ? 'partial' as const
        : 'pending' as const,
      statusLabel: fiscalProfile?.is_complete
        ? 'Completo'
        : fiscalProfile?.is_estimated
        ? 'Estimado'
        : 'Pendiente',
    },
    {
      key: 'gastos-fijos',
      label: 'Gastos fijos',
      description: `${activeFixed.length} gasto${activeFixed.length !== 1 ? 's' : ''} fijo${activeFixed.length !== 1 ? 's' : ''}`,
      status: activeFixed.length >= 3
        ? 'complete' as const
        : activeFixed.length > 0
        ? 'partial' as const
        : 'pending' as const,
      statusLabel: activeFixed.length > 0
        ? `$${totalFixed.toLocaleString('es-CO')}/mes`
        : 'Sin configurar',
    },
    {
      key: 'mi-tarifa',
      label: 'Mi tarifa',
      description: 'Ingreso esperado ÷ horas = costo hora',
      status: 'pending' as const,
      statusLabel: 'Próximamente',
    },
    // Sprint 9: Mi equipo
    {
      key: 'mi-equipo',
      label: 'Mi equipo',
      description: `${teamMemberCount} miembro${teamMemberCount !== 1 ? 's' : ''} en el workspace`,
      status: teamMemberCount > 1
        ? 'complete' as const
        : 'pending' as const,
      statusLabel: teamMemberCount > 1
        ? `${teamMemberCount} miembros`
        : 'Solo tú',
    },
    // F7: Personal
    {
      key: 'personal',
      label: 'Personal',
      description: `${staffMembers.length} persona${staffMembers.length !== 1 ? 's' : ''} registrada${staffMembers.length !== 1 ? 's' : ''}`,
      status: staffMembers.length >= 1
        ? 'complete' as const
        : 'pending' as const,
      statusLabel: staffMembers.length > 0
        ? `${staffMembers.length} activo${staffMembers.length !== 1 ? 's' : ''}`
        : 'Sin configurar',
    },
    // F18: Cuentas bancarias
    {
      key: 'cuentas-bancarias',
      label: 'Cuentas bancarias',
      description: 'Registra tus cuentas para seguimiento de caja',
      status: bankAccounts.filter(a => a.is_active).length >= 1
        ? 'complete' as const
        : 'pending' as const,
      statusLabel: bankAccounts.filter(a => a.is_active).length > 0
        ? `${bankAccounts.filter(a => a.is_active).length} cuenta${bankAccounts.filter(a => a.is_active).length !== 1 ? 's' : ''}`
        : 'Sin configurar',
    },
    // F25: Metas mensuales
    {
      key: 'metas-mensuales',
      label: 'Metas mensuales',
      description: `Metas de venta y cobro ${new Date().getFullYear()}`,
      status: monthlyTargets.length >= 1
        ? 'complete' as const
        : 'pending' as const,
      statusLabel: monthlyTargets.length > 0
        ? `${monthlyTargets.length} meses configurados`
        : 'Sin configurar',
    },
  ]

  return (
    <ConfigClient
      checklist={checklist}
      fixedExpenses={fixedWithCat}
      categories={categories}
      totalFixedExpenses={totalFixed}
      fiscalProfile={fiscalProfile}
      currentUserRole={profile.role}
      staffMembers={staffMembers}
      bankAccounts={bankAccounts}
      monthlyTargets={monthlyTargets}
    />
  )
}
