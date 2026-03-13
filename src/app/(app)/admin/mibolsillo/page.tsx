import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getMiBolsilloMetrics } from './actions'
import MiBolsilloClient from './mibolsillo-client'

export default async function MiBolsilloAdminPage() {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) redirect('/numeros')

  const data = await getMiBolsilloMetrics()
  if (!data) redirect('/numeros')

  return <MiBolsilloClient initialData={data} />
}
