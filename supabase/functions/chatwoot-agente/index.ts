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
// Dominio de ventas (Dimpro, 29-oct): `config_extra.bot_conversacional.chatwoot.dominio = 'ventas'`. El webhook de Bold del
// workspace (Next) avisa un pago aprobado con `POST …?ws=<slug>&pago=<LNK_…>` y `Authorization: Bearer <service role>`.
// Con las sugerencias salen las fotos de los productos como adjuntos (multipart), bajadas solo del bucket
// `ferreteria-fotos` del host de SUPABASE_URL.
// Interruptores: `config_extra.bot_conversacional.chatwoot.activo` (sin él, 200 y nada) y la ficha `bot.encendido`
// del reglamento publicado (bot `asistente-publico`). Quitar el Agent Bot del inbox en Chatwoot también lo apaga.
// ============================================================

import { getServiceClient } from '../_shared/supabase-client.ts';
import { modeloAnthropic } from '../_shared/agente/modelo-anthropic.ts';
import { modeloGemini } from '../_shared/agente/modelo-gemini.ts';
import { cargarReglamento } from '../_shared/agente/produccion.ts';
import { atenderConversacion, avisarPagoAprobado } from '../_shared/agente/publico/cola.ts';
import { hostDe, ventasSupabase } from '../_shared/agente/publico/ventas/produccion-ventas.ts';
import { variableSecreta } from '../_shared/agente/publico/config.ts';
import { BOT_PUBLICO } from '../_shared/agente/publico/dominio.ts';
import { recibir } from '../_shared/agente/publico/entrada.ts';
import type { Atender } from '../_shared/agente/publico/entrada.ts';
import {
  alertaCaidaChatwoot, almacenChatwootSupabase, caidaChatwootSupabase, avisosPorCorreo, mensajeroChatwootApi, preciosSupabase, puertosEntradaSupabase,
} from '../_shared/agente/publico/produccion.ts';
import { transcribirAudio } from '../_shared/agente/publico/transcribir.ts';
import { MOTIVO_SIN_BANCO, NOTA_SIN_BANCO, NOTA_SIN_ROL, turnoPublico } from '../_shared/agente/publico/turno-con-rol.ts';
import { alertarSinBanco } from '../_shared/agente/caida.ts';
import { resolverRol } from '../_shared/agente/roles.ts';
import { registrarEscalamiento } from '../_shared/agente/persona.ts';
import { escalamientosSupabase } from '../_shared/agente/persona-produccion.ts';
import { pistasDeFunciones, pistasSiEncendidas } from '../_shared/agente/pistas.ts';
import type { FuentePistaDelTurno } from '../_shared/agente/pistas.ts';
import { leerBasePistas } from '../_shared/agente/pistas-supabase.ts';
import type { Modelo } from '../_shared/agente/tipos.ts';
import type { SupabaseClient } from '../_shared/types.ts';

