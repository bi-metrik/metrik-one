/**
 * El negocio alrededor de la cotización de viaje (Trappvel, decisión de layout del
 * 2026-09-23).
 *
 * La cotización sigue en su propia pantalla, pero trae del negocio lo que quien cotiza
 * necesita tener a la vista: arriba un encabezado fijo (titular, destino, fechas,
 * pasajeros, etapa) y a la derecha una columna de solo lectura con la solicitud, el
 * contacto, el perfil del cliente y las cotizaciones abiertas del negocio.
 *
 * Aquí vive lo PURO: de filas de la base a lo que se pinta. La lectura está en
 * `marco-negocio-datos.ts`.
 *
 * Lo que se decidió (y por qué) — ver el PR del marco:
 * - El presupuesto no está en la solicitud: sale de «Bolsillo declarado» del perfil.
 * - El código IATA del destino no tiene tabla propia: sale de los vuelos ya leídos
 *   de las cotizaciones del negocio, y SOLO si el vuelo llega a una ciudad con el
 *   mismo nombre del destino. Sin vuelo que coincida, va el nombre solo.
 * - Cotizaciones abiertas: borrador, enviada y aceptada. Fuera: rechazada y vencida.
 * - La lista se muestra en las etapas 2 (Cotización) y 3 (Seguimiento).
 */

import { lugarConCodigo, sinTildes } from '@/lib/pdf/cotizacion-trappvel-formato'
import { coberturaDeLinea, type LineaParaCobertura } from './cobertura-opciones'
import { encabezadoDelViaje, rangoDelViaje, resumenDelViaje } from './estado-pasos'
import { describirOcupacion, type Composicion } from './tarifa-pasajero'

/** Los estados que cuentan como cotización abierta del negocio. */
export const ESTADOS_ABIERTOS = ['borrador', 'enviada', 'aceptada'] as const

/** Las etapas (por número dentro de la línea) en que la columna lista las cotizaciones. */
export const ETAPAS_CON_COTIZACIONES: readonly number[] = [2, 3]

export interface SolicitudDelViaje {
  destino: string | null
  /** «Nacional» / «Internacional». */
  alcance: string | null
  /** «9 al 13 nov 2026». */
  fechas: string | null
  /** «fechas fijas» / «fechas móviles». */
  tipoDeFechas: string | null
  /** «2 adultos, 1 niño». */
  pasajeros: string | null
  requisitos: string | null
}

export interface PerfilDelCliente {
  tipo: string | null
  conQuienViaja: string | null
  bolsillo: string | null
  preferencias: string | null
  notas: string | null
}

export interface ContactoDelNegocio {
  nombre: string | null
  telefono: string | null
  email: string | null
}

export interface CotizacionDeLaLista {
  id: string
  codigo: string
  estado: string
  /** El total de la Recomendada (`cotizaciones.valor_total`). */
  valorTotal: number | null
  /** Última edición, ISO. */
  editadaEl: string | null
}

export interface EtapaDelNegocio {
  nombre: string
  /** venta · ejecucion · cobro. */
  stage: string | null
  numero: number | null
}

export interface MarcoDelNegocio {
  negocioId: string
  titular: string | null
  etapa: EtapaDelNegocio | null
  viaje: {
    destino: string | null
    fechas: { inicio: string | null; fin: string | null }
    composicion: Composicion | null
  }
  /** El código IATA del destino según los vuelos de cada cotización (por id). */
  iataPorCotizacion: Record<string, string | null>
  solicitud: SolicitudDelViaje
  contacto: ContactoDelNegocio | null
  perfil: PerfilDelCliente | null
  /** `null` = la etapa del negocio no lista cotizaciones. */
  cotizaciones: CotizacionDeLaLista[] | null
  /** Si ya hay una aceptada, no se ofrece crear otra (igual que el bloque del negocio). */
  puedeCrearCotizacion: boolean
}

function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

const ALCANCE: Record<string, string> = { nacional: 'Nacional', internacional: 'Internacional' }
const TIPO_FECHAS: Record<string, string> = { fijas: 'fechas fijas', moviles: 'fechas móviles' }
const TIPO_CLIENTE: Record<string, string> = { leisure: 'Leisure', corporativo: 'Corporativo' }
const BOLSILLO: Record<string, string> = { economico: 'Económico', medio: 'Medio', alto: 'Alto' }

