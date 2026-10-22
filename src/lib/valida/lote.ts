/**
 * El cargue masivo de Valida procesado en el SERVIDOR: lo puro (sin red, sin base, sin React).
 *
 * Hasta el 2026-10-15 el navegador corría el lote con un server action por fila. Next encola los
 * server actions del cliente y los corre de a uno (`actionQueue` del router), así que el lote iba en
 * serie aunque el código pidiera 3 a la vez, con la puerta CDA resuelta ~3 veces por fila, y cerrar
 * la pestaña lo cortaba. Ahora el archivo se sube una vez y un trabajador del servidor procesa las
 * filas (`lote-servidor.ts`). Ver la migración `20261015231700_valida_lotes_servidor.sql`.
 */

import type { FilaLotePreparada, TipoDocumento, TipoPersona, ValidaConsultaInput } from '@/lib/actions/valida-consultas'
import { CODIGO_BUSQUEDA_INCOMPLETA, ROTULO_NO_COMPLETADA, mensajeErrorValida } from './mensajes-error'

// ─── Topes y ritmo ──────────────────────────────────────────────────────────────

/**
 * Filas por lote. 10.000 porque:
 *   - el XLSX de 10.000 filas pesa ~0,5 MB, lejos del tope de 5 MB del archivo y del de 20 MB de los
 *     server actions;
 *   - con 8 filas a la vez y ~0,5 s por fila (Valida p50 0,39 s + tres escrituras en ONE) son ~10–17
 *     filas por segundo: 10.000 filas en 10–17 minutos, dentro del día y de la autorización de 2 h;
 *   - el PDF del lote sale en partes de 500 (tope de `POST /reporte-lote` de Valida): 20 partes;
 *   - la guía de Valida para integradores ya habla de lotes de 9.000 filas.
 * Más que eso pide partir el archivo: un lote más grande ocupa su turno más tiempo sin dar nada a cambio.
 */
export const TOPE_FILAS_LOTE = 10_000

/** Filas a la vez POR LOTE. Valida aguanta 20 por cliente (su guía de concurrencia); 8 deja holgura. */
export const CONCURRENCIA_POR_LOTE = 8

/**
 * Lotes procesándose a la vez en todo ONE. Con 8 filas cada uno son a lo sumo 24 consultas en vuelo
 * contra Valida, que comparte la base entre todos sus clientes: un cliente grande no satura a los demás.
 */
export const LOTES_SIMULTANEOS = 3

/** Un turno de un lote dura a lo sumo esto; después el lote vuelve a la fila y pasa el siguiente. */
export const TURNO_MS = 60_000

/**
 * Lo que dura el turno en la base: el turno, más lo que tardan en terminar las filas en vuelo
 * (30 s de tope de Valida + un reintento), más holgura. Vencido, otro trabajador toma el lote.
 */
export const TURNO_RECLAMO_S = 150

/** Lo que dura el reclamo de una fila: el tope de Valida (30 s), un reintento y holgura. */
export const FILA_RECLAMO_S = 120

/** Consultas por PDF del lote: el tope de `POST /api/v1/reporte-lote` de Valida. */
export const CONSULTAS_POR_PDF = 500

/** Lotes con al menos tantas filas avisan por correo al terminar o detenerse. */
export const FILAS_PARA_AVISO_CORREO = 100

/** Lo más que vale la autorización de la sesión (la puerta CDA completa) sin volver a mirarla. */
export const AUTORIZACION_MAX_MS = 2 * 60 * 60 * 1000

function entero(v: string | undefined, min: number, max: number, defecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : defecto
}

/** Filas a la vez de un lote: la del lote, si no la del entorno (`VALIDA_LOTE_CONCURRENCIA`), si no 8. */
export function concurrenciaDelLote(propia: number | null | undefined, entorno = process.env.VALIDA_LOTE_CONCURRENCIA): number {
  if (typeof propia === 'number' && Number.isInteger(propia) && propia >= 1 && propia <= 20) return propia
  return entero(entorno, 1, 20, CONCURRENCIA_POR_LOTE)
}

/** Lotes a la vez en todo ONE (`VALIDA_LOTES_SIMULTANEOS`, 1–10; 3 por defecto). */
export function lotesSimultaneos(entorno = process.env.VALIDA_LOTES_SIMULTANEOS): number {
  return entero(entorno, 1, 10, LOTES_SIMULTANEOS)
}

