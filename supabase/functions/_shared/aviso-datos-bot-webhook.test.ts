import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * El webhook REAL (`wa-webhook/index.ts`, entero) con la puerta del aviso de datos encendida:
 * antes de aceptar, ningun camino llama a Gemini ni descarga media de Meta. Control de Vera
 * (2026-10-05, punto 5): wa-parse, transcripcion de audio, bandeja, interprete e imagenes de gasto.
 *
 * Como se corre en node: `Deno.serve` se reemplaza para capturar el handler, `EdgeRuntime.waitUntil`
 * para esperar el trabajo en segundo plano, la base es un doble en memoria permisivo (aplica los
 * filtros que la puerta usa; lo demas devuelve vacio y queda anotado), y la red es un espia de
 * `fetch`. Toda llamada a Gemini sale por `fetch` a generativelanguage.googleapis.com, y toda
 * descarga de audio o imagen por `wa-media.ts`: los dos se cuentan.
 *
 * Para que la prueba no pase en vacio, cada camino se corre primero con el aviso APAGADO y se
 * comprueba que ahi SI llega a Gemini, a la media o a la bandeja. Datos sinteticos.
 */

// ── Lo que se cuenta ────────────────────────────────────────────────────────

const gemini: string[] = [];
const media: string[] = [];
const escrituras: string[] = []; // `tabla:op` y `rpc:nombre` fuera de la puerta
const envios: Array<{ phone: string; tipo: string; texto: string }> = [];

vi.mock('./supabase-client.ts', () => ({ getServiceClient: () => db }));
vi.mock('./wa-media.ts', () => ({
  getMediaUrl: vi.fn(async (id: string) => { media.push(`url:${id}`); return null; }),
  downloadMediaBinary: vi.fn(async () => { media.push('bajar'); return null; }),
  downloadAndStoreImage: vi.fn(async (_s: unknown, id: string) => { media.push(`imagen:${id}`); return null; }),
}));
vi.mock('./wa-respond.ts', async (original) => {
  const real = await original<typeof import('./wa-respond')>();
  let n = 0;
  const anotar = (tipo: string) => vi.fn(async (phone: string, texto?: unknown) => {
    envios.push({ phone, tipo, texto: typeof texto === 'string' ? texto : '' });
    return `wamid.out${++n}`;
  });
  return {
    ...real,
    sendTextMessage: anotar('texto'),
    sendTextMessageABsuid: anotar('texto'),
    sendTextoExacto: anotar('texto'),
    sendNumberedMenu: anotar('texto'),
    sendButtons: anotar('botones'),
    sendDocument: vi.fn(async (phone: string) => { envios.push({ phone, tipo: 'documento', texto: '' }); return `wamid.out${++n}`; }),
    sendCtaUrl: anotar('cta'),
    sendFlow: anotar('flow'),
    sendTemplate: anotar('plantilla'),
    sendTextWithRhythm: anotar('texto'),
    sendContact: anotar('contacto'),
    sendLocationRequest: anotar('ubicacion'),
    markAsRead: vi.fn(async () => {}),
    sendTypingIndicator: vi.fn(async () => {}),
  };
});
vi.mock('./wa-alerta.ts', () => ({ enviarAvisoInterno: vi.fn(async () => {}) }));

// ── Base en memoria, permisiva ──────────────────────────────────────────────

type Fila = Record<string, unknown>;
let tablas: Record<string, Fila[]>;
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
// `claves_idempotencia`: el reclamo del `wa_message_id` (`wa-mensaje-unico.ts`) va ANTES de la
// puerta y solo guarda el id del mensaje; no es un tercero ni procesa el contenido.
const DE_LA_PUERTA = new Set(['aceptaciones_terminos', 'wa_mensajes_retenidos', 'documentos_contractuales_versiones', 'wa_collaborators', 'workspaces', 'wa_message_log', 'wa_envios', 'claves_idempotencia']);

