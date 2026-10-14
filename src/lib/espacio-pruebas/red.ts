/**
 * Las llamadas HTTP del clonador del espacio de pruebas (PostgREST, Auth, Storage) con techo.
 *
 * Por qué: el segundo `--apply` (2026-10-14) falló a mitad y el deshacer se quedó minutos sin
 * imprimir nada y sin consulta activa en la base. Ninguna llamada tenía tiempo máximo: el `fetch`
 * de Node espera hasta 300 s por cabeceras y otros 300 s por cuerpo, por llamada, y el borrado
 * hacía cientos de llamadas en serie. Con techo, una llamada colgada se vuelve un error que el
 * borrado anota como pendiente y sigue.
 */

/** Techo por llamada. Un DELETE o un conteo de la purga tarda milisegundos; Auth y Storage, poco más. */
export const TECHO_POR_LLAMADA_MS = 30_000

/** Un `fetch` que aborta si la llamada pasa de `ms` (respetando la señal que traiga quien llama). */
export function fetchConTiempo(ms: number = TECHO_POR_LLAMADA_MS, base: typeof fetch = fetch): typeof fetch {
  return (entrada, init) => {
    const techo = AbortSignal.timeout(ms)
    const signal = init?.signal ? AbortSignal.any([init.signal, techo]) : techo
    return base(entrada, { ...init, signal }).catch((e: unknown) => {
      if (techo.aborted) {
        const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
        throw new Error(`Sin respuesta en ${Math.round(ms / 1000)} s: ${init?.method ?? 'GET'} ${url.split('?')[0]}`)
      }
      throw e
    })
  }
}

/**
 * La columna generada que Postgres nombra al rechazar un valor en ella, o `null`. Es la defensa
 * genérica del almacén de Supabase: una columna generada que no esté en la lista medida
 * (`COLUMNAS_GENERADAS`) se quita y la sentencia se repite (la que falló no escribió nada).
 */
export function columnaGeneradaDelError(mensaje: string): string | null {
  const m = /cannot insert a non-DEFAULT value into column "([^"]+)"/.exec(mensaje) ?? /column "([^"]+)" can only be updated to DEFAULT/.exec(mensaje)
  return m ? m[1] : null
}
