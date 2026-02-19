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
  const [fixedResult, categoriesResult, fiscalResult, teamCountResult] = await Promise.all([
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
  ])

  const fixedExpenses = fixedResult.data || []
  const categories = categoriesResult.data || []
  const fiscalProfile = fiscalResult.data
  const teamMemberCount = teamCountResult.count || 1

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
  ]

  return (
    <ConfigClient
      checklist={checklist}
      fixedExpenses={fixedWithCat}
      categories={categories}
      totalFixedExpenses={totalFixed}
      fiscalProfile={fiscalProfile}
      currentUserRole={profile.role}
    />
  )
}
