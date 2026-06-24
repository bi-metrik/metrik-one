// cardumen-cron — recordatorios + expiracion de conversaciones CardumenChat.
// Lo llama pg_cron cada ~15 min con la service role key (verify_jwt por defecto).
//
// 1. Recordatorio: sesiones abiertas, sin recordar, inactivas 2-24h -> mensaje "¿seguimos?".
//    (La ventana de servicio 24h de Meta sigue abierta porque la ultima actividad fue < 24h.)
// 2. Expiracion: sesiones abiertas inactivas > 24h -> se cierran (el avance se pierde).

import { getServiceClient } from "../_shared/supabase-client.ts";
import { sendTextMessage } from "../_shared/wa-respond.ts";

const REMINDER =
  "🐟 ¿Seguimos? Te quedaste a mitad de tu historia sobre hacer negocios en La Araucanía. " +
  "Reenvíame tu última respuesta y continuamos justo donde quedamos. " +
  "Recuerda: si pasan 24 horas sin avanzar, se pierde lo recogido.";

Deno.serve(async (req) => {
  // Guard: solo se invoca con el secreto interno (pg_cron lo pasa en el body).
  let body: { secret?: string } = {};
  try { body = await req.json(); } catch { /* sin body */ }
  const expected = Deno.env.get("CARDUMEN_CRON_SECRET");
  if (!expected || body.secret !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = getServiceClient();
  const now = Date.now();
  const h2 = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const h24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  let reminded = 0, expired = 0;

  // 1. Recordatorios (inactivas entre 2h y 24h, aun no recordadas)
  const { data: toRemind } = await supabase
    .from("cardumen_chat_sessions")
    .select("phone")
    .eq("closed", false)
    .is("reminded_at", null)
    .lt("updated_at", h2)
    .gt("updated_at", h24);

  for (const r of toRemind ?? []) {
    try {
      await sendTextMessage(r.phone, REMINDER);
      await supabase
        .from("cardumen_chat_sessions")
        .update({ reminded_at: new Date().toISOString() })
        .eq("phone", r.phone);
      reminded++;
    } catch (e) {
      console.error(`[cardumen-cron] error recordando ${r.phone}:`, (e as Error).message);
    }
  }

  // 2. Expiracion (inactivas > 24h) — se cierran, el avance se pierde.
  const { data: toExpire } = await supabase
    .from("cardumen_chat_sessions")
    .update({ closed: true })
    .eq("closed", false)
    .lt("updated_at", h24)
    .select("phone");
  expired = (toExpire ?? []).length;

  console.log(`[cardumen-cron] recordados=${reminded} expirados=${expired}`);
  return new Response(JSON.stringify({ reminded, expired }), {
    headers: { "content-type": "application/json" },
  });
});
