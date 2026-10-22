// ============================================================
// El núcleo conversacional en el webhook: la bandeja de solicitudes (Trappvel) y, desde el 2026-10-21, el dominio ONE
// en todo workspace (`atenderConAgenteOne`, más abajo)
// ------------------------------------------------------------
// Diseño: proyectos/trappvel/clarity/docs/diseno/2026-10-06_investigacion-agentes-conversacionales.md, §3.
// Interruptor: `config_extra.bot_conversacional.agente === true` (llega en la misma lectura que identifica al
// remitente). Apagado, `atenderConAgente` devuelve false sin una sola consulta y todo sigue como en `main`.
// Prendido, atiende todo lo del equipo en ese workspace salvo «gasto …» (el bot de gastos) y los botones que no son
// suyos (términos, aviso de datos, resúmenes de la bandeja de antes). El mensaje ya está en `wa_conversacion`: lo
// escribió `registrarEntrante` justo antes.
// ============================================================

import { agenteOnePorDefecto, dominioDelAgente, leerConfigAgente, leerConfigOne } from './agente/config.ts';
import { atenderPendientes } from './agente/cola.ts';
import { BOT_BANDEJA, dominioBandeja } from './agente/bandeja/dominio.ts';
import { modeloGemini } from './agente/modelo-gemini.ts';
import { entornoPorDefecto, haikuActivo } from './llm-anthropic.ts';
import { BOT_ONE, dominioOne } from './agente/one/dominio.ts';
import { puertoOneSupabase } from './agente/one/puerto-supabase.ts';
import { lectorDeSoportes } from './agente/one/lectura-adjunto.ts';
import { lectorDeDocumentosDeViaje } from './agente/bandeja/lectura-adjunto.ts';
import { reglamentoOne } from './agente/one/reglamento.ts';
import { logMessage } from './wa-rate-limit.ts';
import { almacenSupabase, cargarReglamento, cupoSupabase, mensajeroWa, puertoBandejaSupabase } from './agente/produccion.ts';
import { leerToque } from './agente/render.ts';
import { revisarCupo } from './agente/uso.ts';
import { completarTexto } from './wa-conversacion.ts';
import { staffIdDelRemitente } from './wa-bandeja.ts';
import { transcribeAudio, PROMPT_TRANSCRIPCION_LITERAL } from './wa-transcribe.ts';
import type { IncomingMessage, SupabaseClient, WaUser } from './types.ts';

/** Lo que el agente NO toma aunque esté prendido. Pura. */
export function fueraDelAgente(message: Pick<IncomingMessage, 'type' | 'text' | 'interactive_reply' | 'reenviado'>): boolean {
  if (message.type === 'interactive' || message.type === 'button') return !leerToque(message.interactive_reply);
  if (message.type === 'text' && message.reenviado !== true && /^\s*gasto\b/i.test(message.text ?? '')) return true;
  return message.type === 'flow_response';
}

