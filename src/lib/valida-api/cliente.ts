import 'server-only'
import { llamarValidaNucleo, type PeticionValida, type ResultadoValida } from './cliente-nucleo'

/**
 * Única capa que lee el entorno para hablar con Valida. Ver `cliente-nucleo.ts`.
 *
 * - `ONE_VALIDA_SECRET`: creado en Vercel de producción con el mismo valor en ONE y en Valida
 *   (2026-09-16). Sin él, toda llamada devuelve `no_disponible` sin tocar la red.
 * - `VALIDA_API_BASE`: la misma variable que ya usan las consultas duales. `||` y no `??`:
 *   Vercel puede inyectarla vacía y `??` la dejaría pasar como URL relativa.
 */

const BASE_POR_DEFECTO = 'https://valida.metrik.com.co'

export function llamarValida<T>(peticion: PeticionValida): Promise<ResultadoValida<T>> {
  return llamarValidaNucleo<T>(peticion, {
    secreto: process.env.ONE_VALIDA_SECRET,
    base: process.env.VALIDA_API_BASE || BASE_POR_DEFECTO,
    fetch,
    ahora: () => Math.floor(Date.now() / 1000),
    // Solo metadatos: método, ruta, status y código. Nunca cuerpos (la llave en claro).
    registrar: (linea) => console.warn(linea),
  })
}