/** De las filas de `negocio_bloques.data` a la solicitud. El primer valor que aparece gana. */
export function solicitudDesdeFilas(
  filas: readonly Record<string, unknown>[],
  viaje: MarcoDelNegocio['viaje'],
): SolicitudDelViaje {
  const primero = (slug: string) => {
    for (const f of filas) {
      const v = texto(f[slug])
      if (v) return v
    }
    return null
  }
  const alcance = primero('destino_tipo')
  const tipoFechas = primero('fechas_tipo')
  return {
    destino: viaje.destino,
    alcance: alcance ? ALCANCE[alcance] ?? alcance : null,
    fechas: rangoDelViaje(viaje.fechas.inicio, viaje.fechas.fin),
    tipoDeFechas: tipoFechas ? TIPO_FECHAS[tipoFechas] ?? tipoFechas : null,
    pasajeros: viaje.composicion ? describirOcupacion(viaje.composicion) : null,
    requisitos: primero('requisitos_especiales'),
  }
}

/**
 * El perfil del cliente desde `contactos.custom_data`. Solo pasan los campos del perfil:
 * el documento de identidad y la autorización de datos no salen a esta columna.
 * `null` si no hay nada que mostrar.
 */
export function perfilDesdeCustomData(raw: unknown): PerfilDelCliente | null {
  const cd = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tipo = texto(cd.tipo_cliente)
  const bolsillo = texto(cd.rango_presupuesto)
  const perfil: PerfilDelCliente = {
    tipo: tipo ? TIPO_CLIENTE[tipo] ?? tipo : null,
    conQuienViaja: texto(cd.con_quien_viaja),
    // «sin declarar» es no saberlo: no se pinta como si fuera un bolsillo.
    bolsillo: bolsillo && bolsillo !== 'sin declarar' ? BOLSILLO[bolsillo] ?? bolsillo : null,
    preferencias: texto(cd.preferencias),
    notas: texto(cd.notas_perfil),
  }
  return Object.values(perfil).some(v => v !== null) ? perfil : null
}

function comparable(s: string): string {
  return sinTildes(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * El código IATA del destino, leído de los vuelos. Solo cuando algún tramo LLEGA a una
 * ciudad que se llama como el destino: un vuelo Bogotá–San Andrés no le da código a un
 * viaje a Providencia. Sin coincidencia, `null` y el encabezado va con el nombre solo.
 */
export function iataDelDestino(destino: string | null, lineas: readonly LineaParaCobertura[]): string | null {
  const d = destino ? comparable(destino) : ''
  if (!d) return null
  for (const l of lineas) {
    const c = coberturaDeLinea(l)
    if (c.estado !== 'leida') continue
    // Solo el tramo de ida: el regreso llega al ORIGEN del viaje, no al destino.
    const lugar = lugarConCodigo(c.tramos[0]?.hasta)
    if (lugar?.iata && comparable(lugar.nombre) === d) return lugar.iata
  }
  return null
}

/** «Providencia · PVA · 9 al 13 nov 2026 · 2 adultos» y el ámbar de P9 si falta algo. */
export function encabezadoDelMarco(viaje: MarcoDelNegocio['viaje'], iata: string | null) {
  const base = encabezadoDelViaje(viaje)
  const destino = viaje.destino?.trim() || null
  return {
    resumen: resumenDelViaje({ ...viaje, destino: destino && iata ? `${destino} · ${iata}` : destino }),
    motivo: base.motivo,
  }
}

/** Las cotizaciones que se listan: abiertas, la última editada primero. */
export function cotizacionesAbiertas(
  filas: readonly { id: string; codigo?: string | null; consecutivo?: string | null; estado: string; valor_total?: number | null; updated_at?: string | null; created_at?: string | null }[],
): CotizacionDeLaLista[] {
  return filas
    .filter(f => (ESTADOS_ABIERTOS as readonly string[]).includes(f.estado))
    .map(f => ({
      id: f.id,
      codigo: f.codigo || f.consecutivo || 'Sin código',
      estado: f.estado,
      valorTotal: typeof f.valor_total === 'number' ? f.valor_total : f.valor_total == null ? null : Number(f.valor_total),
      editadaEl: f.updated_at ?? f.created_at ?? null,
    }))
    .sort((a, b) => (b.editadaEl ?? '').localeCompare(a.editadaEl ?? ''))
}

export function muestraCotizaciones(etapa: EtapaDelNegocio | null): boolean {
  return etapa?.numero != null && ETAPAS_CON_COTIZACIONES.includes(etapa.numero)
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «23 sep», en hora de Bogotá. */
export function fechaCortaBogota(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const d = new Date(t - 5 * 3600 * 1000)
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
}