// ─── Autorización ───────────────────────────────────────────────────────────────

const MS_DIA = 24 * 60 * 60 * 1000
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000 // UTC-5, sin horario de verano

/**
 * Hasta cuándo vale la autorización que dio la sesión: dos horas, y nunca más allá de la medianoche
 * de Bogotá. La mora y la vigencia de los términos se miden por DÍA (`plazos.ts`): al cambiar el día
 * pueden cambiar, y el lote tiene que volver a preguntar. Lo que cambia dentro del día (el módulo, los
 * contratos) lo mira el trabajador en cada turno.
 */
export function autorizadoHasta(ahora: Date): Date {
  const bogota = ahora.getTime() - BOGOTA_OFFSET_MS
  const medianoche = Math.floor(bogota / MS_DIA) * MS_DIA + MS_DIA + BOGOTA_OFFSET_MS
  return new Date(Math.min(ahora.getTime() + AUTORIZACION_MAX_MS, medianoche))
}

// ─── Filas ──────────────────────────────────────────────────────────────────────

/**
 * La llave de idempotencia de una fila en Valida (`Idempotency-Key`, 1–64 ASCII). Con ella, si un
 * trabajador muere después de que Valida cobró la consulta, el reintento recibe la misma respuesta
 * guardada y no se cobra otra vez (Valida la guarda 24 h).
 */
export function claveIdempotenciaFila(filaId: string): string {
  return `one-lote-fila-${filaId}`
}

/**
 * ¿Esta fila gasta una consulta? Valida rechaza sin cobrar (400) una entrada sin nombre de 2+
 * caracteres ni documento de 3+; todo lo demás se cobra. Es lo que se compara contra la bolsa.
 */
export function filaConsume(input: ValidaConsultaInput): boolean {
  const nombre = (input.nombre ?? '').trim()
  const doc = (input.documento?.numero ?? '').trim()
  return nombre.length >= 2 || doc.length >= 3
}

/**
 * Las filas que caben en `saldo` consultas, en el orden del archivo. Las que no gastan consulta
 * (Valida las rechaza sin cobrar) entran todas mientras quede alguna por consumir.
 */
export function recortarAlSaldo<T extends { input: ValidaConsultaInput }>(filas: readonly T[], saldo: number): T[] {
  const out: T[] = []
  let usadas = 0
  for (const f of filas) {
    if (filaConsume(f.input)) {
      if (usadas >= saldo) break
      usadas += 1
    }
    out.push(f)
  }
  return out
}

/** Severidad del CONTADOR de la pantalla: una fila mal escrita en el XLSX cuenta como error, como siempre. */
export function severidadDelConteo(errorParseo: string | null, severidad: string): string {
  return errorParseo ? 'error' : severidad
}

/** Cuántos PDF salen de un lote con `n` consultas con reporte. */
export function partesDelPdf(n: number): number {
  return Math.ceil(Math.max(0, n) / CONSULTAS_POR_PDF)
}

/**
 * Lo que antes hacía `prepararLoteValida` fila por fila, idéntico: las filas del XLSX como entradas
 * para Valida. No cambia nada de lo que se manda (es lo que hace que el resultado sea el mismo).
 */
export type FilaXLSX = {
  tipo_persona: string
  nombre_completo: string
  tipo_documento?: string
  numero_documento?: string
  negocio_codigo?: string
}

export function filasDesdeXlsx(
  rows: readonly FilaXLSX[],
  codigoToId: ReadonlyMap<string, string>,
  negocioIdLote: string | null,
): FilaLotePreparada[] {
  return rows.map((fila, idx) => {
    const tipoPersona = String(fila.tipo_persona ?? '').trim().toLowerCase() as TipoPersona
    const nombre = String(fila.nombre_completo ?? '').trim()
    const tipoDoc = String(fila.tipo_documento ?? '').trim().toUpperCase() as TipoDocumento
    const numDoc = String(fila.numero_documento ?? '').trim()
    const negocioCodigo = String(fila.negocio_codigo ?? '').trim()

    const negocioId = negocioCodigo ? codigoToId.get(negocioCodigo) ?? null : negocioIdLote ?? null

    const tipoValido = tipoPersona === 'natural' || tipoPersona === 'juridica'
    const tieneDoc = !!(numDoc && tipoDoc)

    // Al menos un dato identificador: nombre o documento (consistente con el motor).
    if (!tipoValido || (!nombre && !tieneDoc)) {
      return {
        posicion: idx + 1,
        input: {
          tipo: tipoPersona === 'juridica' ? 'juridica' : 'natural',
          ...(nombre ? { nombre } : {}),
        },
        negocio_id: negocioId,
        error: 'tipo_persona invalido o fila sin nombre ni documento',
      }
    }

    const input: ValidaConsultaInput = {
      tipo: tipoPersona,
      ...(nombre ? { nombre } : {}),
      ...(tieneDoc ? { documento: { tipo: tipoDoc, numero: numDoc } } : {}),
    }

    return { posicion: idx + 1, input, negocio_id: negocioId, error: null }
  })
}

