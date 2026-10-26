import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * La puerta del aviso de datos de punta a punta, contra una base en memoria que APLICA los filtros,
 * las llaves unicas de la migracion (una pendiente por persona/version, un wamid retenido una vez,
 * `reply_wamid`) y devuelve 23505 como PostgREST. Se reemplazan el envio por WhatsApp (`wa-respond`)
 * y la red (`fetch`, que solo debe ver la descarga del PDF para verificar su SHA-256).
 *
 * El «resto del bot» es `pipeline`: la misma secuencia de `processMessage` despues de identificar
 * (puerta → transcripcion → modelo), con la transcripcion y el modelo como espias. Que la puerta va
 * ANTES de todo eso en el webhook real se fija leyendo `wa-webhook/index.ts` (ultima seccion).
 *
 * Datos sinteticos: ningun telefono, nombre ni texto sale de produccion.
 */

// ── Envios por WhatsApp ─────────────────────────────────────────────────────

type Envio = { tipo: 'texto' | 'botones' | 'documento'; phone: string; texto: string; botones?: string[] };
const envios: Envio[] = [];
let wamidSeq = 0;
vi.mock('./wa-respond.ts', () => ({
  sendTextMessage: vi.fn(async (phone: string, texto: string) => { envios.push({ tipo: 'texto', phone, texto }); }),
  sendTextoExacto: vi.fn(async (phone: string, texto: string) => { envios.push({ tipo: 'texto', phone, texto }); return `wamid.out${++wamidSeq}`; }),
  sendButtons: vi.fn(async (phone: string, texto: string, botones: Array<{ id: string }>) => {
    envios.push({ tipo: 'botones', phone, texto, botones: botones.map((b) => b.id) });
    return `wamid.out${++wamidSeq}`;
  }),
  sendDocument: vi.fn(async (phone: string, _link: string, _nombre: string, leyenda: string) => {
    envios.push({ tipo: 'documento', phone, texto: leyenda });
    return `wamid.out${++wamidSeq}`;
  }),
}));
vi.mock('./wa-alerta.ts', () => ({ enviarAvisoInterno: vi.fn(async () => {}) }));

// ── Base en memoria ─────────────────────────────────────────────────────────

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;
type Err = { code?: string; message: string } | null;

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** Llaves unicas de la migracion. Devuelven la llave de la fila, o null si no aplica. */
const UNICOS: Record<string, Array<(f: Fila) => string | null>> = {
  aceptaciones_terminos: [
    (f) => (f.aviso_datos_version != null && f.estado === 'pendiente' ? `p|${f.workspace_id}|${f.telefono}|${f.aviso_datos_version}` : null),
    (f) => (f.reply_wamid != null ? `r|${f.reply_wamid}` : null),
  ],
  wa_mensajes_retenidos: [(f) => (f.wa_message_id != null ? `w|${f.wa_message_id}` : null)],
};

function violaUnico(t: Tablas, tabla: string, fila: Fila, excepto?: Fila): boolean {
  for (const llave of UNICOS[tabla] ?? []) {
    const k = llave(fila);
    if (k && t[tabla].some((x) => x !== excepto && llave(x) === k)) return true;
  }
  return false;
}

function valor(v: string): unknown {
  const s = v.replace(/^"(.*)"$/, '$1');
  return s === 'null' ? null : s;
}

function filtroOr(expr: string): (f: Fila) => boolean {
  const partes = expr.split(',').map((p) => {
    const [col, op, ...resto] = p.split('.');
    const v = valor(resto.join('.'));
    return (f: Fila) => {
      if (op === 'is') return f[col] == null;
      if (op === 'eq') return String(f[col]) === String(v);
      if (op === 'lte') return f[col] != null && String(f[col]) <= String(v);
      throw new Error(`op ${op} sin soporte en el doble`);
    };
  });
  return (f) => partes.some((p) => p(f));
}

let consultas = 0;

