/**
 * De la tarifa aceptada a las filas de servicio del viaje (F0, plan post-cotización).
 *
 * Cada ítem que la tarifa aceptada cobra se vuelve UNA fila de `negocio_servicios`: es lo que
 * la empresa le compra a un proveedor para cumplir la venta. Módulo puro: quien llama lee la
 * cotización (`contextoDeCotizacion`) y escribe; aquí solo se decide qué filas salen.
 *
 * Qué entra (criterio F0-1 de Vera):
 *  · los ítems del itinerario de la tarifa aceptada (`itemsDelItinerario`), o los que aportan
 *    al total si la cotización no tiene tarifas: los mismos que suma el precio;
 *  · NO entran los de fuera del precio (sugerencias que el cliente no compró) ni el ítem de
 *    ajuste (cuadre de precio, no un servicio);
 *  · un ítem sin ranura ni grupo NO se descarta: sale con tipo «otro».
 *
 * El costo de cada fila es el costo directo de su línea con la MISMA aritmética de la cascada
 * (`calcularCascada` sobre esa sola línea), y la diferencia de redondeo contra el costo
 * directo de la tarifa se le suma a la fila más cara. Así Σ costo_cotizado = costo directo de
 * la tarifa al peso (F0-2), que es el número contra el que se mide el margen.
 */

