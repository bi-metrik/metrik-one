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
import { leeSoportes, turnoViajes } from './agente/bandeja/turno-con-rol.ts';
import type { TurnoViajes } from './agente/bandeja/turno-con-rol.ts';
import { lectorMixto } from './agente/bandeja/lectura-mixta.ts';
import { modeloGemini } from './agente/modelo-gemini.ts';
import { entornoPorDefecto, haikuActivo } from './llm-anthropic.ts';
import { BOT_ONE, dominioOne } from './agente/one/dominio.ts';
import { puertoOneSupabase } from './agente/one/puerto-supabase.ts';
import { lectorDeSoportes } from './agente/one/lectura-adjunto.ts';
import { lectorDeDocumentosDeViaje } from './agente/bandeja/lectura-adjunto.ts';
import { reglamentoOne } from './agente/one/reglamento.ts';
import { turnoOne } from './agente/one/turno-con-rol.ts';
import { escalamientosSupabase } from './agente/persona-produccion.ts';
import { resolverRol, rolPrevio } from './agente/roles.ts';
import type { RolTraza } from './agente/tipos.ts';
import { logMessage } from './wa-rate-limit.ts';
import { alertarCaidaWa, almacenSupabase, cargarReglamento, cupoSupabase, mensajeroWa, puertoBandejaSupabase } from './agente/produccion.ts';
import { leerToque } from './agente/render.ts';
import { revisarCupo } from './agente/uso.ts';
import { completarTexto } from './wa-conversacion.ts';
import { staffIdDelRemitente } from './wa-bandeja.ts';
import { transcribeAudio, PROMPT_TRANSCRIPCION_LITERAL } from './wa-transcribe.ts';
import { fuentesDeComposicion, leerConfigTranscripcion, pistasDeFunciones, pistasSiEncendidas } from './agente/pistas.ts';
import type { Composicion } from './agente/componer.ts';
import { leerBasePistas } from './agente/pistas-supabase.ts';
import type { IncomingMessage, SupabaseClient, WaUser } from './types.ts';

/**
 * Las pistas para transcribir la nota de voz (spec 2026-10-26, §4.6): solo con `bot_conversacional.transcripcion.pistas
 * = true`. Apagado devuelve `null` sin una consulta y la transcripción queda como siempre. Con la composición del turno
 * (el rol o el cargo de quien escribe), las funciones que quedaron aportan las suyas por su gancho `pistas`.
 */
function pistasDeLaNota(supabase: SupabaseClient, user: WaUser, composicion?: Composicion): Promise<string | null> {
  return pistasSiEncendidas(
    leerConfigTranscripcion(user.modulos?.bot_conversacional),
    async () => ({
      base: await leerBasePistas(supabase, user.workspace_id),
      extras: composicion ? await pistasDeFunciones(fuentesDeComposicion(composicion), user.workspace_id) : [],
    }),
  );
}

/** Lo que el agente NO toma aunque esté prendido. Pura. */
export function fueraDelAgente(message: Pick<IncomingMessage, 'type' | 'text' | 'interactive_reply' | 'reenviado'>): boolean {
  if (message.type === 'interactive' || message.type === 'button') return !leerToque(message.interactive_reply);
  if (message.type === 'text' && message.reenviado !== true && /^\s*gasto\b/i.test(message.text ?? '')) return true;
  return message.type === 'flow_response';
}

