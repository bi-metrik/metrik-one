import 'server-only'

import { getNegociosV2, getEtapasSegmentador } from '@/app/(app)/negocios/negocio-v2-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getAreasEfectivas, type Area, type Role } from '@/lib/permissions/can-edit'
import { todayBogotaISO } from '@/lib/dates/bogota'
import type { SearchParams } from '@/lib/filtros/url-estado'
import { costosEjecutadosPorNegocio } from './costos-ejecutados'
import { armarVistaLista, type FaseFilter, type Universo, type VistaLista } from './vista-lista'

/**
 * Filtro de fase por defecto según el área del usuario (supervisor con área ve su fase
 * preseleccionada; puede cambiarla). Sin área / dirección → 'todos'. Operator ya ve solo
 * sus negocios (filtro de `getNegociosV2`).
 */
export function defaultStageFilter(role: string | null, areas: string[]): FaseFilter {
  if (!areas || areas.length === 0) return 'todos'
  const ef = getAreasEfectivas({ id: '', role: (role ?? 'read_only') as Role, areas: areas as Area[] })
  if (ef.has('comercial') && ef.has('operaciones') && ef.has('financiera')) return 'todos' // dirección
  if (ef.has('comercial')) return 'venta'
  if (ef.has('operaciones')) return 'ejecucion'
  if (ef.has('financiera')) return 'cobro'
  return 'todos'
}

/**
 * Lee el universo que la lista filtra. Los cerrados se leen SIEMPRE aquí (son pocos: 39
 * en SOENA el 2026-10-03) porque los contadores, «Todos» y la búsqueda los cuentan; lo que
 * ya no hacen es viajar al navegador salvo que caigan en la página visible.
 *
 * ⚠️ `'cerrado'` (los TRES estados de cierre) tiene que ser el mismo valor que pide
 * `POST /api/negocios/export` (`construirExportNegocios`): si la pantalla lista un negocio
 * que el Excel no tiene en su mapa, la fila desaparece del archivo en silencio.
 *
 * Sin costos (`conCostos=false`): se leen después, solo para la página.
 */
async function leerUniverso(): Promise<{ u: Universo; supabase: unknown; workspaceId: string } | null> {
  const ws = await getWorkspace()
  if (ws.error || !ws.workspaceId) return null
  const [abiertos, cerrados, etapas] = await Promise.all([
    getNegociosV2('abierto', false, false),
    getNegociosV2('cerrado', false, false),
    getEtapasSegmentador(),
  ])
  return {
    supabase: ws.supabase,
    workspaceId: ws.workspaceId,
    u: { abiertos, cerrados, etapas, defaultStage: defaultStageFilter(ws.role, ws.areas), hoyISO: todayBogotaISO() },
  }
}

/**
 * La lista para unos parámetros de URL, con la página pedida. null sin sesión con workspace.
 * Misma función para la primera carga (`page.tsx`) y para `GET /api/negocios/lista`.
 */
export async function cargarVistaLista(
  sp: SearchParams | undefined,
  pagina: { desde?: number; cuantos?: number } = {},
): Promise<VistaLista | null> {
  const leido = await leerUniverso()
  if (!leido) return null
  const { vista } = armarVistaLista(leido.u, sp, pagina)

  // Costos solo de lo que se pinta (ver `costos-ejecutados.ts`). Un 0 no viaja: es el defecto.
  const costos = await costosEjecutadosPorNegocio(
    leido.supabase,
    leido.workspaceId,
    vista.tarjetas.map((t) => t.id),
  )
  vista.tarjetas = vista.tarjetas.map((t) => (costos[t.id] ? { ...t, costos_ejecutados: costos[t.id] } : t))
  return vista
}

/**
 * Ids de la lista visible COMPLETA, en el orden de la pantalla. Es lo que reciben el Excel
 * y la hoja de Drive: la misma función que arma la vista, así que no pueden divergir.
 */
export async function idsDeVistaLista(sp: SearchParams | undefined): Promise<string[] | null> {
  const leido = await leerUniverso()
  if (!leido) return null
  return armarVistaLista(leido.u, sp).ordenados.map((n) => n.id)
}
