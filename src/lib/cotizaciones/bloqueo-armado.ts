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
 *  · «Tarifa del operador: Pública / Neta» (Mauricio, 2026-11-03, segunda vuelta): SIN default. Cada
 *    paquete NUEVO nace con la pregunta (`tarifaPorElegir`), que la bandeja le hace a la asesora una
 *    vez por paquete. Una opción nueva hereda la respuesta de sus hermanas (con su comisión); si el
 *    paquete todavía no la tiene, hereda la pregunta. Otro vuelo = otro paquete = otra pregunta. Con
 *    Pública el total por personas es el precio al cliente.
 *
 *  · VARIOS OPERADORES en la solicitud (QA de Trappvel del 2026-11-05, viaje 02): los 4 pantallazos
 *    subidos juntos (vuelo Avianca + hotel GHL de Tu Reserva; vuelo LATAM + hotel Decameron de Aliados)
 *    se armaban en el orden en que terminaba la detección: «Paquete 1 = Avianca + GHL + Decameron,
 *    Paquete 2 = LATAM». El «paquete vigente» solo sirve cuando todo es de UN operador. Con varios, el
 *    reparto va por OPERADOR y nunca se adivina (`planConVariosOperadores`):
 *      - un hotel cuyo operador se leyó (y es uno de la solicitud) va al paquete de ese operador; si
 *        no hay, abre el suyo con ese operador;
 *      - un hotel sin operador leído abre su propio paquete (sin operador: la tarjeta lo pide);
 *      - un vuelo con operador leído (el encabezado del pantallazo: «tureserva · Salidas en bloqueo»,
 *        2026-11-05) va al paquete de ese operador que todavía no tiene vuelo, y se pone en TODAS sus
 *        opciones; si no hay ninguno, abre el suyo con ese operador (y los hoteles de ese operador
 *        llegan ahí). Un paquete que ya tiene OTRO vuelo no se pisa: el vuelo abre paquete propio;
 *      - un vuelo sin operador leído abre su propio paquete: juntarlo con un hotel sería adivinar. La
 *        asesora lo pone en el paquete que le toca.
 *    El resultado no depende del orden de llegada: un hotel nunca queda con el vuelo de otro operador.
 *
 *  · LOS PAQUETES COMPITEN, NO SE SUMAN (reprueba de Trappvel del 2026-11-05, viaje 02): un bloqueo es
 *    UN viaje a un destino y sus paquetes son alternativas para el cliente. Con cada paquete en su propia
 *    ranura, Tarifas los sumaba en una sola tarifa (A + B), y la asesora tenía que «Juntar como opción
 *    de…». Ahora el paquete nuevo es OTRA OPCIÓN de la ranura del bloqueo que ya existe (`grupo` del plan;
 *    solo el primero abre la ranura): cada opción es una tarifa (D5), la Recomendada y la «Opción 2».
 *    Vale para varios operadores y para UN operador con otro vuelo. Dentro de la ranura, un PAQUETE son
 *    las opciones con el mismo operador y el mismo vuelo (`paquetesDelBloqueo`): a él van sus hoteles, su
 *    vuelo y su pregunta Pública / Neta. Nada se guarda aparte: sale de lo que ya dice cada opción, y así
 *    lo que la asesora juntó a mano antes se lee igual.
 *
 * Puro: sin red y sin base. La escritura es de `pegarEnBloqueo` (`bloqueo-actions.ts`).
 */

import { claveDeNombre, operadorDeLaLectura } from './bloqueo-operador'
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
import { ranuraDeGrupo } from './ranuras-pantallazo'
import { formaDesdeGrupo } from './ranuras-cotizacion'

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
  /** El orden de la línea (`items.orden`). Sin él, el de la lista. */
  orden?: number | null
}

/**
 * Un PAQUETE del bloqueo: las opciones de una misma ranura con el mismo operador y el mismo vuelo
 * (2026-11-05). Varios paquetes viven en UNA ranura y compiten como opciones.
 */
