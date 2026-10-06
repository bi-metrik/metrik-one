/**
 * La bandeja de capturas habla con el servidor por `fetch`, NUNCA por server action.
 *
 * POR QUÉ (prueba de Mauricio en COT-2026-0016, 2026-09-24): Next despacha las server actions
 * y los `router.refresh()` de una página en UNA sola fila (`app-router-instance`). Cada
 * pantallazo pegado lanzaba dos server actions (detectar, leer) de 8 a 25 s, así que con siete
 * pegados la fila se llenaba y el `router.refresh()` que sigue a cada «Aceptar» esperaba detrás
 * de todas las lecturas: la captura ya estaba en la base y Componentes no la mostraba. En los
 * registros de Vercel se ve: las tres aceptaciones entraron a las 19:08:18-23 y el refresco
 * llegó a las 19:08:40, cuando terminó la última lectura. Un `fetch` no entra a esa fila, y de
 * paso las lecturas corren a la vez en vez de una detrás de otra.
 *
 * ## La red se cae: se reintenta, se dice y queda registrado (caso Alejandra, 2026-10-05)
 *
 * En N1 26 1 cuatro peticiones de la bandeja de Alejandra NUNCA llegaron a Vercel (la cuenta de
 * peticiones del borde no las tiene, ni siquiera como error): la detección de Cabañas Agua
 * Dulce, su «Aceptar» y la lectura de los dos pantallazos que pegó juntos. Cada una pesaba
 * ~0,5 MB (el pantallazo va adentro) y su red estaba degradada. El `fetch` lanzó y la bandeja
 * dijo «Inténtalo otra vez» / «Vuelve a pegarlo» sin dejar rastro en ningún log.
 *
 * Desde entonces cada envío:
 *  · se REINTENTA solo cuando no hubo respuesta legible (el `fetch` lanzó, o volvió algo que no
 *    es JSON, como la página de error del borde). Una respuesta JSON, aunque sea `ok:false`, es
 *    la decisión del servidor y no se repite. Detectar y leer no escriben nada; «Aceptar» es
 *    idempotente por `idAceptacion` (`aceptacion-idempotente.ts`), así que repetirlo no duplica.
 *  · si se agota, LANZA un `ErrorDeEnvio` con su código (`RED`, `RESPUESTA`, `PESADA`) para que
 *    la fila diga qué pasó y qué hacer, y
 *  · deja una línea en el log de Vercel (`reportarFalloDeBandeja`): ruta, código, cotización,
 *    tamaño de la imagen e intentos. También cuando se recuperó en un reintento.
 */
import type { ResultadoDeteccion } from '@/app/(app)/negocios/ranura-actions'
import type { BorradorParaAceptar, ResultadoAceptarCaptura, ResultadoBorrador, ResultadoManualEnBorrador } from '@/app/(app)/negocios/tarifa-pax-actions'
import { reportarFalloDeBandeja, type FalloDeBandeja } from '@/lib/errores-cliente/enviar'
import { bytesDeImagen } from './bandeja-registro'
import type { TipoRanura } from './ranuras-cotizacion'

type Fetch = typeof fetch
type Ruta = FalloDeBandeja['ruta']

/** Cuántas veces sale cada envío, contando el primero. */
export const INTENTOS_DE_ENVIO = 3
/** La espera antes de cada reintento (con un poco de azar: dos que fallan juntos no chocan otra vez). */
export const ESPERAS_DE_REINTENTO_MS = [1500, 4000] as const
/**
 * El cuerpo más grande que acepta una función de Vercel es 4,5 MB; uno más grande vuelve 413
 * sin entrar. Se corta antes, con un margen para el resto del cuerpo, y se dice por qué.
 */
export const MAX_BYTES_CUERPO = 4_400_000

/** Por qué no se pudo hablar con ONE. */
export type CodigoDeEnvio = 'RED' | 'RESPUESTA' | 'PESADA'

export class ErrorDeEnvio extends Error {
  constructor(
    readonly codigo: CodigoDeEnvio,
    readonly ruta: Ruta,
    readonly intentos: number,
    readonly status?: number,
  ) {
    super(`${ruta}: ${codigo}${status ? ` (${status})` : ''} tras ${intentos} intento${intentos === 1 ? '' : 's'}`)
    this.name = 'ErrorDeEnvio'
  }
}

export const esErrorDeEnvio = (e: unknown): e is ErrorDeEnvio => e instanceof ErrorDeEnvio

/** Lo que se puede cambiar en una prueba: la red, la espera y a dónde va el registro. */
export interface OpcionesDeEnvio {
  dormir?: (ms: number) => Promise<void>
  reportar?: (f: FalloDeBandeja) => void
}

const dormirDeVerdad = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Lo que pesa la imagen de un data URL, en bytes (el base64 son 4 caracteres por cada 3). */
const bytesDeDataUrl = (dataUrl: string | null | undefined): number | undefined => bytesDeImagen(dataUrl) ?? undefined

function rutaDe(cotizacionId: string, accion: Ruta): string {
  return `/api/cotizaciones/${encodeURIComponent(cotizacionId)}/${accion}`
}

