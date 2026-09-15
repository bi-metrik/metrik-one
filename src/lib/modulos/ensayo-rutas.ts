/**
 * Ensayo del gate por módulo contra el uso real (spec §2.3): para cada workspace, qué rutas
 * quedan bloqueadas y si alguien trabajó en ellas en los últimos 90 días según `activity_log`.
 * Si un workspace usa hoy una ruta de un módulo que no tiene, se decide antes (cortesía o aviso).
 *
 * La lógica es pura y usa el gate real (`rutaPermitida`), no una copia del criterio. La lectura
 * de producción vive en `scripts/ensayo-rutas-bloqueadas.ts`.
 *
 * Límite declarado: `activity_log` casi solo registra eventos de negocios (y algo de contactos y
 * cuentas de cobro). Mide el uso de Clarity y del directorio; no ve una consulta de Valida, una
 * llamada auditada ni una matriz de riesgos abierta. Un cero en una ruta de otro módulo quiere
 * decir "no hay evidencia en esta tabla", no "nadie la usa".
 */

import { IDS_MODULO, MODULOS, RUTAS_POR_FUNCION, RUTAS_VITRINA } from './catalogo'
import { rutaGateada, rutaPermitida } from './gate'

export interface WorkspaceEnsayo {
  id: string
  slug: string
  modules: Record<string, boolean> | null
  modoVitrina: boolean
}

export interface EventoActividad {
  workspace_id: string
  entidad_tipo: string
  created_at: string
}

/** A qué pantalla corresponde un evento, por el tipo de entidad que registra. */
export const RUTA_POR_ENTIDAD: Record<string, string> = {
  negocio: '/negocios',
  oportunidad: '/negocios',
  cobro: '/negocios',
  cuenta_cobro: '/cobros-recurrentes',
  contacto: '/directorio',
}

export interface UsoBloqueado {
  ruta: string
  eventos: number
  ultimo: string
}

export interface FilaEnsayo {
  slug: string
  rutasBloqueadas: string[]
  usoBloqueado: UsoBloqueado[]
  entidadesSinRuta: string[]
}

/** Todas las rutas que el gate conoce: las de cada módulo, las de vitrina y las abiertas por función. */
export function rutasDelCatalogo(): string[] {
  return [
    ...new Set([
      ...IDS_MODULO.flatMap((id) => MODULOS[id].rutas),
      ...RUTAS_VITRINA,
      ...RUTAS_POR_FUNCION.map((f) => f.ruta),
    ]),
  ].sort()
}

export function ensayarRutasBloqueadas(
  workspaces: readonly WorkspaceEnsayo[],
  eventos: readonly EventoActividad[],
): FilaEnsayo[] {
  const rutas = rutasDelCatalogo()

  return workspaces
    .map((w) => {
      const ctx = { modules: w.modules, modoVitrina: w.modoVitrina, platformAdmin: false }
      const rutasBloqueadas = rutas.filter((r) => rutaGateada(r) && !rutaPermitida(r, ctx))

      const uso = new Map<string, UsoBloqueado>()
      const sinRuta = new Set<string>()
      for (const e of eventos) {
        if (e.workspace_id !== w.id) continue
        const ruta = RUTA_POR_ENTIDAD[e.entidad_tipo]
        if (!ruta) {
          sinRuta.add(e.entidad_tipo)
          continue
        }
        if (rutaPermitida(ruta, ctx)) continue
        const previo = uso.get(ruta)
        uso.set(ruta, {
          ruta,
          eventos: (previo?.eventos ?? 0) + 1,
          ultimo: previo && previo.ultimo > e.created_at ? previo.ultimo : e.created_at,
        })
      }

      return {
        slug: w.slug,
        rutasBloqueadas,
        usoBloqueado: [...uso.values()].sort((a, b) => b.eventos - a.eventos),
        entidadesSinRuta: [...sinRuta].sort(),
      }
    })
    .sort((a, b) => a.slug.localeCompare(b.slug))
}