function crearDb(t: Tablas) {
  function from(tabla: string) {
    if (!t[tabla]) throw new Error(`tabla inesperada en el doble: ${tabla}`);
    consultas++;
    const filtros: Array<(f: Fila) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Fila | null = null;
    let devolver = false;
    let head = false;
    const ordenes: Array<{ col: string; asc: boolean; nullsFirst: boolean }> = [];
    let tope: number | null = null;
    let unaSola = false;

    const ejecutar = (): { data: unknown; error: Err; count?: number } => {
      if (op === 'insert') {
        const f: Fila = { id: uuid(), ...defaults(tabla), ...payload! };
        if (violaUnico(t, tabla, f)) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        t[tabla].push(f);
        return { data: devolver ? [{ ...f }] : null, error: null };
      }
      let filas = t[tabla].filter((f) => filtros.every((fn) => fn(f)));
      if (op === 'update') {
        for (const f of filas) {
          const nueva = { ...f, ...payload! };
          if (violaUnico(t, tabla, nueva, f)) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        for (const f of filas) Object.assign(f, payload!);
        return { data: devolver ? filas.map((f) => ({ ...f })) : null, error: null };
      }
      if (op === 'delete') {
        t[tabla] = t[tabla].filter((f) => !filas.includes(f));
        return { data: devolver ? filas.map((f) => ({ ...f })) : null, error: null };
      }
      for (const o of [...ordenes].reverse()) {
        filas = [...filas].sort((a, b) => {
          const va = a[o.col], vb = b[o.col];
          if (va == null && vb == null) return 0;
          if (va == null) return o.nullsFirst ? -1 : 1;
          if (vb == null) return o.nullsFirst ? 1 : -1;
          const c = va < vb ? -1 : va > vb ? 1 : 0;
          return o.asc ? c : -c;
        });
      }
      if (tope != null) filas = filas.slice(0, tope);
      if (head) return { data: null, error: null, count: filas.length };
      if (unaSola) return { data: filas[0] ? { ...filas[0] } : null, error: null };
      return { data: filas.map((f) => ({ ...f })), error: null };
    };

    const q = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (op !== 'select') devolver = true;
        if (opts?.head) head = true;
        return q;
      },
      insert(p: Fila) { op = 'insert'; payload = p; return q; },
      update(p: Fila) { op = 'update'; payload = p; return q; },
      delete() { op = 'delete'; return q; },
      eq(c: string, v: unknown) { filtros.push((f) => f[c] === v); return q; },
      in(c: string, vs: unknown[]) { filtros.push((f) => vs.includes(f[c])); return q; },
      is(c: string, v: null) { filtros.push((f) => (f[c] ?? null) === v); return q; },
      gt(c: string, v: string) { filtros.push((f) => f[c] != null && String(f[c]) > v); return q; },
      lte(c: string, v: string) { filtros.push((f) => f[c] != null && String(f[c]) <= v); return q; },
      or(expr: string) { filtros.push(filtroOr(expr)); return q; },
      order(col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) {
        ordenes.push({ col, asc: o.ascending ?? true, nullsFirst: o.nullsFirst ?? !(o.ascending ?? true) });
        return q;
      },
      limit(n: number) { tope = n; return q; },
      maybeSingle() { unaSola = true; return Promise.resolve(ejecutar()); },
      single() { unaSola = true; return Promise.resolve(ejecutar()); },
      then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) { return Promise.resolve(ejecutar()).then(ok, ko); },
    };
    return q;
  }
  let orden = 0;
  function defaults(tabla: string): Fila {
    const ahora = new Date().toISOString();
    if (tabla === 'aceptaciones_terminos') {
      return {
        estado: 'pendiente', canal: 'whatsapp', created_at: ahora, expira_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        enviado_at: null, ultimo_intento_at: null, prompt_wamid: null, documento_wamid: null, reply_wamid: null,
        button_id: null, respondido_at: null, negocio_id: null, empresa_nombre: null, empresa_nit: null, aviso_datos_version: null,
      };
    }
    if (tabla === 'wa_mensajes_retenidos') return { orden: ++orden, recibido_at: ahora };
    return {};
  }
  return {
    from,
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (ruta: string) => ({ data: { signedUrl: `https://proyecto.supabase.co/storage/v1/object/sign/${bucket}/${ruta}?token=ficticio` }, error: null }),
      }),
    },
  };
}

// ── Escenario ───────────────────────────────────────────────────────────────

