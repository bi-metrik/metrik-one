/**
 * Una línea sin costo que entra al total que se va a enviar (decisión de Mauricio del
 * 2026-09-23, caso Providencia).
 *
 * Con «Falta el costo de 1 línea» el botón Enviar seguía activo, y el cliente recibía un
 * precio sin ese servicio: COT-2026-0011 sumaba Avianca + Satena + $0 del vuelo a
 * Providencia. Ahora:
 *
 *  · Si la línea sin costo NI precio entra al total que sale —sin tarifas, la combinación que
 *    suma hoy; con tarifas, las marcadas para la propuesta—, no se envía, y el PDF sale como
 *    borrador incompleto. Esa condición ya la calcula `medirSalida` (`conteo.faltantes`),
 *    sobre la MISMA cascada que mide el margen.
 *  · Si no entra (una opción que ninguna tarifa marcada usa), queda el aviso neutro de siempre.
 *  · Una línea con precio escrito y sin costo NO cuenta: es la forma del recargo fijo.
 *
 * Aquí solo se nombra: «Falta el costo de Vuelo a Providencia · Opción 1: el cliente
 * recibiría un precio sin ese servicio». Puro: lo usan el servidor y el editor.
 */

import { avisoTasaPendiente } from './actividad-pantallazo'
import { esNombreDeOpcion } from './ranuras-cotizacion'
import { etiquetaDeRanura, ranuraDeGrupo, resolverRanura } from './ranuras-pantallazo'
import { composicionDeLinea, leerTarifaPax, type Composicion } from './tarifa-pasajero'

export interface LineaSinCosto {
  id: string
  nombre: string | null
  grupo: string | null
}

/** «Opción 1» y no «OPCIÓN 1»: el nombre de relleno se dice como se lee. */
function nombreDeOpcion(nombre: string | null): string | null {
  const n = (nombre ?? '').trim()
  if (!n) return null
  if (esNombreDeOpcion(n)) return `Opción ${n.replace(/\D+/g, '')}`
  return n
}

/** «Vuelo a Providencia · Opción 1»: el nombre de la ranura (o su etiqueta) y la opción. */
export function nombreDeLineaSinCosto(l: Pick<LineaSinCosto, 'nombre' | 'grupo'>): string {
  const opcion = nombreDeOpcion(l.nombre)
  if (!l.grupo) return opcion ?? 'una línea'
  const ranura = resolverRanura(l.grupo)?.nombre?.trim() || etiquetaDeRanura(l.grupo)
  return opcion ? `${ranura} · ${opcion}` : ranura
}

/**
 * El motivo para no enviar. `null` = no hay líneas sin costo en el total que sale.
 * Con más de dos se nombran las dos primeras y «N más».
 *
 * @param pendientes Por id de línea, POR QUÉ no tiene costo cuando lo que falta es la tasa de
 *   cambio (brief del 2026-10-05): el MISMO texto de la tarjeta («El precio está en EUR:
 *   escribe la tasa de cambio para cargar el costo.»), que se agrega al motivo. Solo lo sabe
 *   el editor (necesita la lectura y los pasajeros del viaje); sin él, el motivo es el de
 *   siempre.
 */
export function motivoFaltaCosto(
  lineas: readonly (Pick<LineaSinCosto, 'nombre' | 'grupo'> & { id?: string })[],
  pendientes?: ReadonlyMap<string, string> | null,
): string | null {
  if (lineas.length === 0) return null
  const nombres = lineas.map(nombreDeLineaSinCosto)
  const lista = nombres.length === 1
    ? nombres[0]
    : nombres.length === 2
      ? `${nombres[0]} y ${nombres[1]}`
      : `${nombres[0]}, ${nombres[1]} y ${nombres.length - 2} más`
  const servicio = nombres.length === 1 ? 'ese servicio' : 'esos servicios'
  const base = `Falta el costo de ${lista}: el cliente recibiría un precio sin ${servicio}.`
  const porTasa = lineas
    .map((l, i) => ({ nombre: nombres[i], texto: l.id ? pendientes?.get(l.id) ?? null : null }))
    .filter((x): x is { nombre: string; texto: string } => !!x.texto)
  if (porTasa.length === 0) return base
  // Una sola línea: el texto de la tarjeta tal cual. Varias: cada uno con su línea.
  if (lineas.length === 1) return `${base} ${porTasa[0]!.texto}`
  return `${base} ${porTasa.map(x => `${x.nombre}: ${x.texto}`).join(' ')}`
}

/**
 * Por línea, por qué no tiene costo cuando lo que falta es la tasa de cambio: el texto de la
 * tarjeta («El precio está en EUR: escribe la tasa de cambio para cargar el costo.»). Lo usan el
 * editor y el servidor (brief del 2026-10-05, punto 12): el rechazo de «Enviar» y la marca del PDF
 * dicen lo mismo que «Revisar y enviar».
 */
export function tasasPendientesPorLinea(
  items: readonly { id: string; grupo?: string | null; es_ajuste?: boolean | null; tarifa_pax?: unknown }[],
  composicionViaje: Composicion | null,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const i of items) {
    if (i.es_ajuste === true || !i.tarifa_pax) continue
    const t = leerTarifaPax(i.tarifa_pax)
    const texto = avisoTasaPendiente(t, composicionDeLinea(t, composicionViaje), ranuraDeGrupo(i.grupo ?? null)?.slug)
    if (texto) out.set(i.id, texto)
  }
  return out
}
