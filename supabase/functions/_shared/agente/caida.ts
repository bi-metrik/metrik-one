// ============================================================
// Asistentes — el correo inmediato si se caen los modelos (spec 2026-10-26 asistentes-roles-y-funciones, §4.1)
// ------------------------------------------------------------
// El 9-oct cayeron principal y respaldo y nadie se enteró: la persona recibió el «no pude» (`rf.modelo_caido`) y la
// traza lo guardó, nada más. Esto lo convierte en un correo a Mauricio, común a los tres canales:
//   · ONE y la bandeja (`_shared/wa-agente.ts`, por `despuesDelTurno`);
//   · el asistente público de Chatwoot (`publico/cola.ts`, por `alertaCaida`). Sabor no tiene modelo de respaldo
//     (decisión del 26-oct): su respaldo es una persona en Chatwoot, y «cayeron todos» quiere decir que cayó el único.
//
// Disparador (`caidaDelTurno`, pura): el turno terminó por error del modelo (`modelo:` del núcleo, `falla:` del público)
// Y en el llamado que falló ningún modelo contestó. Un modelo que contestó y no sirvió (rechazo `refusal`, «sin llamada»)
// NO es caída: el proveedor está arriba, el problema es de la conversación y lo cuenta el resumen diario (§4.3).
//
// Un correo por incidente: candado `agente:caido:<workspace>:<ventana de 30 min>`. Si la ventana anterior también tuvo
// caída, el incidente sigue: solo sale un recordatorio por hora (candado `agente:caido:<workspace>:recordatorio`).
// Resend recibe además una `Idempotency-Key` por ventana. Si Resend falla, los candados se sueltan para que el próximo
// turno caído lo intente otra vez. Nunca lanza: el turno no se cae por el correo.
//
// El cuerpo: hora de Bogotá, cada modelo con su motivo, cuántas conversaciones quedaron sin respuesta en la última hora
// (de la base, si se pudo contar) y cómo encontrar la traza. NUNCA el texto del cliente ni un teléfono: la
// conversación va por alias (en WhatsApp, un resumen del teléfono que no se puede revertir).
// ============================================================

import { CORREO_MAURICIO, htmlDeTexto } from '../correo-interno.ts';
import type { EnvioCorreo, ResultadoCorreo } from '../correo-interno.ts';
import type { Traza, UsoLlamado } from './tipos.ts';

export const VENTANA_CAIDA_MS = 30 * 60 * 1000;
export const RECORDATORIO_CAIDA_S = 60 * 60;

export interface ModeloCaido {
  modelo: string;
  motivo: string;
}

/** El motivo que contestó el modelo (no es caída del proveedor). */
const respondio = (motivo: string) => motivo === 'refusal' || motivo.startsWith('sin llamada');

/**
 * El motivo para el correo: el código de la falla, sin el cuerpo que devolvió el proveedor («http 403», «corte»,
 * «red: …» corto). Pura.
 */
export function motivoCorto(motivo: string | undefined): string {
  const m = String(motivo ?? '').trim();
  if (!m) return 'sin motivo';
  const http = /^http \d{3}/.exec(m);
  return http ? http[0] : m.slice(0, 60);
}

/**
 * ¿El turno terminó porque se cayeron todos los modelos configurados? Devuelve cada modelo con su motivo, o `null`.
 *
 * Los `usos` de la traza son de todos los llamados del turno; los del llamado que falló son los del final, después del
 * último que contestó bien (los perdedores cancelados de un llamado anterior, «cancelado: …», no cuentan). Pura.
 */
export function caidaDelTurno(t: Pick<Traza, 'error' | 'uso'> | null | undefined): ModeloCaido[] | null {
  const e = String(t?.error ?? '');
  // El público le pega a `error` lo que falló al pasar a persona («…; nota: …»): manda lo de antes del primer «;».
  const motivo = e.startsWith('modelo:') ? e.slice(7).split(';')[0].trim() : e.startsWith('falla:') ? e.slice(6).split(';')[0].trim() : null;
  if (motivo === null || respondio(motivo)) return null;
  const usos: UsoLlamado[] = t?.uso ?? [];
  let desde = 0;
  usos.forEach((u, i) => { if (u.ok) desde = i + 1; });
  const cola = usos.slice(desde).filter((u) => !u.ok && !String(u.motivo ?? '').startsWith('cancelado'));
  if (!cola.length) {
    // Sin ningún llamado terminado: solo el corte total del público (ningún intento respondió a tiempo). Si algún
    // llamado contestó bien, el turno terminó por otra cosa (el tope de tiempo del núcleo, por ejemplo).
    if (desde === 0 && motivo === 'corte_total') return [{ modelo: 'el modelo configurado', motivo: 'corte total: ningún intento respondió a tiempo' }];
    return null;
  }
  if (cola.some((u) => respondio(String(u.motivo ?? '')))) return null;
  return cola.map((u) => ({ modelo: u.modelo, motivo: motivoCorto(u.motivo) }));
}