/** El host de Supabase: de ahí (bucket `ferreteria-fotos`) y de ningún otro lado se bajan las fotos del catálogo. */
const HOST_FOTOS = hostDe(Deno.env.get('SUPABASE_URL'));

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
    // Con el banco: una versión que no pasó su banco del arnés no atiende en vivo (migración 20261030190000).
    reglamentoDelRol: (clave, id) => cargarReglamento(supabase, a.workspace.id, `rol:${clave}`, id, { conBanco: true }),
    reglamentoDeHoy: () => cargarReglamento(supabase, a.workspace.id, BOT_PUBLICO, c.reglamentoId, { conBanco: true }),
  });
  if (turno.tipo === 'nada') {
    console.warn(`[chatwoot-agente] ${a.workspace.slug} sin reglamento publicado de ${BOT_PUBLICO}: no contesta`);
    return;
  }
  if (turno.tipo === 'persona') {
    // El inbox usa roles y no tiene uno activo, o la versión vigente no pasó su banco: el respaldo de Sabor es una
    // persona en Chatwoot (decisión del 26-oct).
    const sinBanco = turno.motivo === MOTIVO_SIN_BANCO;
    console.warn(`[chatwoot-agente] ${a.workspace.slug}: ${sinBanco ? 'la versión vigente no pasó su banco' : 'sin rol activo para el inbox'} (${turno.motivo}), pasa a una persona`);
    const m = mensajeroChatwootApi({ apiUrl: c.apiUrl, token });
    await m.nota(a.llave, sinBanco ? NOTA_SIN_BANCO : NOTA_SIN_ROL);
    await m.abrir(a.llave);
    const conversacion = `cw:${a.llave.cuentaId}:${a.llave.conversacionId}`;
    // Cada traspaso deja su fila (spec 2026-10-26, §4.2), a mejor esfuerzo.
    await registrarEscalamiento(escalamientosSupabase(supabase), {
      workspace_id: a.workspace.id, rol_clave: sinBanco ? 'sin_banco' : 'sin_rol', canal: 'chatwoot', conversacion,
      motivo: turno.motivo, resumen: sinBanco ? 'la versión vigente no pasó su banco del arnés' : 'el inbox no tiene un rol activo (o no se pudo leer)', modo: 'pasado',
    });
    if (sinBanco) {
      await alertarSinBanco(caidaChatwootSupabase(supabase, almacenChatwootSupabase(supabase), a.workspace.id, Deno.env.get('RESEND_API_KEY') ?? ''), {
        workspaceId: a.workspace.id, workspaceNombre: a.workspace.slug, canal: 'chatwoot', conversacion, turnoId: null, ahoraMs: Date.now(),
      });
    }
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
  // Pistas para transcribir (spec 2026-10-26, §4.6), solo con `bot_conversacional.transcripcion.pistas = true` y una
  // vez por atención. Aquí habla un cliente: van el equipo y lo que aporten las funciones del rol del inbox por su
  // gancho `pistas` (la cola le pasa al transcriptor las funciones que compuso, `fuentesDePistas`), nunca los otros
  // clientes ni los negocios (`incluirClientes: false`).
  let pistas: Promise<string | null> | null = null;
  const pistasDeLaNota = (fuentes: FuentePistaDelTurno[] | undefined) => pistas ??= pistasSiEncendidas(
    c.transcripcion,
    async () => ({
      base: await leerBasePistas(supabase, a.workspace.id, { negocios: false }),
      extras: await pistasDeFunciones(fuentes ?? [], a.workspace.id),
    }),
    { incluirClientes: false },
  );
  await atenderConversacion({
    modelo, reglamento, config: c,
    ...(turno.funciones ? { funciones: turno.funciones, rol: turno.rol } : {}),
    almacen: almacenChatwootSupabase(supabase),
    mensajero: mensajeroChatwootApi({ apiUrl: c.apiUrl, token, hostFotos: c.dominio === 'ventas' ? HOST_FOTOS : null }),
    transcriptor: {
      transcribir: async (x) => transcribirAudio(x, {
        llave: llaveAudio, modelo: c.audio.modelo, maxBytes: c.audio.maxBytes, pistas: await pistasDeLaNota(x.fuentesDePistas),
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
    // Dominio de ventas (Dimpro): catálogo de Ferretería y Bold con las llaves de la bóveda del workspace.
    ...(c.dominio === 'ventas' ? { ventas: ventasSupabase(supabase, a.workspace.id, undefined, { hostFotos: HOST_FOTOS }) } : {}),
  });
}

/** Comparación en tiempo constante. */
function iguales(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * `POST ?ws=<slug>&pago=<LNK_…>` con `Authorization: Bearer <service role>`: el webhook de Bold del workspace (Next) avisa
 * que registró la venta de un link del asistente de ventas. Aquí: confirmarle al cliente en Chatwoot y pasar a persona
 * con `despachar`, una sola vez por link (`avisarPagoAprobado`). No escribe la venta (eso ya lo hizo el webhook).
 */
async function pagoAprobado(supabase: SupabaseClient, req: Request, slug: string, referencia: string): Promise<Response> {
  const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const llave = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!iguales(llave, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) return json(401, { ok: false, motivo: 'no_autorizado' });
  if (!/^LNK_[A-Za-z0-9]+$/.test(referencia)) return json(400, { ok: false, motivo: 'referencia_invalida' });
  const puertos = puertosEntradaSupabase(supabase, () => undefined);
  const w = await puertos.workspace(slug);
  if (!w || w.config.dominio !== 'ventas' || w.config.cuentaId === null) return json(404, { ok: false, motivo: 'sin_asistente_de_ventas' });
  const ventas = ventasSupabase(supabase, w.id);
  const link = await ventas.linkPorReferencia(referencia);
  if (!link) return json(404, { ok: false, motivo: 'link_no_es_del_asistente' });
  const token = Deno.env.get(variableSecreta('CHATWOOT_API_TOKEN', slug)) ?? '';
  if (!token) return json(503, { ok: false, motivo: 'sin_token_chatwoot' });
  const reglamento = await cargarReglamento(supabase, w.id, BOT_PUBLICO, w.config.reglamentoId);
  if (!reglamento) return json(503, { ok: false, motivo: 'sin_reglamento' });
  const c = w.config;
  const canal = link.canal === 'instagram' || link.canal === 'whatsapp' || link.canal === 'tiktok' ? link.canal : 'otro';
  const inbox = c.inboxes.find((i) => i.canal === canal);
  const r = await avisarPagoAprobado({
    modelo: { llamar: async () => ({ ok: false, motivo: 'sin modelo en el aviso de pago', usos: [] }) }, reglamento, config: c,
    almacen: almacenChatwootSupabase(supabase), mensajero: mensajeroChatwootApi({ apiUrl: c.apiUrl, token }),
    transcriptor: { transcribir: async () => ({ texto: null }) },
    llave: { workspaceId: w.id, cuentaId: link.cuentaId, conversacionId: link.conversacionId }, canal, anuncio7Dias: inbox?.anuncio7Dias ?? false,
    workspaceNombre: slug, precios: [], ahoraMs: () => Date.now(), reloj: () => performance.now(), nuevoId: () => crypto.randomUUID(),
    dormir: (ms) => new Promise((x) => setTimeout(x, ms)), escalamientos: escalamientosSupabase(supabase), ventas,
  }, referencia);
  // 502 si Chatwoot no aceptó: el webhook lo deja en su log (la venta ya está); «ya pagué» lo vuelve a intentar.
  return json(r === 'fallo' ? 502 : 200, { ok: r !== 'fallo', resultado: r });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('método no permitido', { status: 405 });
  const url = new URL(req.url);
  const supabase = getServiceClient();
  const pago = url.searchParams.get('pago');
  if (pago) {
    try {
      return await pagoAprobado(supabase, req, url.searchParams.get('ws') ?? '', pago);
    } catch (e) {
      console.error('[chatwoot-agente] aviso de pago falló:', e);
      return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }
  const cuerpo = await req.text();
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
