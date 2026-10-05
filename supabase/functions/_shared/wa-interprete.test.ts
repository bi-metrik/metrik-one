import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * La ejecución del intérprete (`wa-interprete.ts`) con todo lo de afuera simulado:
 *   · interruptor apagado → ni una consulta, ni un llamado al modelo (también mal escrito y por entorno);
 *   · fallback → timeout, HTTP 500, JSON inválido y esquema roto dejan el mensaje al código de hoy y la
 *     telemetría marca `fallback_*`;
 *   · despacho → cada acción llega a la función que ya existe con su entrada canónica, y no hay
 *     escrituras nuevas a negocios, bloques ni gastos.
 * Datos sintéticos (Carolina Ruiz, Jorge y Lina Pérez, Arena, Clínica del Norte).
 */

const enviados: string[] = [];
const botones: Array<{ body: string; ids: string[] }> = [];
vi.mock('./wa-respond.ts', () => ({
  sendTextMessage: vi.fn(async (_p: string, t: string) => { enviados.push(t); }),
  sendButtons: vi.fn(async (_p: string, body: string, b: Array<{ id: string }>) => { botones.push({ body, ids: b.map(x => x.id) }); }),
}));

const espias = vi.hoisted(() => ({
  responderPendiente: vi.fn(async () => true),
  descartarTodo: vi.fn(async () => {}),
  descartarTandaAbierta: vi.fn(async () => ({ partes: [{ nombre: 'Carolina Ruiz', n: 2 }], guardada: true })),
  preguntarCliente: vi.fn(async () => {}),
  enviar: vi.fn(async () => true),
  preguntaAbierta: vi.fn(async () => null as unknown),
  pendienteDeLaTanda: vi.fn(async () => null as unknown),
  tandaAbiertaDelRemitente: vi.fn(async () => null as unknown),
  candidatosDeEncabezado: vi.fn(async () => ({ viajes: [] as unknown[], equipo: [] as string[] })),
  handleRegistro: vi.fn(async () => {}),
  reconfirmarGasto: vi.fn(async () => {}),
  handleGasto: vi.fn(async () => {}),
  proceedEmpresaGasto: vi.fn(async () => {}),
  handleConsulta: vi.fn(async () => {}),
  handleActividad: vi.fn(async () => {}),
  handleAyuda: vi.fn(async () => {}),
  handleUnclearResume: vi.fn(async () => {}),
  checkInboundLimit: vi.fn(async () => true),
  getOrCreateSession: vi.fn(async () => ({}) as unknown),
  updateSession: vi.fn(async () => {}),
}));

vi.mock('./wa-bandeja.ts', () => ({
  configDelWorkspace: vi.fn(async () => ({
    ventanaMinutos: 5, palabrasCierre: ['listo'], prefijosBot: ['gasto', 'bot'], prefijosConsulta: ['bot'],
    horasRespuestaCliente: 24, modoViajes: 'encabezado', confirmar: 'siempre', horasCajaActiva: 4,
  })),
  responderPendiente: espias.responderPendiente,
  descartarTodo: espias.descartarTodo,
  descartarTandaAbierta: espias.descartarTandaAbierta,
  preguntarCliente: espias.preguntarCliente,
  enviar: vi.fn(async (_p: string, t: string) => { enviados.push(t); return true; }),
  esperaEnVuelo: { ms: 0, dormir: async () => {} },
  estadoParaEsperar: vi.fn(async () => ({ hayAbierta: true, hayPregunta: false })),
  staffIdDelRemitente: vi.fn(async () => null),
}));
vi.mock('./wa-entendimiento.ts', () => ({
  candidatosDeEncabezado: espias.candidatosDeEncabezado,
  preguntaAbierta: espias.preguntaAbierta,
  pendienteDeLaTanda: espias.pendienteDeLaTanda,
  tandaAbiertaDelRemitente: espias.tandaAbiertaDelRemitente,
}));
vi.mock('./handlers/registro/index.ts', () => ({ handleRegistro: espias.handleRegistro }));
vi.mock('./handlers/registro/resume.ts', () => ({ reconfirmarGasto: espias.reconfirmarGasto }));
vi.mock('./handlers/registro/gasto.ts', () => ({
  handleGasto: espias.handleGasto, proceedEmpresaGasto: espias.proceedEmpresaGasto, categoriaDelGasto: () => 'otros',
}));
vi.mock('./handlers/consulta.ts', () => ({ handleConsulta: espias.handleConsulta }));
vi.mock('./handlers/actividad.ts', () => ({ handleActividad: espias.handleActividad }));
vi.mock('./handlers/ayuda.ts', () => ({ handleAyuda: espias.handleAyuda, handleUnclearResume: espias.handleUnclearResume }));
vi.mock('./wa-rate-limit.ts', () => ({ checkInboundLimit: espias.checkInboundLimit }));
vi.mock('./wa-session.ts', () => ({ getOrCreateSession: espias.getOrCreateSession, updateSession: espias.updateSession }));

import { atenderEscrito, interruptorDe, llamarGemini, PREVIEW_NOTA_INTERNA, usoParaTelemetria, type DepsInterprete, type RespuestaModelo } from './wa-interprete.ts';
import { identificarRemitente } from './wa-identificar.ts';
import type { BotSession, IncomingMessage, WaUser } from './types.ts';

// ── La base falsa: cuenta todo y anota cada escritura ───────────────────────

type Fila = Record<string, unknown>;
interface Op { tabla: string; op: 'select' | 'insert' | 'update' | 'rpc'; payload?: unknown; filtros: string[] }