function crearDb() {
  function from(tabla: string) {
    tablas[tabla] ??= [];
    const filtros: Array<(f: Fila) => boolean> = [];
    let op = 'select';
    let payload: Fila | Fila[] | null = null;
    let devolver = false;
    let head = false;
    let tope: number | null = null;
    let una = false;
    const ejecutar = () => {
      if (op !== 'select' && !DE_LA_PUERTA.has(tabla)) escrituras.push(`${tabla}:${op}`);
      if (op === 'insert' || op === 'upsert') {
        const nuevas = (Array.isArray(payload) ? payload : [payload!]).map((p) => ({ id: uuid(), created_at: new Date().toISOString(), ...p }));
        if (tabla === 'aceptaciones_terminos') {
          for (const f of nuevas) {
            Object.assign(f, { estado: 'pendiente', expira_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), enviado_at: null, ultimo_intento_at: null, ...f });
            const choca = tablas[tabla].some((x) => x.estado === 'pendiente' && x.aviso_datos_version === f.aviso_datos_version && x.telefono === f.telefono && x.workspace_id === f.workspace_id);
            if (choca) return { data: null, error: { code: '23505', message: 'duplicate' } };
          }
        }
        if (tabla === 'wa_mensajes_retenidos') {
          for (const f of nuevas) {
            if (tablas[tabla].some((x) => x.wa_message_id === f.wa_message_id)) return { data: null, error: { code: '23505', message: 'duplicate' } };
            f.orden = ++seq;
          }
        }
        tablas[tabla].push(...nuevas);
        return { data: devolver ? nuevas.map((f) => ({ ...f })) : null, error: null };
      }
      const filas = tablas[tabla].filter((f) => filtros.every((fn) => fn(f)));
      if (op === 'update') { for (const f of filas) Object.assign(f, payload); return { data: devolver ? filas.map((f) => ({ ...f })) : null, error: null }; }
      if (op === 'delete') { tablas[tabla] = tablas[tabla].filter((f) => !filas.includes(f)); return { data: devolver ? filas.map((f) => ({ ...f })) : null, error: null }; }
      const vista = tope != null ? filas.slice(0, tope) : filas;
      if (head) return { data: null, error: null, count: vista.length };
      if (una) return { data: vista[0] ? { ...vista[0] } : null, error: null };
      return { data: vista.map((f) => ({ ...f })), error: null };
    };
    const filtroOr = (expr: string) => (f: Fila) => expr.split(',').some((p) => {
      const [col, o, ...r] = p.split('.');
      const v = r.join('.').replace(/^"(.*)"$/, '$1');
      if (o === 'is') return f[col] == null;
      if (o === 'eq') return String(f[col]) === v;
      if (o === 'lte') return f[col] != null && String(f[col]) <= v;
      return true;
    });
    const conocidos: Record<string, (...a: never[]) => unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => { if (op !== 'select') devolver = true; if (o?.head) head = true; return q; },
      insert: (p: Fila) => { op = 'insert'; payload = p; return q; },
      upsert: (p: Fila) => { op = 'upsert'; payload = p; return q; },
      update: (p: Fila) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q; },
      is: (c: string, v: null) => { filtros.push((f) => (f[c] ?? null) === v); return q; },
      gt: (c: string, v: string) => { filtros.push((f) => f[c] != null && String(f[c]) > v); return q; },
      lte: (c: string, v: string) => { filtros.push((f) => f[c] != null && String(f[c]) <= v); return q; },
      or: (e: string) => { filtros.push(filtroOr(e)); return q; },
      limit: (n: number) => { tope = n; return q; },
      maybeSingle: () => { una = true; return Promise.resolve(ejecutar()); },
      single: () => { una = true; return Promise.resolve(ejecutar()); },
      then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok, ko),
    };
    // Todo metodo que la puerta no usa (gte, neq, not, ilike, order, range…) se acepta sin filtrar.
    const q: unknown = new Proxy({}, { get: (_t, k: string) => conocidos[k] ?? (() => q) });
    return q;
  }
  return {
    from,
    rpc: async (nombre: string) => {
      if (nombre !== 'wa_identify_user') escrituras.push(`rpc:${nombre}`);
      return { data: nombre === 'wa_identify_user' ? [] : null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (ruta: string) => ({ data: { signedUrl: `https://proyecto.supabase.co/storage/v1/object/sign/${bucket}/${ruta}?token=t` }, error: null }),
        upload: async () => { escrituras.push(`storage:${bucket}`); return { data: null, error: null }; },
      }),
    },
  };
}
let db: ReturnType<typeof crearDb>;

// ── El webhook ──────────────────────────────────────────────────────────────

const WS = 'ws-prueba';
const DOC_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PDF = new TextEncoder().encode('%PDF-1.7 aviso ficticio');
const ANA = '573001110001';
const ENV: Record<string, string> = { WA_WEBHOOK_SKIP_FIRMA: '1', GEMINI_API_KEY: 'clave-ficticia', WHATSAPP_TOKEN: 'token-ficticio' };

let handler: (req: Request) => Promise<Response>;
const pendientes: Promise<unknown>[] = [];

