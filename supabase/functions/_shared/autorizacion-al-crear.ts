// ============================================================
// El correo con el link de autorización de datos, para los viajes que abre la bandeja de WhatsApp
// ------------------------------------------------------------
// El correo lo manda la app (Next, Resend) desde UN solo sitio: `src/lib/autorizacion-datos/servidor.ts`. Los viajes
// que se crean en la app lo disparan desde la acción; los que abre el bot llegan aquí y piden a la ruta
// `/api/autorizacion-datos/al-crear` que haga lo mismo. La ruta decide (workspace encendido, contacto con correo y sin
// autorización, sin un correo reciente) y solo actúa sobre negocios de menos de 15 minutos.
//
// Nunca lanza ni demora el turno más de unos segundos: el viaje ya quedó creado y el link se puede mandar desde ONE.
// ============================================================

import type { SupabaseClient } from './types.ts';

/** ¿El workspace encendió el correo automático? Solo `true` literal (como en la app). Pura. */
export function correoAlCrearEncendido(configExtra: unknown): boolean {
  const c = (configExtra as { autorizacion_datos?: { correo_al_crear?: unknown } } | null)?.autorizacion_datos;
  return c?.correo_al_crear === true;
}

export async function pedirCorreoAutorizacionAlCrear(supabase: SupabaseClient, workspaceId: string, negocioId: string): Promise<void> {
  try {
    const { data: ws } = await supabase.from('workspaces').select('slug, config_extra').eq('id', workspaceId).maybeSingle();
    if (!ws?.slug || !correoAlCrearEncendido(ws.config_extra)) return;
    const base = (Deno.env.get('APP_BASE_DOMAIN') || 'metrikone.co').trim();
    const res = await fetch(`https://${ws.slug}.${base}/api/autorizacion-datos/al-crear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ negocio_id: negocioId }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) console.error(`[autorizacion-al-crear] la app respondió ${res.status} para ${negocioId}`);
  } catch (e) {
    console.error('[autorizacion-al-crear] no se pudo pedir el correo:', String(e).slice(0, 200));
  }
}