const WS = 'ws-prueba';
const DOC_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PDF = new TextEncoder().encode('%PDF-1.7 aviso de datos ficticio');
const PDF_SHA = createHash('sha256').update(PDF).digest('hex');
const TEXTO_AVISO = 'Para usar este bot necesitamos que aceptes el aviso de tratamiento de datos adjunto.';
const ANA = '573001110001';
const LUIS = '573001110002';

let tablas: Tablas;
let db: ReturnType<typeof crearDb>;
const transcribir = vi.fn(async () => 'texto transcrito');
const modelo = vi.fn(async () => 'GASTO');
const procesados: Array<{ phone: string; text: string; type: string }> = [];
const llamadasRed: string[] = [];

type Mod = typeof import('./aviso-datos-bot-flujo');
type ModTerminos = typeof import('./aceptacion-terminos-flujo');
let puerta: Mod;
let terminos: ModTerminos;

beforeAll(async () => {
  // `aceptacion-terminos-flujo` lee `Deno.env` al avisar a quien opera: sin numero, solo registra.
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => undefined } };
  puerta = await import('./aviso-datos-bot-flujo');
  terminos = await import('./aceptacion-terminos-flujo');
});

function config(over: Record<string, unknown> = {}) {
  return { activo: true, documento_version_id: DOC_ID, texto: TEXTO_AVISO, version: 'v1', ...over };
}

function usuario(phone: string, nombre: string, aviso: unknown = config()) {
  return {
    workspace_id: WS, phone, name: nombre, role: 'operator' as const, collaborator_id: `col-${phone}`,
    subscription_status: 'trial', modulos: { modules: {}, aviso_datos_bot: aviso },
  };
}

let ts = 1791212400;
function texto(phone: string, cuerpo: string, extra: Record<string, unknown> = {}) {
  ts++;
  return { phone, text: cuerpo, type: 'text' as const, timestamp: String(ts), wa_message_id: `wamid.in${ts}`, webhook_crudo: { cuerpo: '{"cuerpo":"crudo"}', firma: 'sha256=ficticia' }, ...extra };
}
function audio(phone: string) {
  ts++;
  return { phone, text: '', type: 'audio' as const, audio_id: `media-${ts}`, timestamp: String(ts), wa_message_id: `wamid.in${ts}` };
}
function toque(phone: string, aceptacionId: string, decision: 'acepto' | 'no_acepto') {
  ts++;
  const id = `terminos:${decision}:${aceptacionId}`;
  return {
    phone, text: decision === 'acepto' ? 'Acepto' : 'No acepto', type: 'interactive' as const, interactive_reply: id, timestamp: String(ts),
    wa_message_id: `wamid.in${ts}`,
    meta_mensaje: { from: phone, id: `wamid.in${ts}`, timestamp: String(ts), type: 'interactive', context: { id: 'wamid.out1' }, interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } },
    webhook_crudo: { cuerpo: '{}', firma: null },
  };
}

/** Lo que hace `processMessage` despues de identificar: puerta, y si pasa, transcripcion y modelo. */
async function pipeline(m: Parameters<Mod['atenderAvisoDatos']>[2], aviso: unknown = config()): Promise<void> {
  const u = usuario(m.phone, m.phone === ANA ? 'Ana Prueba' : 'Luis Prueba', aviso);
  if (await terminos.atenderBotonTerminos(db, m, {
    alResponderAviso: (fila, d, at) => puerta.cerrarAviso(db, fila, d, at, (r) => pipeline(r, aviso)),
  })) return;
  if (await terminos.atenderPendienteTerminos(db, m, true)) return;
  if (await puerta.atenderAvisoDatos(db, u, m, (r) => pipeline(r, aviso))) return;
  if (m.type === 'audio') m.text = await transcribir();
  await modelo();
  procesados.push({ phone: m.phone, text: m.text, type: m.type });
}

const filasAviso = (phone?: string) =>
  tablas.aceptaciones_terminos.filter((f) => f.aviso_datos_version != null && (!phone || f.telefono === `+${phone}`));
const retenidos = () => tablas.wa_mensajes_retenidos;
const enviosA = (phone: string) => envios.filter((e) => e.phone === phone);

