// ============================================================
// chatwoot-agente — el webhook del Agent Bot de Chatwoot (asistente público; Sabor & Experiencias, etapa 1)
// ------------------------------------------------------------
// Diseño: proyectos/sabor-experiencias/clarity/docs/entrada/diseno-asistente-etapa1.md (§2, §3).
// URL: …/functions/v1/chatwoot-agente?ws=<slug>   (una URL por workspace en el Agent Bot de Chatwoot)
//
// La petición hace solo esto y responde (`_shared/agente/publico/entrada.ts`): firma y antigüedad, filtros,
// deduplicación por id de mensaje y guardar el mensaje. Responde 200 ANTES de cualquier trabajo; el resto (ráfaga,
// transcripción, modelo, publicar) corre en `EdgeRuntime.waitUntil` con candado por conversación
// (`_shared/agente/publico/cola.ts`).
//
// Secretos (Supabase, por workspace; no se crean desde este PR):
//   CHATWOOT_WEBHOOK_SECRET_<SLUG>   el secreto que genera Chatwoot al crear el Agent Bot.
//   CHATWOOT_API_TOKEN_<SLUG>        el token del Agent Bot (o de un usuario de servicio, D7).
//   ANTHROPIC_API_KEY                Claude Haiku 5.5 (sin respaldo de Gemini, D1).
//   <audio.llave_env>                Gemini del plan PAGO para las notas de voz (por defecto GEMINI_API_KEY_PAGO).
//   RESEND_API_KEY                   correo a MéTRIK: caída del modelo y presupuesto del día (spec 2026-10-26, §4.1).
// Interruptores: `config_extra.bot_conversacional.chatwoot.activo` (sin él, 200 y nada) y la ficha `bot.encendido`
// del reglamento publicado (bot `asistente-publico`). Quitar el Agent Bot del inbox en Chatwoot también lo apaga.
// ============================================================

import { getServiceClient } from '../_shared/supabase-client.ts';
import { modeloAnthropic } from '../_shared/agente/modelo-anthropic.ts';
import { modeloGemini } from '../_shared/agente/modelo-gemini.ts';
import { cargarReglamento } from '../_shared/agente/produccion.ts';
import { atenderConversacion } from '../_shared/agente/publico/cola.ts';
import { variableSecreta } from '../_shared/agente/publico/config.ts';
import { BOT_PUBLICO } from '../_shared/agente/publico/dominio.ts';
import { recibir } from '../_shared/agente/publico/entrada.ts';
import type { Atender } from '../_shared/agente/publico/entrada.ts';
import {
  alertaCaidaChatwoot, almacenChatwootSupabase, avisosPorCorreo, mensajeroChatwootApi, preciosSupabase, puertosEntradaSupabase,
} from '../_shared/agente/publico/produccion.ts';
import { transcribirAudio } from '../_shared/agente/publico/transcribir.ts';
import { NOTA_SIN_ROL, turnoPublico } from '../_shared/agente/publico/turno-con-rol.ts';
import { resolverRol } from '../_shared/agente/roles.ts';
import { registrarEscalamiento } from '../_shared/agente/persona.ts';
import { escalamientosSupabase } from '../_shared/agente/persona-produccion.ts';
import type { Modelo } from '../_shared/agente/tipos.ts';
import type { SupabaseClient } from '../_shared/types.ts';

function enSegundoPlano(p: Promise<unknown>): void {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const seguro = p.catch((e) => console.error('[chatwoot-agente] trabajo en segundo plano falló:', e));
  if (rt?.waitUntil) rt.waitUntil(seguro);
}

const mismoHost = (a: string, b: string) => {
  try { return new URL(a).host === new URL(b).host; } catch { return false; }
};

function modeloDe(a: Atender): Modelo | null {
  const m = a.workspace.config.modelo;
  if (m.proveedor === 'anthropic') {
    const llave = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
    if (!llave) return null;
    return modeloAnthropic({ llave, modelo: m.modelo, esfuerzo: m.esfuerzo, pensamiento: m.pensamiento, maxSalida: m.maxSalida, estricto: m.estricto });
  }
  const llave = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!llave) return null;
  // Gemini directo (sin `fetchModelo`, que lo mandaría a Haiku) y sin respaldo.
  return modeloGemini({
    llave, principal: { modelo: m.modelo, razonamiento: 'LOW', temperatura: null, maxSalida: m.maxSalida }, respaldo: null, corteMs: a.workspace.config.corte1Ms,
    fetch: (u, i) => globalThis.fetch(u, i), haiku: false,
  });
}

