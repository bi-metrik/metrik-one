// ============================================================
// Intérprete conversacional del bot de WhatsApp — la ejecución
// ------------------------------------------------------------
// Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-02-bot-conversacional.md
// Diseño:  proyectos/trappvel/clarity/docs/diseno/yuto-bot-conversacional-2026-10-02.md
//
// Una capa que ATIENDE o DEJA PASAR, sentada delante de la ruta de hoy (bloque `1a-int` de
// `wa-webhook/index.ts`). Las decisiones viven en `wa-interprete-reglas.ts` (puro, probado); aquí se
// lee el contexto, se llama al modelo UNA vez, se valida y se despacha con las funciones que ya
// existen. Ante CUALQUIER falla devuelve `{atendido:false}` y el mensaje sigue por el código de hoy,
// tal cual. No reintenta.
//
// Con el interruptor apagado (`config_extra.bot_conversacional`, que llega en la misma lectura que
// identifica al remitente) devuelve `{atendido:false}` sin tocar la base ni la red.
// ============================================================

import { sendButtons, sendTextMessage } from './wa-respond.ts';
import { checkInboundLimit } from './wa-rate-limit.ts';
import { botEquipoPermitido, MENSAJE_BOT_SIN_CLARITY } from './wa-modulos.ts';
import { getOrCreateSession, updateSession } from './wa-session.ts';
import {
  bandejaActiva,
  empiezaConPrefijoBot,
  fechaDeMeta,
  hayQueEsperarEnVuelo,
  quitarPrefijoConsulta,
  respuestaTrasRegistro,
  textoDescarteTotal,
  TEXTO_NADA_PENDIENTE,
} from './wa-bandeja-reglas.ts';
import type { AccionRegistro, ConfigBandeja } from './wa-bandeja-reglas.ts';
import {
  configDelWorkspace,
  descartarTandaAbierta,
  descartarTodo,
  enviar,
  esperaEnVuelo,
  estadoParaEsperar,
  preguntarCliente,
  responderPendiente,
  staffIdDelRemitente,
} from './wa-bandeja.ts';
import {
  acuseDelClienteDeLaTanda, candidatosDeEncabezado, pendienteDeLaTanda, preguntaAbierta, simularEnLaTanda, tandaAbiertaDelRemitente, textoDeLoQueFalta,
} from './wa-entendimiento.ts';
import { pareceRespuesta, resolverEncabezado } from './wa-viajes-reglas.ts';
import type { PlanViajes, ViajeAbierto } from './wa-viajes-reglas.ts';
import {
  armarContexto,
  atajoExacto,
  esEscrito,
  esquemaPara,
  generacionPara,
  instrucciones,
  leerConfigInterprete,
  negociosDelContexto,
  piensa,
  preguntaPendienteUnificada,
  textoSiguePendiente,
  TEXTO_GASTO_EN_COLA,
  TEXTO_NOTA_INTERNA,
  validar,
} from './wa-interprete-reglas.ts';
import type {
  ConfigInterprete,
  Decision,
  Interpretacion,
  NegocioCtx,
  Paso,
  PreguntaBandejaVista,
  PreguntaUnificada,
  SesionBotVista,
} from './wa-interprete-reglas.ts';
import { handleRegistro } from './handlers/registro/index.ts';
import { reconfirmarGasto } from './handlers/registro/resume.ts';
import { conSesion, despacharGasto } from './handlers/registro/cola-gastos.ts';
import { textoGastoDeLaCola } from './wa-interprete-reglas.ts';
import { handleConsulta } from './handlers/consulta.ts';
import { handleActividad } from './handlers/actividad.ts';
import { handleAyuda, handleUnclearResume } from './handlers/ayuda.ts';
import type { BotSession, GastoEnCola, HandlerContext, IncomingMessage, ParsedFields, SupabaseClient, WaUser } from './types.ts';

const NO = { atendido: false } as const;
const SI = { atendido: true } as const;

/** Marca en `wa_message_log.message_preview` de una nota interna: el texto no se guarda (V18). */
export const PREVIEW_NOTA_INTERNA = '[nota interna: no se guarda]';

// ── El modelo ────────────────────────────────────────────────────────────────

/**
 * Los tokens de un llamado, como los cuenta `usageMetadata`: entrada, respuesta (`candidatesTokenCount`) y
 * razonamiento (`thoughtsTokenCount`, que también se cobra como salida). `null`: no vino.
 */
export interface UsoModelo {
  tokensIn: number | null;
  tokensOut: number | null;
  tokensRazonamiento: number | null;
}

export type RespuestaModelo =
  | { ok: true; json: unknown; tokensIn: number | null; tokensOut: number | null; tokensRazonamiento?: number | null; ms: number }
  /** Una falla tras un HTTP 200 (MAX_TOKENS, JSON roto) trae su `uso`: el razonamiento se cobró igual. */
  | { ok: false; motivo: 'timeout' | 'http' | 'esquema'; ms: number; detalle?: string; uso?: UsoModelo };

