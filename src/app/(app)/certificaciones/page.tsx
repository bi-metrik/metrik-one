import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { listCertData } from '@/lib/cert/admin'
import CertificacionesClient from './certificaciones-client'

export const dynamic = 'force-dynamic'

export default async function CertificacionesPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await sb.from('profiles').select('workspace_id').eq('id', user.id).single()
  if (!profile?.workspace_id) redirect('/')

  const svc = createServiceClient()
  const { data: ws } = await svc.from('workspaces').select('modules').eq('id', profile.workspace_id).single()
  const modules = (ws?.modules ?? {}) as Record<string, boolean>
  if (!modules.cert_qr) redirect('/')

  const data = await listCertData()
  return <CertificacionesClient {...data} />
}