export interface PaqueteDelBloqueo {
  clave: string
  grupo: string
  numero: number
  opciones: OpcionDeBloqueo[]
}

export interface TarifaDeOpcion {
  tipo: 'publica' | 'neta'
  comision: { tipo: 'pct' | 'monto'; valor: number } | null
}

export type LecturaParaArmar =
  | { cual: 'hotel'; hotel: HotelBloqueo; incluye: IncluyeBloqueo; operador?: string | null }
  /** `operador`: el del encabezado del pantallazo del vuelo, sin validar (2026-11-05). */
  | { cual: 'vuelo'; vuelo: VueloBloqueo; operador?: string | null }

export interface ContextoDeArmado {
  /** El operador con que nace un paquete nuevo (el único de la solicitud, o `null`). */
  operadorInicial: string | null
  /** Los viajeros de la Solicitud. `null` = no los dice: las habitaciones quedan para la asesora. */
  pasajeros: { adultos: number; ninos: number; infantes: number } | null
  /** Las edades de los niños que dice la Solicitud. */
  edadesNinos: readonly number[]
  /**
   * Los operadores que nombra la solicitud (`operadoresDeLaSolicitud`). Con DOS o más, el reparto va
   * por operador (`planConVariosOperadores`). Ausente o con uno = el paquete vigente, como siempre.
   */
  operadoresSolicitud?: readonly string[]
}

export type PlanDeArmado =
  /**
   * Paquete nuevo con su primera opción. Siempre con la pregunta Pública / Neta. `grupo`: la ranura del
   * bloqueo donde entra como OTRA OPCIÓN que compite (2026-11-05); `null` = no hay ranura: se abre.
   * `mensaje`: lo que ve la asesora, si no es el de siempre (viaje con varios operadores).
   */
  | { accion: 'nuevo_paquete'; grupo: string | null; paquete: PaqueteBloqueo; tarifa: null; mensaje?: string }
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

function claveDeVuelo(v: VueloBloqueo | null | undefined): string {
  return v && v.tramos.length > 0 ? v.tramos.map(claveDeTramo).sort().join(';') : ''
}

/**
 * Los paquetes del bloqueo, en el orden en que se abrieron (ranura y orden de la línea): las opciones
 * de una ranura con el mismo operador y el mismo vuelo son UN paquete. Una opción que nunca se guardó
 * («+ Paquete» recién creado) es del último paquete de su ranura, como antes de este cambio.
 */
export function paquetesDelBloqueo(opciones: readonly OpcionDeBloqueo[]): PaqueteDelBloqueo[] {
  const ordenadas = opciones
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.numero - b.o.numero || (a.o.orden ?? a.i) - (b.o.orden ?? b.i) || a.i - b.i)
    .map(x => x.o)
  const salida: PaqueteDelBloqueo[] = []
  const porClave = new Map<string, PaqueteDelBloqueo>()
  for (const o of ordenadas) {
    let p = o.paquete ? undefined : [...salida].reverse().find(x => x.grupo === o.grupo)
    if (!p) {
      const clave = `${o.grupo}|${claveDeNombre(o.paquete?.operador)}|${claveDeVuelo(o.paquete?.vuelo)}`
      p = porClave.get(clave)
      if (!p) {
        p = { clave, grupo: o.grupo, numero: o.numero, opciones: [] }
        porClave.set(clave, p)
        salida.push(p)
      }
    }
    p.opciones.push(o)
  }
  return salida
}

/** Los ids de las opciones del mismo paquete que `itemId` (él incluido). Vacío si no está. */
export function opcionesDelMismoPaquete(opciones: readonly OpcionDeBloqueo[], itemId: string): string[] {
  return paquetesDelBloqueo(opciones).find(p => p.opciones.some(o => o.itemId === itemId))?.opciones.map(o => o.itemId) ?? []
}

/** La ranura donde entra un paquete nuevo: la del bloqueo (la de número más alto). `null` = no hay. */
function ranuraDelBloqueo(opciones: readonly OpcionDeBloqueo[]): string | null {
  if (opciones.length === 0) return null
  const numero = Math.max(...opciones.map(o => o.numero))
  return opciones.find(o => o.numero === numero)!.grupo
}

