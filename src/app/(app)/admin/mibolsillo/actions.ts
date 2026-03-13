'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createMiBolsilloClient } from '@/lib/supabase/mibolsillo'
import type { MiBolsilloMetrics } from '@/types/mibolsillo'

export async function getMiBolsilloMetrics(): Promise<MiBolsilloMetrics | null> {
  // Auth guard: only owner of MéTRIK workspace can access
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner') return null
  if (workspaceId !== process.env.ADMIN_WORKSPACE_ID) return null

  const mb = createMiBolsilloClient()

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString()
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000).toISOString()

  const [
    usersRes,
    subsRes,
    messagesTodayRes,
    messagesWeekRes,
    txTodayRes,
    txWeekRes,
    discoveriesRes,
    dauRes,
    wauRes,
    mauRes,
  ] = await Promise.all([
    // All users (not deleted)
    mb.from('users').select('id, plan, onboarding_complete, created_at, last_active_at, days_active, deleted_at'),

    // Active subscriptions
    mb.from('subscriptions').select('plan, status, amount').eq('status', 'active'),

    // Messages today (user-sent)
    mb.from('message_log').select('id', { count: 'exact', head: true }).eq('direction', 'in').gte('created_at', todayStart),

    // Messages this week
    mb.from('message_log').select('id', { count: 'exact', head: true }).eq('direction', 'in').gte('created_at', weekAgo),

    // Transactions today
    mb.from('transactions').select('id', { count: 'exact', head: true }).is('deleted_at', null).gte('created_at', todayStart),

    // Transactions this week
    mb.from('transactions').select('id', { count: 'exact', head: true }).is('deleted_at', null).gte('created_at', weekAgo),

    // Feature discoveries (top features)
    mb.from('user_discoveries').select('feature'),

    // DAU: distinct users with messages today
    mb.from('message_log').select('user_id').eq('direction', 'in').gte('created_at', todayStart),

    // WAU: distinct users with messages this week
    mb.from('message_log').select('user_id').eq('direction', 'in').gte('created_at', weekAgo),

    // MAU: distinct users with messages this month
    mb.from('message_log').select('user_id').eq('direction', 'in').gte('created_at', monthAgo),
  ])

  // Also fetch daily trends (last 14 days) — separate queries for date grouping
  const [signups14dRes, messages14dRes, tx14dRes] = await Promise.all([
    mb.from('users').select('created_at').gte('created_at', twoWeeksAgo).is('deleted_at', null),
    mb.from('message_log').select('created_at').eq('direction', 'in').gte('created_at', twoWeeksAgo),
    mb.from('transactions').select('created_at').is('deleted_at', null).gte('created_at', twoWeeksAgo),
  ])

  // ── Calculate metrics ──

  const allUsers = (usersRes.data ?? []).filter(u => !u.deleted_at)
  const totalUsers = allUsers.length

  // Users by plan
  const usersByPlan: Record<string, number> = {}
  allUsers.forEach(u => {
    usersByPlan[u.plan] = (usersByPlan[u.plan] ?? 0) + 1
  })

  // New users
  const newUsersToday = allUsers.filter(u => u.created_at >= todayStart).length
  const newUsersWeek = allUsers.filter(u => u.created_at >= weekAgo).length

  // Onboarding rate
  const completedOnboarding = allUsers.filter(u => u.onboarding_complete).length
  const onboardingRate = totalUsers > 0 ? completedOnboarding / totalUsers : 0

  // Revenue
  const activeSubs = subsRes.data ?? []
  const mrrTotal = activeSubs.reduce((s, sub) => s + Number(sub.amount), 0)
  const mrrByPlan: Record<string, number> = {}
  activeSubs.forEach(sub => {
    mrrByPlan[sub.plan] = (mrrByPlan[sub.plan] ?? 0) + Number(sub.amount)
  })
  const activeSubscriptions = activeSubs.length
  const arpu = activeSubscriptions > 0 ? mrrTotal / activeSubscriptions : 0

  // Engagement
  const messagesToday = messagesTodayRes.count ?? 0
  const messagesWeek = messagesWeekRes.count ?? 0
  const transactionsToday = txTodayRes.count ?? 0
  const transactionsWeek = txWeekRes.count ?? 0

  // Top features
  const featureCounts = new Map<string, number>()
  ;(discoveriesRes.data ?? []).forEach(d => {
    featureCounts.set(d.feature, (featureCounts.get(d.feature) ?? 0) + 1)
  })
  const topFeatures = [...featureCounts.entries()]
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Retention (distinct users)
  const distinctUsers = (data: { user_id: string | null }[]) =>
    new Set(data.filter(d => d.user_id).map(d => d.user_id)).size

  const dau = distinctUsers(dauRes.data ?? [])
  const wau = distinctUsers(wauRes.data ?? [])
  const mau = distinctUsers(mauRes.data ?? [])

  // Inactive / churn
  const inactiveOver7d = allUsers.filter(u => {
    if (!u.last_active_at) return u.created_at < weekAgo
    return u.last_active_at < weekAgo
  }).length

  const churnOver30d = allUsers.filter(u => {
    if (!u.last_active_at) return u.created_at < monthAgo
    return u.last_active_at < monthAgo
  }).length

  // Funnel
  const planOrder = ['free', 'personal', 'mi_negocio', 'mi_negocio_plus']
  const funnel = planOrder.map(plan => ({
    plan,
    count: usersByPlan[plan] ?? 0,
    pct: totalUsers > 0 ? ((usersByPlan[plan] ?? 0) / totalUsers) * 100 : 0,
  }))

  // Daily trends (last 14 days)
  const buildDailyTrend = (rows: { created_at: string }[]) => {
    const counts = new Map<string, number>()
    // Initialize all 14 days
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000)
      const key = d.toISOString().split('T')[0]
      counts.set(key, 0)
    }
    rows.forEach(r => {
      const key = r.created_at.split('T')[0]
      if (counts.has(key)) counts.set(key, counts.get(key)! + 1)
    })
    return [...counts.entries()].map(([date, count]) => ({ date, count }))
  }

  const dailySignups = buildDailyTrend(signups14dRes.data ?? [])
  const dailyMessages = buildDailyTrend(messages14dRes.data ?? [])
  const dailyTransactions = buildDailyTrend(tx14dRes.data ?? [])

  return {
    totalUsers,
    usersByPlan,
    newUsersToday,
    newUsersWeek,
    onboardingRate,
    mrrTotal,
    mrrByPlan,
    arpu,
    activeSubscriptions,
    messagesToday,
    messagesWeek,
    transactionsToday,
    transactionsWeek,
    topFeatures,
    dau,
    wau,
    mau,
    inactiveOver7d,
    churnOver30d,
    funnel,
    dailySignups,
    dailyMessages,
    dailyTransactions,
  }
}
