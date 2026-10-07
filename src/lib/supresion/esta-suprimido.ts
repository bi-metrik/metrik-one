import { huellasDe, type TipoSupresion } from './huella'

/**
 * Compuerta de todo envío comercial: ¿alguno de estos datos está en la lista de supresión?
 * Llamarla ANTES de enviar, con la llave de servicio (la tabla es server-only).
 *
 * Falla CERRADO: si la consulta falla, devuelve suprimido=true. Un error de red no puede
 * convertirse en un correo a quien pidió la baja.
 */

type Cliente = {
  from: (t: string) => {
    select: (c: string) => {
      in: (col: string, v: string[]) => PromiseLike<{ data: { tipo: string; huella: string; baja_at: string; canal: string }[] | null; error: unknown }>
    }
  }
}

export type ResultadoSupresion = {
  suprimido: boolean
  coincidencias: { tipo: TipoSupresion; baja_at: string; canal: string }[]
  /** true si se bloqueó por error de consulta y no por una baja real. */
  porError?: boolean
}

export async function estaSuprimido(
  svc: unknown,
  datos: { email?: string | null; telefono?: string | null; nit?: string | null },
): Promise<ResultadoSupresion> {
  const hs = huellasDe(datos)
  if (hs.length === 0) return { suprimido: false, coincidencias: [] }

  const { data, error } = await (svc as Cliente)
    .from('supresiones')
    .select('tipo, huella, baja_at, canal')
    .in('huella', hs.map((h) => h.huella))

  if (error || !data) return { suprimido: true, coincidencias: [], porError: true }

  const coincidencias = data
    .filter((r) => hs.some((h) => h.tipo === r.tipo && h.huella === r.huella))
    .map((r) => ({ tipo: r.tipo as TipoSupresion, baja_at: r.baja_at, canal: r.canal }))
  return { suprimido: coincidencias.length > 0, coincidencias }
}