function operadorDelPaquete(p: PaqueteDelBloqueo): string | null {
  return p.opciones.find(o => o.paquete?.operador)?.paquete?.operador ?? null
}

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()

/** Las opciones del paquete vigente (el último que se abrió, `paquetesDelBloqueo`), en su orden. */
export function paqueteVigente(opciones: readonly OpcionDeBloqueo[]): OpcionDeBloqueo[] {
  return paquetesDelBloqueo(opciones).at(-1)?.opciones ?? []
}

/**
 * El grupo de la ranura «Paquete de bloqueo» de número más alto: el paquete vigente. A él agrega «+
 * Paquete» (2026-11-03; antes iba siempre al primero). `null` sin paquetes.
 */
export function grupoDelPaqueteVigente(filas: readonly { grupo: string | null; es_ajuste?: boolean | null }[]): string | null {
  let mejor: { grupo: string; numero: number } | null = null
  for (const i of filas) {
    if (i.es_ajuste === true || !i.grupo || ranuraDeGrupo(i.grupo)?.slug !== 'paquete_detalle') continue
    const numero = formaDesdeGrupo(i.grupo)?.numero ?? 1
    if (!mejor || numero > mejor.numero) mejor = { grupo: i.grupo, numero }
  }
  return mejor?.grupo ?? null
}

/** Las líneas de la ranura «Paquete de bloqueo» como opciones del armado (sin tarifa). */
export function opcionesDeLasLineas(
  lineas: readonly { id: string; grupo?: string | null; es_ajuste?: boolean | null; orden?: number | null; paquete: PaqueteBloqueo | null }[],
): OpcionDeBloqueo[] {
  return lineas
    .filter(l => l.es_ajuste !== true && !!l.grupo && ranuraDeGrupo(l.grupo)?.slug === 'paquete_detalle')
    .map(l => ({ itemId: l.id, grupo: l.grupo as string, numero: formaDesdeGrupo(l.grupo)?.numero ?? 1, paquete: l.paquete, orden: l.orden ?? null }))
}

/**
 * Los paquetes con «¿Pública o Neta?» sin responder: UNO por paquete (`paquetesDelBloqueo`), con la
 * primera opción que tiene la pregunta abierta y un título para la bandeja («Paquete 2 · AV 9370»). El
 * número es el del paquete en el bloqueo, en el orden en que se abrieron.
 */
export function paquetesConTarifaPorElegir(
  lineas: readonly { id: string; grupo?: string | null; es_ajuste?: boolean | null; orden?: number | null; paquete: PaqueteBloqueo | null }[],
): { itemId: string; titulo: string }[] {
  const out: { itemId: string; titulo: string }[] = []
  paquetesDelBloqueo(opcionesDeLasLineas(lineas)).forEach((p, i) => {
    const abierta = p.opciones.find(o => o.paquete?.tarifaPorElegir)
    if (!abierta) return
    const t = vueloDe(p.opciones)?.tramos[0]
    const vuelo = t ? [t.aerolinea, t.numeroVuelo].filter(Boolean).join(' ') : ''
    out.push({ itemId: abierta.itemId, titulo: `Paquete ${i + 1}${vuelo ? ` · ${vuelo}` : ''}` })
  })
  return out
}

// ── El plan ───────────────────────────────────────────────────────────────────

/** La tarifa decidida de la primera opción que la tenga. */
function tarifaDe(opciones: readonly OpcionDeBloqueo[]): TarifaDeOpcion | null {
  return opciones.find(o => o.tarifa)?.tarifa ?? null
}

/** Lo que ve la asesora cuando el vuelo abre su propio paquete en un viaje con varios operadores. */
export const MENSAJE_VUELO_VARIOS_OPERADORES =
  'Paquete nuevo con este vuelo. El viaje tiene varios operadores y el vuelo no dice de cuál es: ' +
  'pégalo en la casilla «Vuelo» del paquete que le toca y borra este.'

