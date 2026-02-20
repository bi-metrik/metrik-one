import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MiNegocioClient from './mi-negocio-client'

export default async function MiNegocioPage() {
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
  const [
    workspaceResult,
    fiscalResult,
    staffResult,
    bankAccountsResult,
    monthlyTargetsResult,
    fixedResult,
    categoriesResult,
    serviciosResult,
  ] = await Promise.all([
    supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .single(),

    supabase
      .from('fiscal_profiles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single(),

    supabase
      .from('staff')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .order('full_name'),

    supabase
      .from('bank_accounts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at'),

    supabase
      .from('monthly_targets')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('year', new Date().getFullYear())
      .order('month'),

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
      .from('servicios')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('nombre'),
  ])

  const workspace = workspaceResult.data
  const fiscalProfile = fiscalResult.data
  const staffMembers = staffResult.data || []
  const bankAccounts = bankAccountsResult.data || []
  const monthlyTargets = monthlyTargetsResult.data || []
  const fixedExpenses = fixedResult.data || []
  const categories = categoriesResult.data || []
  const servicios = serviciosResult.data || []

  // Build category map for fixed expenses
  const catMap = new Map(categories.map(c => [c.id, c.name]))
  const fixedWithCat = fixedExpenses.map(f => ({
    ...f,
    categoryName: f.category_id ? catMap.get(f.category_id) || null : null,
  }))

  // ── Compute progress bar server-side (16 pts total) ──
  // §3 Perfil fiscal: 3 pts
  const fiscalScore = fiscalProfile?.is_complete ? 3 : fiscalProfile?.is_estimated ? 1.5 : 0
  // §4 Mi marca: 1 pt
  const marcaScore = (workspace?.logo_url || (workspace?.color_primario && workspace.color_primario !== '#10B981')) ? 1 : 0
  // §5 Servicios: 2 pts
  const activeServicios = servicios.filter(s => s.activo !== false)
  const serviciosScore = activeServicios.length >= 1 ? 2 : 0
  // §6 Gastos fijos: 3 pts
  const activeFixed = fixedExpenses.filter(f => f.is_active)
  const gastosScore = activeFixed.length >= 3 ? 3 : activeFixed.length > 0 ? 1.5 : 0
  // §7 Cuenta bancaria: 2 pts
  const activeBanks = bankAccounts.filter(a => a.is_active)
  const bancoScore = activeBanks.length >= 1 ? 2 : 0
  // §8 Equipo: 2 pts
  const staffWithSalary = staffMembers.filter(s => (s.salary ?? 0) > 0 && (s.horas_disponibles_mes ?? 0) > 0)
  const equipoScore = staffWithSalary.length >= 1 ? 2 : 0
  // §9 Metas: 3 pts
  const metasScore = monthlyTargets.length >= 1 ? 3 : 0

  const totalScore = fiscalScore + marcaScore + serviciosScore + gastosScore + bancoScore + equipoScore + metasScore
  const progressPct = Math.round((totalScore / 16) * 100)

  return (
    <MiNegocioClient
      workspace={workspace}
      fiscalProfile={fiscalProfile}
      staffMembers={staffMembers}
      bankAccounts={bankAccounts}
      monthlyTargets={monthlyTargets}
      fixedExpenses={fixedWithCat}
      categories={categories}
      servicios={servicios}
      progressPct={progressPct}
      currentUserRole={profile.role}
      sectionScores={{
        fiscal: fiscalScore,
        marca: marcaScore,
        servicios: serviciosScore,
        gastos: gastosScore,
        banco: bancoScore,
        equipo: equipoScore,
        metas: metasScore,
      }}
    />
  )
}
