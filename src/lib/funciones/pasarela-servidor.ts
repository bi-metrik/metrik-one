import 'server-only'

/**
 * La pasarela de pagos de un workspace, para lo que hace el equipo desde ONE (regenerar el link del saldo en la lista
 * del día, P14c): la de Bold con las llaves DEL WORKSPACE, que el dueño carga en la bóveda (Configuración → Bóveda de
 * llaves). Sin llaves devuelve `null` y la pantalla lo dice ANTES de preparar un pago (el saldo se cobra con el QR).
 *
 * NUNCA cae a la llave de MéTRIK (`BOLD_IDENTITY_KEY`, la de las cuotas): el contrato del cliente (Anexo 2, 2.5) dice
 * que MéTRIK no recibe ni administra su dinero. La función compartida no lee variables de entorno; la prueba
 * `pasarela-servidor.test.ts` lo amarra.
 */
import type { PasarelaPagos } from '../../../supabase/functions/_shared/funciones/pasarela.ts'
import { pasarelaDeWorkspace } from '../../../supabase/functions/_shared/funciones/bold-workspace.ts'
import { createServiceClient } from '@/lib/supabase/server'

type Cliente = Parameters<typeof pasarelaDeWorkspace>[0]

export async function pasarelaDelWorkspace(
  workspaceId: string,
  deps: { cliente?: Cliente; fetch?: typeof fetch } = {},
): Promise<PasarelaPagos | null> {
  const cliente = deps.cliente ?? (createServiceClient() as unknown as Cliente)
  return pasarelaDeWorkspace(cliente, workspaceId, deps.fetch ?? fetch)
}