export async function atenderConAgente(supabase: SupabaseClient, user: WaUser, message: IncomingMessage): Promise<boolean> {
  const bot = user.modulos?.bot_conversacional;
  if (dominioDelAgente(bot, message.phone) !== 'bandeja') return false;
  // «gasto …» va al bot de gastos de siempre, salvo que el rol de quien escribe registre gastos con el agente (abajo).
  const gastoDeSiempre = esGastoDeSiempre(message);
  if (fueraDelAgente(message) && !gastoDeSiempre) return false;
  const config = leerConfigAgente(bot);
  const llave = Deno.env.get('GEMINI_API_KEY') ?? '';
  const phone = message.phone.replace(/\D/g, '');
  const staffId = user.collaborator_id ? null : await staffIdDelRemitente(supabase, user);
  const ws: { name?: unknown; slug?: unknown } = {};

  // Con roles (2026-10-29, Trappvel): qué rol atiende a quien escribe. Sin roles en la base, el camino de hoy, igual.
  const turnoRol = await turnoViajes({
    resolver: () => resolverRol(supabase, {
      workspaceId: user.workspace_id, canal: 'wa_one', staff: user.staff_id ?? null, colaborador: user.collaborator_id ?? null,
      cargo: user.role, inbox: inboxWaOne(),
    }),
    rolPrevio: () => rolPrevioWa(supabase, user.workspace_id, phone, config.topes.ventanaHoras),
    reglamentoDelRol: (clave, id) => cargarReglamento(supabase, user.workspace_id, `rol:${clave}`, id),
    motorViajes: (funciones) => motorViajesDe(supabase, user.workspace_id, staffId, config, llave, funciones),
    // Sin lector propio: los adjuntos los prepara el motor de viajes (uno solo baja y lee cada archivo).
    motorOne: (funciones, empresa) => dominioOne(puertoOneSupabase(supabase, user), { rol: user.role, lector: null, empresa, funciones }),
    empresa: async () => {
      Object.assign(ws, (await supabase.from('workspaces').select('name, slug').eq('id', user.workspace_id).maybeSingle()).data ?? {});
      return ws.name ? String(ws.name) : null;
    },
  });
  if (turnoRol.tipo !== 'hoy') {
    return await atenderConRolDeViajes(supabase, user, message, turnoRol, { config, llave, phone, gastoDeSiempre, workspaceNombre: String(ws.slug ?? user.workspace_id) });
  }
  if (gastoDeSiempre) return false;

  const reglamento = await cargarReglamento(supabase, user.workspace_id, BOT_BANDEJA, config.reglamentoId);
  if (!reglamento) {
    console.warn(`[agente] ${user.workspace_id} tiene el agente prendido sin reglamento publicado: sigue el bot de siempre`);
    return false;
  }
  // Con Haiku de principal, la llave de Gemini solo hace falta para el respaldo (sin ella corre sin respaldo, con aviso
  // en el log). Sin Haiku ni Gemini no hay modelo: sigue el bot de siempre.
  if (!llave && !haikuActivo()) {
    console.error('[agente] sin GEMINI_API_KEY ni Haiku activo: sigue el bot de siempre');
    return false;
  }

  // Un audio se transcribe antes del turno (el del equipo es un escrito dictado; el reenviado, dato del cliente).
  if (message.type === 'audio' && message.audio_id) {
    const pistas = await pistasDeLaNota(supabase, user);
    const r = await transcribeAudio(message.audio_id, { prompt: PROMPT_TRANSCRIPCION_LITERAL, maxOutputTokens: 8192, exigirFinCompleto: true, pistas });
    if (r.text) await completarTexto(supabase, message.wa_message_id, r.text);
  }

  const almacen = almacenSupabase(supabase);
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
    phone,
    remitente: { nombre: user.name || 'el comercial', rol: user.collaborator_id ? 'colaborador' : user.role },
    nuevoId: () => crypto.randomUUID(),
    despuesDelTurno: async (traza, turno) => {
      const { data: ws } = await supabase.from('workspaces').select('slug').eq('id', user.workspace_id).maybeSingle();
      const workspaceNombre = String(ws?.slug ?? user.workspace_id);
      // El correo si se cayeron los modelos (spec 2026-10-26, §4.1). Nunca lanza.
      await alertarCaidaWa(supabase, almacen, traza, { workspaceId: user.workspace_id, workspaceNombre, canal: 'bandeja', phone: message.phone, turnoId: turno.turnoId });
      await revisarCupo(cupoSupabase(supabase, almacen), {
        workspaceId: user.workspace_id, workspaceNombre, cupo: config.cupoTurnosMes, ahoraMs: Date.now(),
      });
    },
  });
  return true;
}

/** «gasto …» escrito (no reenviado): hoy va al bot de gastos de siempre. Pura. */
export function esGastoDeSiempre(message: Pick<IncomingMessage, 'type' | 'text' | 'reenviado'>): boolean {
  return message.type === 'text' && message.reenviado !== true && /^\s*gasto\b/i.test(message.text ?? '');
}

/**
 * El motor de viajes de un rol: la bandeja de hoy, con el lector de documentos del viaje; si el rol también registra
 * gastos o ingresos (la mano derecha), con el lector MIXTO (viaje + soporte de pago, `bandeja/lectura-mixta.ts`).
 */
function motorViajesDe(supabase: SupabaseClient, workspaceId: string, staffId: string | null, config: ReturnType<typeof leerConfigAgente>, llave: string, funciones: string[]) {
  const lector = !config.leerAdjuntos ? null
    : leeSoportes(funciones)
      ? lectorMixto(lectorDeDocumentosDeViaje({ llaveGemini: llave }), lectorDeSoportes({ llaveGemini: llave }))
      : lectorDeDocumentosDeViaje({ llaveGemini: llave });
  return dominioBandeja(
    puertoBandejaSupabase(supabase, workspaceId, staffId, { extraccionCompacta: config.extraccionCompacta, adjuntos: config.leerAdjuntos }),
    { lector },
  );
}

