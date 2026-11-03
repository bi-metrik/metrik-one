/**
 * EL PEGADO ARMA LOS PAQUETES SOLO (SAN ANDRÉS, Trappvel, 2026-11-03).
 *
 * En un viaje en Bloqueo, lo que se pega en la bandeja principal de la cotización arma los paquetes:
 *
 *  · Un PAQUETE = UN vuelo + VARIAS opciones de hotel. En la cotización, el paquete es la ranura
 *    «Paquete de bloqueo» y cada hotel es una OPCIÓN de esa ranura (su propia línea, su propia tarifa),
 *    que lleva copia del vuelo del paquete. Sin migración: todo vive en `items.tarifa_pax.bloqueo`.
 *  · El paquete VIGENTE es el último que se abrió (la ranura de número más alto).
 *  · Vuelo: sin paquetes, abre el 1. Si el vigente no tiene vuelo, se lo pone a todas sus opciones. El
 *    mismo vuelo otra vez no hace nada. Un vuelo DISTINTO abre un paquete nuevo, y los hoteles que vengan
 *    después van a ese.
 *  · Hotel: llena la opción del vigente que todavía no tiene hotel; si no hay, es una opción nueva del
 *    vigente con su vuelo. Sin paquetes, abre el 1 sin vuelo.
 *  · Acomodación automática, como fuera del paquete: las habitaciones salen de la composición del viaje
 *    (3 adultos → 1 Triple) entre las acomodaciones con precio de la tabla; los niños con la tarifa CHD y
 *    sus edades de la Solicitud; los infantes. Costo = precio por persona × personas (`costoDelPaquete`).
 *    Lo que no se puede deducir queda vacío y lo dice la tarjeta: no se pregunta en una lista.
 *  · «Tarifa del operador: Pública / Neta» (Mauricio, 2026-11-03): una opción NUEVA hereda la de sus
 *    hermanas del paquete (con su comisión); un paquete nuevo, la del último paquete. Sin ninguna
 *    decidida, el default de siempre (Neta). Con Pública el total por personas es el precio al cliente.
 *
 * Puro: sin red y sin base. La escritura es de `pegarEnBloqueo` (`bloqueo-actions.ts`).
 */

import {
  ACOMODACIONES,
  PERSONAS_POR_HABITACION,
  paqueteVacio,
  type Acomodacion,
  type DistribucionBloqueo,
  type HotelBloqueo,
  type IncluyeBloqueo,
  type PaqueteBloqueo,
  type TramoBloqueo,
  type VueloBloqueo,
} from './bloqueo-paquete'

/** Una opción de la ranura «Paquete de bloqueo» de la cotización. */
export interface OpcionDeBloqueo {
  itemId: string
  grupo: string
  /** El número de la ranura (`formaDesdeGrupo`): el más alto es el paquete vigente. */
  numero: number
  /** `null` = la opción nunca se guardó (recién creada). */
  paquete: PaqueteBloqueo | null
  /** Pública / Neta de la opción (`tarifa_pax.tipoTarifa`) y su comisión. `null` = sin decidir. */
  tarifa?: TarifaDeOpcion | null
}

export interface TarifaDeOpcion {
  tipo: 'publica' | 'neta'
  comision: { tipo: 'pct' | 'monto'; valor: number } | null
}

export type LecturaParaArmar =
  | { cual: 'hotel'; hotel: HotelBloqueo; incluye: IncluyeBloqueo; operador?: string | null }
  | { cual: 'vuelo'; vuelo: VueloBloqueo }

export interface ContextoDeArmado {
  /** El operador con que nace un paquete nuevo (el único de la solicitud, o `null`). */
  operadorInicial: string | null
  /** Los viajeros de la Solicitud. `null` = no los dice: las habitaciones quedan para la asesora. */
  pasajeros: { adultos: number; ninos: number; infantes: number } | null
  /** Las edades de los niños que dice la Solicitud. */
  edadesNinos: readonly number[]
}

