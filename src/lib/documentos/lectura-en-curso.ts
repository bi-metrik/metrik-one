/**
 * La lectura de un documento corre DESPUÉS de responder, y su estado vive en la fila.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────────────
 * Hasta el 2026-10-05 `procesarDocumento` hacía todo dentro de la server action:
 * identificar el documento, extraer con IA, Drive, cruces. Medido en SOENA ese día:
 * p95 20,1 s. Una petición abierta 20 s sobre una línea que pierde paquetes (Claro/Telmex:
 * 24 errores por 10.000 GET, el resto casi 0) se rompe mucho más que una de 0,3 s, no se
 * reintenta sola, y Next pone las server actions en fila: mientras el documento se leía,
 * cualquier otro guardado de esa pestaña esperaba detrás.
 *
 * Ahora la acción valida, deja la marca `leyendo` en `data._lectura` y responde. La lectura
 * corre con `after()` (`src/lib/segundo-plano.ts`) y deja su resultado en la MISMA marca;
 * la tarjeta lo pide por GET (`/api/negocios/<id>/lectura/<bloqueId>`).
 *
 * ── Gana el último ───────────────────────────────────────────────────────────────────
 * Cada lectura lleva su `token`. Antes de lo destructivo (borrar el archivo anterior de
 * Drive, consolidar la subida externa) y al escribir el resultado, la lectura comprueba que
 * la marca sigue siendo SUYA; la escritura final es condicional al token (compare-and-set).
 * Si otra subida o un reintento la reemplazó, se retira sin tocar la fila.
 *
 * ── Los gates ────────────────────────────────────────────────────────────────────────
 * Mientras lee, el bloque queda `pendiente` (`puede_avanzar_etapa` solo mira el estado) y
 * `cambiarEtapaNegocioConGate` además frena por la marca, para los cruces que leen
 * `_cross_check` viejo. Si la lectura no prospera, el estado vuelve a `estado_previo`.
 *
 * ── Una marca que nunca termina ──────────────────────────────────────────────────────
 * La lectura vive dentro de la invocación (tope `maxDuration = 60` de la ficha). Si la
 * función muere, la marca queda `leyendo` para siempre: pasados `LECTURA_VENCE_MS` se
 * trata como vencida (error visible con «Reintentar») y deja de frenar el avance.
 *
 * Puro y sin IO: lo usan la acción, la ruta, el gate y la tarjeta.
 */

import type { DocumentoRechazado } from './tipo-documento'

export type EstadoLectura = 'leyendo' | 'lista' | 'error' | 'rechazado'

/** `carga`: archivo nuevo (`procesarDocumento`). `reproceso`: el archivo ya guardado. */
export type TipoLectura = 'carga' | 'reproceso'

export interface MarcaLectura {
  token: string
  estado: EstadoLectura
  tipo: TipoLectura
  iniciada_at: string
  terminada_at?: string
  /** El estado del bloque ANTES de la lectura: se repone si no prospera. */
  estado_previo?: 'pendiente' | 'completo'
  /** Solo `carga`: lo que hace falta para reintentar sin volver a subir el archivo. */
  file_name?: string
  storage_path?: string
  error?: string
  documento_rechazado?: DocumentoRechazado
}

/**
 * Tras esto una marca `leyendo` se da por muerta. La lectura corre dentro de la invocación
 * de la ficha (`maxDuration = 60`): 90 s deja 30 s de holgura sobre el tope.
 */
export const LECTURA_VENCE_MS = 90_000

export const MENSAJE_LECTURA_VENCIDA =
  'La lectura del documento no terminó. Reintenta o vuelve a cargar el archivo.'

const ESTADOS: readonly EstadoLectura[] = ['leyendo', 'lista', 'error', 'rechazado']

/** La marca guardada en `data._lectura`, o `null` si no hay una bien formada. */
export function leerMarca(data: unknown): MarcaLectura | null {
  if (!data || typeof data !== 'object') return null
  const m = (data as { _lectura?: unknown })._lectura
  if (!m || typeof m !== 'object') return null
  const marca = m as Partial<MarcaLectura>
  if (typeof marca.token !== 'string' || !marca.token) return null
  if (!ESTADOS.includes(marca.estado as EstadoLectura)) return null
  if (typeof marca.iniciada_at !== 'string') return null
  return marca as MarcaLectura
}

