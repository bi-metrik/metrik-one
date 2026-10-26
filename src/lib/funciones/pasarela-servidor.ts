import 'server-only'

/**
 * La pasarela de pagos de un workspace, para lo que hace el equipo desde ONE (regenerar el link del saldo en la lista
 * del día, P14c).
 *
 * HOY NO HAY NINGUNA: las llaves de Bold por workspace y la llamada HTTP son el frente de la pasarela, aparte de este
 * módulo (el adaptador ya existe y no llama a nadie por su cuenta: `pasarelaBold` en
 * `supabase/functions/_shared/funciones/pasarela.ts`). Mientras devuelva `null`, la pantalla lo dice ANTES de preparar
 * un pago, y el saldo se cobra con el QR de Bold en el evento ([Saldo cobrado]). Al conectar la pasarela solo cambia
 * este archivo.
 */
import type { PasarelaPagos } from '../../../supabase/functions/_shared/funciones/pasarela.ts'

export async function pasarelaDelWorkspace(_workspaceId: string): Promise<PasarelaPagos | null> {
  return null
}
