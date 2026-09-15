// ============================================================
// wa-destino — a quien va un mensaje saliente, en el formato de la Messages API
// ------------------------------------------------------------
// Puro a proposito: `wa-respond.ts` no se puede importar desde vitest (arrastra el cliente de
// Supabase por URL), y el contrato con Meta es justo lo que conviene fijar con una prueba.
//
// Contrato (https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/,
// "Send message requests"): al telefono se le escribe con `to`; al BSUID, con `recipient` y SIN
// `to`, porque si van los dos gana `to`. La doc no fija una version minima de la Graph API.
// ============================================================

export type Destino = { telefono: string } | { bsuid: string };

/** Los campos de destinatario del cuerpo de `POST /<PHONE_NUMBER_ID>/messages`. */
export function camposDestino(destino: Destino): Record<string, string> {
  if ('bsuid' in destino) {
    return { recipient_type: 'individual', recipient: destino.bsuid };
  }
  return { to: destino.telefono };
}
