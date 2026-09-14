/**
 * Reintento de una extracción con modelo, con UNA sola política para todo el producto.
 *
 * Vivía dentro de `documento-actions.ts` como función local (`extractWithRetry`). Sale
 * aquí porque el lector de pantallazos de cotización necesita exactamente la misma
 * política y **dos copias se desincronizan**: el día que una suba a tres intentos, la
 * otra seguirá en dos y nadie lo va a notar — el síntoma es una extracción que falla
 * más seguido en una pantalla que en otra.
 *
 * `documento-actions.ts` conserva su `extractWithRetry`, que ahora delega aquí: no
 * puede exportarla (es un archivo `'use server'`, donde todo export se vuelve server
 * action) ni importarla desde otro módulo sin arrastrar la cadena entera de Next.
 */

/**
 * Dos intentos. El fallo transitorio de Gemini (timeout, 429, 5xx, JSON malformado)
 * casi siempre pasa al segundo; el tercero ya es esperar por esperar delante de una
 * persona que tiene el proveedor abierto en otra pestaña.
 */
export const INTENTOS_MAXIMOS = 2

/** Espera entre intentos, en milisegundos. */
const ESPERA_MS = 600

export interface ResultadoExtraccion<T> {
  data: T | null
  error?: string
}

/**
 * Corre `ejecutar` hasta obtener datos, con un reintento ante fallo transitorio.
 *
 * ⚠️ NO se reintenta cuando Gemini **bloqueó el contenido**: eso es permanente y
 * reintentarlo solo gasta el reloj de quien espera. Cualquier otro error se trata como
 * transitorio, que es el lado seguro: un reintento de más cuesta 600 ms, y uno de
 * menos deja el bloque en pendiente sin que nadie sepa por qué.
 */
export async function extraerConReintento<T>(
  ejecutar: () => Promise<ResultadoExtraccion<T>>,
  tag: string,
): Promise<ResultadoExtraccion<T>> {
  let ultimo: ResultadoExtraccion<T> = { data: null }
  for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
    ultimo = await ejecutar()
    if (ultimo.data) return ultimo
    if (ultimo.error?.startsWith('Contenido bloqueado')) return ultimo // permanente
    if (intento < INTENTOS_MAXIMOS) {
      console.warn(
        `[${tag}] Extracción AI falló (intento ${intento}/${INTENTOS_MAXIMOS}): ${ultimo.error}. Reintentando...`,
      )
      await new Promise(r => setTimeout(r, ESPERA_MS))
    }
  }
  return ultimo
}
