import 'server-only'
import { unstable_cache, updateTag } from 'next/cache'

/**
 * Caché de las RPC caras de Tableros y Equipo (SOENA).
 *
 * Por qué existe: abrir `/tableros` en SOENA dispara 12 RPC que leen
 * `v_venta_mes_comercial` (~1 s cada una). Son ~13 s de CPU de una base de dos
 * núcleos por apertura, y el 2026-10-03 a la 1:33 p. m. eso tumbó ONE. Las 12 son
 * SECURITY DEFINER y su único vínculo con quien pregunta es la guarda
 * `p_workspace_id = current_user_workspace_id()`: el resultado depende SOLO del
 * workspace y de los parámetros. Por eso se pueden compartir entre las personas del
 * mismo workspace durante unos minutos.
 *
 * ⚠️ Reglas que NO se negocian (cada una tiene prueba en `cache-rpc.test.ts`):
 *
 * 1. La llave lleva SIEMPRE el workspace, el nombre de la RPC y todos sus
 *    parámetros. Dos workspaces nunca comparten entrada.
 * 2. El permiso (rol, «Ver como», módulo) se decide ANTES de llamar aquí, en la
 *    acción, igual que antes. El recorte por persona (el bono ajeno) se hace
 *    DESPUÉS, sobre lo que esto devuelve. Nada que dependa de QUIÉN mira entra al
 *    caché.
 * 3. Solo se guarda una respuesta si la guarda de la RPC pasó con ESE workspace:
 *    se pregunta `current_user_workspace_id()` antes y después de la RPC con el
 *    mismo cliente. Con service_role (el `__dev_ws` de desarrollo) la función da
 *    null, la RPC devuelve ceros, y eso NO puede quedar guardado como cifra real.
 *    Tampoco se guardan errores ni respuestas vacías. En esos casos la respuesta
 *    se devuelve tal cual, sin caché: el comportamiento es el de antes.
 * 4. Vida máxima: 5 minutos. `unstable_cache` sirve una entrada VENCIDA una vez
 *    mientras la refresca por detrás (stale-while-revalidate), así que con solo
 *    `revalidate` una cifra podría salir con horas de atraso. La llave lleva la
 *    ventana de 5 minutos en curso: al cambiar de ventana la entrada vieja deja de
 *    leerse. Una cifra nunca tiene más de 5 minutos.
 *
 * Por qué `unstable_cache` y no `'use cache'`: en Next 16.1.6 `'use cache'` exige
 * encender `cacheComponents` para todo el proyecto, y eso cambia el render de toda
 * la app. `unstable_cache` funciona sin bandera, en páginas y en server actions.
 * No puede leer cookies adentro: por eso el cliente de Supabase (con el JWT de la
 * sesión) se crea AFUERA, en `getWorkspace`, y la función cacheada lo usa por
 * cierre. El cierre no entra a la llave; el workspace sí, como argumento.
 */

/** Vida de una entrada, en segundos. Es también el atraso máximo de una cifra. */
export const VIDA_CACHE_TABLEROS_S = 300

/** Tag por workspace: invalidarlo borra TODAS las cifras cacheadas de ese workspace. */
export function tagTablerosWorkspace(workspaceId: string): string {
  return `tableros-rpc:ws:${workspaceId}`
}

/** Ventana de 5 minutos en curso. Entra a la llave (regla 4). */
export function ventanaActual(ahoraMs: number = Date.now()): number {
  return Math.floor(ahoraMs / (VIDA_CACHE_TABLEROS_S * 1000))
}

/** Lo mínimo del cliente de Supabase que se usa aquí. */
export interface ClienteRpc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>
}

export interface RespuestaRpc<T> {
  data: T | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any
}

/** Respuesta que no se puede guardar: viaja en un throw para que `unstable_cache` no la escriba. */
class NoCacheable {
  constructor(readonly respuesta: RespuestaRpc<unknown>) {}
}

/** `null`, arreglo vacío u objeto vacío: no se guarda (regla 3). */
export function esRespuestaVacia(data: unknown): boolean {
  if (data == null) return true
  if (Array.isArray(data)) return data.length === 0
  if (typeof data === 'object') return Object.keys(data as object).length === 0
  return false
}