import { calcularCascada, type ParametrosCascada } from '@/lib/cotizaciones/totales'
import { itemsDelItinerario, itemsQueAportanAlTotal, normalizarGrupo } from '@/lib/cotizaciones/itinerarios'
import { etiquetaDeRanura, ranuraDeGrupo } from '@/lib/cotizaciones/ranuras-pantallazo'
import { esTipoRanura, tipoDeDefinicion } from '@/lib/cotizaciones/ranuras-cotizacion'
import { lineaConAsistenciaMedica } from '@/lib/cotizaciones/asistencia-medica'
import { lecturaDeOpcion } from '@/lib/cotizaciones/habitaciones'
import { leerTarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import type { ItemDeCotizacion } from '@/lib/cotizaciones/itinerarios-datos'
import { leerTramos as leerTramosDelItem, regresoEsLaLlegadaDeLaIda } from '@/lib/cotizaciones/tramos-vuelo'
import {
  SIN_FECHAS,
  esFechaIso,
  fechaPorDiaDelViaje,
  fechasDeTramos,
  horaHHMM,
  type FechasServicio,
  type TramoServicio,
} from './fechas-servicio'

export const TIPOS_SERVICIO = ['vuelo', 'hotel', 'traslado', 'actividad', 'asistencia', 'otro'] as const
export type TipoServicio = (typeof TIPOS_SERVICIO)[number]

/** Lo que se inserta en `negocio_servicios` (sin las llaves del negocio). */
export interface FilaServicioNueva {
  item_id: string
  tipo: TipoServicio
  nombre: string
  proveedor_nombre: string | null
  fecha_servicio: string | null
  fecha_fin: string | null
  hora_inicio: string | null
  hora_fin: string | null
  tramos: TramoServicio[] | null
  costo_cotizado: number
  orden: number
}

/**
 * Lo mínimo del ítem que hace falta aquí: lo trae `contextoDeCotizacion`, más `items.tramos`, que
 * `generarServiciosDesdeTarifa` lee aparte (`null` = sin tramos guardados: manda la lectura).
 */
export type ItemParaServicio = Pick<
  ItemDeCotizacion,
  | 'id' | 'nombre' | 'grupo' | 'opcion_de' | 'es_ajuste' | 'orden' | 'dia_relativo' | 'entra_al_precio'
  | 'cantidad' | 'subtotal' | 'numeroDeRubros' | 'costoDeRubros' | 'descuento_porcentaje'
  | 'margen_porcentaje' | 'precio_venta' | 'precio_manual' | 'adicionales' | 'pasajeros' | 'tarifa_pax'
> & { tramos?: unknown }

/** Lo del ítem de lo que salen las fechas: la lectura y, en un vuelo, `items.tramos`. */
type FuenteDeFechas = Pick<ItemParaServicio, 'tarifa_pax'> & { tramos?: unknown }

const MAX_NOMBRE = 200

/**
 * El tipo del servicio. Manda la ranura del ítem (`items.ranura_id` → `cotizacion_ranuras.tipo`);
 * si no la tiene, el tipo de su grupo; si tampoco, «asistencia» cuando el texto lo dice y si no
 * «otro». Nunca se descarta un ítem por no saber qué es.
 *
 * «Otro servicio» (la ranura «otro» de la cotización por pasos) ya dijo qué es: es «asistencia»
 * solo si su lectura trae la MARCA de asistencia médica (`asistencia-medica.ts`), y si no, «otro»
 * —un «Seguro de viaje» no se adivina por el texto—.
 */
export function tipoDeServicio(
  item: Pick<ItemParaServicio, 'grupo' | 'nombre'> & { tarifa_pax?: unknown },
  tipoRanura?: string | null,
): TipoServicio {
  const porGrupo = tipoDeDefinicion(ranuraDeGrupo(item.grupo))
  const tipo = esTipoRanura(tipoRanura) ? tipoRanura : porGrupo
  if (tipo === 'otro') return lineaConAsistenciaMedica(item) ? 'asistencia' : 'otro'
  // Un paquete de bloqueo (hotel + vuelo del operador, un valor) se opera como un servicio del operador.
  if (tipo === 'paquete') return 'otro'
  if (tipo) return tipo
  const texto = `${normalizarGrupo(item.grupo) ?? ''} ${item.nombre ?? ''}`.toLowerCase()
  if (/\b(asistencia|seguro)\b/.test(texto)) return 'asistencia'
  return 'otro'
}

function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/** `AAAA-MM-DD` si el texto empieza por una fecha ISO válida; si no, `null` (no se adivina). */
export function fechaIso(v: unknown): string | null {
  const t = texto(v)
  const m = t ? /^(\d{4})-(\d{2})-(\d{2})/.exec(t) : null
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

type Lectura = NonNullable<ReturnType<typeof lecturaDeOpcion>>

function leer(item: { tarifa_pax?: unknown }): Lectura | null {
  if (item.tarifa_pax === null || item.tarifa_pax === undefined) return null
  try {
    return lecturaDeOpcion(leerTarifaPax(item.tarifa_pax))
  } catch {
    return null
  }
}

/** Un campo leído por su etiqueta. Lo que vino del viaje («… (del viaje)») no es lectura: no cuenta. */
function campoLeido(lectura: Lectura, etiqueta: string): string | null {
  const v = texto(lectura.campos?.find(c => c.label.trim().toLowerCase() === etiqueta.toLowerCase())?.valor)
  return v && !/\(del viaje\)$/.test(v) ? v : null
}

/**
 * Proveedor y fecha leídos del pantallazo de la línea, si los hay. Lo leído PROPONE: la fila
 * dice «Falta el proveedor» cuando no se leyó, y quien reserva lo escribe.
 */
export function lecturaDelServicio(item: FuenteDeFechas, tipo: TipoServicio): {
  proveedor: string | null
  fecha: string | null
} {
  const lectura = leer(item)
  const fecha = fechasLeidas(lectura, tipo, item.tramos).fecha_servicio
  if (!lectura) return { proveedor: null, fecha }
  const id = lectura.identidad ?? {}
  const proveedor =
    tipo === 'hotel' ? texto(id.hotel)
      : tipo === 'vuelo' ? aerolineaLeida(lectura)
        : campoLeido(lectura, 'proveedor')
  return { proveedor: proveedor ? proveedor.slice(0, MAX_NOMBRE) : null, fecha }
}

/** Los textos de un tramo con el tope de la columna. */
function recortar(t: TramoServicio): TramoServicio {
  return {
    ...t,
    origen: t.origen?.slice(0, 100) ?? null,
    destino: t.destino?.slice(0, 100) ?? null,
    aerolinea: t.aerolinea?.slice(0, 100) ?? null,
    numero_vuelo: t.numero_vuelo?.slice(0, 100) ?? null,
  }
}

/**
 * Los tramos de un vuelo leído: la ida (`fecha_salida`) y, si hay, el regreso (`fecha_regreso`),
 * con sus horas, la ruta, la aerolínea y el número. Sin fecha de ida no hay tramos (no se arma un
 * vuelo que empieza en el regreso). Un regreso anterior a la ida es una lectura rota: se queda la ida.
 *
 * Es el camino de un ítem SIN `items.tramos` (`tramosDelItemGuardados`): la lectura trae el número
 * en un solo campo y aquí no se parte.
 */
function tramosLeidos(lectura: Lectura): TramoServicio[] {
  const id = lectura.identidad ?? {}
  const ida = fechaIso(id.fecha_salida)
  if (!ida) return []
  const origen = texto(id.origen)
  const destino = texto(id.destino)
  const aerolinea = aerolineaLeida(lectura)
  const tramos: TramoServicio[] = [{
    fecha: ida,
    hora_salida: horaHHMM(campoLeido(lectura, 'Hora de salida (ida)')),
    hora_llegada: horaHHMM(campoLeido(lectura, 'Hora de llegada (ida)')),
    origen,
    destino,
    aerolinea,
    // Tal como se lee («AV8520 / AV8521»): repartirlo entre tramos sería adivinar.
    numero_vuelo: campoLeido(lectura, 'Nº de vuelo'),
  }]
  const regreso = fechaIso(id.fecha_regreso)
  const salidaRegreso = horaHHMM(campoLeido(lectura, 'Hora de salida (regreso)'))
  const llegadaRegreso = horaHHMM(campoLeido(lectura, 'Hora de llegada (regreso)'))
  // M9-3: la llegada al día siguiente de un vuelo nocturno no es un regreso.
  const fantasma = regresoEsLaLlegadaDeLaIda(
    { fecha: ida, salida: tramos[0].hora_salida, llegada: tramos[0].hora_llegada },
    { fecha: regreso, salida: salidaRegreso, llegada: llegadaRegreso },
  )
  if (regreso && regreso >= ida && !fantasma) {
    tramos.push({
      fecha: regreso,
      hora_salida: salidaRegreso,
      hora_llegada: llegadaRegreso,
      origen: destino,
      destino: origen,
      aerolinea,
      numero_vuelo: null,
    })
  }
  return tramos.map(recortar)
}

function aerolineaLeida(lectura: Lectura | null): string | null {
  if (!lectura) return null
  return texto(lectura.identidad?.aerolinea) ?? campoLeido(lectura, 'aerolínea')
}

/**
 * Los tramos de un vuelo desde `items.tramos` (brief del 2026-10-22): cada tramo con SU fecha,
 * sus horas, su ruta y su número. La columna ya trae el número repartido entre ida y regreso con
 * la regla del documento (`numerosDeVuelo`, `tramos-vuelo.ts`): aquí no se reparte nada, se copia.
 * La aerolínea sale de la lectura, como en el otro camino.
 *
 * `null` = el ítem no tiene `items.tramos` utilizables (o ningún tramo trae fecha ISO): quien llama
 * cae a la lectura. Las mismas reglas que la lectura: sin fecha de la ida no hay tramos, un tramo
 * sin fecha se omite y un regreso anterior a la ida se cae. `leerTramos` ya garantiza la ida
 * primero.
 *
 * ⚠️ Si NINGÚN tramo guardado trae su número (la columna no pudo repartirlos), la ida conserva el
 * número completo de la lectura, como hoy: es lo mismo que hace `tramosDelItem` con
 * `numerosSinTramo`, y perderlo dejaría al vuelo sin ningún número.
 */
function tramosDelItemGuardados(raw: unknown, lectura: Lectura | null): TramoServicio[] | null {
  const guardados = leerTramosDelItem(raw)
  if (!guardados) return null
  const ida = guardados[0]
  const fechaIda = fechaIso(ida.fecha)
  if (!fechaIda) return null
  const aerolinea = aerolineaLeida(lectura)
  const sinNumeros = guardados.every(t => !texto(t.numero))
  const tramos: TramoServicio[] = []
  for (const t of guardados) {
    const fecha = fechaIso(t.fecha)
    if (!fecha || fecha < fechaIda) continue
    tramos.push({
      fecha,
      hora_salida: horaHHMM(t.salida),
      hora_llegada: horaHHMM(t.llegada),
      origen: texto(t.origen),
      destino: texto(t.destino),
      aerolinea,
      numero_vuelo: texto(t.numero) ?? (t === ida && sinNumeros && lectura ? campoLeido(lectura, 'Nº de vuelo') : null),
    })
  }
  return tramos.map(recortar)
}

/** La hora de un `fecha_hora` que la trae («2026-11-10T14:30», «2026-11-10 14:30»). */
function horaDeFechaHora(v: unknown): string | null {
  const t = texto(v)
  const m = t ? /^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/.exec(t) : null
  return m ? horaHHMM(m[1]) : null
}

function fechasLeidas(lectura: Lectura | null, tipo: TipoServicio, tramosDelItem?: unknown): FechasServicio {
  if (tipo === 'vuelo') {
    const tramos = tramosDelItemGuardados(tramosDelItem, lectura) ?? (lectura ? tramosLeidos(lectura) : [])
    return tramos.length > 0 ? fechasDeTramos(tramos) : SIN_FECHAS
  }
  if (!lectura) return SIN_FECHAS
  const id = lectura.identidad ?? {}
  switch (tipo) {
    case 'hotel': {
      const entra = fechaIso(id.check_in)
      const sale = fechaIso(id.check_out)
      return { ...SIN_FECHAS, fecha_servicio: entra, fecha_fin: entra && sale && sale >= entra ? sale : null }
    }
    case 'actividad':
      return { ...SIN_FECHAS, fecha_servicio: fechaIso(id.fecha) }
    case 'traslado': {
      const fecha = fechaIso(id.fecha_hora)
      return { ...SIN_FECHAS, fecha_servicio: fecha, hora_inicio: fecha ? horaDeFechaHora(id.fecha_hora) : null }
    }
    default:
      return SIN_FECHAS
  }
}

/**
 * Las fechas de la fila: las leídas del pantallazo y, en una actividad o un traslado sin fecha
 * leída, el día del viaje (`items.dia_relativo = N` → salida + (N − 1)). Sin salida o sin día,
 * vacías: «Falta la fecha».
 */
export function fechasDelServicio(
  item: FuenteDeFechas & Pick<ItemParaServicio, 'dia_relativo'>,
  tipo: TipoServicio,
  salidaViaje: string | null | undefined,
): FechasServicio {
  const leidas = fechasLeidas(leer(item), tipo, item.tramos)
  if (leidas.fecha_servicio || (tipo !== 'actividad' && tipo !== 'traslado')) return leidas
  const porDia = fechaPorDiaDelViaje(esFechaIso(salidaViaje) ? salidaViaje : null, item.dia_relativo)
  return porDia ? { ...leidas, fecha_servicio: porDia } : leidas
}

function nombreDelServicio(item: Pick<ItemParaServicio, 'nombre' | 'grupo'>): string {
  const propio = texto(item.nombre)
  const nombre = propio ?? (normalizarGrupo(item.grupo) ? etiquetaDeRanura(item.grupo) : 'Servicio')
  return nombre.slice(0, MAX_NOMBRE)
}

/**
 * Las filas de servicio de una tarifa.
 *
 * @param seleccion la selección de la tarifa aceptada (`cotizacion_itinerarios.seleccion`);
 *   `null` si la cotización no tiene tarifas (entonces cuenta lo que aporta al total).
 * @param tipoRanuraPorItem el tipo de la ranura de cada ítem, por id (de `items.ranura_id`).
 */
export function filasDeServicioDeTarifa(args: {
  items: ItemParaServicio[]
  seleccion: string[] | null
  params: ParametrosCascada
  tipoRanuraPorItem?: Record<string, string | null | undefined>
  /** Salida del viaje (`negocio_bloques.data.fecha_salida`): el día N de una actividad sin fecha. */
  salidaViaje?: string | null
}): FilaServicioNueva[] {
  const { items, seleccion, params } = args
  const ids = seleccion ? itemsDelItinerario(items, seleccion) : itemsQueAportanAlTotal(items)
  const porId = new Map(items.map(i => [i.id, i]))
  // El ajuste y lo de fuera del precio ya los saca `itemsDelItinerario` (`compitePorElTotal`):
  // repetir el filtro aquí sería una línea que ninguna prueba puede ver fallar.
  const incluidos = ids
    .map(id => porId.get(id))
    .filter((i): i is ItemParaServicio => !!i)

  const filas: FilaServicioNueva[] = incluidos.map((item, orden) => {
    const tipo = tipoDeServicio(item, args.tipoRanuraPorItem?.[item.id])
    const { proveedor } = lecturaDelServicio(item, tipo)
    const fechas = fechasDelServicio(item, tipo, args.salidaViaje)
    return {
      item_id: item.id,
      tipo,
      nombre: nombreDelServicio(item),
      proveedor_nombre: proveedor,
      ...fechas,
      costo_cotizado: Math.max(0, calcularCascada([item], params).costoDirecto),
      orden,
    }
  })

  // Cuadre al peso contra el costo directo de la tarifa: el redondeo de cada línea no puede
  // dejar la suma de las filas distinta del número con que se midió el margen.
  const total = Math.max(0, calcularCascada(incluidos, params).costoDirecto)
  const suma = filas.reduce((s, f) => s + f.costo_cotizado, 0)
  const residuo = total - suma
  if (residuo !== 0 && filas.length > 0) {
    const mayor = filas.reduce((a, f) => (f.costo_cotizado > a.costo_cotizado ? f : a), filas[0])
    mayor.costo_cotizado = Math.max(0, mayor.costo_cotizado + residuo)
  }
  return filas
}