beforeEach(() => {
  tablas = {
    aceptaciones_terminos: [],
    aceptaciones_terminos_acciones: [],
    wa_mensajes_retenidos: [],
    wa_message_log: [],
    wa_envios: [],
    negocios: [],
    workspaces: [],
    wa_collaborators: [
      { id: `col-${ANA}`, workspace_id: WS, name: 'Ana Prueba', phone: `+${ANA}`, is_active: true, consent_accepted_at: null },
      { id: `col-${LUIS}`, workspace_id: WS, name: 'Luis Prueba', phone: LUIS, is_active: true, consent_accepted_at: null },
    ],
    documentos_contractuales_versiones: [{
      id: DOC_ID, titulo: 'Aviso de privacidad del bot', version: '1.0', pdf_bucket: 'aceptaciones-documentos',
      pdf_path: 'avisos/aviso-bot-v1.pdf', pdf_sha256: PDF_SHA, texto_sha256: 'b'.repeat(64), vigente_desde: '2026-01-01', vigente_hasta: null,
    }],
  };
  db = crearDb(tablas);
  envios.length = 0;
  procesados.length = 0;
  llamadasRed.length = 0;
  transcribir.mockClear();
  modelo.mockClear();
  consultas = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    llamadasRed.push(String(url));
    return new Response(PDF, { status: 200, headers: { 'content-length': String(PDF.byteLength) } });
  }));
  // La pausa de 3 s entre documento y botones no aporta nada a la prueba.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const soloPdf = () => llamadasRed.every((u) => u.includes('/storage/v1/object/sign/aceptaciones-documentos/'));

// ── Pruebas ─────────────────────────────────────────────────────────────────

describe('sin la llave, nada cambia', () => {
  it.each([
    ['sin modulos', null],
    ['sin la llave', undefined],
    ['activo false', config({ activo: false })],
    ['activo "true" (texto)', config({ activo: 'true' })],
  ])('%s: deja pasar sin una sola consulta', async (_n, aviso) => {
    const u = { ...usuario(ANA, 'Ana Prueba'), modulos: aviso === null ? null : { modules: {}, aviso_datos_bot: aviso } };
    expect(await puerta.atenderAvisoDatos(db, u, texto(ANA, 'gasto 20000 taxi'), vi.fn())).toBe(false);
    expect(consultas).toBe(0);
    expect(envios).toEqual([]);
  });
});

describe('primer mensaje', () => {
  it('se retiene sin procesar y se muestra el aviso: documento y botones con el texto de la config', async () => {
    await pipeline(texto(ANA, 'gasto 20000 taxi KAE-2'));

    expect(modelo).not.toHaveBeenCalled();
    expect(procesados).toEqual([]);
    const [fila] = filasAviso(ANA);
    expect(fila).toMatchObject({
      workspace_id: WS, telefono: `+${ANA}`, estado: 'pendiente', canal: 'whatsapp', calidad: 'persona_natural',
      nombre_aceptante: 'Ana Prueba', documento_version_id: DOC_ID, documento_sha256: PDF_SHA, documento_version: '1.0',
      texto_aceptacion: TEXTO_AVISO, aviso_datos_version: 'v1',
      texto_aceptacion_sha256: createHash('sha256').update(TEXTO_AVISO).digest('hex'),
    });
    expect(fila.enviado_at).toBeTruthy();
    expect(retenidos()).toHaveLength(1);
    expect(retenidos()[0].mensaje).not.toHaveProperty('webhook_crudo');
    expect(enviosA(ANA).map((e) => e.tipo)).toEqual(['documento', 'botones']);
    expect(enviosA(ANA)[1].texto).toBe(TEXTO_AVISO);
    expect(enviosA(ANA)[1].botones).toEqual([`terminos:acepto:${fila.id}`, `terminos:no_acepto:${fila.id}`]);
    expect(soloPdf()).toBe(true);
  });

  it('dos mensajes que llegan a la vez crean UNA solicitud y un solo aviso; los dos quedan retenidos', async () => {
    await Promise.all([pipeline(texto(ANA, 'hola')), pipeline(texto(ANA, 'buenos dias'))]);
    expect(filasAviso(ANA)).toHaveLength(1);
    expect(retenidos()).toHaveLength(2);
    expect(enviosA(ANA).filter((e) => e.tipo === 'documento')).toHaveLength(1);
  });
});

