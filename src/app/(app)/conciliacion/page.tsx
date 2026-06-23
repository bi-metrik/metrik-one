import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getConciliacionV2 } from '@/lib/actions/conciliacion-actions'
import ConciliacionClient from './conciliacion-client'

export const runtime = 'nodejs'

export default async function ConciliacionPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.workspace_id) redirect('/onboarding')

  // Módulo opt-in: solo workspaces con modules.conciliacion = true (SOENA).
  const { data: ws } = await supabase
    .from('workspaces')
    .select('modules')
    .eq('id', profile.workspace_id)
    .single()

  const modules = (ws as { modules: Record<string, boolean> | null } | null)?.modules
  if (!modules?.conciliacion) {
    redirect('/numeros')
  }

  // getConciliacionV2 re-valida el área financiera server-side (ctxFinanciero).
  const { data, error } = await getConciliacionV2()

  // Si el usuario no es del área financiera, el action devuelve error → no mostramos
  // datos (redirigimos a Negocios).
  if (error || !data) {
    redirect('/negocios')
  }

  return <ConciliacionClient data={data} />
}