// ─── Estados y pausas ───────────────────────────────────────────────────────────

export type EstadoLote = 'preparando' | 'en_cola' | 'procesando' | 'pausado' | 'completado' | 'cancelado'

export type MotivoPausa =
  | 'bolsa_agotada'
  | 'bolsa_vencida'
  | 'reautorizar'
  | 'acceso'
  | 'sin_llave'
  | 'valida_rechazo'

export function loteActivo(estado: string): boolean {
  return estado === 'en_cola' || estado === 'procesando'
}

/** Lo que la pantalla dice de una pausa. */
export function textoPausa(motivo: string | null, detalle: string | null): string {
  switch (motivo) {
    case 'bolsa_agotada':
      return 'Se agotaron las consultas de tu bolsa. Las filas que faltan no se consultaron ni se cobraron.'
    case 'bolsa_vencida':
      return 'Tu bolsa de consultas venció. Las filas que faltan no se consultaron ni se cobraron.'
    case 'reautorizar':
      return 'El cargue se detuvo para volver a verificar el acceso de tu espacio. Reanúdalo para seguir.'
    case 'acceso':
      return detalle ?? 'Tu espacio perdió el acceso a Valida durante el cargue.'
    case 'sin_llave':
      return 'Tu espacio no tiene una llave de Valida configurada. Escríbenos para revisarlo.'
    case 'valida_rechazo':
      return `Valida rechazó las consultas (${detalle ?? 'sin detalle'}). Las filas que faltan no se cobraron.`
    default:
      return detalle ?? 'El cargue está detenido.'
  }
}

const SEVERIDAD_TEXTO: Record<string, string> = {
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
  informativo: 'Informativo',
  sin_hallazgo: 'Sin hallazgo',
  error: 'Error',
}

/**
 * La columna «severidad» del XLSX de resultados. Una búsqueda incompleta no es un resultado
 * («Error» se leía como uno): se rotula para reintentar.
 */
export function textoSeveridadFila(f: { estado: string; severidad: string | null; resultado_error: string | null }): string {
  if (f.estado === 'pendiente' || f.estado === 'en_curso') return 'Sin consultar'
  if (f.resultado_error === CODIGO_BUSQUEDA_INCOMPLETA) return ROTULO_NO_COMPLETADA
  return SEVERIDAD_TEXTO[f.severidad ?? ''] ?? f.severidad ?? ''
}

export type FilaResultadoLote = {
  posicion: number
  entrada: { tipo?: string; nombre?: string; documento?: { tipo?: string; numero?: string } } | null
  estado: string
  severidad: string | null
  total_matches: number | null
  valida_consulta_id: string | null
  resultado_error: string | null
  error_parseo: string | null
}

/** Una fila del XLSX de resultados del cargue, en el orden del encabezado. */
export function celdasFilaResultado(f: FilaResultadoLote): Array<string | number> {
  return [
    f.posicion + 1, // la fila del XLSX, contando el encabezado
    f.entrada?.tipo ?? '',
    f.entrada?.nombre ?? '',
    f.entrada?.documento?.tipo ?? '',
    f.entrada?.documento?.numero ?? '',
    textoSeveridadFila(f),
    f.total_matches ?? '',
    f.valida_consulta_id ?? '',
    // El error de parseo es de ONE y ya viene en frase; el de Valida es un código y se traduce.
    f.error_parseo ?? (f.resultado_error ? mensajeErrorValida(f.resultado_error).mensaje : ''),
  ]
}
