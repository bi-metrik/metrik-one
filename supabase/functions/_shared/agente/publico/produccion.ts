// ============================================================
// Asistente público — los puertos de producción (Supabase y la API de Chatwoot)
// ------------------------------------------------------------
// · `almacenChatwootSupabase`: `chatwoot_conversacion` y `chatwoot_consentimientos` (migración 20261021090000), y
//   `tomar_candado`/`claves_idempotencia` como el núcleo.
// · `mensajeroChatwootApi`: la API de aplicación de Chatwoot con el token del Agent Bot (cabecera `api_access_token`):
//   mensaje (`input_select` para Sí / No y opciones), nota privada, etiquetas (se suman: la API reemplaza la lista),
//   asignación de equipo y `toggle_status`. SIN VERIFICAR (D7): que el token del Agent Bot pueda crear notas privadas,
//   etiquetar y cambiar el estado en la cuenta real; plan B: token de un usuario de servicio con el rol más bajo que
//   alcance (es otro valor de `CHATWOOT_API_TOKEN_<SLUG>`, sin cambiar código).
//   Fotos (ventas, 29-oct): `publicarFoto` baja la imagen del bucket `ferreteria-fotos` (solo ese host y ruta, sin
//   redirecciones, ≤ 5 MB, 8 s) y la sube por multipart `attachments[]`. SIN VERIFICAR contra Chatwoot Cloud: que el
//   token del Agent Bot pueda subir adjuntos y que Messenger muestre la foto con el pie.
// · `puertosEntradaSupabase`: lo que necesita la petición del webhook (`entrada.ts`).
// · `alertaCaidaChatwoot` y `avisosPorCorreo` (spec 2026-10-26, §4.1): el correo si se cae el modelo y el aviso del
//   presupuesto diario, por correo a MéTRIK (Resend) y ya no por WhatsApp.
// Los secretos los pasa quien llama (la función los lee de `Deno.env`); este archivo no lee el entorno.
// ============================================================

import type { SupabaseClient } from '../../types.ts';
import type { Salida } from '../tipos.ts';
import { CORREO_MAURICIO, enviarCorreoInterno, htmlDeTexto } from '../../correo-interno.ts';
import { alertarSiCaido, caidaDelTurno } from '../caida.ts';
import type { PuertosCaida } from '../caida.ts';
import { inicioDiaBogota } from './topes.ts';
import type { PrecioModelo } from '../uso.ts';
import { leerConfigPublico } from './config.ts';
import type { EntranteNuevo, PuertosEntrada, WorkspacePublico } from './entrada.ts';
import type { AlmacenPublico, AvisosInternos, Consentimiento, MensajeroChatwoot, ResultadoPublicar } from './puertos.ts';
import type { FilaPublica, LlaveConversacion, TrazaPublica } from './tipos.ts';
import { llaveTexto } from './tipos.ts';
import { urlFotoPermitida } from './ventas/catalogo-ventas.ts';

type Fila = Record<string, unknown>;
const COLUMNAS = 'id, workspace_id, cuenta_id, conversacion_id, canal, direccion, clase, texto, enmascarado, adjunto, opciones, toque_id, chatwoot_message_id, turno_id, ranura, estado, traza, ms_webhook, created_at';
export const TEXTO_ENMASCARADO = '[mensaje con un dato protegido: enmascarado]';

/** Una fila de la tabla como la ve el núcleo. Pura. */
export function filaDeTabla(x: Fila): FilaPublica {
  return {
    id: String(x.id), workspace_id: String(x.workspace_id), phone: `${x.cuenta_id}:${x.conversacion_id}`,
    direccion: x.direccion as FilaPublica['direccion'], clase: x.clase as FilaPublica['clase'], texto: (x.texto as string | null) ?? null,
    opciones: (x.opciones as FilaPublica['opciones']) ?? null, toque_id: (x.toque_id as string | null) ?? null,
    wa_message_id: x.chatwoot_message_id === null || x.chatwoot_message_id === undefined ? null : String(x.chatwoot_message_id),
    turno_id: (x.turno_id as string | null) ?? null, traza: (x.traza as TrazaPublica | null) ?? null, created_at: String(x.created_at),
    canal: x.canal as FilaPublica['canal'], enmascarado: x.enmascarado === true, adjunto: (x.adjunto as FilaPublica['adjunto']) ?? null,
    estado: (x.estado as FilaPublica['estado']) ?? null, ranura: (x.ranura as string | null) ?? null, ms_webhook: (x.ms_webhook as number | null) ?? null,
  };
}

