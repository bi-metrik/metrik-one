/**
 * El negocio alrededor de la cotización de viaje (Trappvel, decisión de layout del
 * 2026-09-23).
 *
 * La cotización se pinta DENTRO del mismo marco de la página del negocio: el mismo
 * encabezado y el mismo panel derecho, con los mismos componentes (corrección de
 * Mauricio a #874: ir y volver entre las dos pantallas no puede mover nada). Lo que la
 * cotización necesitaba ver —el viaje con su IATA, la solicitud, el perfil del cliente y
 * las cotizaciones abiertas— entra a ESOS componentes y se ve también en el negocio.
 *
 * Aquí vive lo PURO: de filas de la base a lo que se pinta. La lectura está en
 * `marco-negocio-datos.ts`.
 *
 * Lo que se decidió (y por qué) — ver el PR del marco:
 * - El presupuesto va en la solicitud si el viaje lo trae; entonces el perfil no repite «Bolsillo declarado»
 *   (especificación de Noor, 2026-10-26). Sin él, el bolsillo del perfil se sigue viendo.
 * - El código IATA del destino no tiene tabla propia: sale de los vuelos ya leídos de
 *   las cotizaciones ABIERTAS del negocio (no de la que esté abierta en pantalla, para
 *   que las dos pantallas digan lo mismo), y SOLO si el vuelo llega a una ciudad con el
 *   mismo nombre del destino. Sin vuelo que coincida, va el nombre solo.
 * - Cotizaciones abiertas: borrador, enviada y aceptada. Fuera: rechazada y vencida.
 * - La lista se muestra en las etapas 2 (Cotización) y 3 (Seguimiento).
 */

import { lugarConCodigo, sinTildes } from '@/lib/pdf/cotizacion-trappvel-formato'
import { coberturaDeLinea, type LineaParaCobertura } from './cobertura-opciones'
import { encabezadoDelViaje, rangoDelViaje, resumenDelViaje } from './estado-pasos'
import { describirOcupacion, type Composicion } from './tarifa-pasajero'
import { esValorBloqueo } from './bloqueo-modalidad'

/** Los estados que cuentan como cotización abierta del negocio. */
export const ESTADOS_ABIERTOS = ['borrador', 'enviada', 'aceptada'] as const

/** Las etapas (por número dentro de la línea) en que la columna lista las cotizaciones. */
export const ETAPAS_CON_COTIZACIONES: readonly number[] = [2, 3]

/**
 * Una fila de la tarjeta «Solicitud». `larga`: texto libre (label arriba, valor a lo ancho, recortado a 3 líneas y
 * desplegable). `detalle`: texto libre debajo del valor, en gris (las edades bajo los pasajeros).
 */
export interface FilaSolicitud {
  clave: 'destino' | 'modalidad' | 'origen' | 'fechas' | 'pasajeros' | 'grupo' | 'presupuesto' | 'hotel' | 'alimentacion'
    | 'acomodacion' | 'equipaje' | 'menores' | 'requisitos'
  label: string
  valor: string
  larga?: boolean
  detalle?: string
}

/**
 * Los datos clave de «Condiciones del viaje» (especificación de Noor, 2026-10-26; más la modalidad del bloqueo, 2026-10-27): hasta 13 filas, cada una solo si
 * tiene valor. Sin filas, la tarjeta dice que el negocio aún no tiene la solicitud.
 */
export interface SolicitudDelViaje {
  filas: FilaSolicitud[]
  /** La solicitud trae presupuesto: el perfil no repite el «Bolsillo declarado». */
  tienePresupuesto: boolean
}

/** Lo que se necesita de un campo de `bloque_configs.config_extra.fields` para nombrar sus opciones. */
export interface CampoConOpciones {
  slug: string
  tipo?: string
  /** Forma vieja: la lista de valores, o pares. */
  options?: ReadonlyArray<string | { value: string; label?: string }>
  /** Forma de la config de Trappvel: pares valor → etiqueta. */
  opciones?: ReadonlyArray<{ value: string; label?: string }>
}

