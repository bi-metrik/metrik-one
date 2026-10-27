/**
 * LAS REGLAS DE MARGEN DE UNA COTIZACIÓN DE VIAJE (brief del 2026-10-27, Trappvel).
 *
 * Reemplazan el margen plano que heredaba todo lo Neto. Todo margen sigue siendo SOBRE EL PRECIO
 * DE VENTA (`precio = costo / (1 − m)`); lo que cambia es con qué margen nace cada línea y qué se
 * le suma o se le descuenta al final:
 *
 *  1. **Vuelo**: un colchón por tiquete y por pasajero, `min(techo, max(piso, pct × precio))`,
 *     separado en nacional e internacional. No es ganancia pura: cubre lo que se mueve el precio
 *     entre la cotización y la reserva. Se ve como el margen de la línea y se puede editar.
 *  2. **Hotel**: el margen de la cotización (15 % de arranque), editable como siempre, y un
 *     descuento por hotel con motivo que el cliente ve. Si el margen que le queda al hotel baja
 *     del piso de hotel (10 %), la cotización pide la autorización del dueño.
 *  3. **Lo demás** (planes, actividades, traslados, otros): arranca en 0 %.
 *  4. **Puntos extra**: de 0 a 5 puntos de margen sobre toda la cotización, repartidos entre
 *     hoteles y lo demás en proporción a su precio. Los vuelos no reciben nada.
 *  5. **Descuentos sobre el total**: uno o varios, con descripción y %, después de los puntos.
 *  6. **Margen global**: `(venta − costo) / venta` después de todo. Se juzga contra el mínimo
 *     de la cotización (12 % en la línea que declara las reglas).
 *
 * ## Dónde vive cada cosa
 *
 *  · La POLÍTICA (los parámetros del colchón, el piso de hotel, el tope de puntos) la declara la
 *    línea en `lineas_negocio.config_extra.margen.reglas`, y la cotización la COPIA al nacer en
 *    `cotizaciones.reglas_margen` (como `convencion_margen` y los umbrales): recalibrar el colchón
 *    no le mueve el precio a una cotización ya enviada.
 *  · Los puntos extra y los descuentos sobre el total son de la cotización: viven en el mismo
 *    `cotizaciones.reglas_margen`.
 *  · El descuento de un hotel y la comisión de una línea Pública son de la línea: viven en
 *    `items.tarifa_pax` (`descuentoCliente` y `tipoTarifa.comisionPct`).
 *
 * Una cotización SIN `reglas_margen` (todas las anteriores, y las de toda línea que no declare
 * reglas) se calcula exactamente como antes: la cascada no mira nada de esto.
 *
 * Puro: lo usan la cascada (`totales.ts`), la pantalla y las acciones.
 */

import { vuelosDeItems } from './detalle-viaje'
import { alcanceDelVuelo } from './vuelo-internacional'
import { ranuraDeGrupo } from './ranuras-pantallazo'
import { leerTipoTarifa } from './tarifa-publica'
import type { FilaDePasajeros } from './cuadre-pasajero'

// ── La política: lo que declara la línea ─────────────────────────────────────

/** Un tramo del colchón: el porcentaje del precio del tiquete, con piso y techo en pesos. */
export interface TramoColchon {
  pct: number
  piso: number
  techo: number
}

export interface PoliticaReglasMargen {
  colchonVuelo: { nacional: TramoColchon; internacional: TramoColchon }
  /** Por debajo de este margen (ya con su descuento), un hotel pide la autorización del dueño. */
  pisoHotelPct: number
  /** Hasta cuántos puntos extra se pueden sumar a la cotización. */
  puntosExtraMax: number
}

/**
 * Los valores con que arranca Trappvel (brief del 2026-10-27). Solo se usan para completar lo que
 * la línea no diga: una línea que no declara `reglas` no tiene reglas.
 */
export const POLITICA_REGLAS_POR_DEFECTO: PoliticaReglasMargen = {
  colchonVuelo: {
    nacional: { pct: 10, piso: 30_000, techo: 80_000 },
    internacional: { pct: 5, piso: 60_000, techo: 200_000 },
  },
  pisoHotelPct: 10,
  puntosExtraMax: 5,
}

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

function numero(v: unknown, porDefecto: number, { min = 0, max = Number.POSITIVE_INFINITY }: { min?: number; max?: number } = {}): number {
  const n = Number(v)
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= min && n <= max ? n : porDefecto
}

