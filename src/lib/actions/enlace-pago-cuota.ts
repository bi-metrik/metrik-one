'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { generarEnlacePagoCuota } from '@/lib/cobros/enlace-pago-cuota-servidor'
import { createServiceClient } from '@/lib/supabase/server'
import { esUuid } from '@/lib/valida-api/reglas'

/**
 * «Generar enlace de pago» de una cuota, desde la ficha del negocio en el espacio cobrador (metrik).
 *
 * ⚠️ Es un endpoint alcanzable con cualquier id aunque la pantalla solo lo ofrezca en la ficha:
 * exige dueño o administrador y todo lo demás (que la cuota, el plan y el contrato sean del espacio
 * de la sesión) lo vuelve a comprobar `generarEnlacePagoCuota` en cada consulta.
 *
 * Crea un enlace real en la pasarela: el cliente puede pagar con él. Por eso un enlace vigente no se
 * regenera, se devuelve el que ya hay.
 */

export type ResultadoAccionEnlace =
  | { ok: true; estado: 'generado' | 'vigente'; url: string; expira: string | null; monto: number | null }
  | { ok: false; error: string }

export async function generarEnlacePagoDeCuota(cuotaId: string): Promise<ResultadoAccionEnlace> {
  const { workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, error: 'Solo el dueño y los administradores generan enlaces de pago.' }
  }
  if (!esUuid(cuotaId)) return { ok: false, error: 'La cuota no es válida.' }

  const db = createServiceClient()
  const r = await generarEnlacePagoCuota({ workspaceId, cuotaId }, { db })
  if (!r.ok) return r

  if (r.estado === 'generado' && staffId) {
    await registrarActividad(
      db,
      {
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: r.negocioId,
        tipo: 'sistema',
        autor_id: staffId, // FK a staff(id), NO a profiles
        // `activity_log.contenido` tiene CHECK de 280 caracteres.
        contenido: `Enlace de pago en línea generado manualmente para la cuota ${r.numero}${r.monto ? ` por $${r.monto.toLocaleString('es-CO')}` : ''}${r.pasarela ? ` (${r.pasarela})` : ''}.`.slice(0, 280),
      },
      'generarEnlacePagoDeCuota',
    )
  }

  revalidatePath(`/negocios/${r.negocioId}`)
  return { ok: true, estado: r.estado, url: r.url, expira: r.expira, monto: r.monto }
}