describe('«Acepto»', () => {
  it('por boton: registra, marca el consentimiento del colaborador, confirma y procesa lo retenido en orden', async () => {
    const primero = texto(ANA, 'gasto 20000 taxi');
    const segundo = texto(ANA, 'gasto 5000 parqueadero');
    // Llegan al reves de como se escribieron: manda el timestamp de Meta.
    await pipeline(segundo);
    await pipeline(primero);
    const [fila] = filasAviso(ANA);

    await pipeline(toque(ANA, fila.id as string, 'acepto'));

    expect(fila.estado).toBe('aceptado');
    expect(fila.button_id).toBe(`terminos:acepto:${fila.id}`);
    expect(tablas.wa_collaborators.find((c) => c.id === `col-${ANA}`)?.consent_accepted_at).toBeTruthy();
    expect(tablas.wa_collaborators.find((c) => c.id === `col-${LUIS}`)?.consent_accepted_at).toBeNull();
    expect(enviosA(ANA).some((e) => e.texto.startsWith('✅ Gracias. Quedó registrada tu aceptación. Ya proceso'))).toBe(true);
    expect(procesados.map((p) => p.text)).toEqual(['gasto 20000 taxi', 'gasto 5000 parqueadero']);
    expect(retenidos()).toEqual([]);

    // Lo que escribe despues pasa directo.
    await pipeline(texto(ANA, 'gasto 3000 tinto'));
    expect(procesados.at(-1)?.text).toBe('gasto 3000 tinto');
  });

  it('escrito: «acepto» cuenta igual, con el wamid del mensaje como llave', async () => {
    await pipeline(texto(ANA, 'gasto 20000 taxi'));
    const [fila] = filasAviso(ANA);
    const respuesta = texto(ANA, 'Acepto');
    await pipeline(respuesta);

    expect(fila).toMatchObject({ estado: 'aceptado', button_id: 'texto:acepto', reply_wamid: respuesta.wa_message_id });
    expect((fila.payload_respuesta as Fila).cuerpo_webhook).toBe('{"cuerpo":"crudo"}');
    expect(procesados.map((p) => p.text)).toEqual(['gasto 20000 taxi']);

    // Meta reintenta el mismo «acepto»: no se confirma ni se procesa dos veces.
    const antes = envios.length;
    await pipeline(respuesta);
    expect(envios.length).toBe(antes);
    expect(procesados).toHaveLength(1);
  });
});

describe('«No acepto»', () => {
  it('registra el rechazo, borra lo retenido sin procesarlo y dice que hable con su administrador', async () => {
    await pipeline(texto(ANA, 'gasto 20000 taxi'));
    const [fila] = filasAviso(ANA);
    await pipeline(toque(ANA, fila.id as string, 'no_acepto'));

    expect(fila.estado).toBe('rechazado');
    expect(retenidos()).toEqual([]);
    expect(procesados).toEqual([]);
    expect(modelo).not.toHaveBeenCalled();
    expect(enviosA(ANA).at(-1)?.texto).toBe(
      'Quedó registrado que no aceptas el aviso. No procesé lo que enviaste. Si tienes usuario en MéTRIK ONE, puedes seguir registrando tu trabajo desde el navegador; si no, habla con el administrador de tu empresa. Si cambias de opinión, escríbeme de nuevo y te muestro el aviso.',
    );
  });

  it('escrito y despues vuelve a escribir: se le muestra el aviso otra vez', async () => {
    await pipeline(texto(ANA, 'hola'));
    await pipeline(texto(ANA, 'no acepto'));
    expect(filasAviso(ANA)[0].estado).toBe('rechazado');

    envios.length = 0;
    await pipeline(texto(ANA, 'gasto 20000 taxi'));
    expect(filasAviso(ANA)).toHaveLength(2);
    expect(filasAviso(ANA)[1].estado).toBe('pendiente');
    expect(enviosA(ANA).map((e) => e.tipo)).toEqual(['documento', 'botones']);
    expect(procesados).toEqual([]);
  });

  it('tocar «Acepto» del aviso que ya rechazo no lo cambia: se le pide escribir para verlo de nuevo', async () => {
    await pipeline(texto(ANA, 'hola'));
    const [fila] = filasAviso(ANA);
    await pipeline(toque(ANA, fila.id as string, 'no_acepto'));
    await pipeline(toque(ANA, fila.id as string, 'acepto'));
    expect(fila.estado).toBe('rechazado');
    expect(enviosA(ANA).at(-1)?.texto).toMatch(/aviso anterior/);
  });
});