/**
 * Contador de llamadas reales a la base (miss), por RPC. Sirve para medir en
 * desarrollo cuántas RPC salen en la primera apertura y cuántas en la segunda, y
 * para las pruebas. No es estado de negocio.
 */
const llamadasReales = new Map<string, number>()
export function __llamadasRealesParaPruebas(): Map<string, number> {
  return llamadasReales
}

function registrarLlamada(fn: string, workspaceId: string) {
  llamadasReales.set(fn, (llamadasReales.get(fn) ?? 0) + 1)
  if (process.env.NODE_ENV === 'development') {
    console.info(`[tableros-cache] a la base: ${fn} (ws ${workspaceId.slice(0, 8)})`)
  }
}

/**
 * Llama una RPC de tablero a través del caché. Misma forma `{ data, error }` que
 * `supabase.rpc`, para que la acción no cambie su manejo de errores.
 *
 * `workspaceId` tiene que ser el que devolvió `getWorkspace()` para ESTA sesión, y
 * `supabase` el cliente de esa misma sesión. Los permisos ya se revisaron.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpcTablero<T = any>(
  supabase: ClienteRpc,
  workspaceId: string,
  fn: string,
  params: Record<string, unknown>,
): Promise<RespuestaRpc<T>> {
  const cacheada = unstable_cache(
    // Todo lo que decide el resultado viaja como ARGUMENTO: `unstable_cache` arma la
    // llave con `JSON.stringify(args)`. Solo el cliente va por cierre, y no decide el
    // resultado salvo por la guarda, que se verifica abajo.
    async (ws: string, nombre: string, args: Record<string, unknown>, _ventana: number) => {
      registrarLlamada(nombre, ws)
      const antes = await supabase.rpc('current_user_workspace_id')
      const r = await supabase.rpc(nombre, args)
      if (antes.error || antes.data !== ws || r.error || esRespuestaVacia(r.data)) {
        throw new NoCacheable({ data: r.data ?? null, error: r.error ?? null })
      }
      // Se pregunta otra vez DESPUÉS: si el workspace de la sesión cambió mientras la
      // RPC corría (otra pestaña cambió de workspace), la cifra no se guarda.
      const despues = await supabase.rpc('current_user_workspace_id')
      if (despues.error || despues.data !== ws) {
        throw new NoCacheable({ data: r.data ?? null, error: r.error ?? null })
      }
      return r.data as T
    },
    // La parte fija de la llave también lleva el workspace: doble cinturón.
    ['tableros-rpc', 'v1', `ws:${workspaceId}`, fn],
    { revalidate: VIDA_CACHE_TABLEROS_S, tags: [tagTablerosWorkspace(workspaceId)] },
  )

  try {
    const data = await cacheada(workspaceId, fn, params, ventanaActual())
    return { data, error: null }
  } catch (e) {
    if (e instanceof NoCacheable) return e.respuesta as RespuestaRpc<T>
    // Un fallo del propio caché no puede tumbar la pantalla: se pregunta directo.
    console.error(`[tableros-cache] el caché falló en ${fn}; se consulta directo:`, e)
    const r = await supabase.rpc(fn, params)
    return { data: (r.data ?? null) as T | null, error: r.error ?? null }
  }
}

/**
 * Borra las cifras cacheadas de un workspace. Se llama desde las server actions
 * que cambian algo que los tableros leen (metas, política del bono), para que el
 * cambio se vea al instante y no a los 5 minutos.
 *
 * `updateTag` (y no `revalidateTag`) porque solo existe en server actions y vence
 * la entrada de inmediato: quien guardó ve su propio cambio en la siguiente lectura.
 */
export function invalidarTablerosWorkspace(workspaceId: string): void {
  try {
    updateTag(tagTablerosWorkspace(workspaceId))
  } catch (e) {
    // Fuera de una server action `updateTag` lanza. El guardado ya ocurrió: lo peor
    // que pasa es que la cifra tarde hasta 5 minutos, no que el guardado falle.
    console.error('[tableros-cache] no se pudo invalidar el caché del workspace:', e)
  }
}
