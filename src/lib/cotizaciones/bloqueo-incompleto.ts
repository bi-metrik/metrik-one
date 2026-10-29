/**
 * PAQUETE INCOMPLETO frena «Enviar» (QA estricto del bloqueo de Trappvel, 2026-10-29).
 *
 * Un paquete de bloqueo cuenta como incompleto si tiene costo 0, un infante sin costo, un niño fuera
 * del rango CHD del operador o una acomodación sin precio (`faltasDelPaquete`). Mientras haya uno en lo
 * que va al cliente, no se envía y la lista de «Revisar» lo dice con su «Ir».
 *
 * Por qué hace falta aparte de «falta el costo» (`falta-costo.ts`): el paquete es una ranura con
 * ALTERNATIVAS (cada opción es un paquete). Sin tarifas marcadas, la cascada no suma ninguna opción
 * con alternativas y la línea en cero no aparecía entre las que faltan: la COT-2026-0007 (tres paquetes
 * sin costo) frenaba como «margen bajo el mínimo». Aquí se miran los paquetes que se ofrecen: con
 * tarifas marcadas, los de esas tarifas; sin tarifas, todos.
 *
 * Puro: lo usan `enviarPorPasos` (el control) y el editor (la puerta visible y la lista única).
 */

import { FALTA_EL_COSTO, faltasDelPaquete, leerPaqueteBloqueo, type FaltaDelPaquete } from './bloqueo-paquete'
import { ranuraDeGrupo } from './ranuras-pantallazo'
import { leerTarifaPax, type Composicion } from './tarifa-pasajero'

export interface LineaParaPaquete {
  id: string
  nombre?: string | null
  grupo?: string | null
  es_ajuste?: boolean | null
  tarifa_pax?: unknown
}

export interface PaqueteIncompleto {
  itemId: string
  /** «Hotel Las Américas» o «Paquete 2» (sin MAYÚSCULAS). */
  nombre: string
  faltas: FaltaDelPaquete[]
}

export const esLineaDePaquete = (l: Pick<LineaParaPaquete, 'grupo' | 'es_ajuste'>): boolean =>
  l.es_ajuste !== true && ranuraDeGrupo(l.grupo ?? null)?.slug === 'paquete_detalle'

/**
 * Los paquetes que se ofrecen y les falta algo, en el orden de las líneas.
 *
 * @param idsQueSalen Con tarifas marcadas para la propuesta, las líneas que entran en ellas. `null` =
 *   sin tarifas: todos los paquetes se ofrecen.
 */
export function paquetesIncompletos(
  lineas: readonly LineaParaPaquete[],
  idsQueSalen: ReadonlySet<string> | null,
  composicionViaje: Composicion | null,
): PaqueteIncompleto[] {
  const paquetes = lineas.filter(esLineaDePaquete)
  const ofrecidos = idsQueSalen ? paquetes.filter(l => idsQueSalen.has(l.id)) : paquetes
  const out: PaqueteIncompleto[] = []
  ofrecidos.forEach(l => {
    const paquete = leerPaqueteBloqueo(leerTarifaPax(l.tarifa_pax ?? null).bloqueo)
    const faltas = faltasDelPaquete(paquete, composicionViaje)
    if (faltas.length === 0) return
    const n = paquetes.indexOf(l) + 1
    out.push({ itemId: l.id, nombre: paquete?.hotel.hotel?.trim() || `Paquete ${n}`, faltas })
  })
  return out
}

/**
 * El motivo con que el servidor rechaza «Enviar» y el botón se apaga. `null` = ningún paquete
 * incompleto. Con el costo en cero el texto empieza por «Falta el costo del paquete».
 */
export function motivoPaquetesIncompletos(incompletos: readonly PaqueteIncompleto[]): string | null {
  if (incompletos.length === 0) return null
  const [primero] = incompletos
  const falta = primero.faltas[0]
  const mas = incompletos.length > 1 ? ` y ${incompletos.length - 1} ${incompletos.length === 2 ? 'paquete más' : 'paquetes más'}` : ''
  if (falta.clave === 'falta_costo') {
    // «Falta el costo del paquete «Paquete 1» y 2 paquetes más. Pon cuántas habitaciones…»
    const detalle = falta.texto.slice(FALTA_EL_COSTO.length).trim()
    return `Falta el costo del paquete «${primero.nombre}»${mas}.${detalle ? ` ${detalle}` : ''}`
  }
  return `Paquete «${primero.nombre}» incompleto${mas}: ${falta.texto}`
}