const duplicado = (e: { code?: string } | null) => e?.code === '23505';

async function tomar(supabase: SupabaseClient, clave: string, segundos: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('tomar_candado', { p_clave: clave, p_segundos: Math.round(segundos) });
  if (error) {
    console.error('[asistente] no se pudo tomar el candado:', error.message);
    return false;
  }
  return data === true;
}

async function soltar(supabase: SupabaseClient, clave: string): Promise<void> {
  const { error } = await supabase.from('claves_idempotencia').delete().eq('clave', clave).eq('ambito', 'candado');
  if (error) console.error('[asistente] no se pudo soltar el candado:', error.message);
}

// ── Almacén ──────────────────────────────────────────────────────────────────

export function almacenChatwootSupabase(supabase: SupabaseClient): AlmacenPublico {
  return {
    async leer(l, desdeIso) {
      const { data, error } = await supabase.from('chatwoot_conversacion').select(COLUMNAS)
        .eq('workspace_id', l.workspaceId).eq('cuenta_id', l.cuentaId).eq('conversacion_id', l.conversacionId)
        .neq('clase', 'nota').gte('created_at', desdeIso).order('created_at', { ascending: true }).limit(500);
      if (error) throw new Error(`no se pudo leer la conversación: ${error.message}`);
      return ((data ?? []) as Fila[]).map(filaDeTabla);
    },
    async cerrarTurno(p) {
      const r = await Promise.all([
        // Sin entrantes (el aviso de un pago aprobado): solo la traza.
        p.filas.length ? supabase.from('chatwoot_conversacion').update({ turno_id: p.turnoId }).in('id', p.filas) : Promise.resolve({ error: null }),
        supabase.from('chatwoot_conversacion').update({ traza: p.traza }).eq('id', p.filaTraza),
      ]);
      for (const x of r) if (x.error) console.error('[asistente] no se pudo cerrar el turno:', x.error.message);
    },
    async completarTexto(id, texto) {
      const { error } = await supabase.from('chatwoot_conversacion').update({ texto }).eq('id', id);
      if (error) console.error('[asistente] no se pudo guardar la transcripción:', error.message);
    },
    async enmascarar(ids) {
      if (!ids.length) return;
      const { error } = await supabase.from('chatwoot_conversacion').update({ texto: TEXTO_ENMASCARADO, enmascarado: true }).in('id', ids);
      if (error) console.error('[asistente] no se pudo enmascarar:', error.message);
    },
    async reservarSalida(p) {
      const { data, error } = await supabase.from('chatwoot_conversacion').insert({
        workspace_id: p.llave.workspaceId, cuenta_id: p.llave.cuentaId, conversacion_id: p.llave.conversacionId, canal: p.canal,
        direccion: 'saliente', clase: p.nota ? 'nota' : 'bot', texto: p.salida.texto, opciones: 'opciones' in p.salida ? p.salida.opciones : null,
        turno_id: p.turnoId, ranura: p.ranura, estado: 'generado',
      }).select('id').single();
      if (duplicado(error)) return null;
      if (error || !data) {
        // Sin la fila no hay garantía de no publicar dos veces: no se publica.
        console.error('[asistente] no se pudo guardar lo que iba a salir:', error?.message);
        return null;
      }
      return String((data as Fila).id);
    },
    async marcarSalida(id, r) {
      const { error } = await supabase.from('chatwoot_conversacion').update({
        estado: r.estado, ...(r.chatwootMessageId ? { chatwoot_message_id: r.chatwootMessageId } : {}), ...(r.estado === 'publicado' ? { publicado_at: new Date().toISOString() } : {}),
      }).eq('id', id);
      if (error) console.error('[asistente] no se pudo marcar la salida:', error.message);
    },
    async registrarConsentimiento(c: Consentimiento) {
      const { error } = await supabase.from('chatwoot_consentimientos').insert({
        workspace_id: c.llave.workspaceId, cuenta_id: c.llave.cuentaId, conversacion_id: c.llave.conversacionId, canal: c.canal,
        tipo: c.tipo, respuesta: c.respuesta, texto_clave: c.textoClave, texto_version: c.textoVersion, texto_huella: c.textoHuella,
        mensaje_texto: c.mensajeTexto, chatwoot_message_id: c.chatwootMessageId,
      });
      // La prueba también queda en la traza del turno; si la fila falla, queda en el log para repararla.
      if (error) console.error('[asistente] no se pudo guardar la prueba del consentimiento:', error.message, JSON.stringify({ ...c, llave: llaveTexto(c.llave) }));
    },
    async trazasDelModelo(workspaceId, desdeIso) {
      const { data, error } = await supabase.from('chatwoot_conversacion').select('traza')
        .eq('workspace_id', workspaceId).gte('created_at', desdeIso).eq('traza->>tipo', 'modelo').limit(5000);
      if (error) {
        console.error('[asistente] no se pudo leer el gasto del día:', error.message);
        return null;
      }
      return ((data ?? []) as Fila[]).map((x) => x.traza as TrazaPublica);
    },
    tomarCandado: (clave, segundos) => tomar(supabase, clave, segundos),
    soltarCandado: (clave) => soltar(supabase, clave),
  };
}

