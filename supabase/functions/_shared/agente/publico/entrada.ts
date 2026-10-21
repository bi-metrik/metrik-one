// ============================================================
// Asistente público — lo que hace la petición del webhook antes de responder (§2 pasos 1 a 4, §3.1)
// ------------------------------------------------------------
// Solo esto, y responde: 1 firma y antigüedad · 2 filtros · 3 deduplicación por id de mensaje (`claves_idempotencia`)
// · 4 guardar el mensaje entrante. Nada de modelo, transcripción ni llamadas a Chatwoot dentro de la petición (Chatwoot
// espera 5 s y, si no recibe respuesta, pasa la conversación a una persona).
//   · firma mala → 401 (sin reintento). Filtrado → 200 y se ignora.
//   · falla la base al guardar → 500 (Chatwoot reintenta; se suelta la clave de deduplicación para que el reintento
//     entre, y el índice único de la tabla absorbe un doble guardado).
//   · `message_updated` con audio: completa el adjunto del mensaje ya guardado si todavía no tenía URL (idempotente:
//     no se deduplica, porque la primera actualización puede llegar sin la URL).
// Con puertos: la función `chatwoot-agente` les pone Supabase y `Deno.env`; las pruebas, memoria.
// ============================================================

import { canalDeChatwoot, claseEntrante, claveDeduplicacion, filtrar, leerPayload, tieneAudio, verificarFirmaChatwoot } from './chatwoot-webhook.ts';
import type { MensajeChatwoot } from './chatwoot-webhook.ts';
import type { ConfigPublico } from './config.ts';
import { inboxRegistrado } from './config.ts';
import type { Canal, FilaPublica, LlaveConversacion } from './tipos.ts';

export const DIAS_DEDUPLICACION = 7;

export interface WorkspacePublico { id: string; slug: string; config: ConfigPublico }

export interface EntranteNuevo {
  llave: LlaveConversacion;
  inboxId: number | null;
  canal: Canal;
  clase: FilaPublica['clase'];
  texto: string | null;
  toqueId: string | null;
  mensajeId: number;
  adjunto: FilaPublica['adjunto'];
  msWebhook: number;
}

export interface PuertosEntrada {
  secreto(slug: string): string | undefined;
  workspace(slug: string): Promise<WorkspacePublico | null>;
  /** `tomar_candado` con vencimiento largo: true = primera vez que llega este mensaje. */
  primeraVez(clave: string): Promise<boolean>;
  olvidar(clave: string): Promise<void>;
  guardarEntrante(e: EntranteNuevo): Promise<'ok' | 'duplicado' | 'error'>;
  /** Completa la URL del audio de un mensaje ya guardado y sin atender. true = cambió algo. */
  completarAudio(p: { workspaceId: string; cuentaId: number; mensajeId: number; adjunto: NonNullable<FilaPublica['adjunto']> }): Promise<boolean>;
  ahoraS(): number;
  reloj(): number;
}

export interface Atender {
  workspace: WorkspacePublico;
  llave: LlaveConversacion;
  canal: Canal;
  anuncio7Dias: boolean;
}

export type Recibido = { status: number; motivo: string; atender?: Atender };

function adjuntoDe(m: MensajeChatwoot): FilaPublica['adjunto'] {
  const a = m.adjuntos.find((x) => x.tipo === 'audio');
  if (a) return { tipo: 'audio', url: a.url, extension: a.extension };
  if (m.noSoportado) return { tipo: 'no_soportado', url: null, no_soportado: true };
  return null;
}

export async function recibir(req: { slug: string | null; cuerpo: string; firma: string | null; timestamp: string | null }, p: PuertosEntrada): Promise<Recibido> {
  const t0 = p.reloj();
  if (!req.slug || !/^[a-z0-9-]{2,63}$/.test(req.slug)) return { status: 401, motivo: 'sin workspace' };
  const firma = await verificarFirmaChatwoot({ secreto: p.secreto(req.slug), firma: req.firma, timestamp: req.timestamp, cuerpo: req.cuerpo, ahoraS: p.ahoraS() });
  if (!firma.ok) return { status: 401, motivo: `firma: ${firma.motivo}` };
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(req.cuerpo);
  } catch {
    return { status: 200, motivo: 'cuerpo que no es JSON' };
  }
  const m = leerPayload(cuerpo);
  const ws = await p.workspace(req.slug);
  if (!ws || !ws.config.activo) return { status: 200, motivo: 'asistente apagado o workspace sin configurar' };
  const f = filtrar(m, { inboxes: ws.config.inboxes.map((i) => i.id), cuentaId: ws.config.cuentaId });
  if (!f.pasa) return { status: 200, motivo: `filtrado: ${f.motivo}` };
  const inbox = inboxRegistrado(ws.config, m.inboxId)!;
  const canal: Canal = inbox.canal !== 'otro' ? inbox.canal : canalDeChatwoot(m.canalChatwoot);
  const llave: LlaveConversacion = { workspaceId: ws.id, cuentaId: m.cuentaId!, conversacionId: m.conversacionId! };
  const atender: Atender = { workspace: ws, llave, canal, anuncio7Dias: inbox.anuncio7Dias };

  if (m.evento === 'message_updated') {
    const adjunto = adjuntoDe(m);
    if (!adjunto?.url || !tieneAudio(m)) return { status: 200, motivo: 'actualización sin audio' };
    const cambio = await p.completarAudio({ workspaceId: ws.id, cuentaId: llave.cuentaId, mensajeId: m.mensajeId!, adjunto });
    return cambio ? { status: 200, motivo: 'audio completado', atender } : { status: 200, motivo: 'audio sin cambios' };
  }

  const clave = claveDeduplicacion(m);
  if (!(await p.primeraVez(clave))) return { status: 200, motivo: 'duplicado' };
  const g = await p.guardarEntrante({
    llave, inboxId: m.inboxId, canal, clase: claseEntrante(m), texto: m.texto, toqueId: m.valorBoton, mensajeId: m.mensajeId!,
    adjunto: adjuntoDe(m), msWebhook: Math.round(p.reloj() - t0),
  });
  if (g === 'error') {
    await p.olvidar(clave);
    return { status: 500, motivo: 'no se pudo guardar' };
  }
  if (g === 'duplicado') return { status: 200, motivo: 'duplicado (índice)' };
  return { status: 200, motivo: 'guardado', atender };
}
