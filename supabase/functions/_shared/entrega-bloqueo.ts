// ============================================================
// ENTREGA ÚNICA DEL BLOQUEO en el webhook (Trappvel, brief del 2026-11-04)
// ------------------------------------------------------------
// La asesora le entrega a Trappi el pedido de un bloqueo (texto, audio transcrito y pantallazos). Aquí:
//   1. se decide a qué pedido va cada mensaje (`decidirAncla`: lo citado va a su hilo; lo suelto, solo sin duda;
//      si hay duda, se pregunta con botones);
//   2. se guarda la pieza (`entregas_bloqueo_piezas`); el pantallazo se baja de Meta y se sube a Storage;
//   3. tras un silencio (`SILENCIO_MS`), la ÚLTIMA pieza de la tanda le pide a la app que procese el pedido
//      (`/api/interno/entrega-bloqueo`, firmado), y se le mandan a la asesora los mensajes que devuelve.
// El modelo, la base y el PDF los hace la app (Node). A la clienta no se le escribe nunca: todo va a `phone`,
// que es la asesora que escribió.
//
// Opt-in: `config_extra.entrega_bloqueo.piloto = { activo: true, telefonos?: [...] }`. Apagado no hace nada.
// ============================================================

import type { IncomingMessage, SupabaseClient, WaUser } from './types.ts';
import { clienteDelTexto, decidirAncla, tieneSenalDeBloqueo, type EntregaAbierta, type MensajeEntrante } from './entrega-bloqueo-ancla.ts';
import { firmarCuerpo } from './entrega-bloqueo-firma.ts';
import { bajarMedia, subirSoporte } from './wa-media.ts';
import { sendButtons, sendDocument, sendTextoConId } from './wa-respond.ts';
import { transcribeAudio } from './wa-transcribe.ts';

/** Espera tras el último mensaje antes de procesar: la asesora manda texto y pantallazos en ráfaga. */
export const SILENCIO_MS = 20_000;

export interface PilotoEntrega { activo: boolean; telefonos: string[] }

/** ¿La entrega única está prendida para este teléfono? Pura. */
export function pilotoActivo(cfg: unknown, telefono: string): boolean {
  const c = (cfg ?? null) as { activo?: unknown; telefonos?: unknown } | null;
  if (!c || c.activo !== true) return false;
  const tels = Array.isArray(c.telefonos) ? c.telefonos.map(t => String(t).replace(/\D/g, '')).filter(Boolean) : [];
  return tels.length === 0 || tels.includes(String(telefono).replace(/\D/g, ''));
}

type Fila = Record<string, unknown>;
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

async function abiertas(supabase: SupabaseClient, ws: string, telefono: string): Promise<EntregaAbierta[]> {
  const { data } = await supabase.from('entregas_bloqueo').select('id, codigo, estado, salida, updated_at')
    .eq('workspace_id', ws).eq('telefono', telefono).not('estado', 'in', '(listo,a_medida,error,descartada)')
    .order('created_at', { ascending: true }).limit(10);
  const filas = (data ?? []) as Fila[];
  if (!filas.length) return [];
  const { data: pz } = await supabase.from('entregas_bloqueo_piezas').select('entrega_id, wamid, direccion, tipo, texto, created_at')
    .in('entrega_id', filas.map(f => f.id as string));
  const piezas = (pz ?? []) as Fila[];
  return filas.map(f => {
    const suyas = piezas.filter(p => p.entrega_id === f.id);
    return {
      id: f.id as string, codigo: (f.codigo as string | null) ?? null,
      cliente: ((f.salida as { requisitos?: { cliente?: string } } | null)?.requisitos?.cliente)
        ?? suyas.filter(p => p.direccion === 'entrante' && p.tipo === 'texto').map(p => clienteDelTexto(p.texto as string | null)).find(Boolean) ?? null,
      estado: f.estado as EntregaAbierta['estado'],
      wamids: suyas.map(p => p.wamid as string | null).filter((x): x is string => !!x),
      tieneEncabezado: suyas.some(p => p.direccion === 'entrante' && p.tipo === 'texto' && tieneSenalDeBloqueo(p.texto as string | null)),
      ultimaEn: suyas.map(p => p.created_at as string).sort().at(-1) ?? (f.updated_at as string),
    };
  });
}

async function nuevaEntrega(supabase: SupabaseClient, user: WaUser, telefono: string, tentativa: boolean): Promise<string> {
  const { data, error } = await supabase.from('entregas_bloqueo').insert({
    workspace_id: user.workspace_id, staff_id: user.staff_id ?? null, telefono, tentativa,
    tiempos: { primerMensaje: new Date().toISOString() },
  }).select('id').single();
  if (error || !data) throw new Error(`no se pudo abrir la entrega: ${error?.message ?? 'sin fila'}`);
  return data.id as string;
}