function tramo(raw: unknown, porDefecto: TramoColchon): TramoColchon {
  const r = esObj(raw) ? raw : {}
  const pct = numero(r.pct, porDefecto.pct, { max: 99.99 })
  const piso = numero(r.piso, porDefecto.piso)
  const techo = numero(r.techo, porDefecto.techo)
  // Un techo por debajo del piso no es un colchón: se descarta el par entero, no se adivina.
  return techo >= piso ? { pct, piso, techo } : { ...porDefecto }
}

/** La política en el formato del jsonb (snake_case, como el resto de `config_extra.margen`). */
function politicaDesdeJsonb(raw: Obj): PoliticaReglasMargen {
  const d = POLITICA_REGLAS_POR_DEFECTO
  const colchon = esObj(raw.colchon_vuelo) ? raw.colchon_vuelo : {}
  return {
    colchonVuelo: {
      nacional: tramo(colchon.nacional, d.colchonVuelo.nacional),
      internacional: tramo(colchon.internacional, d.colchonVuelo.internacional),
    },
    pisoHotelPct: numero(raw.piso_hotel_pct, d.pisoHotelPct, { max: 99.99 }),
    puntosExtraMax: numero(raw.puntos_extra_max, d.puntosExtraMax, { max: 20 }),
  }
}

function politicaAJsonb(p: PoliticaReglasMargen): Obj {
  return {
    colchon_vuelo: {
      nacional: { ...p.colchonVuelo.nacional },
      internacional: { ...p.colchonVuelo.internacional },
    },
    piso_hotel_pct: p.pisoHotelPct,
    puntos_extra_max: p.puntosExtraMax,
  }
}

/**
 * La política que declara una línea (`config_extra.margen.reglas`), o `null` si no declara reglas.
 * `null` es lo de siempre: la cotización nace sin reglas y se calcula como antes.
 */
export function politicaReglasDeLinea(configExtra: unknown): PoliticaReglasMargen | null {
  const margen = esObj(configExtra) ? configExtra.margen : null
  const reglas = esObj(margen) ? margen.reglas : null
  return esObj(reglas) ? politicaDesdeJsonb(reglas) : null
}

// ── Lo de la cotización: puntos extra y descuentos sobre el total ────────────

/** Un descuento sobre el total: el cliente lo ve con su descripción. */
export interface DescuentoSobreTotal {
  id: string
  descripcion: string
  pct: number
}

export interface ReglasDeCotizacion {
  politica: PoliticaReglasMargen
  /** De 0 a `politica.puntosExtraMax`. */
  puntosExtra: number
  descuentos: DescuentoSobreTotal[]
}

/** Lo más largo que puede ser la descripción de un descuento: sale en el documento del cliente. */
export const MAX_DESCRIPCION_DESCUENTO = 80
/** Hasta cuántos descuentos sobre el total. */
export const MAX_DESCUENTOS = 6

function leerDescuentos(raw: unknown): DescuentoSobreTotal[] {
  if (!Array.isArray(raw)) return []
  const out: DescuentoSobreTotal[] = []
  for (const d of raw) {
    if (!esObj(d)) continue
    const descripcion = typeof d.descripcion === 'string' ? d.descripcion.trim().slice(0, MAX_DESCRIPCION_DESCUENTO) : ''
    const pct = Number(d.pct)
    if (!descripcion || !Number.isFinite(pct) || pct <= 0 || pct >= 100) continue
    const id = typeof d.id === 'string' && d.id.trim() ? d.id.slice(0, 40) : `d${out.length + 1}`
    out.push({ id, descripcion, pct })
    if (out.length >= MAX_DESCUENTOS) break
  }
  return out
}

/** Lo guardado en `cotizaciones.reglas_margen`, revisado. `null` = la cotización no tiene reglas. */
export function leerReglasDeCotizacion(raw: unknown): ReglasDeCotizacion | null {
  if (!esObj(raw) || !esObj(raw.politica)) return null
  const politica = politicaDesdeJsonb(raw.politica)
  const puntos = numero(raw.puntos_extra, 0, { max: politica.puntosExtraMax })
  return { politica, puntosExtra: puntos, descuentos: leerDescuentos(raw.descuentos) }
}