export type PlanDeArmado =
  /** Paquete nuevo (ranura nueva) con su primera opción. */
  | { accion: 'nuevo_paquete'; paquete: PaqueteBloqueo; tarifa: TarifaDeOpcion | null }
  /** Opción nueva (otro hotel) en el paquete vigente, con la tarifa de sus hermanas. */
  | { accion: 'nueva_opcion'; grupo: string; paquete: PaqueteBloqueo; tarifa: TarifaDeOpcion | null }
  /** Opciones que ya existen y cambian (la opción sin hotel, o el vuelo de todo el paquete). */
  | { accion: 'actualizar'; cambios: { itemId: string; paquete: PaqueteBloqueo }[] }
  /** Nada que hacer: ya estaba. */
  | { accion: 'repetido'; mensaje: string }

// ── Acomodación automática ────────────────────────────────────────────────────

/**
 * Las habitaciones para `adultos` personas con las acomodaciones que tienen precio: las menos
 * habitaciones posibles y, a igual número, las más grandes primero (3 → 1 Triple; 5 → Triple + Doble;
 * sin Triple, 3 → Doble + Sencilla). `{}` si no hay manera exacta o no hay precios.
 */
export function habitacionesPorAdultos(adultos: number, conPrecio: readonly Acomodacion[]): Partial<Record<Acomodacion, number>> {
  if (!Number.isInteger(adultos) || adultos <= 0 || adultos > 200) return {}
  const tamanos = ACOMODACIONES.filter(a => conPrecio.includes(a))
    .sort((a, b) => PERSONAS_POR_HABITACION[b] - PERSONAS_POR_HABITACION[a])
  if (tamanos.length === 0) return {}
  // Menos habitaciones para n personas; el primer tamaño que lo logra (el más grande) gana el empate.
  const mejor: (Acomodacion[] | null)[] = Array(adultos + 1).fill(null)
  mejor[0] = []
  for (let n = 1; n <= adultos; n++) {
    for (const a of tamanos) {
      const resto = n - PERSONAS_POR_HABITACION[a]
      if (resto < 0 || mejor[resto] === null) continue
      const cand = [a, ...mejor[resto]!]
      if (mejor[n] === null || cand.length < mejor[n]!.length) mejor[n] = cand
    }
  }
  const combo = mejor[adultos]
  if (!combo) return {}
  const fuera: Partial<Record<Acomodacion, number>> = {}
  for (const a of combo) fuera[a] = (fuera[a] ?? 0) + 1
  return fuera
}

/** El reparto del paquete según los viajeros de la Solicitud. */
export function distribucionPorComposicion(hotel: HotelBloqueo, ctx: Pick<ContextoDeArmado, 'pasajeros' | 'edadesNinos'>): DistribucionBloqueo {
  const pax = ctx.pasajeros
  if (!pax) return { habitaciones: {}, ninos: 0, infantes: 0, edadesNinos: [] }
  const conPrecio = hotel.precios.filter(p => p.precioPorPersona !== null).map(p => p.acomodacion)
  return {
    habitaciones: habitacionesPorAdultos(pax.adultos, conPrecio),
    ninos: pax.ninos,
    infantes: pax.infantes,
    edadesNinos: [...ctx.edadesNinos].slice(0, pax.ninos),
  }
}

// ── Cuál es el paquete vigente y qué hay en él ────────────────────────────────

function claveDeTramo(t: TramoBloqueo): string {
  const num = (t.numeroVuelo ?? '').replace(/\D/g, '')
  return `${num}|${t.fecha ?? ''}|${(t.origen ?? '').toUpperCase()}|${(t.destino ?? '').toUpperCase()}`
}

/** ¿Es el mismo vuelo? Mismos tramos (número, fecha y ruta), en cualquier orden. */
export function mismoVuelo(a: VueloBloqueo | null, b: VueloBloqueo | null): boolean {
  if (!a || !b || a.tramos.length !== b.tramos.length) return false
  const ka = a.tramos.map(claveDeTramo).sort()
  const kb = b.tramos.map(claveDeTramo).sort()
  return ka.every((k, i) => k === kb[i])
}