describe('mientras esta pendiente', () => {
  it('texto, audio y reenvio se retienen sin transcribir ni llamar al modelo; un solo recordatorio por rafaga', async () => {
    await pipeline(texto(ANA, 'hola'));
    envios.length = 0;

    await pipeline(texto(ANA, 'gasto 20000 taxi'));
    await pipeline(audio(ANA));
    await pipeline(texto(ANA, 'Pedido de Carlos Ficticio: 3 cajas', { reenviado: true }));

    expect(transcribir).not.toHaveBeenCalled();
    expect(modelo).not.toHaveBeenCalled();
    expect(soloPdf()).toBe(true);
    expect(retenidos().map((r) => r.tipo)).toEqual(['text', 'text', 'audio', 'text']);
    // Dentro del enfriamiento no sale nada mas: sin bucle de avisos.
    expect(envios).toEqual([]);

    // Pasado el enfriamiento, el siguiente mensaje trae UN recordatorio (solo los botones).
    filasAviso(ANA)[0].ultimo_intento_at = new Date(Date.now() - 3 * 60_000).toISOString();
    await pipeline(texto(ANA, 'sigo aqui'));
    expect(envios.map((e) => e.tipo)).toEqual(['botones']);

    // Al aceptar se procesa todo, el audio incluido (recien ahi se transcribe).
    await pipeline(toque(ANA, filasAviso(ANA)[0].id as string, 'acepto'));
    expect(transcribir).toHaveBeenCalledTimes(1);
    expect(procesados.map((p) => p.type)).toEqual(['text', 'text', 'audio', 'text', 'text']);
  });

  it('un reintento de Meta del mismo mensaje no se retiene dos veces', async () => {
    const m = texto(ANA, 'gasto 20000 taxi');
    await pipeline(m);
    await pipeline({ ...m });
    expect(retenidos()).toHaveLength(1);
  });

  it('la solicitud de la puerta no la toma el flujo general de aceptaciones', async () => {
    await pipeline(texto(ANA, 'hola'));
    envios.length = 0;
    expect(await terminos.atenderPendienteTerminos(db, texto(ANA, 'otra cosa'), true)).toBe(false);
    expect(envios).toEqual([]);
  });
});

describe('revocacion', () => {
  it('revocada por SQL, vuelve a mostrar el aviso y no procesa hasta una aceptacion nueva', async () => {
    await pipeline(texto(ANA, 'hola'));
    const [primera] = filasAviso(ANA);
    await pipeline(toque(ANA, primera.id as string, 'acepto'));
    procesados.length = 0;

    // Lo que hace la sesion principal a pedido de la empresa.
    primera.revocada_at = new Date().toISOString();

    envios.length = 0;
    await pipeline(texto(ANA, 'gasto 20000 taxi'));
    expect(procesados).toEqual([]);
    expect(modelo).toHaveBeenCalledTimes(1); // el «hola» de antes de revocar, nada mas
    expect(filasAviso(ANA)).toHaveLength(2);
    expect(enviosA(ANA).map((e) => e.tipo)).toEqual(['documento', 'botones']);

    // El «Acepto» viejo no revive la aceptacion revocada.
    await pipeline(toque(ANA, primera.id as string, 'acepto'));
    expect(enviosA(ANA).at(-1)?.texto).toMatch(/aviso anterior/);
    expect(procesados).toEqual([]);

    await pipeline(toque(ANA, filasAviso(ANA)[1].id as string, 'acepto'));
    expect(procesados.map((p) => p.text)).toEqual(['gasto 20000 taxi']);
  });
});

describe('lo retenido no deja texto en wa_message_log', () => {
  it('ni el contenido ni un trozo: solo marcas sin texto del mensaje', async () => {
    await pipeline(texto(ANA, 'gasto 20000 taxi del cliente Pedro Ficticio'));
    await pipeline(audio(ANA));
    await pipeline(texto(ANA, 'no acepto'));
    const previews = tablas.wa_message_log.map((f) => String(f.message_preview ?? ''));
    expect(previews.some((p) => /gasto|Pedro|taxi/i.test(p))).toBe(false);
    expect(retenidos()).toEqual([]);
  });
});

