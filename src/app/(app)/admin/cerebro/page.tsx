import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import CerebroClient from './cerebro-client'

export const metadata: Metadata = { title: 'Cerebro' }

export default async function AdminCerebroPage() {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) redirect('/numeros')

  return <CerebroClient />
}
