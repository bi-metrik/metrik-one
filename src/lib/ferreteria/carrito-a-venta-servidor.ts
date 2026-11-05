import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import type { ConvertidorCarrito } from '@/lib/carritos/pago-bold'
import { convertidorDeFerreteria } from './carrito-a-venta'
import { puertoNegociosSistema } from './negocios-puerto'
import { repoSupabase } from './repo-supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** El canal de Chatwoot como canal de una conversación de Ferretería (Messenger llega como `otro`). */
export function canalConversacion(canal: string): 'messenger' | 'whatsapp' | 'instagram' {
  return canal === 'instagram' ? 'instagram' : canal === 'whatsapp' ? 'whatsapp' : 'messenger'
}

/** El convertidor de Ferretería con la base real (cliente de servicio, acotado al workspace del webhook). */
export function convertidorFerreteria(ws: string): ConvertidorCarrito {
  return convertidorDeFerreteria({
    ws,
    repo: repoSupabase(),
    negocios: () => puertoNegociosSistema(ws, 'Bold'),
    async conversacion(c, hoyISO) {
      const db = createServiceClient() as unknown as Db
      const { data, error } = await db
        .from('ferreteria_conversaciones')
        .upsert(
          {
            workspace_id: ws,
            publicacion_id: c.publicacionId,
            fecha: hoyISO,
            // Solo el nombre visible (minimización: el celular y la dirección quedan en el carrito, server-only).
            interesado: c.comprador.slice(0, 120),
            canal: canalConversacion(c.canal),
            resultado: 'vendio',
            clave: `chatwoot:${c.cuentaId}:${c.conversacionId}`,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,clave' },
        )
        .select('id, publicacion_id')
        .single()
      // La conversación es contexto, no condición: sin ella la venta sale igual (sin conversación de origen).
      if (error || !data || data.publicacion_id !== c.publicacionId) {
        if (error) console.error('[ferreteria/carrito] no se pudo guardar la conversación de origen:', error.message)
        return null
      }
      return String(data.id)
    },
  })
}
