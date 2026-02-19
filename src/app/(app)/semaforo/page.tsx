import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SemaforoClient from './semaforo-client'
import { getSemaforoData } from './semaforo-actions'

export default async function SemaforoPage() {
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

  const data = await getSemaforoData(profile.workspace_id)

  return <SemaforoClient data={data} />
}