/** El rol (spec §2.9, `traza.rol`) o, sin roles, el bot. Lee el rol sin depender de su tipo. Pura. */
export function asistenteDe(t: Pick<Traza, 'bot'> & { rol?: unknown }): string {
  const rol = t.rol as { clave?: unknown } | null | undefined;
  return typeof rol?.clave === 'string' && rol.clave ? rol.clave : t.bot;
}

/** La hora de Bogotá («2026-10-26 14:05»). Colombia no tiene horario de verano. Pura. */
export function horaBogota(ms: number): string {
  return new Date(ms - 5 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Un alias de la conversación de WhatsApp que no deja ver el teléfono: «wa-» + 10 hex del sha-256. */
export async function aliasConversacionWa(workspaceId: string, phone: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${workspaceId}:${phone.replace(/\D/g, '')}`)));
  return `wa-${[...h.slice(0, 5)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export type CanalAsistente = 'one' | 'bandeja' | 'chatwoot';

const NOMBRE_CANAL: Record<CanalAsistente, string> = {
  one: 'WhatsApp de ONE (modo agente)',
  bandeja: 'WhatsApp, bandeja de solicitudes',
  chatwoot: 'Chatwoot (asistente público)',
};

const TABLA: Record<CanalAsistente, string> = { one: 'wa_conversacion', bandeja: 'wa_conversacion', chatwoot: 'chatwoot_conversacion' };

export interface DatosCaida {
  workspaceId: string;
  /** El slug. */
  workspaceNombre: string;
  canal: CanalAsistente;
  /** El alias de la conversación (nunca el teléfono). */
  conversacion: string;
  turnoId: string | null;
  ahoraMs: number;
}

/** El correo de la caída. Pura. */
export function correoCaida(p: {
  datos: DatosCaida; asistente: string; modelos: ModeloCaido[]; sinRespuesta: number | null; recordatorio: boolean; destino?: string;
}): { to: string; subject: string; text: string; html: string } {
  const d = p.datos;
  const lineas = [
    p.recordatorio ? 'SIGUE CAÍDO: el asistente lleva más de una hora sin modelo.' : 'El asistente se quedó sin modelo: fallaron todos los configurados.',
    '',
    `Hora (Bogotá): ${horaBogota(d.ahoraMs)}`,
    `Workspace: ${d.workspaceNombre}`,
    `Asistente: ${p.asistente}`,
    `Canal: ${NOMBRE_CANAL[d.canal]}`,
    '',
    'Modelos:',
    ...p.modelos.map((m) => `  · ${m.modelo}: ${m.motivo}`),
    '',
    p.sinRespuesta === null
      ? 'Conversaciones sin respuesta del modelo en la última hora: no se pudieron contar.'
      : `Conversaciones sin respuesta del modelo en la última hora: ${p.sinRespuesta}.`,
    d.canal === 'chatwoot'
      ? 'La conversación pasó a una persona en Chatwoot (motivo «falla»).'
      : 'La persona recibió el «no pude» (rf.modelo_caido).',
    '',
    'La traza:',
    `  workspace ${d.workspaceNombre} (${d.workspaceId})`,
    `  conversación ${d.conversacion}`,
    `  turno ${d.turnoId ?? '(sin id)'}`,
    ...(d.turnoId ? [`  select traza from public.${TABLA[d.canal]} where turno_id = '${d.turnoId}' and traza is not null;`] : []),
  ];
  const text = lineas.join('\n');
  return { to: p.destino ?? CORREO_MAURICIO, subject: `Asistente caído: ${d.workspaceNombre} · ${p.asistente}`, text, html: htmlDeTexto(text) };
}

export interface PuertosCaida {
  tomarCandado(clave: string, segundos: number): Promise<boolean>;
  soltarCandado?(clave: string): Promise<void>;
  /** Conversaciones con un turno sin respuesta del modelo desde `desdeIso`. `null` = no se pudo contar. */
  sinRespuesta?(desdeIso: string): Promise<number | null>;
  enviarCorreo: EnvioCorreo;
  /** Otro destino (pruebas). */
  destino?: string;
}

export type ResultadoCaida = 'sin_caida' | 'enviado' | 'recordatorio' | 'ya_avisado' | 'fallo_envio' | 'error';

export function clavesCaida(workspaceId: string, ahoraMs: number) {
  const v = Math.floor(ahoraMs / VENTANA_CAIDA_MS);
  return {
    ventana: v,
    actual: `agente:caido:${workspaceId}:${v}`,
    anterior: `agente:caido:${workspaceId}:${v - 1}`,
    recordatorio: `agente:caido:${workspaceId}:recordatorio`,
  };
}

/**
 * Después de un turno: si fue caída de todos los modelos, el correo (uno por incidente; un recordatorio por hora si
 * sigue). Nunca lanza.
 */
export async function alertarSiCaido(p: PuertosCaida, traza: (Pick<Traza, 'error' | 'uso' | 'bot'> & { rol?: unknown }) | null | undefined, d: DatosCaida): Promise<ResultadoCaida> {
  try {
    const modelos = traza ? caidaDelTurno(traza) : null;
    if (!traza || !modelos) return 'sin_caida';
    const k = clavesCaida(d.workspaceId, d.ahoraMs);
    // Las claves viven dos ventanas: la siguiente tiene que poder ver que esta tuvo caída.
    if (!(await p.tomarCandado(k.actual, 2 * VENTANA_CAIDA_MS / 1000))) return 'ya_avisado';
    const sigue = !(await p.tomarCandado(k.anterior, 2 * VENTANA_CAIDA_MS / 1000));
    let recordatorio = false;
    if (!sigue) {
      // Incidente nuevo: el correo sale ya, y el recordatorio queda para dentro de una hora.
      await p.soltarCandado?.(k.recordatorio);
      await p.tomarCandado(k.recordatorio, RECORDATORIO_CAIDA_S);
    } else {
      if (!(await p.tomarCandado(k.recordatorio, RECORDATORIO_CAIDA_S))) return 'ya_avisado';
      recordatorio = true;
    }
    const sinRespuesta = p.sinRespuesta ? await p.sinRespuesta(new Date(d.ahoraMs - 3600 * 1000).toISOString()).catch(() => null) : null;
    const c = correoCaida({ datos: d, asistente: asistenteDe(traza), modelos, sinRespuesta, recordatorio, destino: p.destino });
    const r: ResultadoCorreo = await p.enviarCorreo({ ...c, idempotencyKey: `agente-caido/${d.workspaceId}/${k.ventana}` })
      .catch((e) => ({ ok: false as const, error: String(e) }));
    // 409: esa llave ya la usó un intento anterior de esta ventana (salió, o está saliendo): no se reintenta.
    if (!r.ok && r.status !== 409) {
      console.error(`[agente] no salió el correo de caída de ${d.workspaceNombre}:`, r.error);
      // Que el próximo turno caído lo intente otra vez: se deja todo como estaba antes de este turno (la llave de
      // Resend evita el doble si sí había salido).
      await p.soltarCandado?.(k.actual);
      await p.soltarCandado?.(k.recordatorio);
      if (!recordatorio) await p.soltarCandado?.(k.anterior);
      return 'fallo_envio';
    }
    return recordatorio ? 'recordatorio' : 'enviado';
  } catch (err) {
    console.error('[agente] la alerta de caída falló:', err);
    return 'error';
  }
}

// ── Versión sin banco (encargo 2026-10-30) ──────────────────────────────────
// El canal está prendido pero la versión vigente no pasó su banco del arnés (`turno-con-rol.ts`, `version_sin_banco`):
// cada turno pasa a una persona. No es una caída del modelo, pero sí deja al asistente sin atender: un correo por
// workspace al día, con el mismo envío.

export const VENTANA_SIN_BANCO_S = 24 * 60 * 60;

/** El correo de la versión sin banco. Pura. */
export function correoSinBanco(p: { datos: DatosCaida; destino?: string }): { to: string; subject: string; text: string; html: string } {
  const d = p.datos;
  const text = [
    'El asistente está prendido, pero la versión publicada no pasó su banco de pruebas (pass^k).',
    'Mientras tanto, cada conversación pasa a una persona en Chatwoot (motivo «version_sin_banco»).',
    '',
    `Hora (Bogotá): ${horaBogota(d.ahoraMs)}`,
    `Workspace: ${d.workspaceNombre}`,
    `Canal: ${NOMBRE_CANAL[d.canal]}`,
    `Conversación: ${d.conversacion}`,
    '',
    'Para que vuelva a atender: correr el arnés del público con --k 3 y publicar con su banco,',
    'o mover el puntero reglamento_id a una versión que sí lo tenga.',
  ].join('\n');
  return { to: p.destino ?? CORREO_MAURICIO, subject: `Asistente sin banco: ${d.workspaceNombre}`, text, html: htmlDeTexto(text) };
}

/** El aviso de la versión sin banco: uno por workspace al día. Nunca lanza. */
export async function alertarSinBanco(p: PuertosCaida, d: DatosCaida): Promise<'enviado' | 'ya_avisado' | 'fallo_envio' | 'error'> {
  try {
    const dia = Math.floor(d.ahoraMs / (VENTANA_SIN_BANCO_S * 1000));
    const clave = `agente:sin_banco:${d.workspaceId}:${dia}`;
    if (!(await p.tomarCandado(clave, VENTANA_SIN_BANCO_S))) return 'ya_avisado';
    const r: ResultadoCorreo = await p.enviarCorreo({ ...correoSinBanco({ datos: d, destino: p.destino }), idempotencyKey: `agente-sin-banco/${d.workspaceId}/${dia}` })
      .catch((e) => ({ ok: false as const, error: String(e) }));
    if (!r.ok && r.status !== 409) {
      console.error(`[agente] no salió el correo de versión sin banco de ${d.workspaceNombre}:`, r.error);
      await p.soltarCandado?.(clave);
      return 'fallo_envio';
    }
    return 'enviado';
  } catch (err) {
    console.error('[agente] el aviso de versión sin banco falló:', err);
    return 'error';
  }
}