/** Lo que ve la asesora cuando un vuelo con operador leído abre el paquete de ese operador. */
export function mensajeVueloDelOperador(operador: string): string {
  return `Paquete nuevo de ${operador} con este vuelo: los hoteles de ${operador} que pegues van a este paquete.`
}

/** Lo que ve la asesora cuando un hotel abre su paquete sin operador leído (varios operadores). */
export function mensajeHotelSinOperador(hotel: string | null): string {
  return `Paquete nuevo con ${hotel ?? 'este hotel'}. No se vio de qué operador es: elígelo en el paquete.`
}

/**
 * El paquete nuevo de la bandeja: siempre con la pregunta Pública / Neta, nunca con la del anterior. Entra
 * como otra opción de la ranura del bloqueo (compite, no se suma); solo el primero la abre.
 */
function paqueteNuevo(opciones: readonly OpcionDeBloqueo[], base: PaqueteBloqueo, mensaje?: string): PlanDeArmado {
  return {
    accion: 'nuevo_paquete',
    grupo: ranuraDelBloqueo(opciones),
    paquete: { ...base, tarifaPorElegir: true },
    tarifa: null,
    ...(mensaje ? { mensaje } : {}),
  }
}

function conHotelLeido(base: PaqueteBloqueo, lectura: Extract<LecturaParaArmar, { cual: 'hotel' }>, ctx: ContextoDeArmado): PaqueteBloqueo {
  return {
    ...base,
    hotel: { ...lectura.hotel, infante: lectura.hotel.infante ?? base.hotel.infante ?? null },
    incluye: lectura.incluye,
    distribucion: distribucionPorComposicion(lectura.hotel, ctx),
  }
}

/**
 * Un hotel en un paquete que YA existe (`paquete`: sus opciones): repetido, la opción sin hotel, u
 * otra opción con el vuelo del paquete y la tarifa de sus hermanas.
 */
function hotelEnElPaquete(
  paquete: readonly OpcionDeBloqueo[],
  lectura: Extract<LecturaParaArmar, { cual: 'hotel' }>,
  ctx: ContextoDeArmado,
): PlanDeArmado {
  const vuelo = vueloDe(paquete)
  const tarifaHermanas = tarifaDe(paquete)
  // El mismo hotel otra vez en el mismo paquete: no se duplica.
  const nombre = norm(lectura.hotel.hotel)
  if (nombre && paquete.some(o => tieneHotel(o.paquete) && norm(o.paquete!.hotel.hotel) === nombre && norm(o.paquete!.hotel.zona) === norm(lectura.hotel.zona))) {
    return { accion: 'repetido', mensaje: `${lectura.hotel.hotel} ya es una opción de este paquete.` }
  }
  const libre = paquete.find(o => !tieneHotel(o.paquete))
  if (libre) {
    const base = libre.paquete ?? { ...paqueteVacio(ctx.operadorInicial), vuelo }
    // Una opción sin respuesta en un paquete sin respuesta: la pregunta queda abierta.
    const preguntar = !libre.tarifa && !tarifaHermanas
    const lleno = conHotelLeido(base, lectura, ctx)
    return { accion: 'actualizar', cambios: [{ itemId: libre.itemId, paquete: preguntar ? { ...lleno, tarifaPorElegir: true } : lleno }] }
  }
  const operador = paquete.find(o => o.paquete?.operador)?.paquete?.operador ?? ctx.operadorInicial
  const nueva = conHotelLeido({ ...paqueteVacio(operador), vuelo }, lectura, ctx)
  return { accion: 'nueva_opcion', grupo: paquete[0].grupo, paquete: tarifaHermanas ? nueva : { ...nueva, tarifaPorElegir: true }, tarifa: tarifaHermanas }
}

/**
 * Viaje con VARIOS operadores (viaje 02, 2026-11-05): el reparto por operador, sin «paquete vigente».
 * Determinista: el mismo conjunto de pantallazos arma los mismos paquetes en cualquier orden.
 */