/** Los precios de `bot_modelo_precios` (USD por millón). Vacío si no se pudo leer (el tope usa el de Haiku por defecto). */
export async function preciosSupabase(supabase: SupabaseClient): Promise<PrecioModelo[]> {
  const { data, error } = await supabase.from('bot_modelo_precios').select('modelo, usd_millon_entrada, usd_millon_salida, usd_millon_cache');
  if (error) return [];
  return ((data ?? []) as Fila[]).map((x) => ({ modelo: String(x.modelo), entrada: Number(x.usd_millon_entrada), salida: Number(x.usd_millon_salida), cache: x.usd_millon_cache === null ? null : Number(x.usd_millon_cache) }));
}

// ── Chatwoot ─────────────────────────────────────────────────────────────────

/**
 * El cuerpo de un mensaje de Chatwoot desde la salida del núcleo (`input_select` con los ids del código). Un `enlace`
 * (§4.2) sale como texto con el link debajo: Chatwoot no tiene el botón de URL de WhatsApp. Pura.
 */
export function cuerpoMensajeChatwoot(s: Salida, privado = false): Record<string, unknown> {
  if (s.tipo === 'enlace') return { content: `${s.texto}\n${s.url}`, message_type: 'outgoing', private: privado };
  const base = { content: s.texto, message_type: 'outgoing', private: privado };
  if (s.tipo === 'texto' || privado) return base;
  return { ...base, content_type: 'input_select', content_attributes: { items: s.opciones.map((o) => ({ title: o.titulo, value: o.id })) } };
}

/** Tope de una foto del catálogo que se sube a Chatwoot (Messenger acepta hasta 8 MB por imagen). */
export const FOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Tiempo máximo para bajar una foto del bucket y, aparte, para subirla a Chatwoot. */
export const FOTO_TIMEOUT_MS = 8000;
const TIPOS_FOTO = /^image\/(jpeg|png|webp|gif)\b/i;

export type FotoBajada = { ok: true; archivo: Blob; nombre: string } | { ok: false; motivo: string };

/**
 * Baja una foto del catálogo para subirla como adjunto: solo del bucket propio (`urlFotoPermitida`), sin seguir
 * redirecciones, imagen (jpeg, png, webp o gif), hasta `maxBytes` (se corta al leer aunque el servidor no diga el
 * largo) y con tiempo máximo. Nunca lanza.
 */
