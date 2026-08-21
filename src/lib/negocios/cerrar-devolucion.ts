/**
 * Cierre de la devolución vigente cuando el bloque vuelve a quedar diligenciado.
 *
 * ⚠️ POR QUE NO VIVE EN `devolucion-actions.ts`. Ese archivo es `'use server'`, y todo lo
 * que exporta queda expuesto como endpoint invocable desde el navegador. Un cierre de
 * devolución alcanzable desde el cliente permitiría marcar como corregido un documento que
 * sigue malo, y el indicador contaría correcciones que nunca ocurrieron. Aquí es un helper
 * de servidor: solo lo alcanza quien ya está adentro del camino que guarda el documento.
 *
 * Por la misma razón no existe un "marcar como resuelto" manual: una devolución se cierra
 * cargando el documento bueno, no apretando un botón.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { leerDevolucion, limpiarDevolucion } from './devolucion'

/**
 * Cierra el evento abierto y devuelve el `data` sin la marca.
 *
 * Quien llama debe persistir el objeto devuelto en el MISMO update con el que guarda el
 * documento. Escribirlo aparte dejaría una ventana en la que el bloque ya está completo y
 * la pantalla todavía lo muestra devuelto.
 *
 * Nunca lanza: un fallo cerrando el evento no puede tumbar el guardado del documento. Si
 * el cierre falla, la marca se quita igual — dejarla pondría al área de origen a corregir
 * algo que ya corrigió — y el evento queda abierto, que en el indicador se lee como una
 * corrección sin fecha de cierre en vez de como una devolución perdida.
 */
export async function cerrarDevolucionAlCompletar(
  negocioBloqueId: string,
  data: Record<string, unknown> | null | undefined,
  staffId: string | null,
): Promise<Record<string, unknown>> {
  const marca = leerDevolucion(data)
  if (!marca) return { ...(data ?? {}) }

  try {
    const admin = createServiceClient()
    const ahora = new Date().toISOString()
    // Por `evento_id` cuando la marca lo trae. El respaldo por bloque cubre las marcas
    // escritas antes de que el id existiera, y el índice parcial de abiertas lo hace barato.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (admin as any)
      .from('devolucion_eventos')
      .update({ resuelto_at: ahora, resuelto_por: staffId })
      .is('resuelto_at', null)
    const { error } = marca.evento_id
      ? await q.eq('id', marca.evento_id)
      : await q.eq('negocio_bloque_id', negocioBloqueId)
    if (error) console.error('[devolucion] no se pudo cerrar el evento:', error)
  } catch (e) {
    console.error('[devolucion] fallo cerrando el evento:', e)
  }

  return limpiarDevolucion(data)
}