function usoDe(d: unknown): UsoModelo | undefined {
  const u = (d as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  if (!u || typeof u !== 'object') return undefined;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  // Sin `thoughtsTokenCount` en un 200 el modelo no pensó: 0, no «no se sabe».
  return { tokensIn: n(u.promptTokenCount), tokensOut: n(u.candidatesTokenCount), tokensRazonamiento: n(u.thoughtsTokenCount) ?? 0 };
}

export interface PedidoModelo {
  modelo: string;
  sistema: string;
  usuario: string;
  generationConfig: Record<string, unknown>;
  timeoutMs: number;
}

/** Lo que una prueba puede reemplazar: el modelo, las variables de entorno y el reloj. */
export interface DepsInterprete {
  llamarModelo?: (p: PedidoModelo) => Promise<RespuestaModelo>;
  env?: (k: string) => string | undefined;
  ahora?: () => number;
}

function envDeDeno(k: string): string | undefined {
  return (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get(k);
}

/**
 * Gemini, un solo intento, con tiempo máximo. Se verifica el motivo de terminación y que el JSON se
 * lea: media respuesta aceptada en silencio es un falso verde.
 */
export async function llamarGemini(p: PedidoModelo, env: (k: string) => string | undefined = envDeDeno): Promise<RespuestaModelo> {
  const t0 = Date.now();
  const key = env('GEMINI_API_KEY');
  if (!key) return { ok: false, motivo: 'http', ms: 0, detalle: 'sin GEMINI_API_KEY' };
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: p.sistema }] },
        contents: [{ role: 'user', parts: [{ text: p.usuario }] }],
        generationConfig: p.generationConfig,
      }),
      signal: AbortSignal.timeout(p.timeoutMs),
    });
  } catch (err) {
    const nombre = (err as { name?: string })?.name ?? '';
    return { ok: false, motivo: nombre === 'TimeoutError' || nombre === 'AbortError' ? 'timeout' : 'http', ms: Date.now() - t0, detalle: String(err) };
  }
  const ms = Date.now() - t0;
  if (res.status !== 200) return { ok: false, motivo: 'http', ms, detalle: `HTTP ${res.status}` };
  let uso: UsoModelo | undefined;
  try {
    const d = await res.json();
    uso = usoDe(d);
    const c = d?.candidates?.[0];
    if (c?.finishReason !== 'STOP') return { ok: false, motivo: 'esquema', ms, detalle: `finishReason ${c?.finishReason ?? 'ninguno'}`, uso };
    // Con razonamiento, `parts` puede traer más de una parte: la respuesta es la que no es `thought`.
    const partes = (c?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
    const texto = partes.filter(x => !x.thought && typeof x.text === 'string').map(x => x.text).join('');
    const json = JSON.parse(texto);
    return { ok: true, json, ms, tokensIn: uso?.tokensIn ?? null, tokensOut: uso?.tokensOut ?? null, tokensRazonamiento: uso?.tokensRazonamiento ?? null };
  } catch (err) {
    return { ok: false, motivo: 'esquema', ms, detalle: String(err), uso };
  }
}

// ── La entrada ───────────────────────────────────────────────────────────────

/** El interruptor del remitente. Sin base: llega en `user.modulos` (`wa-identificar.ts`). */
export function interruptorDe(user: WaUser, env: (k: string) => string | undefined = envDeDeno): ConfigInterprete {
  const cfg = leerConfigInterprete(user.modulos?.bot_conversacional ?? null, env('WA_INTERPRETE_APAGADO'));
  // Un modelo fuera de `MODELOS_PERMITIDOS` corre el de por defecto, pero queda en el log (nunca en silencio).
  if (cfg.activo && cfg.modeloRechazado) {
    console.warn(`[wa-interprete] el modelo «${cfg.modeloRechazado.slice(0, 60)}» de config_extra.bot_conversacional no está permitido: corre ${cfg.modelo}`);
  }
  return cfg;
}

/**
 * El intérprete. `{atendido:true}`: el mensaje ya se atendió y el webhook termina. `{atendido:false}`:
 * sigue la ruta de hoy, sin cambios (interruptor apagado, no es un escrito, un atajo exacto, el tope,
 * o cualquier falla).
 */
export async function atenderEscrito(
  supabase: SupabaseClient, user: WaUser, message: IncomingMessage, deps: DepsInterprete = {},
): Promise<{ atendido: boolean }> {
  const env = deps.env ?? envDeDeno;
  const cfg = interruptorDe(user, env);
  if (!cfg.activo || !esEscrito(message)) return NO;
  const estado = { despachado: false };
  try {
    return await atender(supabase, user, message, cfg, deps, estado);
  } catch (err) {
    console.error('[wa-interprete] falla, sigue el código de hoy:', err);
    // Si ya se ejecutó algo, el mensaje está atendido: volver a la ruta de hoy lo haría dos veces.
    return estado.despachado ? SI : NO;
  }
}

interface Lectura {
  texto: string;
  bandeja: ConfigBandeja | null;
  sesion: (SesionBotVista & { context?: BotSession['context'] }) | null;
  pregunta: Awaited<ReturnType<typeof preguntaAbierta>>;
  pendiente: PreguntaUnificada | null;
  negocios: NegocioCtx[];
  tanda: Awaited<ReturnType<typeof tandaAbiertaDelRemitente>>;
}