export async function bajarFoto(url: string, o: { hostPermitido: string | null; fetch: typeof fetch; maxBytes?: number; timeoutMs?: number }): Promise<FotoBajada> {
  if (!urlFotoPermitida(url, o.hostPermitido)) return { ok: false, motivo: 'la URL no es del bucket de fotos del catálogo' };
  const max = o.maxBytes ?? FOTO_MAX_BYTES;
  try {
    const r = await o.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(o.timeoutMs ?? FOTO_TIMEOUT_MS) });
    if (!r.ok) return { ok: false, motivo: `descarga http ${r.status}` };
    const tipo = r.headers.get('content-type') ?? '';
    if (!TIPOS_FOTO.test(tipo)) return { ok: false, motivo: `no es una imagen (${tipo.slice(0, 40) || 'sin tipo'})` };
    const largo = Number(r.headers.get('content-length') ?? '');
    if (Number.isFinite(largo) && largo > max) return { ok: false, motivo: `la foto pesa ${largo} bytes (tope ${max})` };
    if (!r.body) return { ok: false, motivo: 'descarga sin cuerpo' };
    const partes: Uint8Array[] = [];
    let total = 0;
    const lector = r.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await lector.cancel().catch(() => {});
        return { ok: false, motivo: `la foto pasa el tope de ${max} bytes` };
      }
      partes.push(value);
    }
    if (!total) return { ok: false, motivo: 'foto vacía' };
    const nombre = (new URL(url).pathname.split('/').pop() || 'foto.jpg').replace(/[^\w.-]+/g, '_').slice(0, 80);
    return { ok: true, archivo: new Blob(partes as BlobPart[], { type: tipo.split(';')[0].trim() }), nombre };
  } catch (e) {
    return { ok: false, motivo: `descarga: ${String(e).slice(0, 80)}` };
  }
}

export function mensajeroChatwootApi(o: {
  apiUrl: string; token: string; fetch?: typeof fetch; timeoutMs?: number;
  /** El host de Supabase de donde se pueden bajar fotos del catálogo (`ferreteria-fotos`). Sin él, ninguna foto sale. */
  hostFotos?: string | null;
}): MensajeroChatwoot {
  const f = o.fetch ?? ((u: RequestInfo | URL, i?: RequestInit) => globalThis.fetch(u, i));
  const base = (l: LlaveConversacion) => `${o.apiUrl}/api/v1/accounts/${l.cuentaId}/conversations/${l.conversacionId}`;
  const pedir = (url: string, metodo: string, cuerpo?: unknown) => f(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', api_access_token: o.token },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    signal: AbortSignal.timeout(o.timeoutMs ?? 8000),
  });
  const crear = async (l: LlaveConversacion, cuerpo: Record<string, unknown>): Promise<ResultadoPublicar> => {
    try {
      const r = await pedir(`${base(l)}/messages`, 'POST', cuerpo);
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        return { ok: true, id: typeof d?.id === 'number' ? d.id : null };
      }
      // 5xx: Chatwoot pudo haberlo creado. No se reintenta a ciegas (§3.3).
      return { ok: false, incierto: r.status >= 500, motivo: `http ${r.status}: ${(await r.text()).slice(0, 120)}` };
    } catch (e) {
      return { ok: false, incierto: true, motivo: `red o corte: ${String(e).slice(0, 80)}` };
    }
  };
  const bien = async (p: Promise<Response>): Promise<boolean> => {
    try {
      const r = await p;
      if (!r.ok) console.error(`[asistente] Chatwoot respondió ${r.status}: ${(await r.text()).slice(0, 120)}`);
      return r.ok;
    } catch (e) {
      console.error('[asistente] Chatwoot no respondió:', String(e).slice(0, 120));
      return false;
    }
  };
  return {
    async estado(l) {
      try {
        const r = await pedir(base(l), 'GET');
        if (!r.ok) return null;
        const d = await r.json();
        return typeof d?.status === 'string' ? d.status : null;
      } catch {
        return null;
      }
    },
    publicar: (l, s) => crear(l, cuerpoMensajeChatwoot(s)),
    async publicarFoto(l, foto) {
      // Chatwoot recibe los adjuntos por multipart (`attachments[]`), no por URL: se baja y se sube. Si la descarga
      // falla no se mandó nada (no es incierto); el texto del turno ya salió antes.
      const b = await bajarFoto(foto.url, { hostPermitido: o.hostFotos ?? null, fetch: f });
      if (!b.ok) return { ok: false, incierto: false, motivo: `foto: ${b.motivo}` };
      const fd = new FormData();
      // Sin pie (ronda 3: la foto va justo después del texto de su producto) no se manda `content`: Messenger muestra
      // solo la imagen. Con pie, Chatwoot lo manda a Messenger como un texto antes de la imagen.
      if (foto.texto) fd.append('content', foto.texto);
      fd.append('message_type', 'outgoing');
      fd.append('private', 'false');
      fd.append('attachments[]', b.archivo, b.nombre);
      try {
        // Sin content-type a mano: el runtime pone el multipart con su boundary.
        const r = await f(`${base(l)}/messages`, { method: 'POST', headers: { api_access_token: o.token }, body: fd, signal: AbortSignal.timeout(FOTO_TIMEOUT_MS) });
        if (r.ok) {
          const d = await r.json().catch(() => ({}));
          return { ok: true, id: typeof d?.id === 'number' ? d.id : null };
        }
        return { ok: false, incierto: r.status >= 500, motivo: `foto: http ${r.status}: ${(await r.text()).slice(0, 120)}` };
      } catch (e) {
        return { ok: false, incierto: true, motivo: `foto: red o corte: ${String(e).slice(0, 80)}` };
      }
    },
    nota: (l, texto) => crear(l, cuerpoMensajeChatwoot({ tipo: 'texto', texto }, true)),
    async etiquetar(l, etiquetas) {
      // La API reemplaza la lista: se leen las de hoy y se suman.
      let actuales: string[] = [];
      try {
        const r = await pedir(`${base(l)}/labels`, 'GET');
        if (r.ok) actuales = ((await r.json())?.payload ?? []).map(String);
      } catch {
        // sin las actuales, se mandan solo las nuevas (peor caso: se pierde una etiqueta que ya tenía).
      }
      return await bien(pedir(`${base(l)}/labels`, 'POST', { labels: [...new Set([...actuales, ...etiquetas])] }));
    },
    asignarEquipo: (l, equipo) => bien(pedir(`${base(l)}/assignments`, 'POST', { team_id: equipo })),
    abrir: (l) => bien(pedir(`${base(l)}/toggle_status`, 'POST', { status: 'open' })),
  };
}