export async function atenderConAgente(supabase: SupabaseClient, user: WaUser, message: IncomingMessage): Promise<boolean> {
  const bot = user.modulos?.bot_conversacional;
  if (dominioDelAgente(bot, message.phone) !== 'bandeja') return false;
  if (fueraDelAgente(message)) return false;
  const config = leerConfigAgente(bot);
  const reglamento = await cargarReglamento(supabase, user.workspace_id, BOT_BANDEJA, config.reglamentoId);
  if (!reglamento) {
    console.warn(`[agente] ${user.workspace_id} tiene el agente prendido sin reglamento publicado: sigue el bot de siempre`);
    return false;
  }
  const llave = Deno.env.get('GEMINI_API_KEY') ?? '';
  // Con Haiku de principal, la llave de Gemini solo hace falta para el respaldo (sin ella corre sin respaldo, con aviso
  // en el log). Sin Haiku ni Gemini no hay modelo: sigue el bot de siempre.
  if (!llave && !haikuActivo()) {
    console.error('[agente] sin GEMINI_API_KEY ni Haiku activo: sigue el bot de siempre');
    return false;
  }

  // Un audio se transcribe antes del turno (el del equipo es un escrito dictado; el reenviado, dato del cliente).
  if (message.type === 'audio' && message.audio_id) {
    const r = await transcribeAudio(message.audio_id, { prompt: PROMPT_TRANSCRIPCION_LITERAL, maxOutputTokens: 8192, exigirFinCompleto: true });
    if (r.text) await completarTexto(supabase, message.wa_message_id, r.text);
  }

  const almacen = almacenSupabase(supabase);
  const staffId = user.collaborator_id ? null : await staffIdDelRemitente(supabase, user);
  await atenderPendientes({
    modelo: modeloGemini({ llave, principal: config.principal, respaldo: config.respaldo, corteMs: config.corteMs }),
    // Las fotos y los PDF (2026-10-21): se guardan al llegar, se leen (Haiku; respaldo Gemini) y lo leído entra a la carga
    // del viaje; con el toque quedan de soporte en la actividad del viaje. `agente_config.leer_adjuntos: false` lo apaga.
    dominio: dominioBandeja(
      puertoBandejaSupabase(supabase, user.workspace_id, staffId, { extraccionCompacta: config.extraccionCompacta, adjuntos: config.leerAdjuntos }),
      { lector: config.leerAdjuntos ? lectorDeDocumentosDeViaje({ llaveGemini: llave }) : null },
    ),
    reglamento,
    config,
    ahoraMs: () => Date.now(),
    reloj: () => performance.now(),
    almacen,
    mensajero: mensajeroWa(),
    workspaceId: user.workspace_id,
    phone: message.phone.replace(/\D/g, ''),
    remitente: { nombre: user.name || 'el comercial', rol: user.collaborator_id ? 'colaborador' : user.role },
    nuevoId: () => crypto.randomUUID(),
    despuesDelTurno: async () => {
      const { data: ws } = await supabase.from('workspaces').select('slug').eq('id', user.workspace_id).maybeSingle();
      await revisarCupo(cupoSupabase(supabase, almacen), {
        workspaceId: user.workspace_id, workspaceNombre: String(ws?.slug ?? user.workspace_id), cupo: config.cupoTurnosMes, ahoraMs: Date.now(),
      });
    },
  });
  return true;
}


// ── El modo agente de ONE (todo workspace, 2026-10-21) ───────────────────────
//
// Mauricio, 2026-10-20: «necesito el modo agente en todo ONE, también para termotech». Por defecto encendido en todo
// workspace que no tenga la bandeja (`dominioDelAgente`): gastos con su soporte, actividades, contactos y consultas, con
// Claude Haiku 5.5 de principal (por `fetchModelo`) y Gemini de respaldo. Interruptores: `bot_conversacional.agente =
// false` apaga un workspace; el secreto `AGENTE_ONE=off` apaga el por defecto en todos sin tocar la base.
// El camino de siempre (wa-parse + máquina de estados) queda de respaldo: si el núcleo no puede correr (sin modelo, o
// falla antes de atender), esta función devuelve false y el webhook sigue como antes.
// Va DESPUÉS de las puertas del módulo, la suscripción y el tope de mensajes (las mismas del bot de siempre).

/** Lo que el modo agente de ONE NO toma: botones que no son suyos (los del flujo de siempre, términos, aviso) y Flows. Pura. */
export function fueraDelAgenteOne(message: Pick<IncomingMessage, 'type' | 'interactive_reply'>): boolean {
  if (message.type === 'interactive' || message.type === 'button') return !leerToque(message.interactive_reply);
  return message.type === 'flow_response';
}