export function tieneHotel(p: PaqueteBloqueo | null): boolean {
  return !!p && !!(p.hotel.hotel || p.hotel.precios.length > 0 || p.imagenes.hotel)
}

function vueloDe(opciones: readonly OpcionDeBloqueo[]): VueloBloqueo | null {
  for (const o of opciones) if (o.paquete?.vuelo && o.paquete.vuelo.tramos.length > 0) return o.paquete.vuelo
  return null
}

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()

/** Las opciones del paquete vigente (la ranura de número más alto), en su orden. */
export function paqueteVigente(opciones: readonly OpcionDeBloqueo[]): OpcionDeBloqueo[] {
  if (opciones.length === 0) return []
  const numero = Math.max(...opciones.map(o => o.numero))
  return opciones.filter(o => o.numero === numero)
}

// ── El plan ───────────────────────────────────────────────────────────────────

/** La tarifa decidida de la primera opción que la tenga. */
function tarifaDe(opciones: readonly OpcionDeBloqueo[]): TarifaDeOpcion | null {
  return opciones.find(o => o.tarifa)?.tarifa ?? null
}

export function planDelPegado(opciones: readonly OpcionDeBloqueo[], lectura: LecturaParaArmar, ctx: ContextoDeArmado): PlanDeArmado {
  const vigente = paqueteVigente(opciones)
  const vueloVigente = vueloDe(vigente)
  // Un paquete nuevo toma la tarifa del último paquete (el vigente), si la decidió.
  const tarifaNueva = tarifaDe(vigente)

  if (lectura.cual === 'vuelo') {
    if (vigente.length === 0) return { accion: 'nuevo_paquete', paquete: { ...paqueteVacio(ctx.operadorInicial), vuelo: lectura.vuelo }, tarifa: null }
    if (!vueloVigente) {
      return {
        accion: 'actualizar',
        cambios: vigente.map(o => ({ itemId: o.itemId, paquete: { ...(o.paquete ?? paqueteVacio(ctx.operadorInicial)), vuelo: lectura.vuelo } })),
      }
    }
    if (mismoVuelo(vueloVigente, lectura.vuelo)) return { accion: 'repetido', mensaje: 'Ese vuelo ya está en el paquete.' }
    return { accion: 'nuevo_paquete', paquete: { ...paqueteVacio(ctx.operadorInicial), vuelo: lectura.vuelo }, tarifa: tarifaNueva }
  }

  const conHotel = (base: PaqueteBloqueo): PaqueteBloqueo => ({
    ...base,
    hotel: { ...lectura.hotel, infante: lectura.hotel.infante ?? base.hotel.infante ?? null },
    incluye: lectura.incluye,
    distribucion: distribucionPorComposicion(lectura.hotel, ctx),
  })
  if (vigente.length === 0) return { accion: 'nuevo_paquete', paquete: conHotel(paqueteVacio(ctx.operadorInicial)), tarifa: null }
  // El mismo hotel otra vez en el mismo paquete: no se duplica.
  const nombre = norm(lectura.hotel.hotel)
  if (nombre && vigente.some(o => tieneHotel(o.paquete) && norm(o.paquete!.hotel.hotel) === nombre && norm(o.paquete!.hotel.zona) === norm(lectura.hotel.zona))) {
    return { accion: 'repetido', mensaje: `${lectura.hotel.hotel} ya es una opción de este paquete.` }
  }
  const libre = vigente.find(o => !tieneHotel(o.paquete))
  if (libre) {
    const base = libre.paquete ?? { ...paqueteVacio(ctx.operadorInicial), vuelo: vueloVigente }
    return { accion: 'actualizar', cambios: [{ itemId: libre.itemId, paquete: conHotel(base) }] }
  }
  const operador = vigente.find(o => o.paquete?.operador)?.paquete?.operador ?? ctx.operadorInicial
  return { accion: 'nueva_opcion', grupo: vigente[0].grupo, paquete: conHotel({ ...paqueteVacio(operador), vuelo: vueloVigente }), tarifa: tarifaNueva }
}
