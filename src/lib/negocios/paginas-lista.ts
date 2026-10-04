import { conReintentoDeRed } from '@/lib/red/con-reintento'
import { fetchPropio } from '@/lib/version/fetch-propio'

/**
 * Lo que el navegador hace con las páginas de `/negocios` (`GET /api/negocios/lista`).
 * Puro y aparte del componente para probarlo sin montar la pantalla.
 */

interface ConId {
  id: string
}

/**
 * Pega una página de «Ver más» detrás de lo que ya hay, sin repetir tarjetas.
 *
 * Entre una página y la siguiente la lista puede moverse (alguien crea o avanza un
 * negocio): la página nueva puede traer una tarjeta que ya estaba pintada. Se descarta la
 * repetida en lugar de pintarla dos veces.
 */
export function pegarPagina<T extends ConId>(previas: T[], desde: number, pagina: T[]): T[] {
  const base = previas.slice(0, desde)
  const vistos = new Set(base.map((t) => t.id))
  const nuevas = pagina.filter((t) => {
    if (vistos.has(t.id)) return false
    vistos.add(t.id)
    return true
  })
  return [...base, ...nuevas]
}

/**
 * Reemplaza el comienzo de la lista por tarjetas frescas y conserva el resto.
 *
 * Es lo que se hace al adoptar una vista refrescada (tras asignar o marcar) y cuando llega
 * la relectura de todo lo cargado: la lista no se encoge a la primera página mientras
 * tanto (el scroll no salta) y ninguna tarjeta aparece dos veces.
 */
export function refrescarComienzo<T extends ConId>(previas: T[], frescas: T[]): T[] {
  const ids = new Set(frescas.map((t) => t.id))
  return [...frescas, ...previas.slice(frescas.length).filter((t) => !ids.has(t.id))]
}

/**
 * GET de JSON para la lista. Una lectura: se reintenta UNA vez si fue la red.
 *
 * Sesión vencida o pestaña desincronizada: el middleware redirige la ruta a `/login` (o la
 * contesta con 401 en el dominio base) y el `fetch` sigue el redirect hasta un HTML. Antes
 * eso reventaba en `r.json()` y la persona quedaba con un error sin salida. Ahora se
 * recarga la página completa, para que el flujo de login o de pestaña desincronizada la
 * tome, y la promesa no se resuelve nunca (la página se va).
 */
export async function pedirJson<T>(
  url: string,
  signal: AbortSignal,
  recargar: () => void = () => window.location.reload(),
): Promise<T> {
  return conReintentoDeRed(async () => {
    const r = await fetchPropio(url, { signal, cache: 'no-store' })
    if (r.status === 401 || r.redirected) return irseAlFlujoDeSesion<T>(recargar)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    if (!(r.headers.get('content-type') ?? '').includes('application/json')) {
      return irseAlFlujoDeSesion<T>(recargar)
    }
    return (await r.json()) as T
  })
}

function irseAlFlujoDeSesion<T>(recargar: () => void): Promise<T> {
  recargar()
  return new Promise<T>(() => {})
}