// ── La entrada ───────────────────────────────────────────────────────────────

const cacheWs = new Map<string, { w: WorkspacePublico | null; vence: number }>();

export function puertosEntradaSupabase(supabase: SupabaseClient, secreto: (slug: string) => string | undefined): PuertosEntrada {
  return {
    secreto,
    async workspace(slug) {
      const c = cacheWs.get(slug);
      if (c && c.vence > Date.now()) return c.w;
      const { data, error } = await supabase.from('workspaces').select('id, slug, config_extra').eq('slug', slug).maybeSingle();
      if (error) throw new Error(`no se pudo leer el workspace: ${error.message}`);
      const w = data ? { id: String(data.id), slug: String(data.slug), config: leerConfigPublico((data.config_extra as Fila | null)?.bot_conversacional) } : null;
      cacheWs.set(slug, { w, vence: Date.now() + 60_000 });
      return w;
    },
    primeraVez: (clave) => tomar(supabase, clave, 7 * 24 * 3600),
    async olvidar(clave) {
      await soltar(supabase, clave);
    },
    async guardarEntrante(e: EntranteNuevo) {
      const { error } = await supabase.from('chatwoot_conversacion').insert({
        workspace_id: e.llave.workspaceId, cuenta_id: e.llave.cuentaId, conversacion_id: e.llave.conversacionId, inbox_id: e.inboxId, canal: e.canal,
        direccion: 'entrante', clase: e.clase, texto: e.texto, toque_id: e.toqueId, chatwoot_message_id: e.mensajeId, adjunto: e.adjunto, ms_webhook: e.msWebhook,
      });
      if (duplicado(error)) return 'duplicado';
      if (error) {
        console.error('[asistente] no se pudo guardar el mensaje:', error.message);
        return 'error';
      }
      return 'ok';
    },
    async completarAudio(p) {
      const { data, error } = await supabase.from('chatwoot_conversacion').select('id, adjunto, turno_id')
        .eq('workspace_id', p.workspaceId).eq('cuenta_id', p.cuentaId).eq('chatwoot_message_id', p.mensajeId).eq('direccion', 'entrante').maybeSingle();
      if (error || !data || data.turno_id || (data.adjunto as Fila | null)?.url) return false;
      const { error: e2 } = await supabase.from('chatwoot_conversacion').update({ adjunto: p.adjunto, clase: 'audio' }).eq('id', data.id);
      return !e2;
    },
    ahoraS: () => Math.floor(Date.now() / 1000),
    reloj: () => performance.now(),
  };
}