function baseFalsa(tablas: Record<string, Fila[]> = {}, rpc: Record<string, unknown> = {}) {
  const ops: Op[] = [];
  const from = (tabla: string) => {
    const o: Op = { tabla, op: 'select', filtros: [] };
    ops.push(o);
    const datos = () => ({ data: tablas[tabla] ?? [], count: (tablas[tabla] ?? []).length, error: null });
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'gt', 'gte', 'lt', 'is', 'or', 'not', 'order', 'limit', 'ilike']) {
      q[m] = (...a: unknown[]) => { if (m !== 'select') o.filtros.push(`${m}:${a.map(x => JSON.stringify(x)).join(',')}`); return q; };
    }
    q.insert = (p: unknown) => { o.op = 'insert'; o.payload = p; return q; };
    q.update = (p: unknown) => { o.op = 'update'; o.payload = p; return q; };
    q.maybeSingle = async () => ({ data: (tablas[tabla] ?? [])[0] ?? null, error: null });
    q.single = q.maybeSingle;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(datos()).then(res);
    return q;
  };
  return {
    ops,
    from,
    rpc: async (nombre: string, args: unknown) => { ops.push({ tabla: nombre, op: 'rpc', payload: args, filtros: [] }); return { data: rpc[nombre] ?? null, error: null }; },
    escrituras: () => ops.filter(o => o.op !== 'select'),
  };
}

/** Un proxy que revienta ante cualquier acceso: con el interruptor apagado no se toca la base. */
function baseIntocable() {
  const accesos: string[] = [];
  const p = new Proxy({}, { get: (_t, k) => { accesos.push(String(k)); throw new Error(`la base se tocó: ${String(k)}`); } });
  return { p, accesos };
}

const WS = 'ws-prueba';
const ON = { activo: true, modelo: 'gemini-2.5-flash' };
const usuario = (o: Partial<WaUser> & { bot?: unknown; modules?: Record<string, unknown> } = {}): WaUser => ({
  workspace_id: WS, phone: '573000000001', name: 'Prueba', role: 'owner', subscription_status: 'trial',
  modulos: { modules: o.modules ?? { business: true, clarity: true }, bot_conversacional: o.bot === undefined ? ON : o.bot },
  ...o,
});
const escrito = (text: string, o: Partial<IncomingMessage> = {}): IncomingMessage => ({
  phone: '573000000001', text, type: 'text', wa_message_id: `wamid.${Math.random()}`, timestamp: '1790000000', ...o,
});
const modelo = (json: unknown): DepsInterprete['llamarModelo'] => vi.fn(async (): Promise<RespuestaModelo> => ({ ok: true, json, tokensIn: 900, tokensOut: 60, ms: 800 }));
const deps = (json: unknown, extra: Partial<DepsInterprete> = {}): DepsInterprete => ({ llamarModelo: modelo(json), env: () => undefined, ...extra });

/** La sesión del bot que devuelve `getOrCreateSession` (y la que lee el intérprete sin crearla). */
function sesionBot(state: string, context: Fila = {}): BotSession {
  return { id: 'ses-1', workspace_id: WS, user_phone: '573000000001', intent: 'GASTO', state: state as BotSession['state'], context: { pending_action: 'W01', ...context }, started_at: '', expires_at: new Date(Date.now() + 600_000).toISOString() };
}