async function atender(
  supabase: SupabaseClient, user: WaUser, message: IncomingMessage, cfg: ConfigInterprete, deps: DepsInterprete, estado: { despachado: boolean },
): Promise<{ atendido: boolean }> {
  const ahora = deps.ahora ?? Date.now;
  const ws = user.workspace_id;
  const modules = (user.modulos?.modules ?? null) as Record<string, unknown> | null;
  const configB = bandejaActiva(modules) ? await configDelWorkspace(supabase, ws) : null;
  // La bandeja del modo `uno` no tiene encabezados: ahí el intérprete no aplica.
  if (configB && configB.modoViajes !== 'encabezado') return NO;
  const conPrefijo = !!configB && empiezaConPrefijoBot(message.text, configB.prefijosBot);
  const texto = (conPrefijo ? quitarPrefijoConsulta(message.text, configB!.prefijosConsulta) : null) ?? message.text.trim();
  const enBandeja = !!configB && !conPrefijo;

  // 2. Atajos exactos que no necesitan contexto.
  if (atajoExacto(texto, { bandeja: enBandeja ? configB : null })) return NO;

  // 3. Los viajes (y el encabezado exacto), y la espera en vuelo ANTES de leer el resto del contexto.
  const cand = enBandeja ? await candidatosDeEncabezado(supabase, ws) : null;
  if (enBandeja && !cand) return NO;
  const encabezado = cand ? resolverEncabezado(texto, cand.viajes, cand.equipo) : null;
  if (enBandeja) {
    const esEnc = !!encabezado && encabezado.tipo !== 'no_reconocido';
    const e = await estadoParaEsperar(supabase, ws, message.phone, configB!);
    if (hayQueEsperarEnVuelo({ escrito: true, esEncabezado: esEnc, esCierre: false, pareceRespuesta: pareceRespuesta(texto), ...e })) {
      await esperaEnVuelo.dormir(esperaEnVuelo.ms);
    }
  }

  // 3b. Lo que el código de hoy lee exacto en la caja abierta (el cliente de un viaje nuevo, su llave, cuál es, la
  // lista de un encabezado): no pasa por el modelo. Así el resolvedor del cliente vive en UN camino, con el
  // interruptor apagado o prendido (diseño 2026-10-05, R6).
  if (enBandeja) {
    const sim = await simularEnLaTanda(supabase, ws, message.phone, configB!.horasCajaActiva, texto, fechaDeMeta(message.timestamp) ?? new Date(ahora()).toISOString());
    if (sim?.respuesta) return NO;
  }

  // 4. El tope de llamados al intérprete del remitente.
  if (!(await dentroDelTope(supabase, message.phone, cfg.maxLlamadasHora, ahora()))) {
    console.warn(`[wa-interprete] ${message.phone} pasó el tope de ${cfg.maxLlamadasHora} llamados por hora: sigue el código de hoy`);
    return NO;
  }

  // 5. El contexto.
  const lec = await leerContexto(supabase, user, message.phone, texto, configB, enBandeja, cand?.viajes ?? null, ahora());
  if (atajoExacto(texto, { bandeja: enBandeja ? configB : null, pendiente: lec.pendiente, encabezado })) return NO;

  const recientes = await mensajesRecientes(supabase, ws, message.phone, enBandeja, ahora());
  const usuario = armarContexto({
    empresa: enBandeja ? 'agencia de viajes con bandeja de solicitudes' : 'empresa que registra gastos y consulta sus números por WhatsApp',
    rol: user.role, bandeja: enBandeja, negocios: lec.negocios,
    tanda: enBandeja ? { abierta: !!lec.tanda, haceMin: lec.tanda?.creadaAt ? Math.round((ahora() - Date.parse(lec.tanda.creadaAt)) / 60000) : null, caja: cajaDe(lec), mensajes: lec.tanda?.n ?? null } : null,
    pendiente: lec.pendiente, recientes, mensaje: texto,
  });
  const llamar = deps.llamarModelo ?? ((p: PedidoModelo) => llamarGemini(p, deps.env ?? envDeDeno));
  const r = await llamar({
    modelo: cfg.modelo, sistema: instrucciones({ bandeja: enBandeja, jsonCompacto: piensa(cfg.modelo), confirmaNuevo: lec.pendiente?.capa === 'nuevo_confirmar' }), usuario,
    generationConfig: generacionPara(cfg.modelo, esquemaPara({ bandeja: enBandeja, rol: user.role })), timeoutMs: cfg.timeoutMs,
  });
  const base = { supabase, user, message, cfg, enBandeja };
  if (!r.ok) {
    await telemetria(base, { resultado: `fallback_${r.motivo}`, accion: enBandeja ? 'bandeja.fallback' : 'bot.fallback', propuesta: null, rechazo: r.detalle ?? null, r });
    return NO;
  }

  // 6. Validar y despachar.
  const decision = validar(r.json, {
    texto, bandeja: enBandeja, rol: user.role, pendiente: lec.pendiente, negocios: lec.negocios,
    tanda: lec.tanda ? { abierta: true, nombre: lec.tanda.nombre, cajaId: lec.tanda.cajaViajeId, cliente: lec.tanda.cajaCliente } : null,
    // Los nombres del equipo: una firma («Tatiana») nunca resuelve un viaje (control de Vera, E1).
    equipo: cand?.equipo ?? [],
  });
  if (decision.tipo === 'fallback') {
    await telemetria(base, { resultado: 'fallback_esquema', accion: enBandeja ? 'bandeja.fallback' : 'bot.fallback', propuesta: r.json, rechazo: decision.rechazo, r });
    return NO;
  }
  // El modelo no supo y el código de hoy sí tiene la respuesta exacta: un encabezado aproximado o ambiguo
  // («Pérez» con dos viajes) lo pregunta hoy con la lista numerada. Se le deja a él.
  if (decision.accion === 'pedir_aclaracion' && !lec.pendiente && encabezado && (encabezado.tipo === 'aproximado' || encabezado.tipo === 'ambiguo')) {
    await telemetria(base, { resultado: 'fallback_encabezado', accion: 'bandeja.fallback', propuesta: r.json, rechazo: decision.rechazo, r });
    return NO;
  }
  estado.despachado = true;
  const hecho = await despachar(base, decision, lec, texto);
  if (!hecho) {
    estado.despachado = false;
    await telemetria(base, { resultado: 'fallback_esquema', accion: enBandeja ? 'bandeja.fallback' : 'bot.fallback', propuesta: r.json, rechazo: 'despacho_sin_efecto', r });
    return NO;
  }
  await telemetria(base, { resultado: 'atendido', accion: decision.accion, propuesta: r.json, rechazo: decision.rechazo, r, nota: decision.paso.p === 'nota_interna' });
  return SI;
}