async function atender(supabase: SupabaseClient, a: Atender): Promise<void> {
  const c = a.workspace.config;
  const token = Deno.env.get(variableSecreta('CHATWOOT_API_TOKEN', a.workspace.slug)) ?? '';
  if (!token) {
    console.error(`[chatwoot-agente] falta ${variableSecreta('CHATWOOT_API_TOKEN', a.workspace.slug)}: no contesta`);
    return;
  }
  // Con roles (spec 2026-10-26): el rol asignado al inbox ('cw:<cuenta>:<inbox>'). Sin roles en este canal, o sin la
  // migración, el reglamento de siempre y el dominio público entero.
  const turno = await turnoPublico({
    resolver: () => resolverRol(supabase, {
      workspaceId: a.workspace.id, canal: 'chatwoot', inbox: a.inboxId === null ? null : `cw:${a.llave.cuentaId}:${a.inboxId}`,
    }),
    reglamentoDelRol: (clave, id) => cargarReglamento(supabase, a.workspace.id, `rol:${clave}`, id),
    reglamentoDeHoy: () => cargarReglamento(supabase, a.workspace.id, BOT_PUBLICO, c.reglamentoId),
  });
  if (turno.tipo === 'nada') {
    console.warn(`[chatwoot-agente] ${a.workspace.slug} sin reglamento publicado de ${BOT_PUBLICO}: no contesta`);
    return;
  }
  if (turno.tipo === 'persona') {
    // El inbox usa roles y no tiene uno activo: el respaldo de Sabor es una persona en Chatwoot (decisión del 26-oct).
    console.warn(`[chatwoot-agente] ${a.workspace.slug}: sin rol activo para el inbox (${turno.motivo}), pasa a una persona`);
    const m = mensajeroChatwootApi({ apiUrl: c.apiUrl, token });
    await m.nota(a.llave, NOTA_SIN_ROL);
    await m.abrir(a.llave);
    // Cada traspaso deja su fila (spec 2026-10-26, §4.2), a mejor esfuerzo.
    await registrarEscalamiento(escalamientosSupabase(supabase), {
      workspace_id: a.workspace.id, rol_clave: 'sin_rol', canal: 'chatwoot', conversacion: `cw:${a.llave.cuentaId}:${a.llave.conversacionId}`,
      motivo: turno.motivo, resumen: 'el inbox no tiene un rol activo (o no se pudo leer)', modo: 'pasado',
    });
    return;
  }
  const reglamento = turno.reglamento;
  const modelo = modeloDe(a);
  if (!modelo) {
    console.error(`[chatwoot-agente] sin llave del modelo (${c.modelo.proveedor}): no contesta (sin respaldo, D1)`);
    return;
  }
  const llaveAudio = Deno.env.get(c.audio.llaveEnv) ?? '';
  const llaveResend = Deno.env.get('RESEND_API_KEY') ?? '';
  await atenderConversacion({
    modelo, reglamento, config: c,
    ...(turno.funciones ? { funciones: turno.funciones, rol: turno.rol } : {}),
    almacen: almacenChatwootSupabase(supabase),
    mensajero: mensajeroChatwootApi({ apiUrl: c.apiUrl, token }),
    transcriptor: {
      transcribir: (x) => transcribirAudio(x, {
        llave: llaveAudio, modelo: c.audio.modelo, maxBytes: c.audio.maxBytes,
        ...(mismoHost(x.url, c.apiUrl) ? { cabecerasDescarga: { api_access_token: token } } : {}),
      }),
    },
    // A MéTRIK por correo (spec 2026-10-26, §4.1): el presupuesto del día y, si se cae el modelo, el aviso inmediato. La
    // conversación igual pasa a una persona en Chatwoot (el respaldo de Sabor, decisión del 26-oct).
    avisos: avisosPorCorreo({ workspaceNombre: a.workspace.slug, llaveResend }),
    alertaCaida: alertaCaidaChatwoot(supabase, almacenChatwootSupabase(supabase), { llave: a.llave, workspaceNombre: a.workspace.slug, llaveResend }),
    llave: a.llave, canal: a.canal, anuncio7Dias: a.anuncio7Dias, workspaceNombre: a.workspace.slug,
    precios: await preciosSupabase(supabase),
    ahoraMs: () => Date.now(),
    reloj: () => performance.now(),
    nuevoId: () => crypto.randomUUID(),
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
    // Cada paso a persona deja su fila en `asistente_escalamientos` (spec 2026-10-26, §4.2), a mejor esfuerzo.
    escalamientos: escalamientosSupabase(supabase),
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('método no permitido', { status: 405 });
  const url = new URL(req.url);
  const cuerpo = await req.text();
  const supabase = getServiceClient();
  const puertos = puertosEntradaSupabase(supabase, (slug) => Deno.env.get(variableSecreta('CHATWOOT_WEBHOOK_SECRET', slug)));
  let r;
  try {
    r = await recibir({ slug: url.searchParams.get('ws'), cuerpo, firma: req.headers.get('x-chatwoot-signature'), timestamp: req.headers.get('x-chatwoot-timestamp') }, puertos);
  } catch (e) {
    // La base no respondió: 500 para que Chatwoot reintente (la deduplicación absorbe el reintento).
    console.error('[chatwoot-agente] falla al recibir:', e);
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
  if (r.status !== 200) console.warn(`[chatwoot-agente] ${r.status}: ${r.motivo}`);
  if (r.atender) enSegundoPlano(atender(supabase, r.atender));
  return new Response(JSON.stringify({ ok: r.status === 200, motivo: r.motivo }), { status: r.status, headers: { 'content-type': 'application/json' } });
});