/** Lo que se escribe en `cotizaciones.reglas_margen`. */
export function reglasAJsonb(r: ReglasDeCotizacion): Obj {
  return {
    v: 1,
    politica: politicaAJsonb(r.politica),
    puntos_extra: r.puntosExtra,
    descuentos: r.descuentos.map(d => ({ id: d.id, descripcion: d.descripcion, pct: d.pct })),
  }
}

/** Las reglas con que NACE una cotización de una línea que las declara: sin puntos ni descuentos. */
export function reglasAlNacer(politica: PoliticaReglasMargen): Obj {
  return reglasAJsonb({ politica, puntosExtra: 0, descuentos: [] })
}

/**
 * ¿Se pueden guardar estos puntos y estos descuentos? `null` = sí; si no, el porqué en palabras.
 */
export function motivoReglasInvalidas(
  politica: PoliticaReglasMargen,
  cambio: { puntosExtra?: number; descuentos?: { descripcion: string; pct: number }[] },
): string | null {
  if (cambio.puntosExtra !== undefined) {
    const p = cambio.puntosExtra
    if (!Number.isFinite(p) || p < 0 || p > politica.puntosExtraMax) {
      return `Los puntos extra van de 0 a ${String(politica.puntosExtraMax).replace('.', ',')}.`
    }
  }
  if (cambio.descuentos !== undefined) {
    if (cambio.descuentos.length > MAX_DESCUENTOS) return `Hasta ${MAX_DESCUENTOS} descuentos sobre el total.`
    for (const d of cambio.descuentos) {
      if (!d.descripcion?.trim()) return 'Cada descuento necesita su descripción: el cliente la ve.'
      if (d.descripcion.trim().length > MAX_DESCRIPCION_DESCUENTO) return `La descripción va hasta ${MAX_DESCRIPCION_DESCUENTO} letras.`
      if (!Number.isFinite(d.pct) || d.pct <= 0 || d.pct >= 100) return 'El descuento va de 0,1 % a 99 %.'
    }
    const suma = cambio.descuentos.reduce((a, d) => a + d.pct, 0)
    if (suma >= 100) return 'Los descuentos juntos no pueden llegar al 100 %.'
  }
  return null
}

// ── Qué es cada línea para el margen ─────────────────────────────────────────

export type TipoParaMargen = 'vuelo' | 'hotel' | 'otro'

/** Vuelo, hotel o lo demás, por la RANURA del grupo (el mismo criterio del recargo). */
export function tipoParaMargen(grupo: string | null | undefined): TipoParaMargen {
  const slug = ranuraDeGrupo(grupo ?? null)?.slug
  if (slug === 'vuelo_detalle') return 'vuelo'
  if (slug === 'hotel_detalle') return 'hotel'
  return 'otro'
}

/**
 * El margen que hereda una línea sin margen propio, fuera de la cascada (las filas con precio a
 * mano de la tarjeta). Sin reglas, el de la cotización; con reglas, el hotel el de la cotización y
 * lo demás 0. El vuelo no entra aquí: su colchón lo calcula la cascada con su costo.
 */
export function margenHeredado(
  grupo: string | null | undefined,
  margenCotizacion: number | null | undefined,
  reglas: ReglasDeCotizacion | null | undefined,
): number {
  const m = Number(margenCotizacion) || 0
  if (!reglas) return m
  return tipoParaMargen(grupo) === 'hotel' ? m : 0
}

// ── 1 · El colchón del vuelo ─────────────────────────────────────────────────

/** El colchón de UN tiquete: `min(techo, max(piso, pct × precio))`, al peso. */
export function colchonDeTiquete(precioTiquete: number, t: TramoColchon): number {
  const precio = Math.max(0, Number(precioTiquete) || 0)
  return Math.round(Math.min(t.techo, Math.max(t.piso, (t.pct / 100) * precio)))
}

/** Lo que hace falta de una línea de vuelo para saber cuántos tiquetes son y a qué precio. */
export interface LineaParaColchon {
  nombre?: string | null
  grupo?: string | null
  tarifa_pax?: unknown
  /** `cuadre-pasajero.ts`: los tipos de pasajero con su costo (por unidad de la línea). */
  pasajeros?: readonly FilaDePasajeros[] | null
}

