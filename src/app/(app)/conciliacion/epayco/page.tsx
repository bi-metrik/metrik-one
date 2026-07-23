import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getConciliacionEpayco } from '@/lib/actions/conciliacion-epayco-actions'
import EpaycoClient from './epayco-client'

export const runtime = 'nodejs'

interface Props {
  searchParams: Promise<{ mes?: string }>
}

export default async function ConciliacionEpaycoPage({ searchParams }: Props) {
  const supabase = await createClient()
  const params = await searchParams

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.workspace_id) redirect('/onboarding')

  // Solo workspaces con modules.conciliacion = true
  const { data: ws } = await supabase
    .from('workspaces')
    .select('modules')
    .eq('id', profile.workspace_id)
    .single()

  const modules = (ws as { modules: Record<string, boolean> | null } | null)?.modules
  if (!modules?.conciliacion) redirect('/numeros')

  const mes = params.mes && /^\d{4}-\d{2}$/.test(params.mes) ? params.mes : undefined

  const { data, error } = await getConciliacionEpayco(mes)

  if (error || !data) redirect('/conciliacion')

  return <EpaycoClient data={data} mesActual={mes} />
}
