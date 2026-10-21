/**
 * Un traslado leído, en los TRAYECTOS que ve el cliente (propuesta nueva). Puro.
 *
 * La captura de un traslado no siempre es un trayecto. En la COT-2026-0026 real (prueba Europa,
 * 2026-10-14) venían así:
 *   · «Aeropuerto Madrid-Barajas (MAD) T4 -> Hotel en el centro de Madrid y Hotel en el centro de
 *     Madrid -> Estación Madrid Puerta de Atocha», fecha «2026-12-11 y 2026-12-14»;
 *   · «Gare de Lyon \n hotel y hotel \n Gare du Nord», fecha «2026-12-17 y 2026-12-21»;
 *   · «Estación Barcelona Sants - Hotel en Barcelona (ida y vuelta)»;
 *   · «Paris Nord -> Amsterdam Centraal» con vehículo «Tren: Eurostar 9325, Clase / tarifa:
 *     Eurostar Standard» y fecha «2026-12-21/lun 10:25»;
 *   · «Tren AVE 03071 Renfe: Madrid Puerta de Atocha 09:30 → Barcelona Sants 12:15 (Estándar)
 *     (solo ida)», escrito a mano.
 * El documento contaba 4 traslados donde había 8 y dejaba sin día los de dos fechas. Aquí cada
 * uno sale como «Origen - destino · vehículo» (la forma que ya pinta la plantilla), con su fecha y
 * su hora. Lo que no se reconoce sale como antes: un solo trayecto con el texto leído.
 */
import { fechaCorta } from '@/lib/cotizaciones/detalle-viaje'

export interface TrayectoLeido {
  descripcion: string
  /** Fecha corta («11 dic 2026») o `null` si la captura no la dice para este trayecto. */
  fecha: string | null
  hora: string | null
  /** El trayecto de vuelta sin fecha propia: la del de ida, para deducir la suya. */
  fechaIda?: string | null
}

const FLECHA = /\s*(?:->|→|=>|➝)\s*|\s+[-–—]\s+/
const HORA = /\b([01]?\d|2[0-3]):([0-5]\d)\b/

/** «Hotel en el centro de Madrid» → «hotel»: el cliente no necesita la dirección de su hotel aquí. */
function extremo(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (/^(el\s+)?hotel\s+(en|de|del)\b/i.test(t)) return 'hotel'
  return t
}

/** «Tren: Eurostar 9325, Clase / tarifa: Eurostar Standard» → «Eurostar 9325, Eurostar Standard». */
export function vehiculoLegible(vehiculo: string | null | undefined): string | null {
  const t = (vehiculo ?? '')
    .replace(/^\s*tren\s*:\s*/i, '')
    .replace(/\bclase\s*\/\s*tarifa\s*:\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t || null
}

/** Las fechas ISO de un texto leído, en orden, como fecha corta. */
function fechasDe(texto: string | null | undefined): string[] {
  return [...(texto ?? '').matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => fechaCorta(m[1])).filter((f): f is string => f !== null)
}

function horaDe(texto: string | null | undefined): string | null {
  const m = HORA.exec(texto ?? '')
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/** Los pares origen–destino de un trayecto leído. Vacío si no se reconoce. */
function pares(trayecto: string): [string, string][] {
  const limpio = trayecto.replace(/\r/g, '')
  // «A \n hotel y hotel \n B»: el renglón del medio es el final de uno y el comienzo del otro.
  if (limpio.includes('\n')) {
    const partes = limpio.split(/\s*\n\s*/).map((p) => p.trim()).filter(Boolean)
    if (partes.length === 2) return [[partes[0], partes[1]]]
    if (partes.length === 3) {
      const medio = /^(.+?)\s+y\s+(.+)$/i.exec(partes[1])
      if (medio) return [[partes[0], medio[1]], [medio[2], partes[2]]]
      return [[partes[0], partes[1]], [partes[1], partes[2]]]
    }
    return []
  }
  const idaYVuelta = /\(?\s*ida\s+y\s+vuelta\s*\)?/i.test(limpio)
  const sinMarca = limpio.replace(/\(?\s*(ida\s+y\s+vuelta|solo\s+ida)\s*\)?/gi, ' ').trim()
  // «A -> B y B -> C»: dos trayectos.
  const tramos = sinMarca.split(/\s+y\s+/i)
  if (tramos.length > 1 && tramos.every((t) => t.split(FLECHA).length === 2)) {
    return tramos.map((t) => t.split(FLECHA).map((x) => x.trim()) as [string, string])
  }
  const ext = sinMarca.split(FLECHA).map((x) => x.trim()).filter(Boolean)
  if (ext.length !== 2) return []
  const ida: [string, string] = [ext[0], ext[1]]
  return idaYVuelta ? [ida, [ext[1], ext[0]]] : [ida]
}

/**
 * «Tren AVE 03071 Renfe: Madrid Puerta de Atocha 09:30 → Barcelona Sants 12:15 (Estándar) (solo
 * ida)»: el servicio, los extremos, la hora de salida y la clase.
 */
function trenEscrito(trayecto: string): { servicio: string; desde: string; hasta: string; hora: string; clase: string | null } | null {
  const m = /^\s*(?:tren\s+)?([^:]{2,60}):\s*(.+?)\s+(\d{1,2}:\d{2})\s*(?:->|→|=>|-|–)\s*(.+?)\s+\d{1,2}:\d{2}\s*(.*)$/i.exec(trayecto)
  if (!m) return null
  const clase = [...m[5].matchAll(/\(([^)]+)\)/g)].map((x) => x[1].trim()).filter((x) => !/^(solo\s+ida|ida\s+y\s+vuelta)$/i.test(x))
  return { servicio: m[1].trim(), desde: m[2].trim(), hasta: m[4].trim(), hora: horaDe(m[3]) as string, clase: clase[0] ?? null }
}

export function trayectosDeTraslado(lectura: { trayecto: string | null; vehiculo: string | null; fecha: string | null }): TrayectoLeido[] {
  const trayecto = (lectura.trayecto ?? '').trim()
  const vehiculo = vehiculoLegible(lectura.vehiculo)
  const fechas = fechasDe(lectura.fecha)
  const unaFecha = fechas.length === 1
  if (!trayecto) return []

  const tren = trenEscrito(trayecto)
  if (tren) {
    const servicio = [tren.servicio.replace(/^tren\s+/i, ''), tren.clase].filter(Boolean).join(', ')
    return [{ descripcion: `${extremo(tren.desde)} - ${extremo(tren.hasta)} · ${servicio}`, fecha: fechas[0] ?? null, hora: tren.hora }]
  }

  const lista = pares(trayecto)
  if (lista.length === 0) {
    // Sin reconocer: como antes, un trayecto con lo leído.
    const descripcion = [trayecto.replace(/\s*\n\s*/g, ' '), vehiculo].filter(Boolean).join(' · ')
    return [{ descripcion, fecha: fechas[0] ?? null, hora: unaFecha ? horaDe(lectura.fecha) : null }]
  }
  return lista.map(([a, b], i) => {
    const descripcion = [`${extremo(a)} - ${extremo(b)}`, vehiculo].filter(Boolean).join(' · ')
    if (fechas.length >= lista.length) return { descripcion, fecha: fechas[i], hora: lista.length === 1 && unaFecha ? horaDe(lectura.fecha) : null }
    if (i === 0) return { descripcion, fecha: fechas[0] ?? null, hora: unaFecha && lista.length === 1 ? horaDe(lectura.fecha) : null }
    return { descripcion, fecha: null, hora: null, fechaIda: fechas[0] ?? null }
  })
}