beforeEach(() => {
  enviados.length = 0;
  botones.length = 0;
  for (const f of Object.values(espias)) f.mockClear();
  espias.preguntaAbierta.mockResolvedValue(null);
  espias.pendienteDeLaTanda.mockResolvedValue(null);
  espias.tandaAbiertaDelRemitente.mockResolvedValue(null);
  espias.candidatosDeEncabezado.mockResolvedValue({ viajes: [], equipo: [] });
  espias.checkInboundLimit.mockResolvedValue(true);
  espias.responderPendiente.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllGlobals());

// ── Interruptor apagado ─────────────────────────────────────────────────────

describe('interruptor apagado: el webhook no hace ni una consulta más que hoy', () => {
  it('sin `bot_conversacional` (o nulo, como en los workspaces viejos): ni base, ni modelo, ni fetch', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const bot of [null, undefined, { activo: false }, { activo: 'true' }, 'activo']) {
      const { p, accesos } = baseIntocable();
      const llamar = vi.fn();
      const u = usuario({ bot: bot === undefined ? null : bot });
      if (bot === undefined) delete (u.modulos as Fila).bot_conversacional;
      expect(await atenderEscrito(p, u, escrito('pagué 20 mil de taxi'), { llamarModelo: llamar, env: () => undefined })).toEqual({ atendido: false });
      expect(accesos).toEqual([]);
      expect(llamar).not.toHaveBeenCalled();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('el apagado por entorno (WA_INTERPRETE_APAGADO=1) apaga aunque el workspace lo tenga encendido', async () => {
    const { p, accesos } = baseIntocable();
    const llamar = vi.fn();
    expect(await atenderEscrito(p, usuario(), escrito('pagué 20 mil de taxi'), { llamarModelo: llamar, env: k => (k === 'WA_INTERPRETE_APAGADO' ? '1' : undefined) })).toEqual({ atendido: false });
    expect(accesos).toEqual([]);
    expect(llamar).not.toHaveBeenCalled();
  });

  it('encendido, lo que no es un escrito tampoco pasa: reenvío, botón, audio, foto', async () => {
    for (const m of [escrito('hola', { reenviado: true }), escrito('Confirmar', { type: 'interactive', interactive_reply: 'btn_confirm' }), escrito('', { type: 'audio' }), escrito('pie', { type: 'image' })]) {
      const { p, accesos } = baseIntocable();
      expect(await atenderEscrito(p, usuario(), m, { llamarModelo: vi.fn(), env: () => undefined })).toEqual({ atendido: false });
      expect(accesos).toEqual([]);
    }
  });

  it('identificar al remitente sigue siendo UNA lectura de workspaces (+ la RPC): el interruptor va en ella', async () => {
    const llamadas: string[] = [];
    let columnas = '';
    const sb = {
      rpc: async (n: string) => { llamadas.push(`rpc:${n}`); return { data: [{ workspace_id: WS, full_name: 'X', es_principal: true, user_id: 'u' }], error: null }; },
      from: (t: string) => {
        llamadas.push(`from:${t}`);
        const q = { select: (c: string) => { columnas = c; return q; }, eq: () => q, single: async () => ({ data: { subscription_status: 'trial', modules: {}, bot_conversacional: null }, error: null }) };
        return q;
      },
    };
    const u = await identificarRemitente(sb, '573000000001');
    expect(llamadas).toEqual(['rpc:wa_identify_user', 'from:workspaces']);
    expect(columnas).toBe('subscription_status, modules, bot_conversacional:config_extra->bot_conversacional, aviso_datos_bot:config_extra->aviso_datos_bot');
    // Nulo (la llave no existe en `config_extra`): apagado.
    expect(interruptorDe(u!, () => undefined).activo).toBe(false);
  });

  it('cableado: el bloque 1a-int va tras identificar y antes de la bandeja, y processMessage no lee config_extra', () => {
    const fuente = readFileSync('supabase/functions/wa-webhook/index.ts', 'utf8');
    const inicio = fuente.indexOf('async function processMessage(');
    const pm = fuente.slice(inicio, fuente.indexOf('\n}\n', inicio));
    const bloque = pm.indexOf('if ((await atenderEscrito(supabase, user, message)).atendido) return;');
    expect(bloque).toBeGreaterThan(pm.indexOf('atenderDesconocido('));
    expect(bloque).toBeLessThan(pm.indexOf('rutaDelMensaje('));
    expect(pm.split('atenderEscrito(').length - 1).toBe(1);
    // Sin comentarios: el código de processMessage no lee `config_extra` (el interruptor llega con el remitente).
    expect(pm.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')).not.toContain('config_extra');
    // En `atenderEscrito`, lo primero es el interruptor: nada se espera (ni base ni red) antes de él.
    const io = readFileSync('supabase/functions/_shared/wa-interprete.ts', 'utf8');
    const ae = io.slice(io.indexOf('export async function atenderEscrito('));
    expect(ae.indexOf('interruptorDe(')).toBeLessThan(ae.indexOf('await '));
    expect(ae.indexOf('if (!cfg.activo || !esEscrito(message)) return NO;')).toBeLessThan(ae.indexOf('await '));
  });
});

// ── Fallback ────────────────────────────────────────────────────────────────

describe('fallback: el mensaje sigue por el camino de hoy y la telemetría marca fallback_*', () => {
  const pedido = { modelo: 'gemini-2.5-flash', sistema: 's', usuario: 'u', generationConfig: {}, timeoutMs: 4000 };
  const env = (k: string) => (k === 'GEMINI_API_KEY' ? 'k' : undefined);

  it('llamarGemini: timeout, HTTP 500, JSON inválido y un corte que no es STOP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }));
    expect(await llamarGemini(pedido, env)).toMatchObject({ ok: false, motivo: 'timeout' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    expect(await llamarGemini(pedido, env)).toMatchObject({ ok: false, motivo: 'http' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"acciones": [' }] } }] }), { status: 200 })));
    expect(await llamarGemini(pedido, env)).toMatchObject({ ok: false, motivo: 'esquema' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] }), { status: 200 })));
    expect(await llamarGemini(pedido, env)).toMatchObject({ ok: false, motivo: 'esquema' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"acciones":[]}' }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 } }), { status: 200 })));
    expect(await llamarGemini(pedido, env)).toMatchObject({ ok: true, json: { acciones: [] }, tokensIn: 9, tokensOut: 3 });
  });

  it('la llave va en la cabecera, nunca en la URL; el razonamiento y el tiempo máximo viajan', async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', f);
    await llamarGemini({ ...pedido, generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }, env);
    const [url, init] = f.mock.calls[0];
    expect(url).not.toContain('key=');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(JSON.parse(String(init.body)).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  for (const [nombre, r] of [
    ['timeout', { ok: false, motivo: 'timeout', ms: 4000 }],
    ['http', { ok: false, motivo: 'http', ms: 120, detalle: 'HTTP 500' }],
    ['esquema', { ok: false, motivo: 'esquema', ms: 900, detalle: 'JSON inválido' }],
  ] as const) {
    it(`atenderEscrito con ${nombre}: atendido false, nada se despacha y queda fallback_${nombre}`, async () => {
      const db = baseFalsa();
      const res = await atenderEscrito(db, usuario(), escrito('pagué 20 mil de taxi'), { llamarModelo: async () => r as RespuestaModelo, env: () => undefined });
      expect(res).toEqual({ atendido: false });
      const log = db.escrituras();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ tabla: 'wa_message_log', op: 'insert', payload: { interprete_resultado: `fallback_${nombre}`, parser_source: 'interprete', interprete_accion: 'bot.fallback' } });
      expect(espias.handleGasto).not.toHaveBeenCalled();
      expect(enviados).toEqual([]);
    });
  }

  it('esquema roto (acción fuera del enum): atendido false y fallback_esquema con el rechazo V0', async () => {
    const db = baseFalsa();
    const res = await atenderEscrito(db, usuario(), escrito('pagué 20 mil de taxi'), deps({ acciones: [{ accion: 'borrar_todo', evidencia: 'pagué' }] }));
    expect(res).toEqual({ atendido: false });
    expect(db.escrituras()[0]).toMatchObject({ payload: { interprete_resultado: 'fallback_esquema', interprete_rechazo: 'V0_esquema' } });
  });

  it('el tope de llamados por hora deja el mensaje al código de hoy sin llamar al modelo', async () => {
    const db = baseFalsa({ wa_message_log: Array.from({ length: 120 }, () => ({})) });
    const llamar = vi.fn();
    expect(await atenderEscrito(db, usuario(), escrito('pagué 20 mil de taxi'), { llamarModelo: llamar, env: () => undefined })).toEqual({ atendido: false });
    expect(llamar).not.toHaveBeenCalled();
  });
});

// ── Despacho: cada acción a la función que ya existe, con su entrada canónica ──

/** Ninguna escritura fuera de lo permitido: la telemetría, la interpretación y el registro de la bandeja. */
function sinEscriturasNuevas(db: ReturnType<typeof baseFalsa>) {
  for (const o of db.escrituras()) {
    expect(['wa_message_log', 'wa_bandeja_mensajes', 'wa_bandeja_registrar_mensaje']).toContain(o.tabla);
    if (o.tabla === 'wa_bandeja_mensajes') expect(Object.keys(o.payload as Fila)).toEqual(['interpretacion']);
  }
}

describe('despacho en el bot', () => {
  const conSesion = (s: BotSession) => {
    espias.getOrCreateSession.mockResolvedValue(s);
    return baseFalsa({ bot_sessions: [{ id: s.id, state: s.state, context: s.context, expires_at: s.expires_at }] });
  };

  it('confirmar en la confirmación del gasto → btn_confirm a la sesión de hoy («ahora sí, guárdalo»)', async () => {
    const db = conSesion(sesionBot('confirming'));
    const r = await atenderEscrito(db, usuario(), escrito('ahora sí, guárdalo'), deps({ acciones: [{ accion: 'confirmar', evidencia: 'ahora sí, guárdalo' }] }));
    expect(r).toEqual({ atendido: true });
    expect(espias.handleRegistro).toHaveBeenCalledTimes(1);
    const ctx = espias.handleRegistro.mock.calls[0][0] as { message: IncomingMessage };
    expect(ctx.message.interactive_reply).toBe('btn_confirm');
    expect(ctx.message.text).toBe('ahora sí, guárdalo');
    sinEscriturasNuevas(db);
    expect(db.escrituras().at(-1)).toMatchObject({ tabla: 'wa_message_log', payload: { interprete_accion: 'bot.confirmar', interprete_resultado: 'atendido', interprete_rechazo: null, gemini_input_tokens: 900 } });
  });

  it('cancelar → btn_cancel; soporte «no me dieron factura» → btn_sin_soporte; un monto pendiente es atajo del código de hoy', async () => {
    let db = conSesion(sesionBot('confirming'));
    await atenderEscrito(db, usuario(), escrito('no, déjalo, ese no era'), deps({ acciones: [{ accion: 'cancelar', evidencia: 'no, déjalo, ese no era' }] }));
    expect((espias.handleRegistro.mock.calls.at(-1)![0] as { message: IncomingMessage }).message.interactive_reply).toBe('btn_cancel');
    db = conSesion(sesionBot('awaiting_image'));
    await atenderEscrito(db, usuario(), escrito('no me dieron factura'), deps({ acciones: [{ accion: 'responder', evidencia: 'no me dieron factura', opcion: 'no_tengo' }] }));
    expect((espias.handleRegistro.mock.calls.at(-1)![0] as { message: IncomingMessage }).message.interactive_reply).toBe('btn_sin_soporte');
    db = conSesion(sesionBot('collecting'));
    const llamar = vi.fn();
    expect(await atenderEscrito(db, usuario(), escrito('fueron 85 mil'), { llamarModelo: llamar, env: () => undefined })).toEqual({ atendido: false });
    expect(llamar).not.toHaveBeenCalled();
  });

  it('corregir el monto y la descripción → reconfirmarGasto con los campos corregidos', async () => {
    let db = conSesion(sesionBot('confirming', { amount: 18900, parsed_fields: { amount: 18900, descripcion: 'peaje', concept: 'peaje' } }));
    await atenderEscrito(db, usuario(), escrito('no, son 19.800'), deps({ acciones: [{ accion: 'corregir_gasto', evidencia: 'son 19.800', campo: 'monto', valor: '19800' }] }));
    expect(espias.updateSession).toHaveBeenCalledWith(db, 'ses-1', 'confirming', expect.objectContaining({ amount: 19800 }));
    expect(espias.reconfirmarGasto.mock.calls.at(-1)![1]).toMatchObject({ amount: 19800, descripcion: 'peaje' });
    db = conSesion(sesionBot('confirming', { amount: 18900, parsed_fields: { amount: 18900, concept: 'otros', category_hint: 'otros' } }));
    await atenderEscrito(db, usuario(), escrito('Peaje autopista norte'), deps({ acciones: [{ accion: 'gasto', evidencia: 'Peaje autopista norte', descripcion: 'Peaje autopista norte' }] }));
    const f = espias.reconfirmarGasto.mock.calls.at(-1)![1] as Fila;
    expect(f).toMatchObject({ descripcion: 'Peaje autopista norte', amount: 18900 });
    expect(f.concept).toBeUndefined();
    sinEscriturasNuevas(db);
  });

  it('un gasto nuevo → handleGasto con confianza 0 (nunca se registra sin el sí) y el código del negocio', async () => {
    espias.getOrCreateSession.mockResolvedValue(sesionBot('started', { pending_action: undefined }));
    const db = baseFalsa({ negocios: [{ id: 'neg-a1', codigo: 'C1 26 1', nombre: 'Consorcio Arena Ingeniería · chiller torre B' }] });
    await atenderEscrito(db, usuario(), escrito('pagué 18.900 de peaje yendo a la obra de Arena'), deps({ acciones: [{ accion: 'gasto', evidencia: 'pagué 18.900 de peaje yendo a la obra de Arena', monto: 18900, negocio: 'Arena', descripcion: 'peaje' }] }));
    const ctx = espias.handleGasto.mock.calls[0][0] as { parsed: { confidence: number; fields: Fila } };
    expect(ctx.parsed.confidence).toBe(0);
    expect(ctx.parsed.fields).toMatchObject({ amount: 18900, descripcion: 'peaje', project_code: 'C1 26 1' });
    sinEscriturasNuevas(db);
  });

  it('varios gastos: se confirma el primero y los demás quedan en la cola de la sesión, uno a la vez', async () => {
    const s = sesionBot('started', { pending_action: undefined });
    espias.getOrCreateSession.mockResolvedValue(s);
    const db = baseFalsa({ negocios: [{ id: 'neg-a1', codigo: 'C1 26 1', nombre: 'Consorcio Arena Ingeniería' }] });
    const texto = 'almuerzo 25 mil, gasolina 90 mil y peaje 18.900, todo de Arena';
    await atenderEscrito(db, usuario(), escrito(texto), deps({ acciones: [
      { accion: 'gasto', evidencia: 'almuerzo 25 mil', monto: 25000, negocio: 'Arena' },
      { accion: 'gasto', evidencia: 'gasolina 90 mil', monto: 90000 },
      { accion: 'gasto', evidencia: 'peaje 18.900', monto: 18900 },
    ] }));
    expect(espias.handleGasto).toHaveBeenCalledTimes(1);
    expect((espias.handleGasto.mock.calls[0][0] as { parsed: { fields: Fila } }).parsed.fields).toMatchObject({ amount: 25000, project_code: 'C1 26 1' });
    const cola = espias.updateSession.mock.calls.find(c => (c[3] as Fila)?.gastos_en_cola)![3] as { gastos_en_cola: Array<Fila>; gastos_total: number };
    expect(cola.gastos_total).toBe(3);
    expect(cola.gastos_en_cola.map(g => g.monto)).toEqual([90000, 18900]);
    expect(enviados).toContain('Gasto 1 de 3: te pido el sí de cada uno, uno a la vez.');
  });

  it('una consulta → handleConsulta con el intent de hoy; con un gasto a medias no pisa la sesión y la recuerda', async () => {
    const db = conSesion(sesionBot('confirming'));
    await atenderEscrito(db, usuario(), escrito('cuánto llevamos gastado en lo de Torre 80?'), deps({ acciones: [{ accion: 'consulta', evidencia: 'cuánto llevamos gastado', tema: 'gastos' }] }));
    const ctx = espias.handleConsulta.mock.calls[0][0] as { parsed: { intent: string }; session: BotSession };
    expect(ctx.parsed.intent).toBe('MIS_NUMEROS');
    expect(ctx.session.id).toBe('interprete-sin-sesion');
    // El borrador del gasto que se está confirmando, como lo vio el usuario.
    expect(enviados.at(-1)).toMatch(/^Sigue pendiente: Gasto .* ¿Lo confirmo\?/);
  });

  it('el saludo → handleAyuda; un acuse no contesta nada', async () => {
    espias.getOrCreateSession.mockResolvedValue(sesionBot('started', { pending_action: undefined }));
    await atenderEscrito(baseFalsa(), usuario(), escrito('buenas buenas'), deps({ acciones: [{ accion: 'saludo', evidencia: 'buenas' }] }));
    expect(espias.handleAyuda).toHaveBeenCalledTimes(1);
    enviados.length = 0;
    expect(await atenderEscrito(baseFalsa(), usuario(), escrito('jajaja sí señora'), deps({ acciones: [{ accion: 'acuse', evidencia: 'jajaja sí señora' }] }))).toEqual({ atendido: true });
    expect(enviados).toEqual([]);
  });

  it('las puertas de hoy: sin Clarity, sin plan o con el tope de 30 por hora, no llega al handler', async () => {
    espias.getOrCreateSession.mockResolvedValue(sesionBot('started', { pending_action: undefined }));
    await atenderEscrito(baseFalsa(), usuario({ subscription_status: 'free' }), escrito('cómo vamos este mes'), deps({ acciones: [{ accion: 'consulta', evidencia: 'cómo vamos', tema: 'numeros' }] }));
    expect(enviados.at(-1)).toBe('El bot de WhatsApp está disponible en el plan Pro+. Puedes activarlo desde la app cuando quieras.');
    espias.checkInboundLimit.mockResolvedValue(false);
    await atenderEscrito(baseFalsa(), usuario(), escrito('cómo vamos este mes'), deps({ acciones: [{ accion: 'consulta', evidencia: 'cómo vamos', tema: 'numeros' }] }));
    expect(enviados.at(-1)).toBe('Vas muy rápido, dame un momento. Espera unos minutos y volvemos.');
    expect(espias.handleConsulta).not.toHaveBeenCalled();
  });

  it('control de Vera · un operador que pregunta (sin consulta en su esquema) y un contador que pide registrar: el texto de su rol', async () => {
    await atenderEscrito(baseFalsa(), usuario({ role: 'operator' }), escrito('¿cuánto llevamos gastado este mes?'), deps({ acciones: [{ accion: 'gasto', evidencia: 'cuánto llevamos gastado' }] }));
    expect(enviados).toEqual(['Con tu rol solo puedes registrar gastos y actividades de tus negocios.']);
    expect(espias.handleGasto).not.toHaveBeenCalled();
    enviados.length = 0;
    await atenderEscrito(baseFalsa(), usuario({ role: 'contador' }), escrito('registra un gasto de 50 mil'), deps({ acciones: [{ accion: 'acuse', evidencia: 'registra un gasto de 50 mil' }] }));
    expect(enviados).toEqual(['Tu rol es de consulta. Para registrar movimientos pídele apoyo a tu admin.']);
  });

  it('control de Vera 2 · O2: un supervisor que pregunta por la plata de un negocio no abre un gasto; K3: un contador que pide anotar recibe su texto', async () => {
    await atenderEscrito(baseFalsa(), usuario({ role: 'supervisor' }), escrito('¿cómo va la plata de Arena?'), deps({ acciones: [{ accion: 'gasto', evidencia: 'cómo va la plata de Arena', negocio: 'Arena' }] }));
    expect(enviados).toEqual(['Con tu rol solo puedes registrar gastos y actividades de tus negocios.']);
    expect(espias.handleGasto).not.toHaveBeenCalled();
    enviados.length = 0;
    await atenderEscrito(baseFalsa(), usuario({ role: 'contador' }), escrito('anota que Arena ya giró la segunda cuota'), deps({ acciones: [{ accion: 'pedir_aclaracion', evidencia: 'anota' }] }));
    expect(enviados).toEqual(['Tu rol es de consulta. Para registrar movimientos pídele apoyo a tu admin.']);
  });

  it('un rol restringido recibe el texto de su rol y nada se ejecuta', async () => {
    await atenderEscrito(baseFalsa(), usuario({ role: 'contador' }), escrito('pagué 20 mil de taxi'), deps({ acciones: [{ accion: 'gasto', evidencia: 'pagué 20 mil de taxi', monto: 20000 }] }));
    expect(enviados).toEqual(['Tu rol es de consulta. Para registrar movimientos pídele apoyo a tu admin.']);
    expect(espias.handleGasto).not.toHaveBeenCalled();
  });
});

describe('despacho en la bandeja', () => {
  const BANDEJA = { business: true, clarity: true, bandeja_solicitudes_wa: true };
  const V = [
    { id: 'v9', codigo: 'T1 26 9', cliente: 'LUISA MEJÍA', destino: 'SAN ANDRÉS' },
    { id: 'v11', codigo: 'T1 26 11', cliente: 'CAROLINA RUIZ', destino: 'PUNTA CANA' },
    { id: 'v12', codigo: 'T1 26 12', cliente: 'JORGE PÉREZ', destino: 'MADRID' },
    { id: 'v14', codigo: 'T1 26 14', cliente: 'LINA PÉREZ', destino: 'CARTAGENA' },
  ];
  beforeEach(() => {
    espias.candidatosDeEncabezado.mockResolvedValue({ viajes: V, equipo: [] });
    espias.getOrCreateSession.mockResolvedValue(sesionBot('started', { pending_action: undefined }));
  });
  const u = () => usuario({ modules: BANDEJA, role: 'operator', collaborator_id: 'col-1' });

  it('«lo de Cartagena» → se registra el crudo completo, se guarda la interpretación y se muestra con 📌', async () => {
    const db = baseFalsa({}, { wa_bandeja_registrar_mensaje: [{ accion: 'abrir', entrega: 'e1', mensajes: 1 }] });
    const m = escrito('lo de Cartagena');
    // n4 es el alias de Lina Pérez en el contexto (n1…n4 en el orden de los viajes).
    expect(await atenderEscrito(db, u(), m, deps({ acciones: [{ accion: 'abrir_viaje', evidencia: 'lo de Cartagena', ref: { destino: 'Cartagena' } }] }))).toEqual({ atendido: true });
    const rpc = db.ops.find(o => o.op === 'rpc')!;
    expect(rpc.payload).toMatchObject({ p_cuerpo: 'lo de Cartagena', p_wa_message_id: m.wa_message_id, p_es_cierre: false, p_puede_ser_respuesta: false, p_remitente_colaborador_id: 'col-1' });
    const upd = db.ops.find(o => o.tabla === 'wa_bandeja_mensajes' && o.op === 'update')!;
    expect(upd.payload).toEqual({ interpretacion: { accion: 'abrir_viaje', viaje_id: 'v14', con_contenido: false, evidencia: 'lo de Cartagena', modelo: 'gemini-2.5-flash' } });
    expect(upd.filtros).toContain(`eq:"wa_message_id",${JSON.stringify(m.wa_message_id)}`);
    expect(enviados).toEqual(['📌 Lina Pérez (T1 26 14)']);
    sinEscriturasNuevas(db);
  });

  it('control de Vera · E1: el equipo del workspace llega al validador; la firma no abre el viaje de la clienta homónima', async () => {
    espias.candidatosDeEncabezado.mockResolvedValue({ viajes: [...V, { id: 'v20', codigo: 'T1 26 20', cliente: 'TATIANA SALAZAR', destino: 'MEDELLÍN' }], equipo: ['Tatiana Quiroga'] });
    const db = baseFalsa({}, { wa_bandeja_registrar_mensaje: [{ accion: 'abrir', entrega: 'e1', mensajes: 1 }] });
    const m = escrito('Tatiana: lo de Cartagena, quieren hotel con piscina');
    expect(await atenderEscrito(db, u(), m, deps({ acciones: [
      { accion: 'abrir_viaje', evidencia: 'Tatiana', ref: { cliente: 'Tatiana' } },
      { accion: 'contenido', evidencia: 'lo de Cartagena, quieren hotel con piscina', ref: { destino: 'Cartagena' } },
    ] }))).toEqual({ atendido: true });
    const upd = db.ops.find(o => o.tabla === 'wa_bandeja_mensajes' && o.op === 'update')!;
    expect(upd.payload).toMatchObject({ interpretacion: { accion: 'abrir_viaje', viaje_id: 'v14', con_contenido: true } });
    expect(enviados).toEqual(['📌 Lina Pérez (T1 26 14) · anotado']);
    sinEscriturasNuevas(db);
  });

  it('control de Vera 3 · PA3: «la tía de <clienta abierta>» abre la caja «Cliente nuevo» (se crea solo con el «sí» al resumen) y el acuse dice el viaje parecido', async () => {
    const db = baseFalsa({}, { wa_bandeja_registrar_mensaje: [{ accion: 'abrir', entrega: 'e1', mensajes: 1 }] });
    const m = escrito('nueva, la tía de Carolina Ruiz también viaja');
    expect(await atenderEscrito(db, u(), m, deps({ acciones: [{ accion: 'abrir_viaje', evidencia: 'nueva, la tía de Carolina Ruiz', nuevo_cliente: 'tía de Carolina Ruiz' }] }))).toEqual({ atendido: true });
    const upd = db.ops.find(o => o.tabla === 'wa_bandeja_mensajes' && o.op === 'update')!;
    expect(upd.payload).toMatchObject({ interpretacion: { accion: 'abrir_viaje', nuevo: 'tía de Carolina Ruiz' } });
    expect(enviados).toEqual(['📌 Cliente nuevo: tía de Carolina Ruiz. Lo creo solo cuando respondas SÍ al resumen.\nYa hay un viaje de Carolina Ruiz (T1 26 11). Si es para ese, escribe T1 26 11.']);
    // Nada se crea en el acto: ni contacto ni negocio.
    sinEscriturasNuevas(db);
  });

  it('control de Vera 2 · E7: el texto nombra dos viajes abiertos y el modelo eligió uno: se pregunta con los dos', async () => {
    const db = baseFalsa({}, { wa_bandeja_registrar_mensaje: [{ accion: 'abrir', entrega: 'e1', mensajes: 1 }] });
    const m = escrito('Lina Pérez ya no quiere Cartagena, ahora quiere Madrid');
    await atenderEscrito(db, u(), m, deps({ acciones: [{ accion: 'contenido', evidencia: 'ahora quiere Madrid', ref: { destino: 'Madrid' } }] }));
    const upd = db.ops.find(o => o.tabla === 'wa_bandeja_mensajes' && o.op === 'update')!;
    expect(upd.payload).toMatchObject({ interpretacion: { accion: 'preguntar_viaje', con_contenido: true } });
    expect([...(upd.payload as { interpretacion: { candidatos: string[] } }).interpretacion.candidatos].sort()).toEqual(['v12', 'v14']);
    expect(db.escrituras().find(o => o.tabla === 'wa_message_log')!.payload).toMatchObject({ interprete_rechazo: 'V5_dos_viajes_en_el_texto' });
    sinEscriturasNuevas(db);
  });

  it('la respuesta a «¿A qué viaje van?» con palabras → responderPendiente con el código, guardando el crudo', async () => {
    espias.preguntaAbierta.mockResolvedValue({ tipo: 'entrega', id: 'e9', nombre: 'Tanda de las 09:28', corta: '¿A qué viaje van?', espera: 'viaje' });
    const db = baseFalsa({ wa_bandeja_entregas: [{ negocio_opciones: [V[0], V[1]], pregunta_enviada_at: new Date().toISOString() }] });
    await atenderEscrito(db, u(), escrito('son de Carolina'), deps({ acciones: [{ accion: 'responder', evidencia: 'son de Carolina', ref: { cliente: 'Carolina' } }] }));
    expect(espias.responderPendiente).toHaveBeenCalledTimes(1);
    const a = espias.responderPendiente.mock.calls[0] as unknown[];
    expect(a[3]).toBe('T1 26 11'); // la entrada canónica
    expect(a[8]).toBe('son de Carolina'); // el crudo
    expect(db.ops.find(o => o.tabla === 'wa_bandeja_mensajes' && o.op === 'update')!.payload).toMatchObject({ interpretacion: { accion: 'responder', viaje_id: 'v11', canonico: 'T1 26 11' } });
    sinEscriturasNuevas(db);
  });

  it('H2 · «a ninguno, bótalos» con la lista y una tanda abierta → DESCARTAR a la pregunta, la tanda sigue', async () => {
    espias.preguntaAbierta.mockResolvedValue({ tipo: 'entrega', id: 'e9', nombre: 'Tanda de las 09:28', corta: '¿A qué viaje van?', espera: 'viaje' });
    espias.tandaAbiertaDelRemitente.mockResolvedValue({ id: 't1', creadaAt: new Date().toISOString(), nombre: 'Carolina Ruiz', n: 2, cajaViajeId: 'v11' });
    const db = baseFalsa({ wa_bandeja_entregas: [{ negocio_opciones: [V[0], V[1]] }] });
    await atenderEscrito(db, u(), escrito('a ninguno, bótalos'), deps({ acciones: [{ accion: 'responder', evidencia: 'a ninguno, bótalos', opcion: 'descartar' }] }));
    expect((espias.responderPendiente.mock.calls[0] as unknown[])[3]).toBe('DESCARTAR');
    expect(espias.descartarTodo).not.toHaveBeenCalled();
    expect(espias.descartarTandaAbierta).not.toHaveBeenCalled();
    expect(enviados).toEqual(['Descarté los mensajes de esa pregunta. La tanda de Carolina Ruiz sigue abierta.']);
  });

  it('«bórralo» sin pregunta y con tanda → solo la tanda (descartarTandaAbierta), nunca todo', async () => {
    espias.tandaAbiertaDelRemitente.mockResolvedValue({ id: 't1', creadaAt: new Date().toISOString(), nombre: 'Carolina Ruiz', n: 2, cajaViajeId: 'v11' });
    await atenderEscrito(baseFalsa(), u(), escrito('uy no, eso lo mandé por error, bórralo'), deps({ acciones: [{ accion: 'descartar', evidencia: 'eso lo mandé por error, bórralo', alcance: 'todo' }] }));
    expect(espias.descartarTandaAbierta).toHaveBeenCalledTimes(1);
    expect(espias.descartarTodo).not.toHaveBeenCalled();
    expect(enviados).toEqual(['Descarté lo pendiente de Carolina Ruiz (2 mensajes). No creé ni cargué nada.']);
  });

  it('una nota interna no se guarda en la bandeja y la bitácora no lleva su texto', async () => {
    const db = baseFalsa();
    await atenderEscrito(db, u(), escrito('ojo que esta señora es súper regatera'), deps({ acciones: [{ accion: 'nota_interna', evidencia: 'esta señora es súper regatera' }] }));
    expect(db.ops.some(o => o.op === 'rpc')).toBe(false);
    expect(enviados).toEqual(['No lo guardo: en la historia solo va lo que pide el cliente.']);
    const log = db.escrituras().find(o => o.tabla === 'wa_message_log')!;
    expect(log.payload).toMatchObject({ message_preview: PREVIEW_NOTA_INTERNA, interprete_accion: 'bandeja.nota_interna', interprete_propuesta: { acciones: [{ accion: 'nota_interna' }] } });
    expect(JSON.stringify(log.payload)).not.toContain('regatera');
  });

  it('«eso es todo de él» → cierra la tanda como la palabra de cierre y pregunta con el resumen de hoy', async () => {
    const db = baseFalsa({}, { wa_bandeja_registrar_mensaje: [{ accion: 'cerrar', entrega: 'e1', mensajes: 3 }] });
    await atenderEscrito(db, u(), escrito('eso es todo de él'), deps({ acciones: [{ accion: 'cerrar_tanda', evidencia: 'eso es todo de él' }] }));
    expect(db.ops.find(o => o.op === 'rpc')!.payload).toMatchObject({ p_es_cierre: true, p_cuerpo: 'eso es todo de él' });
    expect(espias.preguntarCliente).toHaveBeenCalledWith(db, 'e1', '573000000001', 3, WS, { porPalabra: true });
  });

  it('con prefijo «gasto» el ámbito es el del bot: una acción de la bandeja se quita (V2)', async () => {
    const db = baseFalsa();
    await atenderEscrito(db, u(), escrito('gasto lo de Cartagena'), deps({ acciones: [{ accion: 'abrir_viaje', evidencia: 'lo de Cartagena', ref: { destino: 'Cartagena' } }] }));
    expect(db.ops.some(o => o.op === 'rpc')).toBe(false);
    expect(db.escrituras().find(o => o.tabla === 'wa_message_log')!.payload).toMatchObject({ interprete_rechazo: 'V2_ambito' });
  });

  it('si el modelo pide aclaración ante un encabezado ambiguo («Pérez»), lo atiende el código de hoy con su lista', async () => {
    const db = baseFalsa();
    expect(await atenderEscrito(db, u(), escrito('Pérez'), deps({ acciones: [{ accion: 'pedir_aclaracion', evidencia: 'Pérez' }] }))).toEqual({ atendido: false });
    expect(db.escrituras()).toHaveLength(1);
    expect(db.escrituras()[0].payload).toMatchObject({ interprete_resultado: 'fallback_encabezado', interprete_accion: 'bandeja.fallback' });
    expect(enviados).toEqual([]);
  });

  it('un atajo exacto (un código, «descartar», «listo») no llama al modelo', async () => {
    for (const t of ['T1 26 9', 'descartar', 'listo', 'ayuda']) {
      const llamar = vi.fn();
      expect(await atenderEscrito(baseFalsa(), u(), escrito(t), { llamarModelo: llamar, env: () => undefined })).toEqual({ atendido: false });
      expect(llamar).not.toHaveBeenCalled();
    }
  });
});

// ── Cuarto control de Vera (2026-10-03): el razonamiento de 3.x, en la telemetría ──

describe('tokens de razonamiento (thoughtsTokenCount) y el modelo fuera de la lista', () => {
  const pedido = { modelo: 'gemini-3.8-flash', sistema: 's', usuario: 'u', generationConfig: {}, timeoutMs: 4000 };
  const env = (k: string) => (k === 'GEMINI_API_KEY' ? 'k' : undefined);
  const resp = (cuerpo: unknown) => vi.fn(async () => new Response(JSON.stringify(cuerpo), { status: 200 }));

  it('llamarGemini devuelve el razonamiento; 0 si el modelo no pensó; y lee la respuesta aunque venga una parte de razonamiento', async () => {
    vi.stubGlobal('fetch', resp({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'pensando…', thought: true }, { text: '{"acciones":[]}' }] } }], usageMetadata: { promptTokenCount: 1400, candidatesTokenCount: 60, thoughtsTokenCount: 233 } }));
    expect(await llamarGemini(pedido, env)).toMatchObject({ ok: true, json: { acciones: [] }, tokensIn: 1400, tokensOut: 60, tokensRazonamiento: 233 });
    vi.stubGlobal('fetch', resp({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"acciones":[]}' }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 } }));
    expect(await llamarGemini(pedido, env)).toMatchObject({ ok: true, tokensRazonamiento: 0 });
  });

  it('un corte por MAX_TOKENS es fallback pero conserva lo que se cobró (el razonamiento quemado)', async () => {
    vi.stubGlobal('fetch', resp({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }], usageMetadata: { promptTokenCount: 1500, thoughtsTokenCount: 489 } }));
    const r = await llamarGemini(pedido, env);
    expect(r).toMatchObject({ ok: false, motivo: 'esquema', detalle: 'finishReason MAX_TOKENS', uso: { tokensIn: 1500, tokensOut: null, tokensRazonamiento: 489 } });
    expect(usoParaTelemetria(r)).toEqual({ tokensIn: 1500, tokensOut: null, tokensRazonamiento: 489 });
    expect(usoParaTelemetria({ ok: false, motivo: 'timeout', ms: 4000 })).toEqual({ tokensIn: null, tokensOut: null, tokensRazonamiento: null });
  });

  it('la telemetría guarda entrada, salida y razonamiento, también en un fallback que cobró', async () => {
    const db = baseFalsa();
    const r: RespuestaModelo = { ok: false, motivo: 'esquema', ms: 2100, detalle: 'finishReason MAX_TOKENS', uso: { tokensIn: 1500, tokensOut: null, tokensRazonamiento: 489 } };
    await atenderEscrito(db, usuario(), escrito('pagué 20 mil de taxi'), { llamarModelo: async () => r, env: () => undefined });
    expect(db.escrituras()[0]).toMatchObject({ tabla: 'wa_message_log', payload: { gemini_input_tokens: 1500, gemini_output_tokens: null, gemini_thoughts_tokens: 489, interprete_resultado: 'fallback_esquema' } });
    const db2 = baseFalsa();
    await atenderEscrito(db2, usuario(), escrito('pagué 20 mil de taxi'), { llamarModelo: async () => ({ ok: true, json: { acciones: [{ accion: 'acuse', evidencia: 'pagué' }] }, tokensIn: 900, tokensOut: 60, tokensRazonamiento: 120, ms: 800 }), env: () => undefined });
    expect(db2.escrituras().find(o => o.tabla === 'wa_message_log')).toMatchObject({ payload: { gemini_input_tokens: 900, gemini_output_tokens: 60, gemini_thoughts_tokens: 120 } });
  });

  it('sin la columna (migración sin aplicar) la fila igual queda, sin el razonamiento: el tope por hora depende de ella', async () => {
    const db = baseFalsa();
    const from0 = db.from;
    const db2 = {
      ...db,
      from: (t: string) => {
        const q = from0(t);
        const insert = q.insert as (p: unknown) => unknown;
        q.insert = (p: Record<string, unknown>) => {
          insert(p);
          if (t === 'wa_message_log' && 'gemini_thoughts_tokens' in p) {
            q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'gemini_thoughts_tokens' column of 'wa_message_log' in the schema cache" } }).then(res);
          }
          return q;
        };
        return q;
      },
    };
    await atenderEscrito(db2, usuario(), escrito('pagué 20 mil de taxi'), { llamarModelo: async () => ({ ok: false, motivo: 'timeout', ms: 4000 }), env: () => undefined });
    const logs = db.escrituras().filter(o => o.tabla === 'wa_message_log');
    expect(logs).toHaveLength(2);
    expect(logs[1].payload).not.toHaveProperty('gemini_thoughts_tokens');
    expect(logs[1].payload).toMatchObject({ parser_source: 'interprete', interprete_resultado: 'fallback_timeout' });
  });

  it('un modelo que no está permitido corre el de por defecto y queda en el log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(interruptorDe(usuario({ bot: { activo: true, modelo: 'gemini-3.9-flash' } }), () => undefined).modelo).toBe('gemini-2.5-flash');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('«gemini-3.9-flash»'));
    warn.mockClear();
    expect(interruptorDe(usuario({ bot: { activo: true, modelo: 'gemini-3.8-flash' } }), () => undefined).modelo).toBe('gemini-3.8-flash');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
