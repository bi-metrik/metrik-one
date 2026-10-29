/**
 * Las fechas del viaje QUE SE COTIZÓ, no las del rango que dio el cliente en la solicitud.
 *
 * COT-2026-0008 (Trappvel, 2026-10-29): la solicitud decía 21 jun – 4 jul 2027 y Alejandra
 * cotizó del 26 al 30 (vuelo de ida el 26, regreso el 30). Los hoteles no traían fechas en la
 * captura, la lectura les puso las de la solicitud («(del viaje)», 7.4) y el documento decía
 * «14 días · 13 noches» en la portada y en cada hotel, y el día a día abría el 21.
 *
 * La regla: con servicios fechados, el viaje va de la primera a la última fecha de los
 * servicios (vuelos y hoteles con fechas LEÍDAS). El rango de la solicitud solo se usa si no
 * hay ninguno. Un hotel con las fechas de la solicitud toma la llegada del vuelo de ida y la
 * salida del regreso, y sus noches se cuentan con esas fechas.
 *
 * ⚠️ Solo cambia lo que se DESCRIBE. El costo del hotel es el que se cargó: ni se prorratea
 * ni se recalcula.
 */
import type { HotelPDF, ItemConLectura, VueloPDF } from './detalle-viaje'
import { fechaCorta, hotelesDeItems, vuelosDeItems } from './detalle-viaje'
import { hotelesDePaquetes, vuelosDePaquetes } from './bloqueo-documento'
import { conAnio, filasDelVuelo, leerFecha } from '@/lib/pdf/cotizacion-trappvel-formato'

export interface RangoDelViaje {
  inicio: string | null
  fin: string | null
  /** La llegada del vuelo de ida y la salida del regreso (ISO), para los hoteles sin fechas. */
  estadia: { entrada: string; salida: string } | null
  /** `servicios` = salió de los vuelos u hoteles; `solicitud` = el rango que dio el cliente. */
  fuente: 'servicios' | 'solicitud'
}

function aIso(texto: string | null | undefined, anclaAnio: string | null): string | null {
  const f = conAnio(leerFecha(texto), anclaAnio)
  if (!f || f.anio === null) return null
  return `${f.anio}-${String(f.mes + 1).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`
}

function masUnDia(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10)
}

const HHMM = /^\s*(\d{1,2}):(\d{2})\s*$/
/** Sale y llega con hora, y llega «antes» de salir: el vuelo llega al día siguiente. */
function llegaAlOtroDia(salida: string | null, llegada: string | null): boolean {
  const a = HHMM.exec(salida ?? '')
  const b = HHMM.exec(llegada ?? '')
  if (!a || !b) return false
  return Number(b[1]) * 60 + Number(b[2]) < Number(a[1]) * 60 + Number(a[2])
}

/**
 * El rango del viaje cotizado. `solicitud` es el rango del bloque «Condiciones del viaje»;
 * también da el año a las fechas que se leyeron sin él.
 */
export function rangoDelViajeCotizado(
  servicios: { vuelos: VueloPDF[]; hoteles: HotelPDF[] },
  solicitud: { inicio: string | null; fin: string | null },
): RangoDelViaje {
  const ancla = solicitud.inicio
  const fechas: string[] = []
  let llegada: string | null = null
  let regreso: string | null = null
  for (const v of servicios.vuelos) {
    const filas = filasDelVuelo(v)
    filas.forEach((f, k) => {
      const dia = aIso(f.fecha, ancla)
      if (!dia) return
      fechas.push(dia)
      if (k === 0) {
        const llega = llegaAlOtroDia(f.salida, f.llegada) ? masUnDia(dia) : dia
        if (llegada === null || llega < llegada) llegada = llega
      } else if (regreso === null || dia > regreso) {
        regreso = dia
      }
    })
  }
  for (const h of servicios.hoteles) {
    if (h.fechasDelViaje) continue
    for (const f of [h.checkIn, h.checkOut]) {
      const dia = aIso(f, ancla)
      if (dia) fechas.push(dia)
    }
  }
  if (fechas.length === 0) return { inicio: solicitud.inicio, fin: solicitud.fin, estadia: null, fuente: 'solicitud' }
  fechas.sort()
  const inicio = fechas[0]
  const ultima = fechas[fechas.length - 1]
  // Con un solo servicio fechado (solo la ida), el fin es el de la solicitud si no queda antes.
  const fin = ultima > inicio ? ultima : solicitud.fin && solicitud.fin >= inicio ? solicitud.fin : null
  const estadia = llegada && regreso && regreso > llegada ? { entrada: llegada, salida: regreso } : null
  return { inicio, fin, estadia, fuente: 'servicios' }
}

/**
 * Los hoteles con las fechas de la solicitud pasan a las del vuelo (llegada de la ida, salida
 * del regreso) y cuentan sus noches con ellas. Sin vuelo de ida y regreso no cambian.
 */
export function hotelesConFechasDelViaje<T extends HotelPDF>(hoteles: T[], rango: RangoDelViaje): T[] {
  const e = rango.estadia
  if (!e) return hoteles
  const noches = Math.round((Date.parse(`${e.salida}T00:00:00Z`) - Date.parse(`${e.entrada}T00:00:00Z`)) / 86_400_000)
  return hoteles.map(h =>
    h.fechasDelViaje ? { ...h, checkIn: fechaCorta(e.entrada), checkOut: fechaCorta(e.salida), noches } : h,
  )
}

/**
 * El rango del viaje cotizado leído directo de las líneas que el documento describe: los vuelos y
 * hoteles de las casillas y los de los paquetes en bloqueo, igual que el PDF.
 *
 * Lo usa la pantalla (Revisar y enviar) para que «Así puedes pagar» cuente desde el mismo día del
 * viaje que el documento (segunda vuelta de la COT-2026-0008, punto 2): la pantalla no arma el
 * documento y antes contaba desde el inicio de la solicitud.
 */
export function rangoDeLasLineas(
  lineas: readonly ItemConLectura[],
  solicitud: { inicio: string | null; fin: string | null },
): RangoDelViaje {
  const xs = [...lineas]
  return rangoDelViajeCotizado(
    {
      vuelos: [...vuelosDeItems(xs), ...vuelosDePaquetes(xs)],
      hoteles: [...hotelesDeItems(xs), ...hotelesDePaquetes(xs, solicitud)],
    },
    solicitud,
  )
}