function planConVariosOperadores(
  opciones: readonly OpcionDeBloqueo[],
  lectura: LecturaParaArmar,
  ctx: ContextoDeArmado,
  operadores: readonly string[],
): PlanDeArmado {
  if (lectura.cual === 'vuelo') {
    if (opciones.some(o => mismoVuelo(o.paquete?.vuelo ?? null, lectura.vuelo))) {
      return { accion: 'repetido', mensaje: 'Ese vuelo ya está en un paquete.' }
    }
    const delVuelo = operadorDeLaLectura(lectura.operador ?? null, operadores)
    if (!delVuelo) return paqueteNuevo(opciones, { ...paqueteVacio(null), vuelo: lectura.vuelo }, MENSAJE_VUELO_VARIOS_OPERADORES)
    const kv = claveDeNombre(delVuelo)
    // El paquete de ese operador que todavía no tiene vuelo; el primero que se abrió, para que el
    // resultado no dependa del orden. Uno que ya tiene otro vuelo no se pisa.
    const sinVuelo = paquetesDelBloqueo(opciones)
      .find(p => claveDeNombre(operadorDelPaquete(p)) === kv && !vueloDe(p.opciones))
    if (!sinVuelo) return paqueteNuevo(opciones, { ...paqueteVacio(delVuelo), vuelo: lectura.vuelo }, mensajeVueloDelOperador(delVuelo))
    // El vuelo es de todo el paquete: va a todas sus opciones, con su tarifa y su pregunta intactas.
    return {
      accion: 'actualizar',
      cambios: sinVuelo.opciones
        .map(o => ({ itemId: o.itemId, paquete: { ...(o.paquete ?? paqueteVacio(delVuelo)), vuelo: lectura.vuelo } })),
    }
  }
  const operador = operadorDeLaLectura(lectura.operador ?? null, operadores)
  if (!operador) return paqueteNuevo(opciones, conHotelLeido(paqueteVacio(null), lectura, ctx), mensajeHotelSinOperador(lectura.hotel.hotel))
  const k = claveDeNombre(operador)
  const delOperador = paquetesDelBloqueo(opciones).filter(p => claveDeNombre(operadorDelPaquete(p)) === k)
  if (delOperador.length === 0) return paqueteNuevo(opciones, conHotelLeido(paqueteVacio(operador), lectura, ctx))
  // El paquete de ese operador (si hay varios, el último que se abrió) con TODAS sus opciones.
  return hotelEnElPaquete(delOperador[delOperador.length - 1].opciones, lectura, ctx)
}

export function planDelPegado(opciones: readonly OpcionDeBloqueo[], lectura: LecturaParaArmar, ctx: ContextoDeArmado): PlanDeArmado {
  const operadores = ctx.operadoresSolicitud ?? []
  if (operadores.length >= 2) return planConVariosOperadores(opciones, lectura, ctx, operadores)

  const vigente = paqueteVigente(opciones)
  const vueloVigente = vueloDe(vigente)

  if (lectura.cual === 'vuelo') {
    if (vigente.length === 0) return paqueteNuevo(opciones, { ...paqueteVacio(ctx.operadorInicial), vuelo: lectura.vuelo })
    if (!vueloVigente) {
      return {
        accion: 'actualizar',
        cambios: vigente.map(o => ({ itemId: o.itemId, paquete: { ...(o.paquete ?? paqueteVacio(ctx.operadorInicial)), vuelo: lectura.vuelo } })),
      }
    }
    if (mismoVuelo(vueloVigente, lectura.vuelo)) return { accion: 'repetido', mensaje: 'Ese vuelo ya está en el paquete.' }
    // Otro vuelo = otro paquete, que COMPITE con el anterior en la misma ranura (2026-11-05).
    return paqueteNuevo(opciones, { ...paqueteVacio(ctx.operadorInicial), vuelo: lectura.vuelo })
  }

  if (vigente.length === 0) return paqueteNuevo(opciones, conHotelLeido(paqueteVacio(ctx.operadorInicial), lectura, ctx))
  return hotelEnElPaquete(vigente, lectura, ctx)
}