export async function atenderConAgenteOne(supabase: SupabaseClient, user: WaUser, message: IncomingMessage): Promise<boolean> {
  const bot = user.modulos?.bot_conversacional;
  if (dominioDelAgente(bot, message.phone, { porDefecto: agenteOnePorDefecto(entornoPorDefecto('AGENTE_ONE')) }) !== 'one') return false;
  if (fueraDelAgenteOne(message)) {
    await soltarDelAgente(supabase, message);
    return false;
  }
  const llave = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!llave && !haikuActivo()) {
    console.error('[agente-one] sin GEMINI_API_KEY ni Haiku activo: sigue el bot de siempre');
    await soltarDelAgente(supabase, message);
    return false;
  }
  const config = leerConfigOne(bot);
  const phone = message.phone.replace(/\D/g, '');
  try {
    const { data: ws } = await supabase.from('workspaces').select('name, slug').eq('id', user.workspace_id).maybeSingle();
    // Un reglamento propio publicado (`bot_reglamentos`, bot 'one') reemplaza al del código.
    const reglamento = (await cargarReglamento(supabase, user.workspace_id, BOT_ONE, config.reglamentoId))
      ?? await reglamentoOne(String(ws?.name ?? 'la empresa'));

    // Un audio se transcribe antes del turno (lo que dice es un escrito dictado).
    if (message.type === 'audio' && message.audio_id) {
      const r = await transcribeAudio(message.audio_id, { prompt: PROMPT_TRANSCRIPCION_LITERAL, maxOutputTokens: 8192, exigirFinCompleto: true });
      if (r.text) await completarTexto(supabase, message.wa_message_id, r.text);
    }
    // La misma telemetría del bot de siempre (y el tope de mensajes por hora la cuenta).
    await logMessage(supabase, message.phone, 'inbound', user.workspace_id, 'agente.one', message.text || `[${message.type}]`).catch(() => {});

    const almacen = almacenSupabase(supabase);
    await atenderPendientes({
      modelo: modeloGemini({ llave, principal: config.principal, respaldo: config.respaldo, corteMs: config.corteMs }),
      // Las fotos y los PDF que llegan se guardan como soporte al llegar y se leen con el modelo (Haiku; respaldo Gemini).
      dominio: dominioOne(puertoOneSupabase(supabase, user), { rol: user.role, lector: lectorDeSoportes({ llaveGemini: llave }) }),
      reglamento,
      config,
      ahoraMs: () => Date.now(),
      reloj: () => performance.now(),
      almacen,
      mensajero: mensajeroWa(),
      workspaceId: user.workspace_id,
      phone,
      remitente: { nombre: user.name || 'quien escribe', rol: user.collaborator_id ? 'colaborador' : user.role },
      nuevoId: () => crypto.randomUUID(),
      despuesDelTurno: async () => {
        await revisarCupo(cupoSupabase(supabase, almacen), {
          workspaceId: user.workspace_id, workspaceNombre: String(ws?.slug ?? user.workspace_id), cupo: config.cupoTurnosMes, ahoraMs: Date.now(),
        });
      },
    });
    return true;
  } catch (err) {
    // El núcleo no pudo atender (la conversación no se leyó, el candado falló…): el bot de siempre toma el mensaje.
    console.error('[agente-one] el núcleo falló, sigue el bot de siempre:', err);
    await soltarDelAgente(supabase, message);
    return false;
  }
}

/**
 * El mensaje lo atiende el bot de siempre: su fila de `wa_conversacion` queda marcada como atendida (con un `turno_id`
 * propio) para que el próximo turno del agente no la tome como pendiente y la conteste otra vez. Nunca lanza.
 */
async function soltarDelAgente(supabase: SupabaseClient, message: IncomingMessage): Promise<void> {
  if (!message.wa_message_id) return;
  try {
    const { error } = await supabase.from('wa_conversacion').update({ turno_id: crypto.randomUUID() })
      .eq('wa_message_id', message.wa_message_id).is('turno_id', null);
    if (error) console.error('[agente-one] no se pudo soltar el mensaje:', error.message);
  } catch (err) {
    console.error('[agente-one] no se pudo soltar el mensaje:', err);
  }
}
