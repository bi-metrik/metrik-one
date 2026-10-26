/**
 * Ruta normalizada para `[rum]`: se agrupa por pantalla, nunca por registro, y nada que
 * identifique a alguien llega al log.
 *
 *  - Sin query string ni hash (pueden traer tokens o filtros con nombres).
 *  - Los segmentos dinamicos que conoce Next (`useParams`) pasan a `[nombre]`:
 *    `/negocios/7f3c…` → `/negocios/[id]`, `/equipo/vendedor/maria-perez` → `/equipo/vendedor/[slug]`.
 *  - Respaldo sin params (el servidor, o una ruta que no es la actual): UUID, numeros y
 *    todo segmento con digitos o de mas de 30 caracteres pasan a `[id]`.
 *
 * SIN dependencias: la usan el navegador y el endpoint.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SEGMENTOS = 8
const MAX_LARGO = 200

export type ParamsDeRuta = Record<string, string | string[] | undefined> | null | undefined

function pareceId(segmento: string): boolean {
  return UUID.test(segmento) || /\d/.test(segmento) || segmento.length > 30
}

function decodificar(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function normalizarRuta(ruta: string, params?: ParamsDeRuta): string {
  const limpia = String(ruta ?? '').split(/[?#]/)[0]
  // Valor del parametro → nombre. Un catch-all (`[...x]`) trae un arreglo: cada pedazo.
  const porValor = new Map<string, string>()
  for (const [nombre, valor] of Object.entries(params ?? {})) {
    for (const v of Array.isArray(valor) ? valor : valor !== undefined ? [valor] : []) {
      if (v) porValor.set(decodificar(v), nombre)
    }
  }
  const segmentos = limpia
    .split('/')
    .filter(Boolean)
    .slice(0, MAX_SEGMENTOS)
    .map((crudo) => {
      const s = decodificar(crudo)
      const nombre = porValor.get(s)
      if (nombre) return `[${nombre}]`
      if (/^\[[A-Za-z_]+\]$/.test(s)) return s
      if (pareceId(s)) return '[id]'
      // Lo que no es un nombre de carpeta razonable (espacios, @, etc.) tampoco viaja.
      return /^[a-z0-9_-]+$/i.test(s) ? s.toLowerCase() : '[id]'
    })
  return `/${segmentos.join('/')}`.slice(0, MAX_LARGO)
}
