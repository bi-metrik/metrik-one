/**
 * EL PÁRRAFO VIEJO del texto para el cliente (H4 de la verificación D, criterio D5 de Vera; diseño
 * de Noor, Paso 3): cuando un servicio sale de la cotización, el párrafo que lo nombra se marca, y
 * se ofrece «Actualizar con ONE» para ese párrafo, no para todo el texto.
 *
 * Cómo se sabe qué párrafo: la forma por pasos guarda con el texto los NOMBRES de los servicios con
 * que se escribió (`fuente_nombres`, junto a la huella de siempre). Un nombre que ya no está en el
 * viaje deja viejo al párrafo que lo menciona. Se compara por las palabras PROPIAS del nombre que
 * salió (las que ningún servicio que sigue usa): quitar «SATENA» marca el párrafo que dice
 * «SATENA», no el que dice «Providencia», que sigue en el viaje con su hotel.
 *
 * Puro: lo usan el panel del servidor y sus pruebas.
 */

import type { DocumentoCliente, ViajeParaRedactar } from './documento-cliente'

/** Las zonas del texto que se marcan y se actualizan por párrafo. «Incluye» lo arma ONE: nunca queda viejo. */
export type ZonaDeParrafo = 'titular' | 'intro' | 'antes'

export interface ParrafoViejo {
  zona: ZonaDeParrafo
  /** En «Antes de viajar», el renglón. `null` en titular y presentación. */
  indice: number | null
  /** Los servicios que nombra y ya no van. */
  nombres: string[]
}

const VACIAS = new Set([
  'para', 'con', 'del', 'las', 'los', 'una', 'uno', 'por', 'que', 'sus', 'hotel', 'vuelo', 'vuelos', 'tour', 'traslado', 'traslados',
  'aeropuerto', 'habitacion', 'habitaciones', 'doble', 'dobles', 'adultos', 'ninos', 'noches', 'noche', 'desde', 'hasta', 'hacia',
  'ida', 'regreso', 'clase', 'tarifa', 'economica', 'plan', 'todo', 'incluido', 'actividad', 'actividades',
])

function palabras(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 4 && !VACIAS.has(w) && !/^\d+$/.test(w))
}

/** Lo que el texto puede nombrar de cada servicio: hotel, aerolínea, actividad, traslado, otro. */
export function nombresDelViaje(v: ViajeParaRedactar): string[] {
  const sinFecha = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const nombres = [
    ...v.hoteles.map(h => h.nombre),
    ...v.vuelos.map(x => x.aerolinea),
    ...v.actividades.map(sinFecha),
    ...v.traslados.map(sinFecha),
    ...v.otrosServicios,
  ]
  return [...new Set(nombres.map(n => (n ?? '').trim()).filter(n => n.length > 0))]
}

/** Los párrafos del texto que nombran un servicio que ya no va. Vacío si no se puede saber. */
export function parrafosViejos(doc: DocumentoCliente | null, nombresAhora: readonly string[]): ParrafoViejo[] {
  const antes = doc?.fuente_nombres
  if (!doc || !antes || antes.length === 0) return []
  const clave = (s: string) => palabras(s).join(' ')
  const siguen = new Set(nombresAhora.map(clave))
  const salieron = antes.filter(n => !siguen.has(clave(n)))
  if (salieron.length === 0) return []
  const deLosQueSiguen = new Set(nombresAhora.flatMap(palabras))
  const propias = salieron
    .map(n => ({ nombre: n, palabras: palabras(n).filter(w => !deLosQueSiguen.has(w)) }))
    .filter(x => x.palabras.length > 0)
  if (propias.length === 0) return []
  const nombra = (texto: string | null | undefined): string[] => {
    if (!texto) return []
    const enTexto = new Set(palabras(texto))
    return propias.filter(x => x.palabras.some(w => enTexto.has(w))).map(x => x.nombre)
  }
  const out: ParrafoViejo[] = []
  const t = nombra(doc.titular)
  if (t.length > 0) out.push({ zona: 'titular', indice: null, nombres: t })
  const i = nombra(doc.intro)
  if (i.length > 0) out.push({ zona: 'intro', indice: null, nombres: i })
  doc.antes_de_viajar.forEach((r, indice) => {
    const n = nombra(r)
    if (n.length > 0) out.push({ zona: 'antes', indice, nombres: n })
  })
  return out
}

/** «Habla de SATENA, que ya no va en la cotización.» */
export function textoDeParrafoViejo(p: ParrafoViejo): string {
  const nombres = p.nombres.length === 1 ? p.nombres[0] : `${p.nombres.slice(0, -1).join(', ')} y ${p.nombres[p.nombres.length - 1]}`
  return `Habla de ${nombres}, que ya no ${p.nombres.length === 1 ? 'va' : 'van'} en la cotización.`
}
