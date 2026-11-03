/**
 * Qué novedades le tocan a un espacio y cuáles ya vio la persona.
 *
 * Funciones puras más la lectura/escritura de `localStorage`. «Visto» vive en el navegador, por
 * persona (la llave lleva el id del usuario): sin tabla ni escrituras a la base. Si el navegador
 * no deja leer o escribir (modo privado, cuota llena, almacenamiento bloqueado), el numerito
 * simplemente no se muestra; la lista se sigue abriendo.
 *
 * Se recuerdan los `id` vistos, no una fecha: con una fecha, una entrada que se mergea el mismo
 * día en que la persona ya abrió el tablero (o con fecha atrasada) nunca contaría como nueva.
 */
import { moduloActivo } from '@/lib/modulos/gate'
import type { Novedad } from './novedades'

/** Una novedad más vieja que esto no prende el numerito (sí sale en la lista). */
export const VENTANA_NUMERITO_DIAS = 60

export interface ContextoNovedades {
  modules: Record<string, boolean | undefined> | null | undefined
  /** El shell de vitrina es el de Valida aunque `valida_consulta` no esté encendido. */
  modoVitrina: boolean
  /** Soporte de MéTRIK en su propio espacio (`soportePasaGate`): ve todas. */
  platformAdmin: boolean
}

export function novedadAplica(n: Novedad, ctx: ContextoNovedades): boolean {
  if (!n.producto || ctx.platformAdmin) return true
  if (n.producto === 'valida' && ctx.modoVitrina) return true
  return moduloActivo(n.producto, ctx.modules)
}

/** Las del espacio, la más reciente arriba (a igual fecha, el orden del archivo). */
export function novedadesDelEspacio(todas: readonly Novedad[], ctx: ContextoNovedades): Novedad[] {
  return todas
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => novedadAplica(n, ctx))
    .sort((a, b) => (a.n.fecha === b.n.fecha ? a.i - b.i : a.n.fecha < b.n.fecha ? 1 : -1))
    .map(({ n }) => n)
}

/** Resta días a una fecha 'YYYY-MM-DD' (calendario, sin zona). */
function restarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10)
}

/**
 * Cuántas no ha visto. `vistas === null` = no se pudo leer el navegador: no hay numerito.
 * `hoy` es 'YYYY-MM-DD' en Bogotá.
 */
export function contarNoVistas(lista: readonly Novedad[], vistas: readonly string[] | null, hoy: string): number {
  if (vistas === null) return 0
  const desde = restarDias(hoy, VENTANA_NUMERITO_DIAS)
  const set = new Set(vistas)
  return lista.filter((n) => n.fecha >= desde && !set.has(n.id)).length
}

// ─── Navegador ───────────────────────────────────────────────────────────────

export const EVENTO_NOVEDADES_VISTAS = 'metrik:novedades-vistas'

export function llaveVistas(usuarioId: string | null | undefined): string {
  return `metrik-one:novedades-vistas:${usuarioId || 'anonimo'}`
}

/**
 * El texto guardado tal cual (estable para `useSyncExternalStore`). '' = nunca abrió el tablero;
 * `null` = el navegador no deja leer.
 */
export function leerVistasCrudo(llave: string): string | null {
  try {
    return window.localStorage.getItem(llave) ?? ''
  } catch {
    return null
  }
}

export function parsearVistas(crudo: string | null): string[] | null {
  if (crudo === null) return null
  if (crudo === '') return []
  try {
    const v: unknown = JSON.parse(crudo)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Marca como vistas las de la lista (conserva las de otros espacios). Falla en silencio. */
export function marcarVistas(llave: string, ids: readonly string[]): void {
  try {
    const previas = parsearVistas(window.localStorage.getItem(llave) ?? '') ?? []
    const todas = Array.from(new Set([...previas, ...ids]))
    window.localStorage.setItem(llave, JSON.stringify(todas))
    window.dispatchEvent(new Event(EVENTO_NOVEDADES_VISTAS))
  } catch {
    // Sin almacenamiento: no hay numerito que apagar.
  }
}
