import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { origenPeticion } from '@/lib/valida-api/contexto'
import type { EntradaValidaCda } from './puerta'

/**
 * La constancia del preaviso de la cláusula 13.1: por cada modificación que se le muestra a una persona
 * del CDA, la PRIMERA vez que la vio (fecha, espacio, IP y navegador), en `avisos_modificacion_vistos`
 * (migración 20261007150000). Es la prueba de que el aviso se publicó y llegó, por CDA y por usuario.
 *
 * Solo cuenta un usuario del cliente en su propio espacio (`usuarioDelCliente`): el soporte de MeTRIK
 * viendo el espacio, o en «Ver como», no es el cliente enterándose.
 *
 * La primera vez es la que vale: `on conflict do nothing` sobre (versión, usuario), y la tabla no admite
 * UPDATE. Una falla al registrar NO tumba la página: se anota en el log y el aviso se muestra igual (no
 * mostrarlo por no poder registrarlo sería peor para el preaviso que la constancia faltante).
 */
export async function registrarVistaAvisoModificacion(entrada: EntradaValidaCda): Promise<void> {
  if (entrada.tipo !== 'ok' || !entrada.usuarioDelCliente || entrada.modificaciones.length === 0) return
  try {
    const origen = await origenPeticion()
    const filas = entrada.modificaciones.map((d) => ({
      documento_version_id: d.documentoId,
      workspace_id: entrada.workspaceId,
      usuario_id: entrada.usuarioId,
      ip: origen.ip,
      user_agent: origen.userAgent,
    }))
    const { error } = await createServiceClient()
      // La tabla nace en 20261007150000 y no está en `database.ts`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('avisos_modificacion_vistos' as any)
      .upsert(filas as never, { onConflict: 'documento_version_id,usuario_id', ignoreDuplicates: true })
    if (error) console.error('[valida-cda] no se pudo registrar la vista del aviso de modificación:', error.message)
  } catch (e) {
    console.error('[valida-cda] no se pudo registrar la vista del aviso de modificación:', (e as Error).message)
  }
}
