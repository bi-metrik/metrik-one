/**
 * ¿Es la primera vez que llega este mensaje de WhatsApp?
 *
 * Meta entrega sus webhooks «al menos una vez»: si no recibe el 200 a tiempo, o se le corta la
 * conexión, reenvía el MISMO mensaje (mismo `wa_message_id`). `wa-webhook` lo procesaba otra vez:
 * el bot contestaba dos veces y un gasto dictado podía quedar registrado dos veces (brief del
 * doble guardado, 2026-10-06).
 *
 * Se reclama el id en `claves_idempotencia` con un INSERT: la llave primaria decide, así que dos
 * entregas a la vez no pueden pasar las dos. Vive 7 días (Meta reintenta hasta ese plazo).
 *
 * Si la tabla no existe (migración sin aplicar) o la base falla, se procesa como siempre: perder
 * un mensaje es peor que contestarlo dos veces.
 *
 * Puro respecto de Deno: recibe el cliente, así se prueba desde vitest.
 */

// deno-lint-ignore no-explicit-any
type Cliente = { from: (tabla: string) => any };

const VIGENCIA_MS = 7 * 24 * 60 * 60 * 1000;

export async function primeraVezDelMensaje(
  supabase: Cliente,
  waMessageId: string | null | undefined,
  ahoraMs: number = Date.now(),
): Promise<boolean> {
  if (!waMessageId) return true;
  const { error } = await supabase.from('claves_idempotencia').insert({
    clave: `wa:${waMessageId}`,
    ambito: 'accion',
    nombre: 'wa-webhook',
    estado: 'hecha',
    vence_at: new Date(ahoraMs + VIGENCIA_MS).toISOString(),
  });
  if (!error) return true;
  if (error.code === '23505') return false;
  console.error('[wa-webhook] no se pudo reclamar el mensaje, se procesa igual:', error.message);
  return true;
}
