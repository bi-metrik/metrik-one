import { conReintentoDeRed } from '@/lib/red/con-reintento'

/**
 * Motor del cargue masivo de Valida, fuera de React para poder probarlo.
 *
 * Antes (hasta 2026-10-04) el cliente hacia `await consultarValida(...)` fila por fila, en
 * serie y sin red de seguridad: 500 filas eran 500 viajes uno tras otro, y una sola fila que
 * lanzaba (un `Load failed` del telefono, un server action que no volvia) cortaba el bucle
 * entero y dejaba la pantalla en «procesando» para siempre, con el lote a medias.
 *
 * Ahora:
 *   - `CONCURRENCIA_LOTE` filas a la vez (no mas: cada una es un server action que llama a la
 *     API de Valida, y no queremos que un lote de un cliente sature a los demas);
 *   - cada intento tiene su tope de tiempo (`TIMEOUT_FILA_MS`); si se agota la fila queda en
 *     error y NO se reintenta (el server action pudo seguir corriendo y cobrar la consulta);
 *   - un error de RED (`esErrorDeRed`, via `conReintentoDeRed`) se reintenta UNA vez, y el
 *     reintento avisa al servidor (`reintento = true`) para que no cobre dos veces una fila
 *     que el primer intento si alcanzo a guardar;
 *   - cualquier otro error, o una fila que lanza, queda como `'error'` y el lote sigue.
 */

export const CONCURRENCIA_LOTE = 3

/**
 * Tope por intento, del lado del navegador. Mayor que el de la API en el servidor
 * (`TIMEOUT_VALIDA_MS` en `valida-consultas.ts`) para que, en el caso normal, sea el servidor
 * quien corte primero y deje la fila guardada como error; este solo cubre el viaje que no vuelve.
 */
export const TIMEOUT_FILA_MS = 45_000

export class TiempoAgotadoError extends Error {
  constructor(ms: number) {
    super(`fila_sin_respuesta_en_${ms}ms`)
    this.name = 'TiempoAgotadoError'
  }
}

/** Rechaza con `TiempoAgotadoError` si `p` no termina en `ms`. No cancela `p`. */
export function conTiempoMaximo<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TiempoAgotadoError(ms)), ms)
  })
  return Promise.race([p, tope]).finally(() => clearTimeout(timer))
}

/**
 * Corre una fila con tope de tiempo y un reintento si falla por red. Nunca lanza: cualquier
 * falla devuelve `valorDeError`.
 */
export async function correrFilaTolerante<R>(
  intentar: (reintento: boolean) => Promise<R>,
  valorDeError: R,
  opciones: { timeoutMs?: number; esperaReintentoMs?: number; dormir?: (ms: number) => Promise<void> } = {},
): Promise<R> {
  const { timeoutMs = TIMEOUT_FILA_MS, esperaReintentoMs, dormir } = opciones
  let intentos = 0
  try {
    return await conReintentoDeRed(
      () => {
        const reintento = intentos > 0
        intentos += 1
        return conTiempoMaximo(intentar(reintento), timeoutMs)
      },
      { esperaMs: esperaReintentoMs, dormir },
    )
  } catch {
    return valorDeError
  }
}

/**
 * Procesa `items` con a lo sumo `concurrencia` en vuelo. `procesar` no deberia lanzar (usa
 * `correrFilaTolerante`), pero si lanza, ese item cuenta como `valorDeError` y el lote sigue.
 *
 * `alTerminarItem` se llama una vez por item, en el orden en que TERMINAN, con el total de
 * terminados hasta ese momento (el contador del progreso). Devuelve los resultados en el
 * orden de ENTRADA, no en el de llegada.
 *
 * `detenerSi`: con el primer resultado que lo cumpla no se ARRANCA ningun item mas (los que ya
 * estan en vuelo terminan y cuentan). Es el corte de la bolsa de Valida: al agotarse, cada fila
 * siguiente responderia lo mismo, y seguir solo llena el historial de errores. Los items que no
 * arrancaron quedan con `valorNoIniciado` (por defecto `valorDeError`) y NO pasan por
 * `alTerminarItem`, asi que el contador del progreso dice cuantas filas se procesaron de verdad.
 */
export async function procesarEnParalelo<T, R>(
  items: readonly T[],
  procesar: (item: T, indice: number) => Promise<R>,
  opciones: {
    concurrencia?: number
    valorDeError: R
    alTerminarItem?: (resultado: R, terminados: number, indice: number) => void
    detenerSi?: (resultado: R) => boolean
    valorNoIniciado?: R
  },
): Promise<R[]> {
  const { concurrencia = CONCURRENCIA_LOTE, valorDeError, alTerminarItem, detenerSi } = opciones
  const valorNoIniciado = 'valorNoIniciado' in opciones ? (opciones.valorNoIniciado as R) : valorDeError
  const resultados = new Array<R>(items.length).fill(valorNoIniciado)
  let siguiente = 0
  let terminados = 0
  let detenido = false

  async function trabajador() {
    while (!detenido && siguiente < items.length) {
      const indice = siguiente++
      let r: R
      try {
        r = await procesar(items[indice], indice)
      } catch {
        r = valorDeError
      }
      resultados[indice] = r
      if (detenerSi?.(r)) detenido = true
      terminados += 1
      alTerminarItem?.(r, terminados, indice)
    }
  }

  const n = Math.max(1, Math.min(concurrencia, items.length))
  await Promise.all(Array.from({ length: n }, () => trabajador()))
  return resultados
}