// ── Avisos internos por correo (spec 2026-10-26, §4.1) ───────────────────────

/** Un resumen corto de un texto (para la llave de Resend). */
async function resumen(texto: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * El aviso del presupuesto diario por correo a MéTRIK (antes por WhatsApp a `WA_ADMIN_NOTIFY_PHONE`, que se perdía fuera
 * de la ventana de 24 h). El candado de la cola ya avisa una vez por umbral y día; la llave de Resend también.
 */
export function avisosPorCorreo(p: { workspaceNombre: string; llaveResend: string; ahoraMs?: () => number }): AvisosInternos {
  return {
    async avisar(texto) {
      const dia = inicioDiaBogota((p.ahoraMs ?? Date.now)()).slice(0, 10);
      const r = await enviarCorreoInterno({
        to: CORREO_MAURICIO,
        subject: `Presupuesto del asistente: ${p.workspaceNombre}`,
        text: texto,
        html: htmlDeTexto(texto),
        idempotencyKey: `asistente-presupuesto/${p.workspaceNombre}/${dia}/${await resumen(texto)}`,
      }, { llave: p.llaveResend });
      if (!r.ok) console.error('[asistente] no salió el aviso del presupuesto:', r.error);
    },
  };
}

/**
 * Los puertos del correo de caída en Chatwoot: los candados del almacén, las conversaciones con un turno caído en la
 * última hora (`chatwoot_conversacion`, índice parcial de las trazas del modelo) y Resend.
 */
export function caidaChatwootSupabase(supabase: SupabaseClient, almacen: Pick<AlmacenPublico, 'tomarCandado' | 'soltarCandado'>, workspaceId: string, llaveResend: string): PuertosCaida {
  return {
    tomarCandado: (k, s) => almacen.tomarCandado(k, s),
    soltarCandado: (k) => almacen.soltarCandado(k),
    async sinRespuesta(desdeIso) {
      const { data, error } = await supabase.from('chatwoot_conversacion').select('cuenta_id, conversacion_id')
        .eq('workspace_id', workspaceId).gte('created_at', desdeIso).eq('traza->>tipo', 'modelo').like('traza->>error', 'falla:%').limit(2000);
      if (error) return null;
      return new Set(((data ?? []) as Fila[]).map((x) => `${x.cuenta_id}:${x.conversacion_id}`)).size;
    },
    enviarCorreo: (m) => enviarCorreoInterno(m, { llave: llaveResend }),
  };
}

/** El gancho `alertaCaida` de la cola pública: el correo si se cayó el modelo. Nunca lanza. */
export function alertaCaidaChatwoot(
  supabase: SupabaseClient, almacen: Pick<AlmacenPublico, 'tomarCandado' | 'soltarCandado'>,
  p: { llave: LlaveConversacion; workspaceNombre: string; llaveResend: string },
): (traza: TrazaPublica, turnoId: string) => Promise<void> {
  return async (traza, turnoId) => {
    if (!caidaDelTurno(traza)) return;
    await alertarSiCaido(caidaChatwootSupabase(supabase, almacen, p.llave.workspaceId, p.llaveResend), traza, {
      workspaceId: p.llave.workspaceId, workspaceNombre: p.workspaceNombre, canal: 'chatwoot',
      conversacion: `cw:${llaveTexto(p.llave)}`, turnoId, ahoraMs: Date.now(),
    });
  };
}