async function guardarPieza(supabase: SupabaseClient, p: Fila): Promise<string> {
  const { data, error } = await supabase.from('entregas_bloqueo_piezas').insert(p).select('id').single();
  if (error || !data) throw new Error(`no se pudo guardar la pieza: ${error?.message ?? 'sin fila'}`);
  return data.id as string;
}

/** Le pide a la app que procese y le manda a la asesora lo que devuelva. Registra los wamid salientes en el hilo. */
async function pedirALaApp(supabase: SupabaseClient, user: WaUser, telefono: string, cuerpo: Record<string, unknown>): Promise<void> {
  const { data: ws } = await supabase.from('workspaces').select('slug').eq('id', user.workspace_id).single();
  const base = (Deno.env.get('APP_BASE_DOMAIN') || 'metrikone.co').trim();
  const texto = JSON.stringify(cuerpo);
  const firma = await firmarCuerpo(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', texto);
  let salidas: Array<Fila> = [];
  try {
    const res = await fetch(`https://${ws?.slug}.${base}/api/interno/entrega-bloqueo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-firma-entrega': firma }, body: texto,
      signal: AbortSignal.timeout(290_000),
    });
    if (!res.ok) throw new Error(`la app respondió ${res.status}`);
    salidas = ((await res.json()).salidas ?? []) as Fila[];
  } catch (e) {
    console.error('[entrega-bloqueo] la app no procesó el pedido:', String(e).slice(0, 300));
    salidas = [{ tipo: 'texto', texto: 'No pude procesar el pedido: algo falló de mi lado. Ya quedó anotado; vuelve a intentarlo en unos minutos.' }];
  }
  const entregaId = cuerpo.entregaId as string;
  for (const s of salidas) {
    let wamid: string | null = null;
    if (s.tipo === 'documento') wamid = await sendDocument(telefono, s.url as string, s.nombre as string, s.caption as string, { origen: 'bot', intent: 'entrega_bloqueo', workspaceId: user.workspace_id });
    else if (s.tipo === 'botones') wamid = await enviarBotones(telefono, s.texto as string, s.botones as { id: string; titulo: string }[]);
    else wamid = await sendTextoConId(telefono, s.texto as string, { origen: 'bot', intent: 'entrega_bloqueo', workspaceId: user.workspace_id });
    await guardarPieza(supabase, {
      workspace_id: user.workspace_id, entrega_id: entregaId, telefono, direccion: 'saliente', wamid,
      tipo: s.tipo === 'documento' ? 'documento' : 'texto', texto: (s.tipo === 'documento' ? s.caption : s.texto) as string,
    }).catch(e => console.error('[entrega-bloqueo] sin la pieza saliente:', String(e)));
  }
}

async function enviarBotones(telefono: string, texto: string, botones: { id: string; titulo: string }[]): Promise<string | null> {
  // Reply buttons de Meta: máximo 3, título ≤ 20 (interactive-reply-buttons-messages, leída el 2026-11-04).
  return await sendButtons(telefono, texto, botones.slice(0, 3).map(b => ({ id: b.id, title: [...b.titulo].slice(0, 20).join('') })));
}

/** Tras el silencio: si esta pieza sigue siendo la última de su pedido, lo procesa. */
async function procesarTrasSilencio(supabase: SupabaseClient, user: WaUser, telefono: string, entregaId: string, piezaId: string): Promise<boolean> {
  await espera(SILENCIO_MS);
  const { data: ult } = await supabase.from('entregas_bloqueo_piezas').select('id').eq('entrega_id', entregaId).eq('direccion', 'entrante')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const { data: ent } = await supabase.from('entregas_bloqueo').select('estado, tentativa').eq('id', entregaId).single();
  const { data: pz } = await supabase.from('entregas_bloqueo_piezas').select('tipo, texto').eq('entrega_id', entregaId).eq('direccion', 'entrante');
  const piezas = (pz ?? []) as Fila[];
  const conSenal = piezas.some(p => p.tipo === 'imagen') || piezas.some(p => tieneSenalDeBloqueo(p.texto as string | null));
  if (!conSenal) {
    // Un texto sin señal y sin pantallazos: no era un pedido de bloqueo. Se suelta para el flujo de siempre.
    if (ent?.tentativa) {
      await supabase.from('entregas_bloqueo_piezas').delete().eq('id', piezaId);
      if (piezas.length <= 1) await supabase.from('entregas_bloqueo').update({ estado: 'descartada' }).eq('id', entregaId);
    }
    return false;
  }
  if (ent?.tentativa) await supabase.from('entregas_bloqueo').update({ tentativa: false }).eq('id', entregaId);
  if (ult?.id !== piezaId) return true; // llegó otra después: esa procesa
  if (!['recibiendo', 'tipo_por_confirmar', 'por_confirmar'].includes(ent?.estado as string)) return true;
  if (ent?.estado === 'por_confirmar') await supabase.from('entregas_bloqueo').update({ estado: 'recibiendo' }).eq('id', entregaId).eq('estado', 'por_confirmar');
  await pedirALaApp(supabase, user, telefono, { accion: 'pedido', entregaId });
  return true;
}

/**
 * Atiende el mensaje si es de la entrega única. `true` = atendido (el resto del webhook no lo ve); `false` = sigue el
 * flujo de siempre. Corre en segundo plano (el webhook ya le respondió a Meta): puede esperar el silencio.
 */
export async function atenderEntregaBloqueo(supabase: SupabaseClient, user: WaUser, message: IncomingMessage): Promise<boolean> {
  if (!pilotoActivo(user.modulos?.entrega_bloqueo, message.phone)) return false;
  const tipo: MensajeEntrante['tipo'] | null = message.type === 'text' || message.type === 'audio' ? 'texto'
    : message.type === 'image' ? 'imagen'
    : message.type === 'interactive' && message.interactive_reply?.startsWith('eb|') ? 'boton' : null;
  if (!tipo) return false;

  try {
    let texto = message.text || null;
    if (message.type === 'audio' && message.audio_id) {
      const t = await transcribeAudio(message.audio_id);
      texto = t.text || null;
      if (!texto) return false;
    }
    const lista = await abiertas(supabase, user.workspace_id, message.phone);
    const piezaId = crypto.randomUUID();
    const d = decidirAncla({ tipo, texto, contextoWamid: message.contexto_wamid ?? null, botonId: message.interactive_reply ?? null }, lista, piezaId, new Date());
    if (d.accion === 'otro') return false;

    const base = {
      id: piezaId, workspace_id: user.workspace_id, telefono: message.phone, direccion: 'entrante', wamid: message.wa_message_id ?? null,
      contexto_wamid: message.contexto_wamid ?? null, tipo: tipo === 'boton' ? 'boton' : tipo, texto,
    };
    const conMedia = async (entregaId: string | null) => {
      if (tipo !== 'imagen' || !message.image_id) return {};
      const m = await bajarMedia(message.image_id);
      if (!m) throw new Error('no se pudo bajar el pantallazo de Meta');
      const ref = await subirSoporte(supabase, user.workspace_id, `entregas-bloqueo/${entregaId ?? 'sueltos'}/${piezaId}`, m);
      if (!ref) throw new Error('no se pudo guardar el pantallazo');
      return { media_ref: ref, mime: m.mimeType };
    };

    switch (d.accion) {
      case 'nueva': {
        const id = await nuevaEntrega(supabase, user, message.phone, d.tentativo);
        await guardarPieza(supabase, { ...base, entrega_id: id, ...(await conMedia(id)) });
        return await procesarTrasSilencio(supabase, user, message.phone, id, piezaId);
      }
      case 'agregar': {
        await guardarPieza(supabase, { ...base, entrega_id: d.entregaId, ...(await conMedia(d.entregaId)) });
        return await procesarTrasSilencio(supabase, user, message.phone, d.entregaId, piezaId);
      }
      case 'responder': {
        await guardarPieza(supabase, { ...base, entrega_id: d.entregaId });
        await pedirALaApp(supabase, user, message.phone, { accion: 'respuesta', entregaId: d.entregaId, texto: texto ?? '' });
        return true;
      }
      case 'tipo': {
        await pedirALaApp(supabase, user, message.phone, { accion: 'tipo', entregaId: d.entregaId, tipo: d.tipo });
        return true;
      }
      case 'asignar': {
        let destino = d.entregaId;
        if (destino === 'nuevo') destino = await nuevaEntrega(supabase, user, message.phone, false);
        await supabase.from('entregas_bloqueo_piezas').update({ entrega_id: destino }).eq('id', d.piezaId).is('entrega_id', null);
        return await procesarTrasSilencio(supabase, user, message.phone, destino, d.piezaId);
      }
      case 'preguntar': {
        // Queda sin pedido hasta que ella elija; nunca se adivina.
        await guardarPieza(supabase, { ...base, entrega_id: null, ...(await conMedia(null)) });
        await enviarBotones(message.phone, d.motivo, d.opciones);
        return true;
      }
    }
  } catch (e) {
    console.error('[entrega-bloqueo] falló:', String(e).slice(0, 300));
    await sendTextoConId(message.phone, 'No pude guardar ese mensaje del pedido. Mándamelo otra vez, por favor.').catch(() => null);
    return true;
  }
  return false;
}