async function enviar<T>(
  cotizacionId: string,
  ruta: Ruta,
  cuerpo: unknown,
  bytesImagen: number | undefined,
  f: Fetch,
  opciones: OpcionesDeEnvio = {},
): Promise<T> {
  const dormir = opciones.dormir ?? dormirDeVerdad
  const reportar = opciones.reportar ?? reportarFalloDeBandeja
  const texto = JSON.stringify(cuerpo)
  const registro = (codigo: string, intentos: number, extra: Partial<FalloDeBandeja> = {}) =>
    reportar({ ruta, codigo, cotizacionId, ...(bytesImagen !== undefined ? { bytesImagen } : {}), intentos, ...extra })

  if (texto.length > MAX_BYTES_CUERPO) {
    registro('PESADA', 1)
    throw new ErrorDeEnvio('PESADA', ruta, 1)
  }

  const inicio = Date.now()
  let ultimo: { codigo: CodigoDeEnvio; status?: number } = { codigo: 'RED' }
  for (let intento = 1; intento <= INTENTOS_DE_ENVIO; intento++) {
    let res: Response
    try {
      res = await f(rutaDe(cotizacionId, ruta), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: texto,
      })
    } catch {
      ultimo = { codigo: 'RED' }
      if (intento < INTENTOS_DE_ENVIO) {
        await dormir(esperaAntesDe(intento))
        continue
      }
      break
    }
    // 413: el borde no la dejó entrar por tamaño. Reintentar no cambia nada.
    if (res.status === 413) {
      registro('PESADA', intento, { status: 413, ms: Date.now() - inicio })
      throw new ErrorDeEnvio('PESADA', ruta, intento, 413)
    }
    try {
      const datos = (await res.json()) as T
      if (intento > 1) registro(ultimo.codigo, intento, { ...(ultimo.status ? { status: ultimo.status } : {}), ms: Date.now() - inicio, recuperado: true })
      return datos
    } catch {
      // No es JSON: la página de error del borde (502, 504) o un cuerpo cortado a medias.
      ultimo = { codigo: 'RESPUESTA', status: res.status }
      if (intento < INTENTOS_DE_ENVIO) await dormir(esperaAntesDe(intento))
    }
  }
  registro(ultimo.codigo, INTENTOS_DE_ENVIO, { ...(ultimo.status ? { status: ultimo.status } : {}), ms: Date.now() - inicio })
  throw new ErrorDeEnvio(ultimo.codigo, ruta, INTENTOS_DE_ENVIO, ultimo.status)
}

function esperaAntesDe(intento: number): number {
  const base = ESPERAS_DE_REINTENTO_MS[Math.min(intento - 1, ESPERAS_DE_REINTENTO_MS.length - 1)]
  return base + Math.floor(Math.random() * 500)
}

/** ¿De qué es el pantallazo? (`detectarCaptura`, por la ruta). Lanza `ErrorDeEnvio`. */
export function detectarPorRuta(cotizacionId: string, dataUrl: string, f: Fetch = fetch, opciones?: OpcionesDeEnvio): Promise<ResultadoDeteccion> {
  return enviar(cotizacionId, 'detectar-captura', { dataUrl }, bytesDeDataUrl(dataUrl), f, opciones)
}

/** La lectura firmada del pantallazo (`leerCapturaEnBorrador`, por la ruta). Lanza `ErrorDeEnvio`. */
export function leerPorRuta(
  cotizacionId: string,
  tipo: TipoRanura,
  dataUrl: string,
  enfoque: { nombre: string; precio: string | null } | null,
  f: Fetch = fetch,
  opciones?: OpcionesDeEnvio,
): Promise<ResultadoBorrador> {
  return enviar(cotizacionId, 'leer-captura', { tipo, dataUrl, enfoque }, bytesDeDataUrl(dataUrl), f, opciones)
}

/** Lo que dice la fila cuando «Aceptar» no alcanzó a ONE. */
export const MENSAJE_ACEPTAR_SIN_RED =
  'No llegó a ONE: la conexión se cortó al aceptar (lo intentamos 3 veces). La captura sigue aquí: revisa tu internet y toca «Aceptar» otra vez.'
export const MENSAJE_ACEPTAR_SIN_RESPUESTA =
  'ONE no respondió al aceptar (lo intentamos 3 veces). La captura sigue aquí: toca «Aceptar» otra vez en un momento; no queda repetida.'
export const MENSAJE_PANTALLAZO_PESADO =
  'El pantallazo pesa demasiado para enviarlo. Recórtalo a la parte con el precio y pégalo otra vez.'

/**
 * «Aceptar» (`aceptarCapturaDeBandeja`, por la ruta). Nunca lanza: si no hubo respuesta
 * devuelve `ok:false` con su código y el mensaje de qué hacer.
 */
export async function aceptarPorRuta(
  cotizacionId: string,
  cuerpo: BorradorParaAceptar,
  f: Fetch = fetch,
  opciones?: OpcionesDeEnvio,
): Promise<ResultadoAceptarCaptura> {
  try {
    return await enviar<ResultadoAceptarCaptura>(cotizacionId, 'aceptar-captura', cuerpo, bytesDeDataUrl(cuerpo.imagen), f, opciones)
  } catch (e) {
    const codigo = esErrorDeEnvio(e) ? e.codigo : 'RED'
    return {
      ok: false,
      codigo,
      mensaje: codigo === 'PESADA' ? MENSAJE_PANTALLAZO_PESADO : codigo === 'RESPUESTA' ? MENSAJE_ACEPTAR_SIN_RESPUESTA : MENSAJE_ACEPTAR_SIN_RED,
    }
  }
}

/** La lectura firmada de un ingreso manual (`lecturaManualEnBorrador`, por la ruta). `null` sin respuesta. */
export async function lecturaManualPorRuta(
  cotizacionId: string,
  tipo: 'hotel' | 'traslado',
  datos: unknown,
  f: Fetch = fetch,
  opciones?: OpcionesDeEnvio,
): Promise<ResultadoManualEnBorrador | null> {
  try {
    return await enviar<ResultadoManualEnBorrador>(cotizacionId, 'lectura-manual', { tipo, datos }, undefined, f, opciones)
  } catch {
    return null
  }
}