beforeAll(async () => {
  (globalThis as unknown as Record<string, unknown>).Deno = {
    env: { get: (k: string) => ENV[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  (globalThis as unknown as Record<string, unknown>).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pendientes.push(p); } };
  await import('../wa-webhook/index.ts');
}, 60_000);

function workspace(aviso: boolean, extra: { bandeja?: boolean; interprete?: boolean } = {}) {
  return {
    id: WS,
    subscription_status: 'trial',
    modules: { business: true, ...(extra.bandeja ? { bandeja_solicitudes_wa: true } : {}) },
    bot_conversacional: extra.interprete ? { activo: true } : null,
    aviso_datos_bot: aviso ? { activo: true, documento_version_id: DOC_ID, texto: 'Acepta el aviso de datos para usar el bot.', version: 'v1' } : null,
  };
}

function preparar(ws: ReturnType<typeof workspace>) {
  tablas = {
    workspaces: [ws],
    wa_collaborators: [{ id: 'col-ana', workspace_id: WS, name: 'Ana Prueba', phone: ANA, is_active: true }],
    documentos_contractuales_versiones: [{
      id: DOC_ID, titulo: 'Aviso de datos', version: '1.0', pdf_bucket: 'aceptaciones-documentos', pdf_path: 'avisos/v1.pdf',
      pdf_sha256: createHash('sha256').update(PDF).digest('hex'), texto_sha256: 'b'.repeat(64), vigente_desde: '2026-01-01', vigente_hasta: null,
    }],
    aceptaciones_terminos: [],
    wa_mensajes_retenidos: [],
  };
  db = crearDb();
}

let ts = 1791212400;
type Msg = Record<string, unknown>;
const texto = (body: string, extra: Msg = {}): Msg => ({ type: 'text', text: { body }, ...extra });
const audio = (): Msg => ({ type: 'audio', audio: { id: `media-audio-${ts}`, mime_type: 'audio/ogg; codecs=opus' } });
const imagen = (caption: string): Msg => ({ type: 'image', image: { id: `media-img-${ts}`, mime_type: 'image/jpeg', caption } });

async function llega(m: Msg): Promise<void> {
  ts++;
  const cuerpo = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '573000000000', phone_number_id: 'pn-ficticio' },
      contacts: [{ wa_id: ANA, profile: { name: 'Ana Prueba' } }],
      messages: [{ from: ANA, id: `wamid.in${ts}`, timestamp: String(ts), ...m }],
    } }] }],
  };
  const res = await handler(new Request('https://ficticio/wa-webhook', { method: 'POST', body: JSON.stringify(cuerpo) }));
  expect(res.status).toBe(200);
  while (pendientes.length) await Promise.allSettled(pendientes.splice(0));
}

beforeEach(() => {
  gemini.length = 0;
  media.length = 0;
  escrituras.length = 0;
  envios.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes('generativelanguage.googleapis.com')) { gemini.push(u); return new Response('{}', { status: 500 }); }
    if (u.includes('/storage/v1/object/sign/')) return new Response(PDF, { status: 200 });
    return new Response('{}', { status: 200 });
  }));
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Pruebas ─────────────────────────────────────────────────────────────────

describe('control: con el aviso APAGADO cada camino si llega a su tercero', () => {
  it('escrito libre con el interprete: llama a Gemini', async () => {
    preparar(workspace(false, { interprete: true }));
    await llega(texto('gasto 20000 taxi para el negocio de Pedro Ficticio'));
    expect(gemini.length).toBeGreaterThan(0);
  });

  it('escrito sin interprete: el parser (wa-parse) llama a Gemini', async () => {
    preparar(workspace(false));
    await llega(texto('cuanto llevo gastado este mes en el negocio de la casa azul'));
    expect(gemini.length).toBeGreaterThan(0);
  });

  it('audio: se descarga de Meta para transcribirlo', async () => {
    preparar(workspace(false));
    await llega(audio());
    expect(media.length).toBeGreaterThan(0);
  });

  it('reenvio con la bandeja encendida: la bandeja lo registra', async () => {
    preparar(workspace(false, { bandeja: true }));
    await llega(texto('Pedido de Pedro Ficticio: 3 cajas', { context: { forwarded: true } }));
    expect(escrituras.length).toBeGreaterThan(0);
  });
});

describe('con el aviso ENCENDIDO y sin aceptar, ningun camino toca un tercero', () => {
  it.each([
    ['escrito libre, interprete y bandeja encendidos', { interprete: true, bandeja: true }, texto('gasto 20000 taxi para el negocio de Pedro Ficticio')],
    ['escrito, sin interprete (wa-parse)', {}, texto('cuanto llevo gastado este mes en el negocio de la casa azul')],
    ['audio (transcripcion)', { interprete: true }, audio()],
    ['imagen de gasto con leyenda', { interprete: true }, imagen('gasto 45000 almuerzo cliente')],
    ['reenvio (bandeja)', { bandeja: true, interprete: true }, texto('Pedido de Pedro Ficticio: 3 cajas', { context: { forwarded: true } })],
    ['prefijo «bot» con la bandeja', { bandeja: true, interprete: true }, texto('bot cuanto llevo este mes')],
  ])('%s', async (_n, extra, m) => {
    preparar(workspace(true, extra));
    await llega(m);

    expect(gemini).toEqual([]);
    expect(media).toEqual([]);
    expect(escrituras).toEqual([]);
    expect(tablas.wa_mensajes_retenidos).toHaveLength(1);
    expect(envios.map((e) => e.tipo)).toEqual(['documento', 'botones']);
  });

  it('y al aceptar, lo retenido si sigue su camino (aqui: el audio va a transcribirse)', async () => {
    preparar(workspace(true));
    await llega(audio());
    expect(media).toEqual([]);
    const fila = tablas.aceptaciones_terminos[0];
    await llega({
      type: 'interactive',
      context: { id: 'wamid.out2' },
      interactive: { type: 'button_reply', button_reply: { id: `terminos:acepto:${fila.id}`, title: 'Acepto' } },
    });
    expect(fila.estado).toBe('aceptado');
    expect(media.length).toBeGreaterThan(0);
    expect(tablas.wa_mensajes_retenidos).toEqual([]);
  });
});
