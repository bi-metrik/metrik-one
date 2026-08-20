import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getConciliacionV2 } from '@/lib/actions/conciliacion-actions'
import { getColaFacturacion } from '@/lib/actions/facturacion-actions'
import ConciliacionClient from './conciliacion-client'
import { getCachedUser } from '@/lib/supabase/auth-user'

export const runtime = 'nodejs'

export default async function ConciliacionPage() {
  const supabase = await createClient()

  const { user } = await getCachedUser()
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

  // La cola de facturación es opcional: si el workspace no la tiene configurada
  // (o el usuario no pasa el guard financiero), la pestaña simplemente no aparece.
  const { data: cola } = await getColaFacturacion()

  return <ConciliacionClient data={data} cola={cola} />
}
