import 'server-only'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { pedirArchivoValida } from '@/lib/valida-api/cliente'
import { actorValido } from '@/lib/valida-api/firma'
import { credencialValida, VALIDA_API_BASE } from './credencial-servidor'
import { pdfDeValida, type PedidoPdf, type ResultadoPdf } from './reporte-pdf'

/**
 * El PDF de un reporte del espacio, con la llave o, si venció, firmado como ONE. Ver `reporte-pdf.ts`.
 * Quien llama ya pasó la puerta del módulo (`accesoValida`) y le da el espacio de la sesión: aquí no
 * se recibe nada del navegador salvo el id de la consulta, que Valida busca dentro del cliente.
 */
export async function pdfDeValidaDelEspacio(workspaceId: string, pedido: PedidoPdf): Promise<ResultadoPdf> {
  const { llave, clienteId } = await credencialValida(workspaceId)
  const { user } = await getCachedUser()
  return pdfDeValida(
    { llave, clienteId, actor: actorValido(user?.id, user?.email) },
    pedido,
    { base: VALIDA_API_BASE, fetch: (...a) => fetch(...a), pedirFirmado: pedirArchivoValida },
  )
}