/** `leyendo` y todavía dentro del plazo. */
export function lecturaVigente(marca: MarcaLectura | null, ahora: number = Date.now()): boolean {
  if (!marca || marca.estado !== 'leyendo') return false
  const inicio = Date.parse(marca.iniciada_at)
  if (!Number.isFinite(inicio)) return false
  return ahora - inicio < LECTURA_VENCE_MS
}

/** Atajo para el gate: ¿la fila tiene una lectura en curso? */
export function bloqueLeyendo(data: unknown, ahora: number = Date.now()): boolean {
  return lecturaVigente(leerMarca(data), ahora)
}

/** Lo que ve la pantalla: una `leyendo` vencida es un error, no un spinner eterno. */
export type EstadoVisibleLectura = EstadoLectura | 'vencida'

export function estadoVisible(marca: MarcaLectura, ahora: number = Date.now()): EstadoVisibleLectura {
  if (marca.estado === 'leyendo' && !lecturaVigente(marca, ahora)) return 'vencida'
  return marca.estado
}

/**
 * Espera antes de la consulta `intento` (0, 1, 2…). Arranca corta porque la mayoría de las
 * lecturas sin IA terminan en 2-3 s, y se estira a 4 s para no golpear la red mala.
 */
export function esperaDeConsulta(intento: number): number {
  const pasos = [1_500, 2_000, 3_000]
  return pasos[intento] ?? 4_000
}

/** Un token nuevo. `crypto.randomUUID` existe en Node 19+ y en los navegadores vigentes. */
export function nuevoToken(): string {
  return globalThis.crypto.randomUUID()
}

/** La respuesta de la ruta de consulta. `marca: null` = el bloque no tiene lectura. */
export interface RespuestaLectura {
  marca: MarcaLectura | null
  /**
   * `leyendo` pasada de plazo, medido con el reloj del SERVIDOR: el de un teléfono puede
   * estar corrido minutos y convertir una lectura viva en vencida (o al revés).
   */
  vencida?: boolean
  /** Solo cuando la lectura terminó `lista`: lo que la tarjeta pinta sin esperar el refresh. */
  bloque?: {
    estado: string | null
    drive_url: string | null
    file_name: string | null
    campos: Record<string, unknown> | null
    extraction_status: 'ok' | 'failed' | 'no_key' | null
  }
  error?: string
}

// ── Lo que hace la tarjeta mientras espera ───────────────────────────────────────────

/** Cómo terminó la espera. `sin_confirmar`: la red no dejó saberlo (no es un error del documento). */
export type FinLectura =
  | { tipo: 'lista'; respuesta: RespuestaLectura }
  | { tipo: 'rechazado' | 'error'; marca: MarcaLectura }
  | { tipo: 'vencida'; marca: MarcaLectura }
  | { tipo: 'sin_confirmar' }
  | { tipo: 'sin_lectura' }

/**
 * Pregunta por la lectura hasta que termina. Nunca espera para siempre:
 *  · si el servidor dice `vencida`, termina como vencida;
 *  · si la red no deja preguntar durante `plazoMs`, termina `sin_confirmar` (la pantalla
 *    ofrece volver a consultar: la lectura pudo terminar bien sin que se supiera).
 * Sigue a la lectura MÁS NUEVA del bloque: si otra subida la reemplazó, espera a esa.
 */
export async function esperarLectura(opts: {
  pedir: (signal?: AbortSignal) => Promise<RespuestaLectura>
  dormir?: (ms: number) => Promise<void>
  ahora?: () => number
  signal?: AbortSignal
  plazoMs?: number
}): Promise<FinLectura> {
  const {
    pedir,
    dormir = (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    ahora = Date.now,
    signal,
    plazoMs = LECTURA_VENCE_MS + 15_000,
  } = opts
  const inicio = ahora()
  let ultimaRespuesta = inicio
  for (let intento = 0; ; intento++) {
    await dormir(esperaDeConsulta(intento))
    if (signal?.aborted) return { tipo: 'sin_confirmar' }
    let r: RespuestaLectura
    try {
      r = await pedir(signal)
    } catch {
      if (signal?.aborted) return { tipo: 'sin_confirmar' }
      if (ahora() - ultimaRespuesta > plazoMs) return { tipo: 'sin_confirmar' }
      continue
    }
    ultimaRespuesta = ahora()
    const marca = r.marca
    if (!marca) return { tipo: 'sin_lectura' }
    if (marca.estado === 'leyendo') {
      if (r.vencida) return { tipo: 'vencida', marca }
      continue
    }
    if (marca.estado === 'lista') return { tipo: 'lista', respuesta: r }
    return { tipo: marca.estado, marca }
  }
}