export interface PerfilDelCliente {
  tipo: string | null
  conQuienViaja: string | null
  bolsillo: string | null
  preferencias: string | null
  notas: string | null
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
  viaje: {
    destino: string | null
    fechas: { inicio: string | null; fin: string | null }
    composicion: Composicion | null
  }
  /** El código IATA del destino según los vuelos de las cotizaciones abiertas. */
  iataDestino: string | null
  solicitud: SolicitudDelViaje
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

const TIPO_CLIENTE: Record<string, string> = { leisure: 'Leisure', corporativo: 'Corporativo' }
const BOLSILLO: Record<string, string> = { economico: 'Económico', medio: 'Medio', alto: 'Alto' }

/** Los slugs de `negocio_bloques.data` que lee la tarjeta (la lectura los pide uno por uno). */
export const SLUGS_SOLICITUD = [
  'destino', 'destino_tipo', 'tipo_viaje', 'ciudad_origen', 'fecha_salida', 'fecha_regreso', 'fechas_tipo',
  'flexibilidad_fecha', 'adultos', 'ninos', 'infantes', 'numero_pasajeros', 'edades_menores', 'composicion',
  'presupuesto', 'categoria_hotel', 'plan_alimentacion', 'acomodacion', 'equipaje', 'permiso_salida_menores',
  'requisitos_especiales',
  // Viaje en bloqueo (brief del 2026-10-27): A medida | Bloqueo, y el operador.
  'modalidad_viaje', 'operador_bloqueo',
] as const

/** «sin_preferencia» → «Sin preferencia»: un valor de opción que no está en la config. */
function humanizar(v: string): string {
  const t = v.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

function valorCrudo(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  return texto(v)
}

/** Etiqueta de un valor según las opciones del campo. Sin opciones conocidas, el texto tal cual. Pura. */
export function etiquetaDeValor(valor: string, campo: CampoConOpciones | undefined): string {
  // Una opción escrita solo como valor (`options: ['nacional']` o `{ value }` sin label) no trae etiqueta: se humaniza.
  const pares: Array<{ value: string; label?: string }> = [
    ...(campo?.opciones ?? []),
    ...(campo?.options ?? []).map(o => (typeof o === 'string' ? { value: o } : o)),
  ]
  const hit = pares.find(o => String(o.value) === valor)
  if (hit?.label) return hit.label
  const esLista = pares.length > 0 || campo?.tipo === 'select' || campo?.tipo === 'radio'
  // Campo desconocido: solo un valor con cara de slug («todo_incluido») se humaniza; el texto libre va tal cual.
  if (esLista || (!campo && /^[a-z0-9]+(_[a-z0-9]+)+$/.test(valor))) return humanizar(valor)
  return valor
}

const unir = (partes: ReadonlyArray<string | null | undefined>) => partes.filter((x): x is string => !!x).join(' · ') || null

/**
 * De las filas de `negocio_bloques.data` a la tarjeta «Solicitud». El primer valor que aparece gana (la misma regla de
 * siempre). `campos`: los fields de la línea, para que los select digan su etiqueta y no su valor.
 */
export function solicitudDesdeFilas(
  filas: readonly Record<string, unknown>[],
  viaje: MarcoDelNegocio['viaje'],
  campos: readonly CampoConOpciones[] = [],
): SolicitudDelViaje {
  const porSlug = new Map<string, CampoConOpciones>()
  for (const c of campos) if (c?.slug && !porSlug.has(c.slug)) porSlug.set(c.slug, c)
  const primero = (slug: string) => {
    for (const f of filas) {
      const v = valorCrudo(f[slug])
      if (v) return v
    }
    return null
  }
  const etiqueta = (slug: string) => {
    const v = primero(slug)
    return v ? etiquetaDeValor(v, porSlug.get(slug)) : null
  }

  const c = viaje.composicion
  const numero = primero('numero_pasajeros')
  const pasajeros = c && c.adultos + c.ninos + c.infantes > 0
    ? describirOcupacion(c)
    : numero && Number(numero) > 0 ? `${numero} ${Number(numero) === 1 ? 'pasajero' : 'pasajeros'}` : null
  const edades = primero('edades_menores')
  const hayMenores = !!c && c.ninos + c.infantes > 0
  const presupuesto = etiqueta('presupuesto')

  const candidatas: Array<FilaSolicitud | null> = [
    fila('destino', 'Destino', unir([viaje.destino, etiqueta('destino_tipo'), etiqueta('tipo_viaje')])),
    // Solo si es Bloqueo: A medida es el default y no se pinta (las tarjetas de siempre quedan iguales).
    esValorBloqueo(primero('modalidad_viaje')) ? fila('modalidad', 'Modalidad', unir(['Bloqueo', primero('operador_bloqueo')])) : null,
    fila('origen', 'Sale de', etiqueta('ciudad_origen')),
    fila('fechas', 'Fechas', unir([rangoDelViaje(viaje.fechas.inicio, viaje.fechas.fin), etiqueta('fechas_tipo'), etiqueta('flexibilidad_fecha')])),
    pasajeros ? { clave: 'pasajeros', label: 'Pasajeros', valor: pasajeros, ...(edades ? { detalle: `Edades: ${edades}` } : {}) } : null,
    fila('grupo', 'Grupo', etiqueta('composicion'), true),
    fila('presupuesto', 'Presupuesto', presupuesto),
    fila('hotel', 'Hotel', etiqueta('categoria_hotel')),
    fila('alimentacion', 'Alimentación', etiqueta('plan_alimentacion')),
    fila('acomodacion', 'Acomodación', etiqueta('acomodacion'), true),
    fila('equipaje', 'Equipaje', etiqueta('equipaje')),
    hayMenores ? fila('menores', 'Menores', etiqueta('permiso_salida_menores')) : null,
    fila('requisitos', 'Requisitos', etiqueta('requisitos_especiales'), true),
  ]
  return { filas: candidatas.filter((f): f is FilaSolicitud => f !== null), tienePresupuesto: !!presupuesto }
}

function fila(clave: FilaSolicitud['clave'], label: string, valor: string | null, larga = false): FilaSolicitud | null {
  if (!valor) return null
  return { clave, label, valor, ...(larga ? { larga: true } : {}) }
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
