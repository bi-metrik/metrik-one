// Minimal types for Mi Bolsillo admin dashboard (read-only)

export interface MBUser {
  id: string
  name: string
  phone_number: string
  plan: 'free' | 'personal' | 'mi_negocio' | 'mi_negocio_plus'
  plan_started_at: string | null
  onboarding_complete: boolean
  onboarding_step: number
  has_business: boolean
  last_active_at: string | null
  days_active: number
  created_at: string
  deleted_at: string | null
}

export interface MBTransaction {
  id: string
  user_id: string
  type: 'income' | 'expense' | 'sale' | 'owner_withdrawal' | 'owner_injection'
  amount: number
  created_at: string
  deleted_at: string | null
}

export interface MBMessageLog {
  id: string
  user_id: string | null
  direction: 'in' | 'out'
  created_at: string
}

export interface MBSubscription {
  id: string
  user_id: string
  plan: string
  status: 'active' | 'past_due' | 'cancelled' | 'trial'
  amount: number
  created_at: string
}

export interface MBUserDiscovery {
  id: string
  user_id: string
  feature: string
  first_used_at: string | null
}

// Dashboard aggregated data
export interface MiBolsilloMetrics {
  // Usuarios
  totalUsers: number
  usersByPlan: Record<string, number>
  newUsersToday: number
  newUsersWeek: number
  onboardingRate: number

  // Revenue
  mrrTotal: number
  mrrByPlan: Record<string, number>
  arpu: number
  activeSubscriptions: number

  // Engagement
  messagesToday: number
  messagesWeek: number
  transactionsToday: number
  transactionsWeek: number
  topFeatures: { feature: string; count: number }[]

  // Retention
  dau: number
  wau: number
  mau: number
  inactiveOver7d: number
  churnOver30d: number

  // Funnel
  funnel: { plan: string; count: number; pct: number }[]

  // Trends (last 14 days)
  dailySignups: { date: string; count: number }[]
  dailyMessages: { date: string; count: number }[]
  dailyTransactions: { date: string; count: number }[]
}
