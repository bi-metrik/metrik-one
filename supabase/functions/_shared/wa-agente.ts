// ============================================================
// El núcleo conversacional en el webhook (bandeja de solicitudes, Trappvel primero)
// ------------------------------------------------------------
// Diseño: proyectos/trappvel/clarity/docs/diseno/2026-10-06_investigacion-agentes-conversacionales.md, §3.
// Interruptor: `config_extra.bot_conversacional.agente === true` (llega en la misma lectura que identifica al
// remitente). Apagado, `atenderConAgente` devuelve false sin una sola consulta y todo sigue como en `main`.
// Prendido, atiende todo lo del equipo en ese workspace salvo «gasto …» (el bot de gastos) y los botones que no son
// suyos (términos, aviso de datos, resúmenes de la bandeja de antes). El mensaje ya está en `wa_conversacion`: lo
// escribió `registrarEntrante` justo antes.
// ============================================================

import { agenteActivo, leerConfigAgente } from './agente/config.ts';
import { atenderPendientes } from './agente/cola.ts';
import { BOT_BANDEJA, dominioBandeja } from './agente/bandeja/dominio.ts';
import { modeloGemini } from './agente/modelo-gemini.ts';
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
  if (!agenteActivo(bot, message.phone)) return false;
  if (fueraDelAgente(message)) return false;
  const config = leerConfigAgente(bot);
  const reglamento = await cargarReglamento(supabase, user.workspace_id, BOT_BANDEJA, config.reglamentoId);
  if (!reglamento) {
    console.warn(`[agente] ${user.workspace_id} tiene el agente prendido sin reglamento publicado: sigue el bot de siempre`);
    return false;
  }
  const llave = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!llave) {
    console.error('[agente] sin GEMINI_API_KEY: sigue el bot de siempre');
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
    dominio: dominioBandeja(puertoBandejaSupabase(supabase, user.workspace_id, staffId)),
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

