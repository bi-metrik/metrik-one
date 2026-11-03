// ============================================================
// Alarma de volumen de Resend — el correo (y el WhatsApp) que avisa a Mauricio
// ------------------------------------------------------------
// Resend Pro incluye un cupo mensual de correos; lo que pase de ahí se cobra y NO hay corte.
// El volumen no se puede consultar por API (la cabecera x-resend-monthly-quota solo viene en
// la respuesta de POST /emails, y el SMTP del auth de Supabase no pasa por nuestro código),
// así que lo cuenta `resend-webhook` con cada `email.sent` y la RPC `resend_contar_enviado`
// devuelve el umbral recién cruzado UNA vez por umbral y período.
//
// Los umbrales, el día de corte y los correos incluidos viven en UNA fila de la base
// (`resend_volumen_config`), no aquí. Aquí solo se arma el mensaje con lo que la RPC devuelve.
//
// Módulo PURO: sin Deno, sin red, sin base. Lo prueban vitest y el script en seco
// (`scripts/alarma-volumen-resend.ts`).
// ============================================================

/** A quién le llega la alarma. */
export const DESTINO_ALARMA_VOLUMEN = 'mauricio.moreno@metrik.com.co';

/** Desde dónde sale: el remitente de sistema (metrikone.co raíz). */
export const REMITENTE_ALARMA_VOLUMEN = 'MéTRIK ONE <noreply@metrikone.co>';

/**
 * Lo que cobra Resend por cada 1.000 correos sobre el cupo (plan Pro, 2026-10-26). Solo va en
 * el texto del aviso; no se usa para calcular nada que se cobre.
 */
export const COSTO_EXCEDENTE_POR_MIL_USD = 0.9;

/** El intent del aviso por WhatsApp (plantilla opcional en `WA_ALERT_TEMPLATES`). */
export const INTENT_ALARMA_VOLUMEN = 'resend_volumen';

export interface DatosAlarmaVolumen {
  enviados: number;
  umbral: number;
  incluidos: number;
  /** Inicio del período, `YYYY-MM-DD` (incluido). */
  periodo: string;
  /** Inicio del período siguiente, `YYYY-MM-DD` (excluido). */
  periodoFin: string;
  /** Hoy en Bogotá, `YYYY-MM-DD`. */
  hoy: string;
}

export interface CorreoAlarmaVolumen {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  /** Resend no manda dos veces el mismo correo con la misma llave (24 h). */
  idempotencyKey: string;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 45000 → «45.000». Sin Intl para que el texto no dependa del ICU del runtime. */
export function miles(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  const conPuntos = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `-${conPuntos}` : conPuntos;
}

function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

function diaAnterior(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Días que faltan para que arranque el período siguiente, contando hoy. */
export function diasQueFaltan(hoy: string, periodoFin: string): number {
  const ms = Date.parse(`${periodoFin}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** «72%», con un decimal solo si hace falta (89,5%). */
export function porcentaje(enviados: number, incluidos: number): string {
  if (incluidos <= 0) return '—';
  const p = Math.round((enviados / incluidos) * 1000) / 10;
  return `${String(p).replace('.', ',')}%`;
}

function escapar(t: string): string {
  return t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function correoAlarmaVolumen(d: DatosAlarmaVolumen): CorreoAlarmaVolumen {
  const subject = `Resend: ${miles(d.umbral)} correos enviados este mes (de ${miles(d.incluidos)} incluidos)`;
  const faltan = diasQueFaltan(d.hoy, d.periodoFin);
  const costo = String(COSTO_EXCEDENTE_POR_MIL_USD.toFixed(2)).replace('.', ',');
  const lineas = [
    `Van ${miles(d.enviados)} correos enviados por Resend en el período, el ${porcentaje(d.enviados, d.incluidos)} de los ${miles(d.incluidos)} incluidos en el plan.`,
    `Período: del ${fechaLarga(d.periodo)} al ${fechaLarga(diaAnterior(d.periodoFin))}. Faltan ${faltan} ${faltan === 1 ? 'día' : 'días'} para que reinicie.`,
    `Lo que pase de ${miles(d.incluidos)} se cobra a US$${costo} por cada 1.000 correos; Resend no corta los envíos.`,
    '',
    'El conteo sale de los eventos email.sent del webhook de Resend (incluye el auth de Supabase y los correos internos). El día de corte y los umbrales se cambian en la tabla resend_volumen_config.',
  ];
  const text = lineas.join('\n');
  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#F5F4F2;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">Volumen de correo</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${escapar(subject)}</h1>
    ${lineas.filter(Boolean).map((l) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#374151">${escapar(l)}</p>`).join('\n    ')}
    <p style="margin:24px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:14px">Enviado por MéTRIK ONE</p>
  </div>
</body></html>`;
  return {
    to: DESTINO_ALARMA_VOLUMEN,
    from: REMITENTE_ALARMA_VOLUMEN,
    subject,
    text,
    html,
    idempotencyKey: `resend-volumen:${d.periodo}:${d.umbral}`,
  };
}

/** El texto corto para WhatsApp. */
export function whatsappAlarmaVolumen(d: DatosAlarmaVolumen): string {
  const faltan = diasQueFaltan(d.hoy, d.periodoFin);
  return `Resend: van ${miles(d.enviados)} correos este mes (${porcentaje(d.enviados, d.incluidos)} de ${miles(d.incluidos)} incluidos). Faltan ${faltan} ${faltan === 1 ? 'día' : 'días'} para que reinicie. El excedente se cobra; no hay corte.`;
}
