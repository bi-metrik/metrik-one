import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import FacturacionClient from './facturacion-client'

export default async function FacturacionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/onboarding')
  if (!['owner', 'admin'].includes(profile.role)) redirect('/dashboard')

  // Parallel data fetches
  const [invoicesRes, paymentsRes, projectsRes, clientsRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('*')
      .eq('workspace_id', profile.workspace_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('payments')
      .select('*')
      .eq('workspace_id', profile.workspace_id)
      .order('payment_date', { ascending: false }),
    supabase
      .from('projects')
      .select('id, name, client_id')
      .eq('workspace_id', profile.workspace_id)
      .in('status', ['active', 'rework', 'completed'])
      .order('name'),
    supabase
      .from('clients')
      .select('id, name')
      .eq('workspace_id', profile.workspace_id)
      .eq('is_active', true)
      .order('name'),
  ])

  return (
    <FacturacionClient
      invoices={invoicesRes.data || []}
      payments={paymentsRes.data || []}
      projects={(projectsRes.data || []).map(p => ({ id: p.id, name: p.name, client_id: p.client_id }))}
      clients={(clientsRes.data || []).map(c => ({ id: c.id, name: c.name }))}
    />
  )
}
