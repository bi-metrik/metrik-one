import { redirect } from 'next/navigation'
import { getControles } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import ControlesList from './controles-list'
import Link from 'next/link'
import { ShieldCheck, Plus } from 'lucide-react'

export default async function ControlesPage() {
  const { role } = await getWorkspace()
  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canViewRiesgos) redirect('/')

  const controles = await getControles()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-[#10B981]" />
          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">Controles</h1>
            <p className="text-sm text-[#6B7280]">
              {controles.length} control{controles.length !== 1 ? 'es' : ''} registrado{controles.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        {perms.canEditRiesgos && (
          <Link
            href="/controles/nuevo"
            className="inline-flex items-center gap-2 rounded-lg bg-[#10B981] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#059669]"
          >
            <Plus className="h-4 w-4" />
            Nuevo control
          </Link>
        )}
      </div>

      <ControlesList controles={controles} />
    </div>
  )
}
