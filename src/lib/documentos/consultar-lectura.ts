import { getWorkspace } from '@/lib/actions/get-workspace'
import { leerMarca, lecturaVigente, type RespuestaLectura } from './lectura-en-curso'

/**
 * El estado de la lectura de un bloque documental, para la tarjeta que la espera.
 *
 * Es una LECTURA: va por la ruta `GET /api/negocios/<id>/lectura/<bloqueId>` y no por server
 * action, porque Next pone las actions en fila y una consulta repetida cada pocos segundos
 * haría esperar a cualquier guardado de la pestaña (gotcha #1019).
 *
 * El alcance lo dan la sesión y el RLS de `negocio_bloques` (cliente de sesión), más el
 * `negocio_id` de la URL: un bloque de otro negocio responde como inexistente.
 */
export async function consultarLectura(negocioId: string, bloqueId: string): Promise<RespuestaLectura> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { marca: null, error: 'No autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fila } = await (supabase as any)
    .from('negocio_bloques')
    .select('estado, data')
    .eq('id', bloqueId)
    .eq('negocio_id', negocioId)
    .maybeSingle()
  if (!fila) return { marca: null, error: 'Bloque no encontrado' }

  const data = ((fila as { data?: Record<string, unknown> | null }).data ?? {}) as Record<string, unknown>
  const marca = leerMarca(data)
  if (!marca) return { marca: null }
  if (marca.estado === 'leyendo') return { marca, vencida: !lecturaVigente(marca) }
  if (marca.estado !== 'lista') return { marca }

  return {
    marca,
    bloque: {
      estado: (fila as { estado?: string | null }).estado ?? null,
      drive_url: (data.drive_url as string | undefined) ?? null,
      file_name: (data.file_name as string | undefined) ?? null,
      campos: (data.campos as Record<string, unknown> | undefined) ?? null,
      extraction_status: (data._extraction_status as 'ok' | 'failed' | 'no_key' | undefined) ?? null,
    },
  }
}