function cajaDe(lec: Lectura): string | null {
  const id = lec.tanda?.cajaViajeId;
  const n = id ? lec.negocios.find(x => x.id === id) : null;
  if (n) return `[${n.alias}] ${[n.codigo, n.cliente].filter(Boolean).join(' · ')}`;
  // La caja de un viaje nuevo: su cliente es el candidato pendiente (diseño 2026-10-05, §5.2). Solo el nombre.
  return lec.tanda?.cajaCliente ? `${lec.tanda.cajaCliente} (viaje nuevo)` : null;
}

async function dentroDelTope(supabase: SupabaseClient, phone: string, max: number, ahora: number): Promise<boolean> {
  const desde = new Date(ahora - 3600_000).toISOString();
  const { count, error } = await supabase.from('wa_message_log').select('*', { count: 'exact', head: true })
    .eq('phone', phone).eq('parser_source', 'interprete').gte('created_at', desde);
  if (error) return false; // ante la duda, el código de hoy
  return (count ?? 0) < max;
}

/** La sesión del bot a medias, SIN crearla (crearla insertaría una fila por cada escrito). */
async function sesionBotAMedias(supabase: SupabaseClient, phone: string, ws: string, ahora: number): Promise<Lectura['sesion']> {
  const { data } = await supabase.from('bot_sessions').select('id, state, context, expires_at')
    .eq('user_phone', phone).eq('workspace_id', ws)
    .in('state', ['confirming', 'awaiting_selection', 'awaiting_reason', 'awaiting_payment_status', 'awaiting_image', 'collecting', 'awaiting_timeout_confirm'])
    .gt('expires_at', new Date(ahora).toISOString()).order('expires_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const ctx = (data.context ?? {}) as BotSession['context'];
  const exp = Date.parse(String(data.expires_at ?? ''));
  return {
    state: String(data.state), pending_action: ctx.pending_action ?? null, options: (ctx.options ?? null) as SesionBotVista['options'],
    vistaAt: Number.isNaN(exp) ? null : new Date(exp - 15 * 60_000).toISOString(), context: ctx,
    texto: String(data.state) === 'confirming' && ctx.pending_action === 'W01' ? borradorDelGasto(ctx) : null,
  };
}

/** El gasto que se está confirmando, como lo vio el usuario: «Gasto $18.900 · peaje · Arena». */
function borradorDelGasto(c: BotSession['context']): string {
  const monto = typeof c.amount === 'number' ? `$${Math.round(c.amount).toLocaleString('es-CO')}` : 'sin monto';
  const detalle = c.parsed_fields?.descripcion || c.parsed_fields?.concept || 'sin detalle';
  const destino = c.destino_tipo === 'empresa' ? 'gasto de la empresa' : (c.proyecto_nombre || 'sin negocio');
  return `Gasto ${monto} · ${detalle} · ${destino} — ¿Lo confirmo? Confirmar / Cancelar`;
}

async function leerContexto(
  supabase: SupabaseClient, user: WaUser, phone: string, texto: string, configB: ConfigBandeja | null, enBandeja: boolean, viajes: ViajeAbierto[] | null, ahora: number,
): Promise<Lectura> {
  const ws = user.workspace_id;
  const sesion = await sesionBotAMedias(supabase, phone, ws, ahora);
  let pregunta: Lectura['pregunta'] = null;
  let bandejaVista: PreguntaBandejaVista | null = null;
  let tandaVista: Parameters<typeof preguntaPendienteUnificada>[0]['tanda'] = null;
  let tanda: Lectura['tanda'] = null;
  let todos: Array<Omit<NegocioCtx, 'alias'>>;
  if (enBandeja && configB) {
    todos = (viajes ?? []).map(v => ({ id: v.id, codigo: v.codigo, cliente: v.cliente, destino: v.destino, nombre: v.nombre ?? null }));
    pregunta = await preguntaAbierta(supabase, ws, phone);
    if (pregunta) {
      let opciones: ViajeAbierto[] | null = null;
      if (pregunta.tipo === 'entrega' && pregunta.espera === 'viaje') {
        const { data } = await supabase.from('wa_bandeja_entregas').select('negocio_opciones, pregunta_enviada_at').eq('id', pregunta.id).maybeSingle();
        opciones = Array.isArray(data?.negocio_opciones) ? (data!.negocio_opciones as ViajeAbierto[]) : null;
        bandejaVista = { espera: pregunta.espera, nombre: pregunta.nombre, corta: pregunta.corta, opciones, vistaAt: (data?.pregunta_enviada_at as string | null) ?? null };
      } else if (pregunta.nuevoPorConfirmar) {
        // «¿Creo el cliente nuevo «X»?»: el modelo ve la lista del aviso (numerada) y la opción «sí». Sin ella,
        // un número suelto se cruzaba con los alias `nN` del contexto (cuarto control de Vera, CF7).
        const { data } = pregunta.entregaId
          ? await supabase.from('wa_bandeja_entregas').select('negocio_opciones').eq('id', pregunta.entregaId).maybeSingle()
          : { data: null };
        opciones = Array.isArray(data?.negocio_opciones) ? (data!.negocio_opciones as ViajeAbierto[]) : null;
        // Con los viajes abiertos: el aviso «Ya hay un viaje de …» puede nombrar uno fuera de la lista (sexto control).
        bandejaVista = { espera: pregunta.espera, nombre: pregunta.nombre, corta: pregunta.corta, opciones, vistaAt: null, nuevoPorConfirmar: pregunta.nuevoPorConfirmar, viajesAbiertos: viajes ?? [] };
      } else if (pregunta.espera === 'resumen') {
        // El resumen con su reparto: el atajo es exacto solo si el código de hoy entiende la respuesta (sexto control).
        const entregaId = pregunta.tipo === 'entrega' ? pregunta.id : pregunta.entregaId;
        const { data } = entregaId ? await supabase.from('wa_bandeja_entregas').select('plan_viajes').eq('id', entregaId).maybeSingle() : { data: null };
        bandejaVista = {
          espera: pregunta.espera, nombre: pregunta.nombre, corta: pregunta.corta, opciones: null, vistaAt: null,
          plan: (data?.plan_viajes ?? null) as PlanViajes | null, viajesAbiertos: viajes ?? [],
        };
      } else {
        bandejaVista = { espera: pregunta.espera, nombre: pregunta.nombre, corta: pregunta.corta, opciones: null, vistaAt: null };
      }
    }
    const pt = await pendienteDeLaTanda(supabase, ws, phone, configB.horasCajaActiva);
    if (pt) {
      tandaVista = pt.tipo === 'eleccion' ? { tipo: 'eleccion', texto: pt.texto, candidatos: pt.candidatos }
        : pt.tipo === 'cliente' ? { tipo: 'cliente', texto: textoDeLoQueFalta(pt) } : { tipo: 'nombre' };
    }
    tanda = await tandaAbiertaDelRemitente(supabase, ws, phone, configB.horasCajaActiva);
  } else {
    todos = await negociosAbiertosDelBot(supabase, ws);
  }
  const negocios = negociosDelContexto(todos, texto);
  const alias = (id: string) => negocios.find(n => n.id === id)?.alias ?? id;
  const pendiente = preguntaPendienteUnificada({ sesion, bandeja: bandejaVista, tanda: tandaVista, alias, ahora });
  return { texto, bandeja: configB, sesion, pregunta, pendiente, negocios, tanda };
}

/** Los negocios abiertos del workspace para el bot (gastos, consultas): código, nombre y cliente. */
async function negociosAbiertosDelBot(supabase: SupabaseClient, ws: string): Promise<Array<Omit<NegocioCtx, 'alias'>>> {
  const { data, error } = await supabase.from('negocios').select('id, codigo, nombre, contactos(nombre), empresas(nombre)')
    .eq('workspace_id', ws).eq('estado', 'abierto').order('updated_at', { ascending: false }).limit(200);
  if (error) console.error('[wa-interprete] no se pudieron leer los negocios abiertos:', error.message);
  const rel = (v: unknown) => (Array.isArray(v) ? v[0] : v) as { nombre?: string } | null;
  return ((data ?? []) as Array<Record<string, unknown>>).map(n => ({
    id: n.id as string, codigo: (n.codigo as string | null) ?? null, nombre: (n.nombre as string | null) ?? null,
    cliente: rel(n.contactos)?.nombre ?? rel(n.empresas)?.nombre ?? null, destino: null,
  }));
}

/** Los últimos mensajes (30 min, máx. 5): los de la bandeja y el último texto del bot. */
async function mensajesRecientes(
  supabase: SupabaseClient, ws: string, phone: string, enBandeja: boolean, ahora: number,
): Promise<Array<{ tipo: 'reenviado' | 'escrito' | 'bot'; texto: string }>> {
  const desde = new Date(ahora - 30 * 60_000).toISOString();
  const out: Array<{ tipo: 'reenviado' | 'escrito' | 'bot'; texto: string; en: string }> = [];
  if (enBandeja) {
    const { data } = await supabase.from('wa_bandeja_mensajes').select('cuerpo, reenviado, recibido_at')
      .eq('workspace_id', ws).eq('remitente_phone', phone).gte('recibido_at', desde).order('recibido_at', { ascending: false }).limit(5);
    for (const m of (data ?? []) as Array<Record<string, unknown>>) {
      if (String(m.cuerpo ?? '').trim()) out.push({ tipo: m.reenviado ? 'reenviado' : 'escrito', texto: String(m.cuerpo), en: String(m.recibido_at) });
    }
  } else {
    const { data } = await supabase.from('wa_message_log').select('message_preview, created_at')
      .eq('phone', phone).eq('direction', 'inbound').gte('created_at', desde).order('created_at', { ascending: false }).limit(5);
    for (const m of (data ?? []) as Array<Record<string, unknown>>) {
      if (String(m.message_preview ?? '').trim()) out.push({ tipo: 'escrito', texto: String(m.message_preview), en: String(m.created_at) });
    }
  }
  const { data: bot } = await supabase.from('wa_envios').select('preview, created_at')
    .eq('phone', phone).gte('created_at', desde).order('created_at', { ascending: false }).limit(1);
  for (const b of (bot ?? []) as Array<Record<string, unknown>>) {
    if (String(b.preview ?? '').trim()) out.push({ tipo: 'bot', texto: String(b.preview), en: String(b.created_at) });
  }
  return out.sort((a, b) => a.en.localeCompare(b.en)).slice(-5).map(({ tipo, texto }) => ({ tipo, texto }));
}

// ── El despacho (§4) ─────────────────────────────────────────────────────────

interface Base {
  supabase: SupabaseClient;
  user: WaUser;
  message: IncomingMessage;
  cfg: ConfigInterprete;
  enBandeja: boolean;
}

/** Ejecuta el paso validado. `false`: no tuvo efecto y el mensaje sigue por la ruta de hoy. */
async function despachar(b: Base, d: Extract<Decision, { tipo: 'ejecutar' }>, lec: Lectura, texto: string): Promise<boolean> {
  const { supabase, user, message } = b;
  const ws = user.workspace_id;
  const paso = d.paso;
  const recordar = d.recordar && lec.pendiente ? textoSiguePendiente(lec.pendiente) : null;
  const decirAlUsuario = async (t: string | null) => {
    const todo = [t, recordar].filter(Boolean).join('\n');
    if (!todo) return;
    if (b.enBandeja) await enviar(message.phone, todo, ws);
    else await sendTextMessage(message.phone, todo);
  };

  switch (paso.p) {
    case 'nada':
      await decirAlUsuario(null);
      return true;
    case 'decir':
      await decirAlUsuario(paso.texto);
      return true;
    case 'nota_interna':
      await decirAlUsuario(TEXTO_NOTA_INTERNA);
      return true;
    case 'registrar': {
      const fila = await registrar(b, lec, { esCierre: false });
      if (!fila) return false;
      if (fila.accion !== 'duplicado') {
        await guardarInterpretacion(b, paso.interpretacion);
        // El acuse de un viaje nuevo es el del código de hoy, con el directorio (quién es el cliente, o qué falta).
        const i = paso.interpretacion;
        const deViajeNuevo = (i.accion === 'abrir_viaje' && !i.viaje_id) || i.accion === 'nombre';
        const delCliente = deViajeNuevo && lec.bandeja ? await acuseDelClienteDeLaTanda(supabase, ws, message.phone, lec.bandeja.horasCajaActiva) : null;
        await decirAlUsuario(delCliente ?? paso.aviso);
      }
      return true;
    }
    case 'cerrar_tanda': {
      const fila = await registrar(b, lec, { esCierre: true });
      if (!fila) return false;
      const r = respuestaTrasRegistro(fila.accion);
      if (r === 'pregunta' && fila.entrega) await preguntarCliente(supabase, fila.entrega, message.phone, fila.mensajes ?? 0, ws, { porPalabra: true });
      else if (r === 'nada_pendiente') await enviar(message.phone, TEXTO_NADA_PENDIENTE, ws);
      return true;
    }
    case 'responder_bandeja': {
      const ok = await responderPendiente(supabase, ws, message.phone, paso.canonico, wamidDe(message), fechaDeMeta(message.timestamp), lec.bandeja!, true, message.text);
      if (!ok) return false;
      await guardarInterpretacion(b, paso.interpretacion);
      if (paso.aviso) await enviar(message.phone, paso.aviso, ws);
      return true;
    }
    case 'descartar': {
      if (paso.alcance === 'todo') {
        await descartarTodo(supabase, ws, message.phone, message.text, wamidDe(message), fechaDeMeta(message.timestamp), lec.bandeja!);
        return true;
      }
      const { partes } = await descartarTandaAbierta(supabase, ws, message.phone, message.text, wamidDe(message), fechaDeMeta(message.timestamp), lec.bandeja!);
      await enviar(message.phone, textoDescarteTotal(partes), ws);
      return true;
    }
    default:
      return despacharAlBot(b, paso, lec, texto, recordar);
  }
}

function wamidDe(m: IncomingMessage): string {
  return m.wa_message_id ?? `sin-wamid:${m.phone}:${m.timestamp}:${m.type}`;
}

/** `wa_bandeja_registrar_mensaje`, con los mismos parámetros que `atenderEnBandeja`: el crudo completo. */
async function registrar(b: Base, lec: Lectura, o: { esCierre: boolean }): Promise<{ accion: AccionRegistro; entrega: string | null; mensajes: number | null } | null> {
  const { supabase, user, message } = b;
  const { data, error } = await supabase.rpc('wa_bandeja_registrar_mensaje', {
    p_workspace_id: user.workspace_id,
    p_remitente_phone: message.phone,
    p_remitente_staff_id: user.collaborator_id ? null : (await staffIdDelRemitente(supabase, user)),
    p_remitente_colaborador_id: user.collaborator_id ?? null,
    p_wa_message_id: wamidDe(message),
    p_tipo: message.type,
    p_cuerpo: message.text,
    p_cuerpo_origen: 'texto',
    p_reenviado: false,
    p_reenviado_muchas_veces: false,
    p_meta_media_id: null,
    p_transcripcion_error: null,
    p_enviado_at: fechaDeMeta(message.timestamp),
    p_es_cierre: o.esCierre,
    p_horas_respuesta_cliente: lec.bandeja!.horasRespuestaCliente,
    // El intérprete ya decidió qué es: no se toma como la respuesta a una pregunta pendiente.
    p_puede_ser_respuesta: false,
  });
  if (error) {
    console.error(`[wa-interprete] no se pudo registrar ${message.wa_message_id}:`, error.message);
    return null;
  }
  const fila = (Array.isArray(data) ? data[0] : data) as { accion: AccionRegistro; entrega: string | null; mensajes: number | null } | undefined;
  return fila ?? null;
}

/** La decisión del intérprete con el mensaje (un UPDATE por `wa_message_id`; la función SQL no cambia). */
async function guardarInterpretacion(b: Base, i: Interpretacion): Promise<void> {
  const { error } = await b.supabase.from('wa_bandeja_mensajes').update({ interpretacion: { ...i, modelo: b.cfg.modelo } })
    .eq('workspace_id', b.user.workspace_id).eq('wa_message_id', wamidDe(b.message));
  if (error) console.error('[wa-interprete] no se pudo guardar la interpretacion:', error.message);
}

// ── Bot ──────────────────────────────────────────────────────────────────────

/**
 * Las puertas de hoy antes de cualquier acción del bot, con los mismos textos de `wa-webhook/index.ts`
 * (Clarity `:437`, plan `:443`, tope de 30 por hora `:450`). Los permisos por rol ya los aplicó V3.
 */
async function puertasDelBot(b: Base): Promise<boolean> {
  const { supabase, user, message } = b;
  if (!botEquipoPermitido(user.modulos)) {
    await sendTextMessage(message.phone, MENSAJE_BOT_SIN_CLARITY);
    return false;
  }
  if (!['active_pro_plus', 'trial'].includes(user.subscription_status)) {
    await sendTextMessage(message.phone, TEXTO_PLAN);
    return false;
  }
  if (!(await checkInboundLimit(supabase, message.phone))) {
    await sendTextMessage(message.phone, TEXTO_TOPE);
    return false;
  }
  return true;
}

export const TEXTO_PLAN = 'El bot de WhatsApp está disponible en el plan Pro+. Puedes activarlo desde la app cuando quieras.';
export const TEXTO_TOPE = 'Vas muy rápido, dame un momento. Espera unos minutos y volvemos.';

/** El contexto de handler, armado como `processMessage` (`wa-webhook/index.ts:530`). */
function contextoDelBot(b: Base, message: IncomingMessage, session: BotSession, parsed: HandlerContext['parsed'], persistir = true): HandlerContext {
  const { supabase } = b;
  return {
    user: b.user,
    message,
    session,
    parsed,
    supabase,
    sendMessage: (text: string) => sendTextMessage(message.phone, text),
    sendOptions: (body: string, options: string[]) => {
      const numbered = options.map((opt, i) => `${i + 1}️⃣ ${opt}`).join('\n');
      return sendTextMessage(message.phone, `${body}\n\n${numbered}\n\nResponde con el número.`);
    },
    sendButtons: async (body: string, btns: Array<{ id: string; title: string }>) => { await sendButtons(message.phone, body, btns); },
    updateSession: async (state, context) => {
      if (persistir) await updateSession(supabase, session.id, state, context);
      session.state = state;
      if (context) session.context = { ...session.context, ...context };
    },
  };
}

/** Una sesión solo en memoria: para una consulta o la ayuda en medio de un gasto a medias (no la pisa). */
function sesionEnMemoria(b: Base): BotSession {
  const ahora = new Date().toISOString();
  return { id: 'interprete-sin-sesion', workspace_id: b.user.workspace_id, user_phone: b.message.phone, intent: null, state: 'started', context: {}, started_at: ahora, expires_at: ahora };
}

/** Lo que hace `handleSessionResponse` de `wa-webhook/index.ts:700`, con la entrada canónica. */
async function responderSesion(ctx: HandlerContext): Promise<void> {
  const pa = ctx.session.context?.pending_action ?? '';
  if (['W01', 'W06'].includes(pa)) await handleRegistro(ctx);
  else if (pa === 'WAC') await handleActividad(ctx);
  else if (pa === 'WUC') await handleUnclearResume(ctx);
  else if (['W14', 'W15', 'W16', 'W17', 'W19'].includes(pa)) await handleConsulta(ctx);
  else {
    await ctx.sendMessage('Perdí el hilo. Cuéntame de nuevo qué necesitas.');
    await updateSession(ctx.supabase, ctx.session.id, 'completed');
  }
}

async function despacharAlBot(b: Base, paso: Paso, lec: Lectura, texto: string, recordar: string | null): Promise<boolean> {
  if (!(await puertasDelBot(b))) return true;
  const { supabase, user, message } = b;
  const aMedias = !!lec.sesion;
  const sesion = async () => getOrCreateSession(supabase, message.phone, user.workspace_id);
  const alFinal = async () => { if (recordar) await sendTextMessage(message.phone, recordar); };

  switch (paso.p) {
    case 'bot_boton':
    case 'bot_texto': {
      const s = await sesion();
      const m: IncomingMessage = paso.p === 'bot_boton' ? { ...message, interactive_reply: paso.boton } : { ...message, text: paso.texto };
      await responderSesion(contextoDelBot(b, m, s, { intent: s.context?.intent || 'UNCLEAR', confidence: 1, fields: {} }));
      return true;
    }
    case 'bot_corregir': {
      const s = await sesion();
      const ctx = contextoDelBot(b, message, s, { intent: 'GASTO', confidence: 1, fields: {} });
      let fields: ParsedFields = { ...(s.context?.parsed_fields ?? {}) };
      for (const c of paso.cambios) {
        if (c.campo === 'monto') {
          fields = { ...fields, amount: c.valor };
          await ctx.updateSession(s.state, { amount: c.valor, parsed_fields: fields });
        } else if (c.campo === 'negocio') {
          const v = c.valor;
          await ctx.updateSession(s.state, v === 'empresa' || !v
            ? { destino_tipo: 'empresa', negocio_id: undefined, proyecto_id: undefined }
            : { destino_tipo: 'negocio', negocio_id: v.id, proyecto_id: undefined, proyecto_nombre: v.nombre ?? undefined });
        } else {
          // Como `decidirConfirmacionGasto` con una descripción: el concepto y la categoría viejos se van.
          const { concept: _c, category_hint: _h, ...resto } = fields;
          fields = { ...resto, descripcion: c.valor, mensaje_original: [fields.mensaje_original, message.text].filter(Boolean).join(' / ') };
        }
      }
      await reconfirmarGasto(ctx, fields);
      return true;
    }
    case 'bot_gastos': {
      const cola: GastoEnCola[] = paso.gastos.map(g => ({ ...g, mensaje: texto }));
      if (paso.enCola && lec.sesion) {
        // Con un gasto a medias, el nuevo espera su turno: la sesión sigue como estaba.
        const s = await sesion();
        const previos = s.context?.gastos_en_cola ?? [];
        await updateSession(supabase, s.id, s.state, { gastos_en_cola: [...previos, ...cola], gastos_total: (Number(s.context?.gastos_total) || 1) + cola.length });
        await sendTextMessage(message.phone, [TEXTO_GASTO_EN_COLA, recordar].filter(Boolean).join('\n'));
        return true;
      }
      const s = await sesion();
      const ctx = contextoDelBot(b, message, s, { intent: 'GASTO', confidence: 0, fields: {} });
      const [primero, ...resto] = cola;
      if (resto.length) {
        await ctx.updateSession(s.state, { gastos_en_cola: resto, gastos_total: cola.length });
        await sendTextMessage(message.phone, textoGastoDeLaCola(1, cola.length));
      }
      await despacharGasto(conSesion(ctx, s), primero);
      await alFinal();
      return true;
    }
    case 'bot_consulta': {
      const s = aMedias ? sesionEnMemoria(b) : await sesion();
      await handleConsulta(contextoDelBot(b, message, s, { intent: paso.intent, confidence: 1, fields: paso.fields }, !aMedias));
      await alFinal();
      return true;
    }
    case 'bot_ayuda': {
      const s = aMedias ? sesionEnMemoria(b) : await sesion();
      await handleAyuda(contextoDelBot(b, message, s, { intent: 'AYUDA', confidence: 1, fields: {} }, !aMedias));
      await alFinal();
      return true;
    }
    case 'bot_actividad':
    case 'bot_contacto': {
      if (aMedias) {
        await sendTextMessage(message.phone, recordar ?? textoSiguePendiente(lec.pendiente!));
        return true;
      }
      const s = await sesion();
      const ctx = contextoDelBot(b, message, s, { intent: paso.p === 'bot_actividad' ? 'ACTIVIDAD' : 'CONTACTO_NUEVO', confidence: 1, fields: paso.fields });
      if (paso.p === 'bot_actividad') await handleActividad(ctx);
      else await handleRegistro(ctx);
      return true;
    }
    default:
      return false;
  }
}

// ── Telemetría (§8) ──────────────────────────────────────────────────────────

/** Los tokens que se guardan: los de la respuesta buena, o los de una falla tras un 200 (MAX_TOKENS también cobra). */
export function usoParaTelemetria(r: RespuestaModelo): UsoModelo {
  if (r.ok) return { tokensIn: r.tokensIn, tokensOut: r.tokensOut, tokensRazonamiento: r.tokensRazonamiento ?? null };
  return r.uso ?? { tokensIn: null, tokensOut: null, tokensRazonamiento: null };
}

/** ¿El error de PostgREST es por una columna que todavía no existe (la migración no se ha aplicado)? */
function faltaColumna(error: { code?: string; message?: string } | null, columna: string): boolean {
  return !!error && (error.code === 'PGRST204' || error.code === '42703') && String(error.message ?? '').includes(columna);
}

async function telemetria(b: Base, t: {
  resultado: string; accion: string | null; propuesta: unknown; rechazo: string | null; r: RespuestaModelo; nota?: boolean;
}): Promise<void> {
  const uso = usoParaTelemetria(t.r);
  const fila: Record<string, unknown> = {
    workspace_id: b.user.workspace_id,
    phone: b.message.phone,
    direction: 'inbound',
    intent: t.accion,
    // V18: una nota interna no deja su texto ni en la bitácora técnica.
    message_preview: t.nota ? PREVIEW_NOTA_INTERNA : String(b.message.text ?? '').slice(0, 100),
    parser_source: 'interprete',
    gemini_model: b.cfg.modelo,
    gemini_input_tokens: uso.tokensIn,
    gemini_output_tokens: uso.tokensOut,
    gemini_thoughts_tokens: uso.tokensRazonamiento,
    gemini_latency_ms: t.r.ms,
    interprete_accion: t.accion,
    interprete_propuesta: t.nota ? sinEvidencia(t.propuesta) : t.propuesta ?? null,
    interprete_rechazo: t.rechazo,
    interprete_resultado: t.resultado,
  };
  let { error } = await b.supabase.from('wa_message_log').insert(fila);
  // Sin la columna (la migración 20261003120000 todavía no se aplicó), la fila igual se guarda: de ella
  // depende el tope de llamados por hora (`dentroDelTope`).
  if (faltaColumna(error, 'gemini_thoughts_tokens')) {
    const { gemini_thoughts_tokens: _sin, ...resto } = fila;
    ({ error } = await b.supabase.from('wa_message_log').insert(resto));
  }
  if (error) console.error('[wa-interprete] no se pudo dejar la telemetría:', error.message);
}

/** La propuesta de una nota interna, sin el texto (la evidencia es un trozo del juicio). */
function sinEvidencia(p: unknown): unknown {
  const acc = (p as { acciones?: unknown[] } | null)?.acciones;
  if (!Array.isArray(acc)) return null;
  return { acciones: acc.map(a => ({ accion: (a as { accion?: string })?.accion ?? null })) };
}
