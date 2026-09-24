import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerTablero } from '@/lib/ferreteria/datos'
import { puedeEditarFerreteria } from '@/lib/ferreteria/reglas'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { FerreteriaCliente } from './ferreteria-cliente'

export const dynamic = 'force-dynamic'

/**
 * `/ferreteria`: el catálogo publicado del piloto Marketplace (alianza Dimpro x MeTRIK).
 * Spec: `docs/specs/2026-09-24_modulo-ferreteria-dimpro.md`, §4.
 *
 * El middleware ya saca de aquí a un workspace sin el módulo; `exigirModulo` cubre el resto
 * (una lectura fallida cierra en vez de pintar un catálogo vacío).
 */
export default async function FerreteriaPage() {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.ferreteria)).ok) redirect('/')

  const hoy = todayBogotaISO()
  const tablero = await leerTablero(supabase as unknown as SupabaseClient, workspaceId, hoy)
  return <FerreteriaCliente tablero={tablero} hoy={hoy} ahoraIso={new Date().toISOString()} puedeEditar={puedeEditarFerreteria(role)} />
}
