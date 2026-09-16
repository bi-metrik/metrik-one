/**
 * Núcleo del cliente HTTP de ONE hacia `/api/one/v1/*` de Valida. Puro y con dependencias
 * inyectadas (fetch, reloj, secreto, base) para poder probarlo sin red.
 *
 * `cliente.ts` es la única capa que lee el entorno; este archivo nunca toca `process.env`.
 *
 * ## Tres resultados, y por qué tres
 *
 *   - `ok`            — Valida respondió 2xx.
 *   - `rechazada`     — Valida respondió 4xx con su error (`{ error, message }`). Es una respuesta
 *                       válida que la pantalla tiene que explicar: límite de llaves, llave que no
 *                       existe, cliente que no es de API directa (422).
 *   - `no_disponible` — no hubo respuesta usable: sin secreto configurado, red caída, tiempo
 *                       agotado, 5xx o 503 de Valida. La pestaña dice «no disponible» y el resto
 *                       de la página carga igual (§5.4).
 *
 * Separar `rechazada` de `no_disponible` es lo que evita la pantalla que miente: «Valida no
 * responde» y «Valida dijo que no» llevan a acciones distintas.
 *
 * ## Lo que este archivo NUNCA hace
 *
 * No escribe en consola ningún cuerpo, ni de ida ni de vuelta. La respuesta de generar una llave
 * trae la llave EN CLARO: un `console.log` aquí la dejaría en los logs de Vercel para siempre.
 * Lo único que se registra es el método, la ruta relativa, el status y el código de error.
 */

import { encabezadosOne, type ActorOne } from './firma'

export type MotivoNoDisponible = 'sin_secreto' | 'sin_base' | 'red' | 'tiempo_agotado' | 'error_valida' | 'respuesta_invalida'

export type ResultadoValida<T> =
  | { tipo: 'ok'; status: number; datos: T }
  | { tipo: 'rechazada'; status: number; codigo: string; mensaje: string }
  | { tipo: 'no_disponible'; motivo: MotivoNoDisponible; status?: number }

export interface DependenciasCliente {
  secreto: string | null | undefined
  base: string | null | undefined
  fetch: typeof fetch
  /** Segundos Unix. */
  ahora: () => number
  timeoutMs?: number
  /** Solo metadatos: nunca recibe cuerpos. */
  registrar?: (linea: string) => void
}

export interface PeticionValida {
  metodo: 'GET' | 'POST' | 'PUT'
  /** Ruta relativa a `/api/one/v1`, ya con el cliente puesto por el servidor. */
  ruta: string
  actor: ActorOne
  /** Se serializa una vez y ESE texto es el que se firma y se manda. */
  cuerpo?: unknown
}

const TIMEOUT_POR_DEFECTO_MS = 8000

export async function llamarValidaNucleo<T>(
  peticion: PeticionValida,
  deps: DependenciasCliente,
): Promise<ResultadoValida<T>> {
  const registrar = deps.registrar ?? (() => {})
  const secreto = (deps.secreto ?? '').trim()
  // La ausencia del secreto nunca autoriza, y tampoco se llama sin él: Valida contestaría 503
  // y la pantalla diría lo mismo, pero sin gastar la llamada ni ensuciar su bitácora.
  if (!secreto) return { tipo: 'no_disponible', motivo: 'sin_secreto' }

  const base = (deps.base ?? '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) return { tipo: 'no_disponible', motivo: 'sin_base' }

  // El cuerpo se serializa UNA vez: lo que se firma tiene que ser byte a byte lo que viaja.
  const cuerpoTexto = peticion.metodo === 'GET' || peticion.cuerpo === undefined ? '' : JSON.stringify(peticion.cuerpo)
  const t = deps.ahora()
  const headers: Record<string, string> = {
    ...encabezadosOne(secreto, peticion.actor, cuerpoTexto, t),
    accept: 'application/json',
  }
  if (cuerpoTexto) headers['content-type'] = 'application/json'

  const controlador = new AbortController()
  const temporizador = setTimeout(() => controlador.abort(), deps.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS)

  let respuesta: Response
  try {
    respuesta = await deps.fetch(`${base}/api/one/v1${peticion.ruta}`, {
      method: peticion.metodo,
      headers,
      body: cuerpoTexto || undefined,
      signal: controlador.signal,
      cache: 'no-store',
    })
  } catch (e) {
    const abortado = (e as { name?: string } | null)?.name === 'AbortError'
    registrar(`[valida-api] ${peticion.metodo} ${peticion.ruta} -> ${abortado ? 'tiempo agotado' : 'error de red'}`)
    return { tipo: 'no_disponible', motivo: abortado ? 'tiempo_agotado' : 'red' }
  } finally {
    clearTimeout(temporizador)
  }

  let datos: unknown = null
  try {
    datos = await respuesta.json()
  } catch {
    datos = null
  }

  // 5xx y 503 (secreto ausente del lado de Valida): no hay respuesta que explicar.
  if (respuesta.status >= 500) {
    const codigo = (datos as { error?: string } | null)?.error ?? ''
    registrar(`[valida-api] ${peticion.metodo} ${peticion.ruta} -> ${respuesta.status} ${codigo}`)
    return { tipo: 'no_disponible', motivo: 'error_valida', status: respuesta.status }
  }

  if (respuesta.status >= 400) {
    const d = (datos ?? {}) as { error?: unknown; message?: unknown }
    const codigo = typeof d.error === 'string' ? d.error : 'error_desconocido'
    const mensaje = typeof d.message === 'string' ? d.message : 'Valida rechazó la operación.'
    registrar(`[valida-api] ${peticion.metodo} ${peticion.ruta} -> ${respuesta.status} ${codigo}`)
    return { tipo: 'rechazada', status: respuesta.status, codigo, mensaje }
  }

  if (datos === null || typeof datos !== 'object') {
    registrar(`[valida-api] ${peticion.metodo} ${peticion.ruta} -> ${respuesta.status} cuerpo no es JSON`)
    return { tipo: 'no_disponible', motivo: 'respuesta_invalida', status: respuesta.status }
  }

  return { tipo: 'ok', status: respuesta.status, datos: datos as T }
}
