import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerDia, leerExperiencias, leerPanelCampanas } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { InicioCliente } from './inicio-cliente'

export const dynamic = 'force-dynamic'

/**
 * `/funciones`: el inicio del panel (§4.1), con pestañas Campañas (activas arriba, borradores después), Hoy y
 * Experiencias. El estado de cada campaña es el efectivo de la base (`funcion_estado_campana`): se cierra sola cuando
 * pasa su última función (P6), sin cron.
 */
export default async function FuncionesPage({ searchParams }: { searchParams: Promise<{ pestana?: string }> }) {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')

  const db = supabase as unknown as SupabaseClient
  const hoy = todayBogotaISO()
  const [campanas, experiencias, dia] = await Promise.all([leerPanelCampanas(db, workspaceId), leerExperiencias(db, workspaceId), leerDia(db, workspaceId, hoy)])
  const { pestana } = await searchParams
  return (
    <InicioCliente
      campanas={campanas}
      experiencias={experiencias}
      hoy={dia.map((d) => ({ ...d.ocupacion, reservas: d.reservas.length }))}
      fechaHoy={hoy}
      pestana={pestana === 'hoy' || pestana === 'experiencias' ? pestana : 'campanas'}
      puedeEditar={puedeEditarFunciones(role)}
    />
  )
}