export interface ColchonDeLinea {
  /** El colchón de toda la línea, en pesos. */
  colchon: number
  /** Cuántos tiquetes cuenta (pasajeros × unidades). */
  tiquetes: number
  internacional: boolean
  /** Lo que no se reconoció del origen o el destino: se trató como internacional. */
  sinReconocer: string[]
  /** El colchón de cada tiquete, en el orden de los pasajeros (para mostrar «$ 60.000 c/u»). */
  porTiquete: number[]
}

/**
 * El colchón de una línea de vuelo: uno por pasajero y por tiquete.
 *
 * El precio de cada tiquete sale del costo de la línea repartido como lo reparte la confirmación
 * por pasajero (`pasajeros`: cuánto cuesta cada tipo y cuántos son). Sin esa confirmación, la línea
 * es UN tiquete por unidad con su costo: es lo honesto con lo que se sabe, y el colchón se puede
 * editar en la tarjeta.
 *
 * Nacional o internacional lo decide `alcanceDelVuelo` (origen o destino fuera de Colombia); lo que
 * no se reconoce cuenta como internacional, igual que el recargo, y se nombra en `sinReconocer`.
 *
 * @param costoLinea El costo de la línea (unidad × cantidad, con el descuento de compra).
 * @param cantidad Las unidades de la línea.
 */
export function colchonDeLinea(
  linea: LineaParaColchon,
  costoLinea: number,
  cantidad: number,
  politica: PoliticaReglasMargen,
): ColchonDeLinea {
  const [vuelo] = vuelosDeItems([{ nombre: linea.nombre ?? null, grupo: linea.grupo ?? null, tarifa_pax: linea.tarifa_pax }])
  const alcance = alcanceDelVuelo(vuelo?.origen, vuelo?.destino)
  const t = alcance.internacional ? politica.colchonVuelo.internacional : politica.colchonVuelo.nacional
  const unidades = Math.max(1, Math.round(Number(cantidad) || 1))
  const costo = Math.max(0, Number(costoLinea) || 0)

  const filas = (linea.pasajeros ?? []).filter(f => f.cantidad > 0)
  const pesoUnidad = filas.reduce((a, f) => a + Math.max(0, f.peso), 0)
  const porTiquete: number[] = []
  if (filas.length > 0 && pesoUnidad > 0) {
    // El costo de la línea puede traer el descuento de compra: se reparte en la misma proporción.
    const factor = costo / (pesoUnidad * unidades)
    for (let u = 0; u < unidades; u++) {
      for (const f of filas) {
        const precioTiquete = (Math.max(0, f.peso) / f.cantidad) * factor
        for (let k = 0; k < f.cantidad; k++) porTiquete.push(colchonDeTiquete(precioTiquete, t))
      }
    }
  } else {
    for (let u = 0; u < unidades; u++) porTiquete.push(colchonDeTiquete(costo / unidades, t))
  }
  return {
    colchon: porTiquete.reduce((a, c) => a + c, 0),
    tiquetes: porTiquete.length,
    internacional: alcance.internacional,
    sinReconocer: alcance.sinReconocer,
    porTiquete,
  }
}

// ── 2 · El descuento de un hotel ─────────────────────────────────────────────

/**
 * El descuento que se le da al cliente en UNA opción (un hotel). Lo ve el cliente, con su motivo.
 *
 *  · `pct`: puntos de margen que se ceden. Un hotel al 15 % con 3 de descuento queda al 12 %
 *    (`margen − descuento`, como lo pide el brief). El cliente ve la cifra en pesos.
 *  · `monto`: pesos que se le restan al precio de la opción.
 */
export interface DescuentoDeLinea {
  motivo: string
  tipo: 'pct' | 'monto'
  valor: number
  por?: string | null
  en?: string
}

export const MAX_MOTIVO_DESCUENTO = 80

/** Lo guardado en `tarifa_pax.descuentoCliente`, revisado. `null` = sin descuento. */
export function leerDescuentoDeLinea(raw: unknown): DescuentoDeLinea | null {
  if (!esObj(raw)) return null
  const motivo = typeof raw.motivo === 'string' ? raw.motivo.trim().slice(0, MAX_MOTIVO_DESCUENTO) : ''
  const tipo = raw.tipo === 'monto' ? 'monto' : raw.tipo === 'pct' ? 'pct' : null
  const valor = Number(raw.valor)
  if (!motivo || !tipo || !Number.isFinite(valor) || valor <= 0) return null
  if (tipo === 'pct' && valor >= 100) return null
  return {
    motivo,
    tipo,
    valor,
    por: typeof raw.por === 'string' ? raw.por.slice(0, 200) : null,
    en: typeof raw.en === 'string' ? raw.en : '',
  }
}

