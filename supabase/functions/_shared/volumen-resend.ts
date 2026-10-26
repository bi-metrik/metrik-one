// ============================================================
// El contador de volumen de Resend, del lado del webhook
// ------------------------------------------------------------
// Cada `email.sent` suma 1 al período con la RPC `resend_contar_enviado` (atómica y
// deduplicada por `svix-id` en la base). Si la RPC devuelve un umbral recién cruzado, se
// manda la alarma a Mauricio por correo (y por WhatsApp si hay canal), se deja traza en
// `avisos_equipo`, y si el correo no salió el umbral vuelve a «sin avisar» para que el
// siguiente `email.sent` lo reintente.
//
// Sin bucle: el correo de la alarma también es un `email.sent` y se cuenta, pero la RPC
// devuelve cada umbral UNA sola vez por período, así que ese conteo no dispara otra alarma.
//
// Nunca lanza: el webhook responde 200 aunque el conteo falle (un reintento sin fin de
// Resend no arregla un contador). Sin Deno: todo entra por `deps`, así lo prueba vitest.
// ============================================================

import { correoAlarmaVolumen, type DatosAlarmaVolumen, whatsappAlarmaVolumen } from './alarma-volumen-resend.ts';
import { idDeRespuestaResend, registrarAvisoEquipo } from './aviso-equipo.ts';

// deno-lint-ignore no-explicit-any
type Cliente = { rpc: (fn: string, args: Record<string, unknown>) => any; from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface DepsVolumen {
  svc: Cliente;
  llaveResend: string;
  /** Hoy en Bogotá, `YYYY-MM-DD`. */
  hoy: () => string;
  fetch?: typeof fetch;
  /** El aviso por WhatsApp, si hay canal. Puede lanzar: se atrapa aquí. */
  whatsapp?: (texto: string, variables: Record<string, string | number>) => Promise<void>;
}

export type ResultadoConteo =
  | { contado: false; razon: 'sin_svix_id' | 'repetido' | 'error' }
  | { contado: true; umbral: number | null; alarma: 'enviada' | 'fallida' | null };

type FilaConteo = {
  contado: boolean;
  periodo: string | null;
  periodo_fin: string | null;
  enviados: number | null;
  incluidos: number | null;
  umbral_cruzado: number | null;
};

export async function contarEnviado(deps: DepsVolumen, svixId: string): Promise<ResultadoConteo> {
  try {
    if (!svixId) {
      console.error('[volumen-resend] email.sent sin svix-id: no se cuenta');
      return { contado: false, razon: 'sin_svix_id' };
    }
    const { data, error } = await deps.svc.rpc('resend_contar_enviado', { p_svix_id: svixId });
    if (error) {
      console.error(`[volumen-resend] conteo fallo (${svixId}): ${error.message}`);
      return { contado: false, razon: 'error' };
    }
    const fila = (Array.isArray(data) ? data[0] : data) as FilaConteo | null;
    if (!fila?.contado) return { contado: false, razon: 'repetido' };
    if (fila.umbral_cruzado == null || !fila.periodo || !fila.periodo_fin || fila.enviados == null || fila.incluidos == null) {
      return { contado: true, umbral: null, alarma: null };
    }
    const alarma = await avisarUmbral(deps, {
      enviados: fila.enviados,
      umbral: fila.umbral_cruzado,
      incluidos: fila.incluidos,
      periodo: fila.periodo,
      periodoFin: fila.periodo_fin,
      hoy: deps.hoy(),
    });
    return { contado: true, umbral: fila.umbral_cruzado, alarma };
  } catch (e) {
    console.error(`[volumen-resend] conteo fallo: ${e instanceof Error ? e.message : String(e)}`);
    return { contado: false, razon: 'error' };
  }
}

/** Manda la alarma de un umbral. Devuelve si el correo salió. Nunca lanza. */
export async function avisarUmbral(deps: DepsVolumen, d: DatosAlarmaVolumen): Promise<'enviada' | 'fallida'> {
  const correo = correoAlarmaVolumen(d);
  let proveedorId: string | null = null;
  let falla: string | null = null;
  if (!deps.llaveResend) {
    falla = 'sin_resend_api_key';
  } else {
    try {
      const f = deps.fetch ?? ((u: RequestInfo | URL, i?: RequestInit) => globalThis.fetch(u, i));
      const res = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${deps.llaveResend}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': correo.idempotencyKey,
        },
        body: JSON.stringify({ from: correo.from, to: [correo.to], subject: correo.subject, html: correo.html, text: correo.text }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) proveedorId = await idDeRespuestaResend(res);
      else falla = `resend_${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`;
    } catch (e) {
      falla = e instanceof Error ? e.message : String(e);
    }
  }

  await registrarAvisoEquipo(deps.svc, {
    origen: 'resend-volumen',
    workspaceId: null,
    estado: falla ? 'fallido' : 'enviado',
    destino: correo.to,
    titulo: correo.subject,
    motivo: falla,
    proveedorId,
  });

  if (falla) {
    // El umbral vuelve a «sin avisar»: el próximo email.sent lo reintenta.
    console.error(`[volumen-resend] la alarma de ${d.umbral} no salio: ${falla}`);
    try {
      const { error } = await deps.svc.rpc('resend_volumen_desmarcar', { p_periodo: d.periodo, p_umbral: d.umbral });
      if (error) console.error(`[volumen-resend] no se pudo desmarcar ${d.umbral}: ${error.message}`);
    } catch (e) {
      console.error(`[volumen-resend] no se pudo desmarcar ${d.umbral}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // El WhatsApp acompaña al correo que SALIÓ: si el correo falla, el umbral se reintenta con
  // el siguiente email.sent y un WhatsApp por intento sería un mensaje por correo enviado.
  if (!falla && deps.whatsapp) {
    try {
      await deps.whatsapp(whatsappAlarmaVolumen(d), { enviados: d.enviados, incluidos: d.incluidos, umbral: d.umbral });
    } catch (e) {
      console.error(`[volumen-resend] el WhatsApp de la alarma fallo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return falla ? 'fallida' : 'enviada';
}
