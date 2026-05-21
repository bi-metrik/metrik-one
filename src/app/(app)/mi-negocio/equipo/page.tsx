/**
 * Pagina /mi-negocio/equipo — Superficie 1 spec UX 2026-05-20
 *
 * Lista staff del workspace con sus areas multi-tag, count de negocios activos,
 * y configuracion de responsables por defecto por area.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import {
  getEquipoConAreas,
  getWorkspaceDefaultResponsables,
} from '@/lib/actions/equipo-areas'
import EquipoAreasClient from './equipo-areas-client'

export const dynamic = 'force-dynamic'

export default async function EquipoAreasPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/onboarding')

  const role = profile.role as string

  // Operator/contador no ven esta pagina (regla 11 + spec Noor)
  if (role === 'operator' || role === 'contador') {
    redirect('/mi-negocio')
  }

  const [staff, defaults] = await Promise.all([
    getEquipoConAreas(),
    getWorkspaceDefaultResponsables(),
  ])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <Link
          href="/mi-negocio"
          className="inline-flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#1A1A1A]"
        >
          <ArrowLeft className="h-4 w-4" />
          Mi Negocio
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[#1A1A1A]">Equipo del workspace</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Asigna areas y responsables por defecto. Los responsables por defecto se
          usan para la cascada de asignacion automatica al cambiar de etapa.
        </p>
      </div>
      <EquipoAreasClient
        initialStaff={staff}
        initialDefaults={defaults}
        currentUserRole={role}
      />
    </div>
  )
}