/** El descuento de una línea, leído del jsonb crudo de `items.tarifa_pax`. */
export function descuentoDeLinea(tarifaPax: unknown): DescuentoDeLinea | null {
  return esObj(tarifaPax) ? leerDescuentoDeLinea(tarifaPax.descuentoCliente) : null
}

/** ¿Se puede guardar este descuento? `null` = sí. */
export function motivoDescuentoInvalido(d: { motivo: string; tipo: string; valor: number }): string | null {
  if (!d.motivo?.trim()) return 'Escribe el motivo del descuento: el cliente lo ve.'
  if (d.motivo.trim().length > MAX_MOTIVO_DESCUENTO) return `El motivo va hasta ${MAX_MOTIVO_DESCUENTO} letras.`
  if (d.tipo !== 'pct' && d.tipo !== 'monto') return 'El descuento es en % o en pesos.'
  if (!Number.isFinite(d.valor) || d.valor <= 0) return 'Escribe cuánto es el descuento.'
  if (d.tipo === 'pct' && d.valor >= 100) return 'El descuento en % va de 0,1 a 99.'
  return null
}

// ── 6 · La comisión de una línea Pública ─────────────────────────────────────

/**
 * La comisión que trae una línea Pública (`tarifa_pax.tipoTarifa.comisionPct`), o `null` si nadie
 * la escribió. Con ella la línea entra al margen global con su comisión como margen; sin ella, la
 * línea sale de la base del margen global (no la puede hundir a ciegas).
 */
export function comisionDePublica(tarifaPax: unknown): number | null {
  if (!esObj(tarifaPax)) return null
  const decision = leerTipoTarifa(tarifaPax.tipoTarifa)
  if (!decision || decision.tipo !== 'publica') return null
  const c = decision.comisionPct
  return c !== null && c !== undefined && Number.isFinite(c) && c >= 0 && c < 100 ? c : null
}

/**
 * Los parámetros para calcular el precio de CADA opción por separado (la tarjeta, «Lo que suma»):
 * sin puntos extra ni descuentos sobre el total. Los puntos se reparten entre las líneas de UNA
 * tarifa y los descuentos son del total: sobre todas las opciones a la vez no significan nada.
 */
export function paramsPorOpcion<T extends { reglas?: ReglasDeCotizacion | null }>(params: T): T {
  if (!params.reglas) return params
  return { ...params, reglas: { ...params.reglas, puntosExtra: 0, descuentos: [] } }
}

/**
 * El descuento sobre el total, en %, que el IVA tiene que restar: los descuentos de las reglas
 * más el descuento comercial de siempre. Sin reglas es el comercial, como antes.
 */
export function pctDescuentoTotal(params: { descuentoComercialPct?: number | null; reglas?: ReglasDeCotizacion | null }): number {
  const comercial = Math.min(100, Math.max(0, Number(params.descuentoComercialPct) || 0))
  if (!params.reglas) return comercial
  return Math.min(100, comercial + params.reglas.descuentos.reduce((a, d) => a + d.pct, 0))
}

// ── Cómo se dice ─────────────────────────────────────────────────────────────

const pesos = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`

/** «Descuento por cierre esta semana: −$120.000», la línea que ve el cliente bajo su hotel. */
export function textoDescuentoDeLinea(motivo: string, valor: number): string {
  return `Descuento · ${motivo}: −${pesos(valor)}`
}

/** «Colchón $60.000 por tiquete · 2 tiquetes internacionales», la nota de la tarjeta del vuelo. */
export function textoColchon(c: ColchonDeLinea): string {
  const alcance = c.internacional ? 'internacional' : 'nacional'
  const iguales = c.porTiquete.length > 0 && c.porTiquete.every(x => x === c.porTiquete[0])
  const cada = iguales ? `${pesos(c.porTiquete[0])} por tiquete` : `${pesos(c.colchon)} en total`
  const n = c.tiquetes === 1 ? '1 tiquete' : `${c.tiquetes} tiquetes`
  return `Colchón ${cada} · ${n} · vuelo ${alcance}`
}