/**
 * El turno de la bandeja con el ROL de quien escribe (o la respuesta fija si usa roles y no tiene uno): el dominio
 * compuesto (viajes, más ONE si el rol lo trae, más el paso a una persona), el reglamento `rol:<clave>`, la traza `rol`
 * y la fila de `asistente_escalamientos`.
 */
async function atenderConRolDeViajes(
  supabase: SupabaseClient, user: WaUser, message: IncomingMessage, turno: Exclude<TurnoViajes, { tipo: 'hoy' }>,
  o: { config: ReturnType<typeof leerConfigAgente>; llave: string; phone: string; gastoDeSiempre: boolean; workspaceNombre: string },
): Promise<boolean> {
  const { config, llave, phone, workspaceNombre } = o;
  if (turno.tipo === 'parar') {
    // El workspace usa roles y quien escribe no tiene uno activo: lo fijo, sin modelo y sin el dominio completo.
    console.warn(`[agente] ${user.workspace_id}: sin rol activo (${turno.motivo}), respuesta fija`);
    await mensajeroWa().enviar(phone, { tipo: 'texto', texto: turno.texto }, { workspaceId: user.workspace_id, intent: 'agente.sin_rol' });
    await soltarDelAgente(supabase, message);
    return true;
  }
  // «gasto …» con un rol que no registra gastos: el bot de gastos de siempre, como hoy.
  if (o.gastoDeSiempre && !turno.composicion.declaradas.acciones.includes('gasto')) return false;
  if (!llave && !haikuActivo()) {
    console.error('[agente] sin GEMINI_API_KEY ni Haiku activo: sigue el bot de siempre');
    return false;
  }
  const empresa = turno.empresa;

  if (message.type === 'audio' && message.audio_id) {
    const pistas = await pistasDeLaNota(supabase, user, turno.composicion);
    const r = await transcribeAudio(message.audio_id, { prompt: PROMPT_TRANSCRIPCION_LITERAL, maxOutputTokens: 8192, exigirFinCompleto: true, pistas });
    if (r.text) await completarTexto(supabase, message.wa_message_id, r.text);
  }

  const almacen = almacenSupabase(supabase);
  await atenderPendientes({
    modelo: modeloGemini({ llave, principal: config.principal, respaldo: config.respaldo, corteMs: config.corteMs }),
    dominio: turno.dominio,
    reglamento: turno.reglamento,
    rol: turno.rol,
    persona: { config: turno.escalamiento, empresa, rolClave: turno.rol.clave, canal: 'wa_one', escalamientos: escalamientosSupabase(supabase) },
    // Dos motores (viajes + ONE): los bloques del prompt con más tope (el reglamento junto no cabe en el de uno).
    config: turno.bloques ? { ...config, topes: { ...config.topes, bloques: turno.bloques } } : config,
    ahoraMs: () => Date.now(),
    reloj: () => performance.now(),
    almacen,
    mensajero: mensajeroWa(),
    workspaceId: user.workspace_id,
    phone,
    remitente: { nombre: user.name || 'el comercial', rol: user.collaborator_id ? 'colaborador' : user.role },
    nuevoId: () => crypto.randomUUID(),
    despuesDelTurno: async (traza, t) => {
      await alertarCaidaWa(supabase, almacen, traza, { workspaceId: user.workspace_id, workspaceNombre, canal: 'bandeja', phone: message.phone, turnoId: t.turnoId });
      await revisarCupo(cupoSupabase(supabase, almacen), { workspaceId: user.workspace_id, workspaceNombre, cupo: config.cupoTurnosMes, ahoraMs: Date.now() });
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
    const empresa = ws?.name ? String(ws.name) : null;
    const puerto = puertoOneSupabase(supabase, user);
    const lector = lectorDeSoportes({ llaveGemini: llave });
    // Qué atiende este turno (spec 2026-10-26, asistentes-roles-y-funciones): con roles en la base, el rol de quien
    // escribe; sin roles (o sin la migración todavía), el dominio ONE recortado a su cargo. Una ida a la base.
    const turno = await turnoOne(user.role, {
      resolver: () => resolverRol(supabase, {
        workspaceId: user.workspace_id, canal: 'wa_one', staff: user.staff_id ?? null, colaborador: user.collaborator_id ?? null,
        cargo: user.role, inbox: inboxWaOne(),
      }),
      rolPrevio: () => rolPrevioWa(supabase, user.workspace_id, phone, config.topes.ventanaHoras),
      reglamentoDelRol: (clave, id) => cargarReglamento(supabase, user.workspace_id, `rol:${clave}`, id),
      // Un reglamento propio publicado (`bot_reglamentos`, bot 'one') reemplaza al del código.
      reglamentoDeHoy: async () => (await cargarReglamento(supabase, user.workspace_id, BOT_ONE, config.reglamentoId)) ?? await reglamentoOne(String(ws?.name ?? 'la empresa')),
      motor: (funciones) => dominioOne(puerto, { rol: user.role, lector, empresa, funciones }),
      empresa,
    });
    if (turno.tipo === 'parar') {
      // El workspace usa roles y quien escribe no tiene uno activo: lo fijo, sin modelo y sin el dominio completo.
      console.warn(`[agente-one] ${user.workspace_id}: sin rol activo (${turno.motivo}), respuesta fija`);
      await mensajeroWa().enviar(phone, { tipo: 'texto', texto: turno.texto }, { workspaceId: user.workspace_id, intent: 'agente.sin_rol' });
      await soltarDelAgente(supabase, message);
      return true;
    }

    // Un audio se transcribe antes del turno (lo que dice es un escrito dictado).
    if (message.type === 'audio' && message.audio_id) {
      const pistas = await pistasDeLaNota(supabase, user, turno.composicion);
      const r = await transcribeAudio(message.audio_id, { prompt: PROMPT_TRANSCRIPCION_LITERAL, maxOutputTokens: 8192, exigirFinCompleto: true, pistas });
      if (r.text) await completarTexto(supabase, message.wa_message_id, r.text);
    }
    // La misma telemetría del bot de siempre (y el tope de mensajes por hora la cuenta).
    await logMessage(supabase, message.phone, 'inbound', user.workspace_id, 'agente.one', message.text || `[${message.type}]`).catch(() => {});

    const almacen = almacenSupabase(supabase);
    await atenderPendientes({
      modelo: modeloGemini({ llave, principal: config.principal, respaldo: config.respaldo, corteMs: config.corteMs }),
      // Las fotos y los PDF que llegan se guardan como soporte al llegar y se leen con el modelo (Haiku; respaldo Gemini).
      dominio: turno.dominio,
      reglamento: turno.reglamento,
      rol: turno.rol,
      // El paso a una persona (spec 2026-10-26, §4.2): el botón al WhatsApp de MeTRIK (o al de la ficha del rol), la
      // señal del código y la fila de `asistente_escalamientos`.
      persona: { config: turno.escalamiento, empresa, rolClave: turno.rol.clave, canal: 'wa_one', escalamientos: escalamientosSupabase(supabase) },
      config,
      ahoraMs: () => Date.now(),
      reloj: () => performance.now(),
      almacen,
      mensajero: mensajeroWa(),
      workspaceId: user.workspace_id,
      phone,
      remitente: { nombre: user.name || 'quien escribe', rol: user.collaborator_id ? 'colaborador' : user.role },
      nuevoId: () => crypto.randomUUID(),
      despuesDelTurno: async (traza, turno) => {
        // El correo si se cayeron los modelos (spec 2026-10-26, §4.1). Nunca lanza.
        await alertarCaidaWa(supabase, almacen, traza, {
          workspaceId: user.workspace_id, workspaceNombre: String(ws?.slug ?? user.workspace_id), canal: 'one', phone, turnoId: turno.turnoId,
        });
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

/** El inbox de Meta del número de Agus para las asignaciones por canal: 'wa:<phone_number_id>'. */
function inboxWaOne(): string | null {
  const id = (Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '').replace(/\D/g, '');
  return id ? `wa:${id}` : null;
}

/**
 * El rol con que empezó esta conversación (el `traza.rol` más reciente dentro de su ventana): el rol se fija al empezar
 * y no cambia a mitad (spec 2026-10-26, §2.6). Solo se lee si el workspace usa roles. Error = null (manda el de ahora).
 */
async function rolPrevioWa(supabase: SupabaseClient, workspaceId: string, phone: string, ventanaHoras: number): Promise<RolTraza | null> {
  const desde = new Date(Date.now() - ventanaHoras * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from('wa_conversacion').select('traza')
    .eq('workspace_id', workspaceId).eq('phone', phone).gte('created_at', desde).not('traza->rol', 'is', null)
    .order('created_at', { ascending: false }).limit(1);
  if (error) {
    console.error('[agente-one] no se pudo leer el rol de la conversación:', error.message);
    return null;
  }
  return rolPrevio((data ?? []) as Array<{ traza?: { rol?: RolTraza | null } | null }>);
}