describe('versiones y personas', () => {
  it('una version nueva vuelve a pedir aceptacion', async () => {
    await pipeline(texto(ANA, 'hola'));
    await pipeline(toque(ANA, filasAviso(ANA)[0].id as string, 'acepto'));
    await pipeline(texto(ANA, 'gasto 1000 tinto'));
    expect(procesados.at(-1)?.text).toBe('gasto 1000 tinto');

    procesados.length = 0;
    await pipeline(texto(ANA, 'gasto 2000 agua'), config({ version: 'v2' }));
    expect(procesados).toEqual([]);
    expect(filasAviso(ANA).map((f) => [f.aviso_datos_version, f.estado])).toEqual([['v1', 'aceptado'], ['v2', 'pendiente']]);
  });

  it('dos personas del mismo workspace aceptan por separado', async () => {
    await pipeline(texto(ANA, 'gasto de Ana'));
    await pipeline(texto(LUIS, 'gasto de Luis'));
    await pipeline(toque(ANA, filasAviso(ANA)[0].id as string, 'acepto'));

    expect(procesados.map((p) => p.text)).toEqual(['gasto de Ana']);
    expect(filasAviso(LUIS)[0].estado).toBe('pendiente');
    expect(retenidos().map((r) => r.telefono)).toEqual([`+${LUIS}`]);

    await pipeline(texto(LUIS, 'acepto'));
    expect(procesados.map((p) => p.text)).toEqual(['gasto de Ana', 'gasto de Luis']);
    expect(tablas.wa_collaborators.every((c) => c.consent_accepted_at)).toBe(true);
  });
});

describe('falla cerrada', () => {
  it('con la llave encendida pero mal escrita, no procesa ni crea nada', async () => {
    await pipeline(texto(ANA, 'gasto 20000 taxi'), config({ documento_version_id: 'no-es-uuid' }));
    expect(procesados).toEqual([]);
    expect(filasAviso()).toEqual([]);
    expect(enviosA(ANA).at(-1)?.texto).toMatch(/No lo procesé/);
  });

  it('con una version de documento que no existe, no procesa', async () => {
    await pipeline(texto(ANA, 'gasto 20000 taxi'), config({ documento_version_id: '0a1b2c3d-4e5f-4a6b-8c7d-000000000000' }));
    expect(procesados).toEqual([]);
    expect(modelo).not.toHaveBeenCalled();
  });

  it('si el PDF no coincide con su huella, no se muestra nada para aceptar y el mensaje queda retenido', async () => {
    tablas.documentos_contractuales_versiones[0].pdf_sha256 = 'c'.repeat(64);
    await pipeline(texto(ANA, 'gasto 20000 taxi'));
    expect(enviosA(ANA).map((e) => e.tipo)).toEqual(['texto']);
    expect(filasAviso(ANA)[0].enviado_at).toBeNull();
    expect(retenidos()).toHaveLength(1);
    expect(procesados).toEqual([]);
  });
});

describe('orden en el webhook', () => {
  const fuente = readFileSync(join(__dirname, '..', 'wa-webhook', 'index.ts'), 'utf8');
  const cuerpo = fuente.slice(fuente.indexOf('async function processMessage'), fuente.indexOf('// Cardumen — disparador de estudio'));
  const pos = (s: string) => {
    const i = cuerpo.indexOf(s);
    expect(i, s).toBeGreaterThan(-1);
    return i;
  };

  it('la puerta va despues de identificar y antes del interprete, la bandeja, la transcripcion y el parser', () => {
    const puertaEn = pos('atenderAvisoDatos(supabase, user, message, processMessage)');
    expect(pos('const user = await identifyUser(')).toBeLessThan(puertaEn);
    for (const despues of ['atenderEscrito(supabase, user, message)', 'rutaDelMensaje(supabase, user, message)', '// 3.5 Transcribe', 'await parseMessage(']) {
      expect(puertaEn, despues).toBeLessThan(pos(despues));
    }
  });

  it('el toque del aviso entra por el boton de terminos con su reproceso', () => {
    expect(pos('alResponderAviso:')).toBeLessThan(pos('const user = await identifyUser('));
  });
});
