/**
 * «INCLUYE» ARMADO POR ONE (cotización por pasos, C6; Noor Paso 3; criterio D6 de Vera).
 *
 * Hasta hoy «Incluido en el plan» lo redactaba el modelo y lo revisaba una persona: era lo que
 * más se desactualizaba (un vuelo que se quitaba seguía escrito). Con la forma por pasos lo arma
 * ONE, SIN IA, con lo que se COBRA en la tarifa que el documento recomienda, al imprimir: así nunca
 * queda viejo.
 *
 * ## La marca va en el dato, no en el interruptor
 *
 * `documento_cliente.incluye_origen = 'one'`. El PDF mira la marca y no el interruptor (nota
 * técnica de Max §2): apagar la forma por pasos no hace volver el texto viejo de la IA, y una
 * cotización sin la marca imprime exactamente lo de siempre. Lo que el documento guarda en
 * `incluye` con la marca son las líneas PROPIAS de la asesora, que se conservan debajo.
 *
 * ## Lo que no toca
 *
 * «A tener en cuenta», los cargos en destino y los Opcionales: un servicio Opcional no se cobra,
 * así que no está aquí. Respeta el nivel de detalle del documento.
 *
 * Puro: lo usan la acción del PDF y la pantalla de Revisar.
 */

import { hotelesDeItems, serviciosDeItems, vuelosDeItems, type ItemConLectura, type NivelDetalle } from './detalle-viaje'
import { idDelPrincipal } from './tarifas'
import { itemsDelItinerario, itemsQueAportanAlTotal, type ItemConGrupo } from './itinerarios'
import { ranuraDeGrupo } from './ranuras-pantallazo'
import { comoNombrePropio } from './ranuras-cotizacion'
import { claveTexto } from './tarifa-pasajero'

/** El valor de la marca. */
export const INCLUYE_POR_ONE = 'one'

/** El tope de renglones de «Incluye» (los de ONE y los propios). */
export const MAX_RENGLONES_INCLUYE = 12

const DINERO = /\$\s?\d|\d[\d.]{3,}\s?(cop|usd|eur)\b|\b(cop|usd|eur)\s?\d/i

const limpio = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

function noches(n: number | null): string | null {
  if (!n || n <= 0) return null
  return n === 1 ? '1 noche' : `${n} noches`
}

/**
 * Los renglones de lo que se cobra, uno por servicio: vuelos, hoteles, traslados, actividades y
 * los demás componentes. Sin cifras. `nivel`: `general` lo dice corto; `muy_detallada` agrega
 * habitación, equipaje y fecha.
 */
export function incluyeDeOne(items: readonly ItemConLectura[], nivel: NivelDetalle): string[] {
  const out: string[] = []
  const detallado = nivel === 'muy_detallada'
  const corto = nivel === 'general'

  for (const v of vuelosDeItems([...items])) {
    const ruta = [v.origen, v.destino].filter(Boolean).join(' – ')
    const regreso = v.fechaRegreso && v.origen ? ` – ${v.origen}` : ''
    const base = ruta ? `Tiquetes aéreos ${ruta}${regreso}` : `Tiquetes aéreos · ${limpio(v.linea)}`
    const con = v.aerolinea ? ` con ${v.aerolinea}` : ''
    const equipaje = !corto && v.equipaje ? `, ${v.equipaje}` : ''
    out.push(`${base}${con}${equipaje}`)
  }
  for (const h of hotelesDeItems([...items])) {
    const cuantas = noches(h.noches)
    const donde = h.hotel ?? limpio(h.linea)
    const ciudad = h.ciudad && !corto ? ` (${h.ciudad})` : ''
    const regimen = !corto && h.regimen ? `, con ${h.regimen.toLowerCase()}` : ''
    const habitacion = detallado && h.habitacion ? ` · ${h.habitacion}` : ''
    out.push(`${cuantas ? `${cuantas} en ` : 'Alojamiento en '}${donde}${ciudad}${regimen}${habitacion}`)
  }
  for (const s of serviciosDeItems([...items])) {
    const fecha = detallado && s.fecha ? ` · ${s.fecha}` : ''
    const que = comoNombrePropio(s.descripcion)
    out.push(s.tipo === 'traslado' ? `Traslado ${que}${fecha}` : `${que}${fecha}`)
  }
  // Lo que no es vuelo, hotel, traslado ni actividad (un seguro, una asistencia médica).
  for (const i of items) {
    const slug = ranuraDeGrupo(i.grupo ?? null)?.slug
    if (slug === 'vuelo_detalle' || slug === 'hotel_detalle' || slug === 'traslado_detalle' || slug === 'actividad_detalle') continue
    const nombre = limpio(i.nombre)
    if (nombre) out.push(comoFrase(nombre))
  }
  return sinRepetidos(out.map(limpio).filter(r => r !== '' && !DINERO.test(r)))
}

/** «ASISTENCIA MÉDICA» → «Asistencia médica»: lo que escribió el equipo en mayúscula, en frase. */
function comoFrase(t: string): string {
  if (t !== t.toLocaleUpperCase('es-CO')) return t
  const bajo = t.toLocaleLowerCase('es-CO')
  return bajo.charAt(0).toLocaleUpperCase('es-CO') + bajo.slice(1)
}

function sinRepetidos(lista: string[]): string[] {
  const vistos = new Set<string>()
  return lista.filter(r => {
    const k = claveTexto(r)
    if (vistos.has(k)) return false
    vistos.add(k)
    return true
  })
}

/** Lo que imprime «Incluye» con la marca: lo de ONE y, debajo, las líneas propias de la asesora. */
export function incluyeConPropias(deOne: readonly string[], propias: readonly string[]): string[] {
  return sinRepetidos([...deOne, ...propias]).slice(0, MAX_RENGLONES_INCLUYE)
}

/** Las líneas propias: lo que escribió la persona que no es ya un renglón de ONE. */
export function lineasPropias(escritas: readonly string[], deOne: readonly string[]): string[] {
  const deOneClaves = new Set(deOne.map(claveTexto))
  return sinRepetidos(escritas.map(limpio).filter(r => r !== '' && !deOneClaves.has(claveTexto(r))))
}

/** Una línea de la cotización, en lo que hace falta para saber si se cobra en la principal. */
export type LineaQueSeCobra = ItemConGrupo & ItemConLectura

/**
 * Lo que se COBRA en la tarifa que el documento recomienda: con tarifas, las líneas de la
 * principal; sin ellas, las que aportan al total. Un servicio Opcional o que no va, no.
 */
export function lineasQueSeCobran<T extends LineaQueSeCobra>(
  lineas: readonly T[],
  tarifas: readonly { id: string; nombre: string; orden: number; vaEnPropuesta: boolean; seleccion: string[] }[],
): T[] {
  const vivas = lineas.filter(l => l.es_ajuste !== true)
  const principal = idDelPrincipal(tarifas.map(t => ({ id: t.id, nombre: t.nombre, orden: t.orden, vaEnPropuesta: t.vaEnPropuesta })))
  const ids = principal
    ? new Set(itemsDelItinerario([...vivas], tarifas.find(t => t.id === principal)?.seleccion ?? []))
    : new Set(itemsQueAportanAlTotal([...vivas]))
  return vivas.filter(l => ids.has(l.id) && l.entra_al_precio !== false)
}
