import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rpcDelDirectorio } from './__fixtures__/directorio-doble.ts';

/**
 * El paso de entendimiento de punta a punta, contra una base en memoria que APLICA los filtros
 * (un doble que devuelve siempre la fila no prueba nada: ver la receta del route handler).
 *
 * `wa-entendimiento.ts` lee `Deno.env` al cargarse: se define un `Deno` mínimo ANTES de
 * importarlo (import dinámico) y se reemplazan el envío por WhatsApp y el modelo (`fetch`).
 * Los datos son sintéticos: ningún valor sale de producción.
 */

const enviados: Array<{ phone: string; texto: string }> = [];
vi.mock('./wa-respond.ts', () => ({
  sendTextMessage: vi.fn(async (phone: string, texto: string) => { enviados.push({ phone, texto }); }),
}));

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;

// ── Base en memoria ─────────────────────────────────────────────────────────

let seq = 0;
const nuevoId = () => `id-${++seq}`;

function leer(fila: Fila, col: string): unknown {
  const m = /^(\w+)->>(\w+)$/.exec(col);
  if (m) {
    const v = (fila[m[1]] as Fila | null | undefined)?.[m[2]];
    return v === undefined || v === null ? null : String(v);
  }
  return fila[col];
}

const UNICOS: Record<string, string> = { wa_bandeja_mensajes: 'wa_message_id' };

function crearDb(t: Tablas) {
  function from(tabla: string) {
    if (!t[tabla]) throw new Error(`tabla inesperada en el doble: ${tabla}`);
    const filtros: Array<(f: Fila) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: Fila | Fila[] | null = null;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let columnas = '*';
    let orden: { col: string; asc: boolean } | null = null;
    let tope: number | null = null;

    const proyectar = (f: Fila): Fila => {
      if (!columnas.includes(':')) return { ...f };
      const out: Fila = {};
      for (const c of columnas.split(',').map(x => x.trim())) {
        const [alias, expr] = c.includes(':') ? c.split(':') : [c, c];
        out[alias] = leer(f, expr);
      }
      return out;
    };

    const ejecutar = (): { data: Fila[] | null; error: { message: string } | null } => {
      if (op === 'insert') {
        const filas = (Array.isArray(payload) ? payload : [payload!]).map(f => ({ id: nuevoId(), ...f }));
        const unico = UNICOS[tabla];
        for (const f of filas) {
          if (unico && t[tabla].some(x => x[unico] === f[unico])) return { data: null, error: { message: 'duplicate key value' } };
        }
        t[tabla].push(...filas);
        return { data: filas.map(proyectar), error: null };
      }
      if (op === 'upsert') {
        const f = { id: nuevoId(), ...(payload as Fila) };
        const cols = upsertOpts.onConflict!.split(',').map(c => c.trim());
        if (t[tabla].some(x => cols.every(c => (x[c] ?? 0) === (f[c] ?? 0)))) return { data: [], error: null };
        t[tabla].push(f);
        return { data: [proyectar(f)], error: null };
      }
      let filas = t[tabla].filter(f => filtros.every(p => p(f)));
      if (op === 'update') {
        for (const f of filas) Object.assign(f, payload);
        return { data: filas.map(proyectar), error: null };
      }
      if (orden) {
        const { col, asc } = orden;
        filas = [...filas].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (tope !== null) filas = filas.slice(0, tope);
      return { data: filas.map(proyectar), error: null };
    };

    const q = {
      select: (c = '*') => { columnas = c; return q; },
      insert: (p: Fila | Fila[]) => { op = 'insert'; payload = p; return q; },
      update: (p: Fila) => { op = 'update'; payload = p; return q; },
      upsert: (p: Fila, o: typeof upsertOpts) => { op = 'upsert'; payload = p; upsertOpts = o; return q; },
      eq: (c: string, v: unknown) => { filtros.push(f => leer(f, c) === v); return q; },
      in: (c: string, vs: unknown[]) => { filtros.push(f => vs.includes(leer(f, c))); return q; },
      is: (c: string, v: unknown) => { filtros.push(f => (leer(f, c) ?? null) === v); return q; },
      not: (c: string, o: string, v: unknown) => {
        if (o !== 'is' || v !== null) throw new Error(`not(${o}) sin soporte en el doble`);
        filtros.push(f => (leer(f, c) ?? null) !== null);
        return q;
      },
      lt: (c: string, v: number) => { filtros.push(f => (leer(f, c) as number) < v); return q; },
      neq: (c: string, v: unknown) => { filtros.push(f => leer(f, c) !== v); return q; },
      gte: (c: string, v: string) => { filtros.push(f => String(leer(f, c) ?? '') >= v); return q; },
      ilike: (c: string, pat: string) => {
        const needle = pat.replace(/%/g, '').toLowerCase();
        filtros.push(f => String(leer(f, c) ?? '').toLowerCase().includes(needle));
        return q;
      },
      order: (c: string, o?: { ascending?: boolean }) => { orden = { col: c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { tope = n; return q; },
      maybeSingle: async () => { const r = ejecutar(); return { data: r.data?.[0] ?? null, error: r.error }; },
      single: async () => { const r = ejecutar(); return { data: r.data?.[0] ?? null, error: r.error ?? (r.data?.length ? null : { message: 'no rows' }) }; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(res, rej),
    };
    return q;
  }
  /**
   * `wa_bandeja_registrar_mensaje`, solo los dos caminos que usa la prueba del acto (la función
   * de verdad se prueba con PGlite): suma a la tanda abierta del remitente, o abre una.
   */
  async function rpc(nombre: string, a: Fila) {
    const delDirectorio = rpcDelDirectorio(t, nombre, a);
    if (delDirectorio) return delDirectorio;
    if (nombre !== 'wa_bandeja_registrar_mensaje') throw new Error(`rpc no esperado: ${nombre}`);
    const ahora = new Date().toISOString();
    let abierta = t.wa_bandeja_entregas.find(e => e.workspace_id === a.p_workspace_id && e.remitente_phone === a.p_remitente_phone && e.estado === 'abierta');
    // La palabra de cierre («listo»): cierra la tanda abierta y la bandeja pregunta.
    if (a.p_es_cierre) {
      if (!abierta) return { data: [{ accion: 'cierre_sin_abierta', entrega: null, mensajes: 0 }], error: null };
      Object.assign(abierta, { estado: 'esperando_cliente', cerrada_at: ahora, motivo_cierre: 'palabra_cierre' });
      return { data: [{ accion: 'cerrar', entrega: abierta.id, mensajes: abierta.n_mensajes }], error: null };
    }
    // Sin tanda abierta, un escrito puede ser la respuesta a la pregunta de la entrega (la más reciente).
    if (!abierta && !a.p_reenviado && a.p_puede_ser_respuesta !== false && String(a.p_cuerpo ?? '').trim()) {
      const espera = t.wa_bandeja_entregas.filter(e => e.remitente_phone === a.p_remitente_phone && e.estado === 'esperando_cliente' && e.pregunta_enviada_at)
        .sort((x, y) => String(y.cerrada_at).localeCompare(String(x.cerrada_at)))[0];
      if (espera) {
        t.wa_bandeja_mensajes.push({ id: nuevoId(), workspace_id: a.p_workspace_id, entrega_id: espera.id, wa_message_id: a.p_wa_message_id, papel: 'respuesta_cliente', tipo: a.p_tipo, cuerpo: a.p_cuerpo, reenviado: false, recibido_at: ahora });
        Object.assign(espera, { estado: 'con_cliente', cliente_texto: a.p_cuerpo, cliente_respondido_at: ahora });
        return { data: [{ accion: 'respuesta_cliente', entrega: espera.id, mensajes: espera.n_mensajes }], error: null };
      }
    }
    const accion = abierta ? 'agregar' : 'abrir';
    if (!abierta) {
      abierta = { id: nuevoId(), workspace_id: a.p_workspace_id, remitente_phone: a.p_remitente_phone, estado: 'abierta', n_mensajes: 0, created_at: ahora, pregunta_enviada_at: null, pregunta_error: null, plan_viajes: null, negocio_opciones: null };
      t.wa_bandeja_entregas.push(abierta);
    }
    t.wa_bandeja_mensajes.push({
      id: nuevoId(), workspace_id: a.p_workspace_id, entrega_id: abierta.id, wa_message_id: a.p_wa_message_id, papel: 'contenido', tipo: a.p_tipo,
      cuerpo: a.p_cuerpo, cuerpo_origen: a.p_cuerpo_origen, reenviado: a.p_reenviado, segmento: null, recibido_at: new Date().toISOString(),
    });
    abierta.n_mensajes = Number(abierta.n_mensajes ?? 0) + 1;
    return { data: [{ accion, entrega: abierta.id, mensajes: abierta.n_mensajes }], error: null };
  }
  return { from, rpc };
}

// ── Escenario sintético ─────────────────────────────────────────────────────

const WS = 'ws-1';
const LINEA = 'linea-viajes';
const STAFF = 'staff-tatiana';
const TEL = '573000000001';

const FIELDS = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde quieren viajar?' },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'fecha_regreso', tipo: 'fecha', label: 'Regreso', nivel: 'minimo', pregunta: '¿Qué día regresan?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
  { slug: 'ninos', tipo: 'numero', label: 'Niños', nivel: 'minimo', pregunta: '¿Viajan niños?' },
  { slug: 'ciudad_origen', tipo: 'texto', label: 'Origen', nivel: 'minimo', pregunta: '¿Desde qué ciudad salen?' },
];

function bloqueConfig() {
  return { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } };
}

function base(): Tablas {
  return {
    workspaces: [{ id: WS, slug: 'agencia', linea_activa_id: LINEA, config_extra: {}, modules: { bandeja_solicitudes_wa: true } }],
    staff: [{ id: STAFF, workspace_id: WS, full_name: 'TATIANA PRUEBA' }],
    wa_collaborators: [{ id: 'col-1', workspace_id: WS, name: 'EDGAR COLABORADOR' }],
    negocios: [
      { id: 'n14', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 14', nombre: 'PUNTA CANA NOV', estado: 'abierto', created_at: '2026-09-20T10:00:00Z', contacto_id: 'c-marta', empresa_id: null, responsable_id: STAFF, contactos: { nombre: 'MARTA PRUEBA' }, empresas: null, workspaces: { slug: 'agencia' } },
      { id: 'n15', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 15', nombre: 'CARTAGENA 3N', estado: 'abierto', created_at: '2026-09-25T10:00:00Z', contacto_id: 'c-luis', empresa_id: null, responsable_id: null, contactos: { nombre: 'LUIS PRUEBA' }, empresas: null, workspaces: { slug: 'agencia' } },
      { id: 'n09', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 9', nombre: 'Aruba 5 días', estado: 'abierto', created_at: '2026-09-01T10:00:00Z', contacto_id: 'c-ana', empresa_id: null, responsable_id: null, contactos: { nombre: 'ANA PRUEBA' }, empresas: null, workspaces: { slug: 'agencia' } },
      { id: 'n01', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 1', nombre: 'W', estado: 'completado', created_at: '2026-09-28T10:00:00Z', contacto_id: 'c-marta', empresa_id: null, responsable_id: STAFF, contactos: { nombre: 'MARTA PRUEBA' }, empresas: null, workspaces: { slug: 'agencia' } },
    ],
    negocio_responsables: [{ negocio_id: 'n15', staff_id: STAFF }],
    negocio_bloques: [
      // Lo que una persona ya escribió en el viaje de Marta.
      { id: 'b14', negocio_id: 'n14', data: { destino: 'PUNTA CANA', fecha_salida: '2026-11-15', adultos: 2 }, updated_at: '2026-09-21T10:00:00Z', bloque_configs: bloqueConfig() },
      { id: 'b15', negocio_id: 'n15', data: { destino: 'CARTAGENA' }, updated_at: '2026-09-25T10:00:00Z', bloque_configs: bloqueConfig() },
    ],
    // Una entrada anterior en la actividad: la carga nueva se AGREGA, no la reemplaza.
    activity_log: [{ id: 'a0', workspace_id: WS, entidad_tipo: 'negocio', entidad_id: 'n14', tipo: 'cambio_sistema', contenido: 'Historia del 20-sep: primera conversación.' }],
    wa_bandeja_entregas: [],
    wa_bandeja_mensajes: [],
    wa_bandeja_entendimientos: [],
    etapas_negocio: [{ id: 'et1', linea_id: LINEA, orden: 1, stage: 'venta' }],
    bloque_configs: [{ id: 'bc1', etapa_id: 'et1', workspace_id: WS, orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' } }],
    contactos: [],
    empresas: [],
    staff_areas: [{ staff_id: STAFF, area: 'comercial' }],
  };
}

let t: Tablas;
let db: ReturnType<typeof crearDb>;
let salidaModelo: unknown;
let colaModelo: unknown[] = [];
let mod: typeof import('./wa-entendimiento.ts');

function entrega(p: { respuesta: string; opciones: unknown; mensajes: Array<{ cuerpo: string; origen?: string }> }): string {
  const id = nuevoId();
  t.wa_bandeja_entregas.push({
    id, workspace_id: WS, remitente_phone: TEL, remitente_staff_id: STAFF, estado: 'con_cliente',
    cliente_texto: p.respuesta, cliente_respondido_at: '2026-09-30T14:00:00Z', negocio_opciones: p.opciones,
  });
  p.mensajes.forEach((m, i) => t.wa_bandeja_mensajes.push({
    id: nuevoId(), workspace_id: WS, entrega_id: id, wa_message_id: `w-${id}-${i}`, papel: 'contenido',
    cuerpo: m.cuerpo, cuerpo_origen: m.origen ?? 'texto', recibido_at: `2026-09-30T13:0${i}:00Z`, reenviado: true, tipo: 'text',
  }));
  return id;
}

/**
 * La salida del modelo: todo por definir salvo lo que se pase. La historia es extractiva (N7):
 * `citas` son frases que el modelo copió; solo entran las que están en lo que el cliente reenvió.
 */
function modelo(citas: string | string[], valores: Record<string, { valor: string; frase: string }>, extra: Fila = {}) {
  const v: Record<string, unknown> = {};
  for (const f of FIELDS) v[f.slug] = valores[f.slug] ?? { valor: 'por_definir', frase: '' };
  salidaModelo = { citas: Array.isArray(citas) ? citas : [citas], cliente: { nombre: '', telefono: '' }, valores: v, ...extra };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T15:00:00Z'));
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => (k === 'GEMINI_API_KEY' ? 'k' : undefined) } };
  vi.stubGlobal('fetch', vi.fn(async () => {
    // Una cola de salidas: cada llamada al modelo toma la siguiente (la última se repite).
    const s = colaModelo.length > 1 ? colaModelo.shift() : colaModelo.length === 1 ? colaModelo[0] : salidaModelo;
    return new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(s) }] } }],
    }), { status: 200 });
  }));
  colaModelo = [];
  mod = await import('./wa-entendimiento.ts');
  // La espera por los mensajes en camino (la carrera de los webhooks) no corre con reloj de verdad aquí.
  (await import('./wa-bandeja.ts')).esperaEnVuelo.dormir = async () => {};
  t = base();
  db = crearDb(t);
  enviados.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const correr = () => mod.procesarEntendimientos(db as never);
const ent = () => t.wa_bandeja_entendimientos[0];
const bloque = (id: string) => t.negocio_bloques.find(b => b.id === id)!.data as Fila;

// ── La pregunta ─────────────────────────────────────────────────────────────

describe('«¿A qué viaje van?»', () => {
  it('ofrece los abiertos de la línea donde el remitente es responsable, recientes primero, con código, cliente y destino', async () => {
    const id = entrega({ respuesta: '', opciones: null, mensajes: [{ cuerpo: 'hola' }] });
    const r = await mod.armarPreguntaNegocio(db as never, id, WS, 2);
    // n15 (responsable por negocio_responsables) y n14 (responsable_id); no n09 (de otro) ni n01 (cerrado).
    expect(r!.opciones.map(o => o.id)).toEqual(['n15', 'n14']);
    expect(r!.texto).toContain('¿De qué viaje son los 2 mensajes?');
    expect(r!.texto).toContain('1. CARTAGENA 3N · Luis Prueba (T1 26 15)');
    expect(r!.texto).toContain('2. PUNTA CANA NOV · Marta Prueba (T1 26 14)');
    // PR B: sin comandos en mayúsculas; «nuevo» y «descartar» siguen valiendo.
    expect(r!.texto).toContain('Si es un viaje nuevo, escribe «nuevo» y el nombre del cliente; si no va, «descartar».');
    expect(r!.texto).not.toMatch(/\b(?:NUEVO|DESCARTAR|SÍ)\b/);
  });

  it('si los mensajes nombran a un cliente con un único negocio abierto, va primero (y se pregunta igual)', async () => {
    const id = entrega({ respuesta: '', opciones: null, mensajes: [{ cuerpo: 'Audio de Ana Prueba: que al final son tres' }] });
    const r = await mod.armarPreguntaNegocio(db as never, id, WS, 1);
    expect(r!.opciones.map(o => o.id)).toEqual(['n09', 'n15', 'n14']);
    expect(r!.opciones[0].propuesto).toBe(true);
    expect(r!.texto).toContain('¿De qué viaje es el mensaje? Parece de Ana Prueba (el 1).');
  });

  it('sin negocios abiertos en la línea solo se ofrece NUEVO', async () => {
    t.negocios.forEach(n => { n.estado = 'completado'; });
    const id = entrega({ respuesta: '', opciones: null, mensajes: [{ cuerpo: 'hola' }] });
    const r = await mod.armarPreguntaNegocio(db as never, id, WS, 1);
    expect(r!.opciones).toEqual([]);
    expect(r!.texto).toBe('¿De qué cliente es el mensaje? No tienes viajes abiertos: escribe «nuevo» y su nombre, o «descartar».');
  });
});

// ── Cargar en un negocio existente ──────────────────────────────────────────

const OPCIONES = [
  { id: 'n15', codigo: 'T1 26 15', cliente: 'LUIS PRUEBA', destino: 'CARTAGENA', nombre: 'CARTAGENA 3N' },
  { id: 'n14', codigo: 'T1 26 14', cliente: 'MARTA PRUEBA', destino: 'PUNTA CANA', nombre: 'PUNTA CANA NOV' },
];

describe('carga en un negocio existente', () => {
  it('por número: llena los vacíos, NO pisa lo que escribió una persona, deja el conflicto visible y traza en la actividad', async () => {
    entrega({
      respuesta: '2', opciones: OPCIONES,
      mensajes: [{ cuerpo: 'Mejor salimos el 20 de noviembre y volvemos el 27, va mi hijo', origen: 'transcripcion' }],
    });
    modelo('Marta cambió la salida y confirmó que viaja su hijo.', {
      fecha_salida: { valor: '2026-11-20', frase: 'salimos el 20 de noviembre' },
      fecha_regreso: { valor: '2026-11-27', frase: 'volvemos el 27' },
      ninos: { valor: '1', frase: 'va mi hijo' },
    });
    await correr();

    const d = bloque('b14');
    expect(d.fecha_salida).toBe('2026-11-15'); // lo de la persona se queda
    expect(d.adultos).toBe(2);
    expect(d.fecha_regreso).toBe('2026-11-27');
    expect(d.ninos).toBe(1);
    expect(Object.keys(d._sugeridos as Fila)).toEqual(['fecha_regreso', 'ninos']);
    expect((d._conflictos as Fila).fecha_salida).toMatchObject({ valor: '2026-11-20', origen: 'audio', frase: 'salimos el 20 de noviembre' });
    expect(bloque('b15')).toEqual({ destino: 'CARTAGENA' }); // el otro negocio, intacto

    expect(ent()).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n14', destino: 'existente', cargados: ['fecha_regreso', 'ninos'] });
    expect(ent().conflictos).toEqual([{ slug: 'fecha_salida', actual: '2026-11-15', valor: '2026-11-20', frase: 'salimos el 20 de noviembre' }]);

    const nuevas = t.activity_log.filter(a => a.entidad_id === 'n14');
    expect(nuevas).toHaveLength(2);
    expect(nuevas[1].contenido).toMatch(/^Se cargaron 2 datos desde WhatsApp \(Tatiana, 30-sep\)\./);

    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('Cargué en PUNTA CANA NOV · Marta Prueba (T1 26 14): regreso 27 nov, niños 1.');
    expect(enviados[0].texto).toContain('salida (en ONE: 15 nov; el cliente dijo: 20 nov)');
    expect(enviados[0].texto).toContain('1. ¿Desde qué ciudad salen?');
  });

  it('el modelo ve la config y los valores que el negocio ya tiene', async () => {
    entrega({ respuesta: '2', opciones: OPCIONES, mensajes: [{ cuerpo: 'hola' }] });
    modelo('Nada nuevo.', {});
    await correr();
    const cuerpo = JSON.parse(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body));
    const instr = cuerpo.system_instruction.parts[0].text as string;
    expect(instr).toContain('Este viaje YA existe.');
    expect(instr).toContain('- fecha_salida: 2026-11-15');
    expect(Object.keys(cuerpo.generationConfig.responseSchema.properties.valores.properties)).toEqual(FIELDS.map(f => f.slug));
  });

  it('por código (en la lista, sin espacios) y por código fuera de la lista', async () => {
    entrega({ respuesta: 't12614', opciones: OPCIONES, mensajes: [{ cuerpo: 'somos de Medellín' }] });
    modelo('Salen de Medellín.', { ciudad_origen: { valor: 'Medellín', frase: 'somos de Medellín' } });
    await correr();
    expect(ent()).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n14' });
    expect(bloque('b14').ciudad_origen).toBe('MEDELLÍN');

    t.negocio_bloques.push({ id: 'b09', negocio_id: 'n09', data: {}, updated_at: null, bloque_configs: bloqueConfig() });
    const e2 = entrega({ respuesta: 'T1 26 9', opciones: OPCIONES, mensajes: [{ cuerpo: 'a Aruba' }] });
    modelo('Aruba.', { destino: { valor: 'Aruba', frase: 'a Aruba' } });
    await correr();
    expect(t.wa_bandeja_entendimientos.find(x => x.entrega_id === e2)).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n09' });
    expect(bloque('b09').destino).toBe('ARUBA');
  });

  it('la historia se agrega a la actividad sin borrar la anterior', async () => {
    entrega({ respuesta: '2', opciones: OPCIONES, mensajes: [{ cuerpo: 'volvemos el 27' }] });
    modelo(['volvemos el 27', 'La cliente regresa el 27'], { fecha_regreso: { valor: '2026-11-27', frase: 'volvemos el 27' } });
    await correr();
    entrega({ respuesta: '2', opciones: OPCIONES, mensajes: [{ cuerpo: 'somos de Cali' }] });
    modelo('somos de Cali', { ciudad_origen: { valor: 'Cali', frase: 'somos de Cali' } });
    await correr();

    const act = t.activity_log.filter(a => a.entidad_id === 'n14').map(a => String(a.contenido));
    expect(act).toHaveLength(3);
    expect(act[0]).toBe('Historia del 20-sep: primera conversación.');
    // Citas del cliente, no prosa del modelo: la paráfrasis «La cliente regresa el 27» no entra.
    expect(act[1]).toContain('Historia del 30-sep:\nEl cliente dijo:\n«volvemos el 27»');
    expect(act[1]).not.toContain('La cliente regresa');
    expect(act[2]).toContain('Historia del 30-sep:\nEl cliente dijo:\n«somos de Cali»');
    // Y la segunda carga no borró lo que dejó la primera.
    expect(bloque('b14')).toMatchObject({ fecha_regreso: '2026-11-27', ciudad_origen: 'CALI' });
  });

  it('si una persona guarda el bloque mientras se carga, lo suyo gana', async () => {
    entrega({ respuesta: '2', opciones: OPCIONES, mensajes: [{ cuerpo: 'volvemos el 27' }] });
    modelo('Regresan el 27.', { fecha_regreso: { valor: '2026-11-27', frase: 'volvemos el 27' } });
    // La persona escribe el regreso justo después de la lectura del paso (primer update rechazado).
    const orig = db.from;
    let primero = true;
    db.from = ((tabla: string) => {
      const q = orig(tabla);
      if (tabla !== 'negocio_bloques') return q;
      const upd = q.update;
      q.update = ((p: Fila) => {
        if (primero) {
          primero = false;
          Object.assign(t.negocio_bloques.find(b => b.id === 'b14')!, { data: { ...bloque('b14'), fecha_regreso: '2026-11-28' }, updated_at: '2026-09-30T14:59:00Z' });
        }
        return upd(p);
      }) as typeof q.update;
      return q;
    }) as typeof db.from;
    await correr();
    expect(bloque('b14').fecha_regreso).toBe('2026-11-28');
    expect((bloque('b14')._conflictos as Fila).fecha_regreso).toMatchObject({ valor: '2026-11-27' });
  });
});

// ── NUEVO y respuestas que no se entienden ──────────────────────────────────

describe('NUEVO y re-pregunta', () => {
  it('«NUEVO Carla Prueba» pide el «sí» mostrando lo que dice el directorio; con el «sí» y sin llave pide el celular (decisión 1 del 2026-10-05); con él, crea y carga', async () => {
    entrega({ respuesta: 'NUEVO Carla Prueba', opciones: OPCIONES, mensajes: [{ cuerpo: 'quiere ir a Aruba' }] });
    modelo('Quiere ir a Aruba.', { destino: { valor: 'Aruba', frase: 'ir a Aruba' } });
    const antes = t.negocio_bloques.filter(b => b.negocio_id !== undefined).map(b => JSON.stringify(b));
    const negocios = t.negocios.length;
    await correr();
    expect(enviados.map(e => e.texto)).toEqual([
      // «Nuevo» es un viaje nuevo: el directorio no la tiene, y comparte el apellido con tres clientes con viaje abierto.
      [
        'Tanda sin nombre · ¿Va como viaje nuevo de Carla Prueba? No lo tengo en el directorio: después del sí te pido su celular o correo (sin uno de los dos no lo creo).',
        'Ya hay viajes de Luis Prueba (T1 26 15), Marta Prueba (T1 26 14) y Ana Prueba (T1 26 9): si es para uno de esos, responde «el de Cartagena», «el de Punta Cana» o T1 26 9.',
        'Responde sí, o dime el viaje si es uno que ya existe. No he creado ni cargado nada.',
      ].join('\n'),
    ]);
    expect(ent()).toMatchObject({ estado: 'esperando_negocio', destino: 'nuevo', contacto_nombre: 'Carla Prueba', confirmacion_pendiente: null });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled(); // ni siquiera se leyó con el modelo
    expect([t.contactos, t.negocios.length]).toEqual([[], negocios]);
    expect(t.negocio_bloques.map(b => JSON.stringify(b))).toEqual(antes);
    expect(await mod.preguntaAbierta(db as never, WS, TEL)).toMatchObject({ espera: 'viaje', corta: '¿Va como viaje nuevo de Carla Prueba? Sí, el nombre correcto, o dime el viaje si ya existe' });
    expect(await responder('sí')).toBe(true);
    await correr();
    // Sin celular ni correo no se crea: se pide, y nada se crea mientras tanto.
    expect(ent()).toMatchObject({ estado: 'esperando_contacto' });
    expect(enviados.at(-1)!.texto).toBe('Carla Prueba · No tengo a Carla Prueba en el directorio. ¿Me pasas su celular o su correo? Sin uno de los dos no lo creo.');
    expect([t.contactos, t.negocios.length]).toEqual([[], negocios]);
    expect(await responder('300 765 4321')).toBe(true);
    await correr();
    expect(ent()).toMatchObject({ destino: 'nuevo', estado: 'negocio_creado' });
    expect(t.contactos.map(c => [c.nombre, c.telefono])).toEqual([['CARLA PRUEBA', '3007654321']]);
    // La empresa espejo, como la crea la app (diseño 2026-10-05, §1).
    const neg = t.negocios.find(n => n.contacto_id === t.contactos[0].id)!;
    expect(t.empresas).toEqual([expect.objectContaining({ nombre: 'CARLA PRUEBA', tipo_persona: 'natural', contacto_id: t.contactos[0].id })]);
    expect(neg.empresa_id).toBe(t.empresas[0].id);
    expect(t.negocio_bloques.slice(0, antes.length).map(b => JSON.stringify(b))).toEqual(antes); // los existentes no se tocan
  });

  it('«NUEVO Carla Prueba» con UNA Carla Prueba en el directorio: la confirmación la muestra con su celular y el «sí» la usa (decisión 2 del 2026-10-05)', async () => {
    t.contactos.push({ id: 'c-carla', workspace_id: WS, nombre: 'CARLA PRUEBA', telefono: '3001112233' });
    entrega({ respuesta: 'NUEVO Carla Prueba', opciones: OPCIONES, mensajes: [{ cuerpo: 'quiere ir a Aruba' }] });
    modelo('Quiere ir a Aruba.', { destino: { valor: 'Aruba', frase: 'ir a Aruba' } });
    await correr();
    expect(enviados[0].texto).toContain('¿Va como viaje nuevo de Carla Prueba? Ya es cliente: Carla Prueba (cel. …2233); va a su nombre.');
    expect(await responder('sí')).toBe(true);
    await correr();
    // Sin un turno aparte de «¿es el mismo?»: el viaje nuevo va a la ficha que ya existía.
    expect(ent()).toMatchObject({ estado: 'negocio_creado', contacto_id: 'c-carla' });
    expect(t.contactos).toHaveLength(1);
    expect(enviados.at(-1)!.texto).toContain('Lo dejé a nombre de Carla Prueba (cel. …2233), que ya era cliente.');
  });

  it('una respuesta que no se entiende vuelve a preguntar con la MISMA lista; la respuesta nueva se toma y se carga', async () => {
    entrega({ respuesta: 'el de la playa', opciones: OPCIONES, mensajes: [{ cuerpo: 'volvemos el 27' }] });
    modelo('Regresan el 27.', { fecha_regreso: { valor: '2026-11-27', frase: 'volvemos el 27' } });
    await correr();
    expect(ent()).toMatchObject({ estado: 'esperando_negocio' });
    expect(enviados[0].texto).toContain('No entendí «el de la playa».');
    expect(enviados[0].texto).toContain('2. PUNTA CANA NOV · Marta Prueba (T1 26 14)');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled(); // sin destino no se gasta el modelo

    const tomada = await mod.tomarRespuestaContacto(db as never, { workspaceId: WS, phone: TEL, texto: '2', wamid: 'w-resp', enviadoAt: null });
    expect(tomada).toBe(true);
    expect(t.wa_bandeja_mensajes.find(m => m.wa_message_id === 'w-resp')).toMatchObject({ papel: 'respuesta_negocio', cuerpo: '2' });
    expect(ent().respuesta_negocio).toBe('2');

    await correr();
    expect(ent()).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n14' });
    expect(bloque('b14').fecha_regreso).toBe('2026-11-27');
  });

  it('la pregunta vieja (sin lista guardada) sigue el camino de antes: la respuesta es el cliente', async () => {
    entrega({ respuesta: 'Carla Prueba', opciones: null, mensajes: [{ cuerpo: 'quiere ir a Aruba' }] });
    modelo('Quiere ir a Aruba.', { destino: { valor: 'Aruba', frase: 'ir a Aruba' } });
    await correr();
    expect(ent()).toMatchObject({ estado: 'esperando_contacto', contacto_nombre: 'Carla Prueba' });
    expect(ent().destino).toBeUndefined();
  });
});

// ── Varios viajes (modo mixto) y los guardianes, de punta a punta ───────────

function entregaCon(p: { estado?: string; respuesta?: string | null; opciones?: unknown; mensajes: Array<{ cuerpo: string; reenviado?: boolean; min?: number }> }): string {
  const id = nuevoId();
  t.wa_bandeja_entregas.push({
    id, workspace_id: WS, remitente_phone: TEL, remitente_staff_id: STAFF, estado: p.estado ?? 'con_cliente',
    cliente_texto: p.respuesta ?? null, cliente_respondido_at: '2026-09-30T14:00:00Z', negocio_opciones: p.opciones ?? null, plan_viajes: null,
  });
  p.mensajes.forEach((m, i) => t.wa_bandeja_mensajes.push({
    id: nuevoId(), workspace_id: WS, entrega_id: id, wa_message_id: `w-${id}-${i}`, papel: 'contenido', tipo: 'text',
    cuerpo: m.cuerpo, cuerpo_origen: 'texto', reenviado: m.reenviado !== false, segmento: null,
    recibido_at: new Date(Date.parse('2026-09-30T13:00:00Z') + (m.min ?? i) * 60_000).toISOString(),
  }));
  return id;
}

const valoresModelo = (valores: Record<string, { valor: string; frase: string }>, extra: Fila = {}) => {
  const v: Record<string, unknown> = {};
  for (const f of FIELDS) v[f.slug] = valores[f.slug] ?? { valor: 'por_definir', frase: '' };
  return { citas: [], cliente: { nombre: '', telefono: '' }, valores: v, ...extra };
};

const responder = (texto: string) => mod.tomarRespuestaContacto(db as never, { workspaceId: WS, phone: TEL, texto, wamid: `w-${nuevoId()}`, enviadoAt: null });

describe('modo encabezado: manda el encabezado, el reparto se confirma y cada viaje se carga por separado', () => {
  it('encabezados → resumen sin cargar nada → sospechoso «dejar» → «sí» → dos cargas, con la asignación guardada por mensaje', async () => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    const id = entregaCon({
      estado: 'esperando_cliente',
      mensajes: [
        { cuerpo: 'Marta', reenviado: false }, { cuerpo: 'volvemos el 27 de noviembre' },
        { cuerpo: 'Hola Tati, buenas tardes' },
        { cuerpo: 'T1 26 15', reenviado: false }, { cuerpo: 'somos de Medellín' },
      ],
    });
    const antes = JSON.stringify(t.negocio_bloques);
    const r = await mod.armarPreguntaNegocio(db as never, id, WS, 5);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled(); // el modelo ya no asigna
    expect(r!.texto).toContain('Entendí 2 viajes:');
    expect(r!.texto).toContain('1) PUNTA CANA NOV · Marta Prueba (T1 26 14) — 2 mensajes');
    expect(r!.texto).toContain('2) CARTAGENA 3N · Luis Prueba (T1 26 15) — 1 mensaje');
    expect(r!.texto).toContain('   2 «Hola Tati, buenas tardes» (saluda a mitad de la caja'); // numerado sin los encabezados
    expect(r!.texto).toContain('No cargué nada todavía');

    // Lo que hace `preguntarCliente`, y el comercial contesta «sí» sin decidir el sospechoso.
    Object.assign(t.wa_bandeja_entregas.find(e => e.id === id)!, { plan_viajes: r!.plan, estado: 'con_cliente', cliente_texto: 'sí' });
    await correr();
    expect(ent()).toMatchObject({ estado: 'esperando_negocio', segmento: 0 });
    expect(enviados.at(-1)!.texto).toContain('Todavía no lo cargo. ¿Qué hago con el 2 (⚠)?');
    expect(JSON.stringify(t.negocio_bloques)).toBe(antes); // nada cargado

    expect(await responder('dejar el 2')).toBe(true);
    await correr();
    expect(enviados.at(-1)!.texto).toContain('Corregido. Así queda:');
    expect(await responder('sí')).toBe(true);
    colaModelo = [
      valoresModelo({ fecha_regreso: { valor: '2026-11-27', frase: 'volvemos el 27 de noviembre' } }),
      valoresModelo({ ciudad_origen: { valor: 'Medellín', frase: 'somos de Medellín' } }),
    ];
    await correr();

    expect(t.wa_bandeja_entendimientos.map(e => [e.segmento, e.estado, e.negocio_id ?? null])).toEqual([
      [0, 'repartida', null], [1, 'negocio_actualizado', 'n14'], [2, 'negocio_actualizado', 'n15'],
    ]);
    expect(bloque('b14').fecha_regreso).toBe('2026-11-27');
    expect(bloque('b14').ciudad_origen).toBeUndefined(); // lo de Luis no cae en Marta
    expect(bloque('b15').ciudad_origen).toBe('MEDELLÍN');
    const ms = t.wa_bandeja_mensajes.filter(m => m.entrega_id === id && m.papel === 'contenido');
    expect(ms.map(m => m.segmento)).toEqual([null, 1, 1, null, 2]);
    expect(ms.map(m => m.clase ?? null)).toEqual(['encabezado', 'cliente', 'cliente', 'encabezado', 'cliente']);
    expect((ms[1].asignacion as Fila)).toMatchObject({ por: 'encabezado', destino: { negocio_id: 'n14' } });
    expect((ms[2].asignacion as Fila)).toMatchObject({ por: 'comercial' });
    expect(t.wa_bandeja_entregas.find(e => e.id === id)!.plan_confirmado_at).toBeTruthy();
    // El avance en % va una vez por viaje, en el mensaje que cierra su carga; en ningún otro.
    const avance = enviados.filter(e => /— Mínimo \d+\/\d+ \(\d+ %\) · Completo \d+\/\d+ \(\d+ %\)/.test(e.texto));
    expect(avance.map(e => e.texto.split('\n').find(l => l.includes('— Mínimo'))!.split(' — ')[0])).toEqual(['PUNTA CANA NOV · Marta Prueba (T1 26 14)', 'CARTAGENA 3N · Luis Prueba (T1 26 15)']);
    expect(avance.every(e => e.texto.startsWith('Cargué en') || e.texto.startsWith('No encontré'))).toBe(true);
  });

  it('una tanda sin encabezados es un viaje: la pregunta es «¿A qué viaje van?», como en modo uno', async () => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    const id = entregaCon({ estado: 'esperando_cliente', mensajes: [{ cuerpo: 'hola' }, { cuerpo: 'queremos Aruba' }] });
    const r = await mod.armarPreguntaNegocio(db as never, id, WS, 2);
    expect(r!.plan).toBeUndefined();
    expect(r!.texto).toContain('¿De qué viaje ');
  });

  // Trappvel 2026-10-02: la respuesta al aproximado es el número de la lista, no un «sí» (que tampoco es contenido).
  it('un encabezado aproximado no cambia la caja: sin elegir queda sin asignar; con «1», va a su viaje; el «sí» no elige ni es contenido', async () => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    const sin = entregaCon({ estado: 'esperando_cliente', mensajes: [{ cuerpo: 'Martha', reenviado: false }, { cuerpo: 'volvemos el 27 de noviembre' }, { cuerpo: 'sí', reenviado: false }] });
    const r1 = await mod.armarPreguntaNegocio(db as never, sin, WS, 3);
    expect(r1!.texto).toContain('No hay mensajes con un viaje asignado.');
    expect(r1!.texto).toContain('«Martha» puede ser PUNTA CANA NOV · Marta Prueba (T1 26 14) y no elegiste');
    expect(r1!.plan!.encabezados).toEqual([1, 3]);
    const con = entregaCon({ estado: 'esperando_cliente', mensajes: [{ cuerpo: 'Martha', reenviado: false }, { cuerpo: 'volvemos el 27 de noviembre' }, { cuerpo: '1', reenviado: false }] });
    const r2 = await mod.armarPreguntaNegocio(db as never, con, WS, 3);
    expect(r2!.texto).toContain('1) PUNTA CANA NOV · Marta Prueba (T1 26 14) — 1 mensaje');
    expect(r2!.plan!.encabezados).toEqual([1, 3]);
  });

  it('¿espera la tanda abierta la elección de la lista del encabezado?', async () => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    const id = entregaCon({ estado: 'abierta', mensajes: [{ cuerpo: 'Martha', reenviado: false }, { cuerpo: 'volvemos el 27 de noviembre' }] });
    expect(await mod.pendienteDeLaTanda(db as never, WS, TEL, 4)).toMatchObject({ tipo: 'eleccion', texto: 'Martha', candidatos: [{ id: 'n14' }], conContenido: true });
    t.wa_bandeja_mensajes.push({ id: nuevoId(), workspace_id: WS, entrega_id: id, wa_message_id: 'w-si', papel: 'contenido', tipo: 'text', cuerpo: 'sí', cuerpo_origen: 'texto', reenviado: false, segmento: null, recibido_at: '2026-09-30T13:05:00Z' });
    expect(await mod.pendienteDeLaTanda(db as never, WS, TEL, 4)).toMatchObject({ tipo: 'eleccion' }); // el «sí» no elige
    t.wa_bandeja_mensajes.push({ id: nuevoId(), workspace_id: WS, entrega_id: id, wa_message_id: 'w-1', papel: 'contenido', tipo: 'text', cuerpo: '1', cuerpo_origen: 'texto', reenviado: false, segmento: null, recibido_at: '2026-09-30T13:06:00Z' });
    expect(await mod.pendienteDeLaTanda(db as never, WS, TEL, 4)).toBeNull();
  });

  it('QA v5 · el nombre de alguien del equipo (staff o colaborador) no es encabezado, aunque haya un negocio a su nombre', async () => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    t.negocios.push(
      { id: 'n16', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 16', nombre: 'P', estado: 'abierto', created_at: '2026-09-26T10:00:00Z', contacto_id: 'c-t', empresa_id: null, responsable_id: null, contactos: { nombre: 'TATIANA PRUEBA' }, empresas: null },
      { id: 'n17', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 17', nombre: 'Q', estado: 'abierto', created_at: '2026-09-26T10:00:00Z', contacto_id: 'c-e', empresa_id: null, responsable_id: null, contactos: { nombre: 'EDGAR COLABORADOR' }, empresas: null },
    );
    expect((await mod.candidatosDeEncabezado(db as never, WS))!.equipo).toEqual(['TATIANA PRUEBA', 'EDGAR COLABORADOR']);
    for (const firma of ['Tatiana', 'Edgar']) {
      const id = entregaCon({ estado: 'esperando_cliente', mensajes: [{ cuerpo: firma, reenviado: false }, { cuerpo: 'queremos Aruba' }] });
      const r = await mod.armarPreguntaNegocio(db as never, id, WS, 2);
      expect(r!.plan, firma).toBeUndefined(); // sin encabezados: «¿A qué viaje van?»
    }
  });

  it('modo `uno` (default): la pregunta sigue siendo «¿A qué viaje van?» con la lista', async () => {
    const id = entregaCon({ estado: 'esperando_cliente', mensajes: [{ cuerpo: 'Marta', reenviado: false }, { cuerpo: 'hola' }] });
    const r = await mod.armarPreguntaNegocio(db as never, id, WS, 2);
    expect(r!.plan).toBeUndefined();
    expect(r!.texto).toContain('¿De qué viaje ');
  });
});

describe('QA v5 · lo que el bot contesta en el acto a un encabezado (atenderEnBandeja)', () => {
  const USER = { workspace_id: WS, phone: TEL, name: 'X', role: 'operator', collaborator_id: 'col-1', subscription_status: 'active', modulos: { modules: { bandeja_solicitudes_wa: true } } };
  let n = 0;
  const llega = async (texto: string, reenviado = false) => {
    const b = await import('./wa-bandeja.ts');
    const cfg = { ...(await import('./wa-bandeja-reglas.ts')).leerConfigBandeja(t.workspaces[0].config_extra) };
    await b.atenderEnBandeja(db as never, USER as never, { phone: TEL, text: texto, type: 'text', reenviado, wa_message_id: `w-acto-${++n}`, timestamp: '1790000000' } as never, cfg);
  };
  const carolina = { id: 'n18', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 18', nombre: 'SAN ANDRÉS 4N', estado: 'abierto', created_at: '2026-09-26T10:00:00Z', contacto_id: 'c-c', empresa_id: null, responsable_id: null, contactos: { nombre: 'CAROLINA RUIZ' }, empresas: null };

  const LISTA_CAROLINA = '¿De qué viaje es «Carlina»? Hasta que me digas, no asigno lo que sigue.\n1. SAN ANDRÉS 4N · Carolina Ruiz (T1 26 18)\nDime cuál (por ejemplo «el de Carolina»). Si es un viaje nuevo, «nuevo» y el nombre del cliente; o «descartar».';

  // Trappvel 2026-10-02 (regla 3): el aproximado pregunta con la lista numerada, aunque haya un solo candidato.
  it('exacto: «📌»; aproximado: la lista numerada y, con el número, «📌»; la firma del equipo no contesta nada', async () => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    t.negocios.push(carolina);
    await llega('Marta');
    expect(enviados.map(e => e.texto)).toEqual(['📌 PUNTA CANA NOV · Marta Prueba (T1 26 14)']);
    await llega('volvemos el 27 de noviembre', true);
    await llega('Carlina');
    await llega('somos 3 adultos', true);
    // El reenvío que llega antes de elegir vuelve a mostrar la pregunta, corta, una sola vez.
    expect(enviados.map(e => e.texto).slice(1)).toEqual([
      LISTA_CAROLINA,
      'Antes: ¿de qué viaje es «Carlina»? 1. SAN ANDRÉS 4N · Carolina Ruiz (T1 26 18). Lo que mandes queda sin asignar hasta que me digas.',
    ]);
    await llega('1');
    await llega('Tatiana');
    expect(enviados.map(e => e.texto).slice(3)).toEqual(['📌 SAN ANDRÉS 4N · Carolina Ruiz (T1 26 18)']);

    // El reparto al cerrar: lo de Marta en Marta; lo que llegó antes de elegir y lo de después, en Carolina.
    const entrega = t.wa_bandeja_entregas.find(e => e.estado === 'abierta')!;
    const r = await mod.armarPreguntaNegocio(db as never, entrega.id as string, WS, 6);
    expect(r!.plan!.mensajes.filter(x => !x.sospecha).map(x => [x.n, x.destino && 'codigo' in x.destino ? x.destino.codigo : null])).toEqual([[2, 'T1 26 14'], [4, 'T1 26 18'], [6, 'T1 26 18']]);
    expect(r!.plan!.encabezados).toEqual([1, 3, 5]);
    expect(enviados.some(e => e.texto.includes('— Mínimo'))).toBe(false); // los acuses no llevan el avance
  });

  it('un «no» o un «sí» no contestan la lista ni son contenido: «No entendí» y la lista otra vez', async () => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    t.negocios.push(carolina);
    await llega('Carlina');
    await llega('no');
    await llega('sí');
    expect(enviados.map(e => e.texto)).toEqual([LISTA_CAROLINA, `No entendí. ${LISTA_CAROLINA}`, `No entendí. ${LISTA_CAROLINA}`]);
    const entrega = t.wa_bandeja_entregas.find(e => e.estado === 'abierta')!;
    const r = await mod.armarPreguntaNegocio(db as never, entrega.id as string, WS, 3);
    expect(r).toMatchObject({ sinContenido: 'esta tanda' }); // nada que repartir: ni el «no» ni el «sí»
  });

  it('lo que no es respuesta es contenido sin asignar (la pregunta corta, una vez); el número de la lista elige', async () => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    t.negocios.push(carolina);
    await llega('Carlina');
    await llega('mmm no sé');
    await llega('3');
    await llega('1');
    expect(enviados.map(e => e.texto)).toEqual([
      LISTA_CAROLINA,
      'Antes: ¿de qué viaje es «Carlina»? 1. SAN ANDRÉS 4N · Carolina Ruiz (T1 26 18). Lo que mandes queda sin asignar hasta que me digas.',
      `No entendí. ${LISTA_CAROLINA}`,
      '📌 SAN ANDRÉS 4N · Carolina Ruiz (T1 26 18)',
    ]);
  });

  it('QA v6 · «nuevo» suelto: el bot pregunta de quién es; con el nombre, lo busca; los apodos del equipo no contestan', async () => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    await llega('nuevo');
    await llega('vamos a Aruba', true);
    await llega('gracias');
    await llega('Pedro Gómez');
    await llega('Tati');
    // El reenvío vuelve a pedir el nombre (la primera vez); el «gracias», ya con contenido, no.
    // 2026-10-05: «nuevo» es un viaje nuevo («¿Para qué cliente es?»); con el nombre, el bot lo busca en el directorio
    // y, como no lo tiene, pide una llave (sin ella no lo crea).
    expect(enviados.map(e => e.texto)).toEqual([
      'Listo, un viaje nuevo. ¿Para qué cliente es?',
      'Listo, un viaje nuevo. ¿Para qué cliente es?',
      'No tengo a Pedro Gómez en el directorio. ¿Me pasas su celular o su correo? Así reviso que no lo tengamos con otro nombre, y sin uno de los dos no lo creo.',
    ]);
  });

  it('en modo `uno` un nombre escrito no contesta nada', async () => {
    t.negocios.push(carolina);
    await llega('Carolina');
    expect(enviados).toEqual([]);
  });
});

describe('Prueba en vivo del 2026-10-01: dos viajes NUEVO seguidos, una sola pregunta abierta a la vez', () => {
  const USER = { workspace_id: WS, phone: TEL, name: 'X', role: 'operator', collaborator_id: 'col-1', subscription_status: 'active', modulos: { modules: { bandeja_solicitudes_wa: true } } };
  let n = 0;
  let reloj = Date.parse('2026-09-30T15:00:00Z');
  const llega = async (texto: string, reenviado = false) => {
    reloj += 20_000;
    vi.setSystemTime(new Date(reloj));
    const b = await import('./wa-bandeja.ts');
    const cfg = (await import('./wa-bandeja-reglas.ts')).leerConfigBandeja(t.workspaces[0].config_extra);
    await b.atenderEnBandeja(db as never, USER as never, { phone: TEL, text: texto, type: 'text', reenviado, wa_message_id: `w-vivo-${++n}`, timestamp: '1790000000' } as never, cfg);
  };
  /** Lo que hace el cron del entendimiento cada minuto: entiende, atiende respuestas y saca lo que esperaba turno. */
  const cron = async () => {
    reloj += 60_000;
    vi.setSystemTime(new Date(reloj));
    await mod.procesarEntendimientos(db as never);
    await (await import('./wa-bandeja.ts')).enviarPreguntasEnCola(db as never);
  };
  const textos = () => enviados.map(e => e.texto);
  const laura = () => valoresModelo({ destino: { valor: 'Cartagena', frase: 'ir a Cartagena' }, adultos: { valor: '2', frase: 'somos 2 adultos' } });
  const diego = () => valoresModelo({ destino: { valor: 'San Andrés', frase: 'para San Andrés' }, adultos: { valor: '3', frase: 'vamos 3 adultos' } });

  beforeEach(() => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    reloj = Date.parse('2026-09-30T15:00:00Z');
  });

  it('la secuencia exacta: los dos viajes quedan cargados, sin «Anotado.» y ninguna respuesta va al viaje equivocado', async () => {
    // 2026-10-05: el cliente nuevo viene con su celular en el encabezado (sin llave no se crea: decisión 1).
    await llega('nuevo Laura Prueba 300 111 2233');
    // Comparte el apellido con tres clientes con viaje abierto: el acuse lo dice (cuarto control de Vera).
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Laura Prueba, cliente nuevo (cel. 300 111 2233). Lo creo cuando me digas que sí en el resumen.\nReenvíame lo que te pidió y al final te muestro el resumen.\nYa hay viajes de Luis Prueba (T1 26 15), Marta Prueba (T1 26 14) y Ana Prueba (T1 26 9): si es para uno de esos, escribe su nombre (por ejemplo «CARTAGENA 3N»).');
    await llega('Hola, queremos ir a Cartagena, somos 2 adultos', true);
    await llega('listo');
    expect(textos().at(-1)).toMatch(/^Laura Prueba · ¿Lo cargo así\?\nEntendí 1 viaje:\n1\) Viaje nuevo de Laura Prueba \(cliente nuevo, cel\. 300 111 2233\) — 1 mensaje\n   1 «Hola, queremos ir a Cartagena/);
    await llega('sí');
    expect(textos()).not.toContain('Anotado.');
    salidaModelo = laura();
    await cron();
    expect(textos().some(x => x.includes('No tengo'))).toBe(false);
    await llega('Nuevo Diego Prueba 300 444 5566');
    for (const x of ['para San Andrés', 'vamos 3 adultos', 'del 5 al 9 de diciembre', 'hotel todo incluido']) await llega(x, true);
    await llega('listo');
    expect(textos().at(-1)).toMatch(/^Diego Prueba · ¿Lo cargo así\?\nEntendí 1 viaje:\n1\) Viaje nuevo de Diego Prueba \(cliente nuevo, cel\. 300 444 5566\) — 4 mensajes/);
    await llega('Si');
    salidaModelo = diego();
    await cron();

    expect(t.contactos.map(c => [c.nombre, c.telefono]).sort()).toEqual([['DIEGO PRUEBA', '3004445566'], ['LAURA PRUEBA', '3001112233']]);
    const creados = t.wa_bandeja_entendimientos.filter(e => e.estado === 'negocio_creado');
    expect(creados).toHaveLength(2);
    const porContacto = new Map(t.contactos.map(c => [c.id, c.nombre]));
    const negocio = (nombre: string) => t.negocios.find(x => porContacto.get(x.contacto_id as string) === nombre)!;
    const bloqueDe = (nombre: string) => t.negocio_bloques.find(b => b.negocio_id === negocio(nombre).id)!.data as Fila;
    expect(bloqueDe('LAURA PRUEBA')).toMatchObject({ destino: 'CARTAGENA' });
    expect(bloqueDe('DIEGO PRUEBA')).toMatchObject({ destino: 'SAN ANDRÉS' });
    // Ninguna respuesta quedó como respuesta de contacto (la falla en vivo: el «Si» de Diego fue a Laura).
    expect(t.wa_bandeja_mensajes.filter(m => m.papel === 'respuesta_contacto')).toEqual([]);
    expect(t.wa_bandeja_entregas.every(e => e.estado === 'con_cliente')).toBe(true);
  });

  it('con el resumen de Laura esperando su celular (sin llave no se crea), Diego espera turno y la llave va a la única pregunta abierta', async () => {
    await llega('nuevo Laura Prueba');
    expect(textos().at(-1)).toBe('No tengo a Laura Prueba en el directorio. ¿Me pasas su celular o su correo? Así reviso que no lo tengamos con otro nombre, y sin uno de los dos no lo creo.\nYa hay viajes de Luis Prueba (T1 26 15), Marta Prueba (T1 26 14) y Ana Prueba (T1 26 9): si es para uno de esos, escribe su nombre (por ejemplo «CARTAGENA 3N»).');
    await llega('Hola, queremos ir a Cartagena, somos 2 adultos', true);
    await llega('listo');
    expect(textos().at(-1)).toContain('1) Viaje nuevo de Laura Prueba (no lo tengo en el directorio: falta su celular o correo) — 1 mensaje');
    expect(textos().at(-1)).toMatch(/^Laura Prueba · ¿Me pasas el celular o el correo de Laura Prueba\?/);
    // El «sí» no crea sin la llave.
    await llega('sí');
    await cron();
    expect(textos().at(-1)).toMatch(/^Laura Prueba · Todavía no lo cargo\. ¿Me pasas el celular o el correo de Laura Prueba\?/);
    expect(t.contactos).toEqual([]);

    // Un encabezado nuevo con la pregunta abierta: su acuse y se recuerda la pendiente en una línea.
    await llega('Nuevo Diego Prueba 300 444 5566');
    expect(textos().at(-1)).toBe([
      'Va como viaje nuevo de Diego Prueba, cliente nuevo (cel. 300 444 5566). Lo creo cuando me digas que sí en el resumen.',
      'Reenvíame lo que te pidió y al final te muestro el resumen.',
      'Ya hay viajes de Luis Prueba (T1 26 15), Marta Prueba (T1 26 14) y Ana Prueba (T1 26 9): si es para uno de esos, escribe su nombre (por ejemplo «CARTAGENA 3N»).',
      'Primero: Laura Prueba · ¿Lo cargo así?',
    ].join('\n'));
    for (const x of ['para San Andrés', 'vamos 3 adultos', 'del 5 al 9 de diciembre', 'hotel todo incluido']) await llega(x, true);
    await llega('listo');
    // El resumen de Diego no sale: espera turno.
    expect(textos().at(-1)).toBe('Primero: Laura Prueba · ¿Lo cargo así?\nLo que acabas de mandar te lo pregunto después.');
    expect(textos().some(x => x.startsWith('Diego Prueba · Entendí'))).toBe(false);

    await llega('300 111 2233'); // la llave va a la única pregunta abierta: la de Laura
    await cron();
    expect(textos().at(-1)).toContain('1) Viaje nuevo de Laura Prueba (cliente nuevo, cel. 300 111 2233) — 1 mensaje');
    await llega('sí');
    salidaModelo = laura();
    await cron();
    expect(t.contactos.map(c => c.nombre)).toEqual(['LAURA PRUEBA']);
    // Contestada la de Laura, sale la de Diego.
    expect(textos().at(-1)).toMatch(/^Diego Prueba · ¿Lo cargo así\?\nEntendí 1 viaje:/);
    await llega('SI');
    salidaModelo = diego();
    await cron();
    expect(t.contactos.map(c => c.nombre).sort()).toEqual(['DIEGO PRUEBA', 'LAURA PRUEBA']);
    expect(t.wa_bandeja_entendimientos.filter(e => e.estado === 'negocio_creado')).toHaveLength(2);
  });

  it('dos viajes nuevos de clientes que ya existen (nombre idéntico y único): el resumen los muestra y el «sí» los carga en sus fichas, sin crear a nadie', async () => {
    t.contactos.push({ id: 'c-laura', workspace_id: WS, nombre: 'LAURA PRUEBA', telefono: null }, { id: 'c-diego', workspace_id: WS, nombre: 'DIEGO PRUEBA', telefono: '3009998877' });
    await llega('nuevo Laura Prueba');
    await llega('Hola, queremos ir a Cartagena, somos 2 adultos', true);
    await llega('nuevo Diego Prueba');
    await llega('vamos 3 adultos para San Andrés', true);
    await llega('listo');
    const resumen = textos().at(-1)!;
    expect(resumen).toContain('1) Viaje nuevo de Laura Prueba (ya es cliente: sin celular ni correo, sin viajes) — 1 mensaje');
    expect(resumen).toContain('2) Viaje nuevo de Diego Prueba (ya es cliente: cel. …8877, sin viajes) — 1 mensaje');
    await llega('Sí');
    colaModelo = [laura(), diego()];
    await cron();
    expect(textos().some(x => x.includes('¿Es la misma persona?'))).toBe(false);
    expect(t.wa_bandeja_entendimientos.filter(e => e.estado === 'negocio_creado').map(e => e.contacto_id).sort()).toEqual(['c-diego', 'c-laura']);
    expect(t.contactos).toHaveLength(2);
  });
});

describe('guardianes en la ejecución', () => {
  it('N6 + 2026-10-03: al aviso de viaje equivocado, «nuevo X» tampoco crea sin el «sí»; con él, crea y el viaje avisado queda intacto', async () => {
    entregaCon({ respuesta: '1', opciones: OPCIONES, mensajes: [{ cuerpo: 'Confirmamos Punta Cana, salimos de Bogotá' }] });
    salidaModelo = valoresModelo({ destino: { valor: 'Punta Cana', frase: 'Confirmamos Punta Cana' }, ciudad_origen: { valor: 'Bogotá', frase: 'salimos de Bogotá' } });
    await correr();
    expect(ent()).toMatchObject({ confirmacion_pendiente: 'cruce' });
    await responder('nuevo Ignacio Salgar');
    await correr();
    expect(enviados.at(-1)!.texto).toContain('¿Va como viaje nuevo de Ignacio Salgar? No lo tengo en el directorio: después del sí te pido su celular o correo');
    expect(t.contactos).toEqual([]);
    await responder('sí');
    await correr();
    // Sin llave no se crea (2026-10-05): se pide, y con ella se crea.
    expect(t.contactos).toEqual([]);
    expect(enviados.at(-1)!.texto).toContain('¿Me pasas su celular o su correo?');
    await responder('ignacio.salgar@correo.co');
    await correr();
    expect(t.contactos.map(c => [c.nombre, c.email])).toEqual([['IGNACIO SALGAR', 'ignacio.salgar@correo.co']]);
    expect(ent()).toMatchObject({ estado: 'negocio_creado', destino: 'nuevo' });
    expect(bloque('b15')).toEqual({ destino: 'CARTAGENA' });
  });

  it('un viaje del reparto con el aviso de viaje equivocado: «nuevo X» pide el «sí» (con el código, no hay lista) y el «sí» crea', async () => {
    t.workspaces[0].config_extra = { bandeja_solicitudes: { modo_viajes: 'encabezado' } };
    const id = entregaCon({ estado: 'esperando_cliente', mensajes: [{ cuerpo: 'T1 26 15', reenviado: false }, { cuerpo: 'Confirmamos Curazao, salimos de Bogotá' }] });
    const r = await mod.armarPreguntaNegocio(db as never, id, WS, 2);
    Object.assign(t.wa_bandeja_entregas.find(e => e.id === id)!, { plan_viajes: r!.plan, estado: 'con_cliente', cliente_texto: 'sí' });
    salidaModelo = valoresModelo({ destino: { valor: 'Curazao', frase: 'Confirmamos Curazao' }, ciudad_origen: { valor: 'Bogotá', frase: 'salimos de Bogotá' } });
    await correr();
    const seg = () => t.wa_bandeja_entendimientos.find(e => e.segmento === 1)!;
    expect(seg()).toMatchObject({ confirmacion_pendiente: 'cruce', destino: 'existente' });
    await responder('nuevo Ignacio Salgar 3201234567');
    await correr();
    expect(enviados.at(-1)!.texto).toContain('¿Va como viaje nuevo de Ignacio Salgar? No lo tengo en el directorio: lo creo como cliente nuevo, con cel. 320 123 4567.');
    expect(enviados.at(-1)!.texto).toContain('Responde sí, o dime el viaje si es uno que ya existe.');
    expect(seg()).toMatchObject({ estado: 'esperando_negocio', destino: 'nuevo', contacto_nombre: 'Ignacio Salgar' });
    expect(t.contactos).toEqual([]);
    expect(bloque('b15')).toEqual({ destino: 'CARTAGENA' });
    await responder('sí');
    await correr();
    expect(t.contactos.map(c => c.nombre)).toEqual(['IGNACIO SALGAR']);
    expect(seg()).toMatchObject({ estado: 'negocio_creado' });
    expect(bloque('b15')).toEqual({ destino: 'CARTAGENA' });
  });

  it('N6 · C1: mensajes de otro destino no se cargan sin aviso; con «sí» se cargan sin volver a llamar al modelo', async () => {
    entregaCon({ respuesta: '1', opciones: OPCIONES, mensajes: [{ cuerpo: 'Confirmamos Punta Cana, salimos de Bogotá' }] });
    salidaModelo = valoresModelo({ destino: { valor: 'Punta Cana', frase: 'Confirmamos Punta Cana' }, ciudad_origen: { valor: 'Bogotá', frase: 'salimos de Bogotá' } });
    await correr();
    expect(ent()).toMatchObject({ estado: 'esperando_negocio', confirmacion_pendiente: 'cruce', negocio_destino_id: 'n15' });
    expect(enviados[0].texto).toContain('¿Seguro que estos mensajes van en CARTAGENA 3N · Luis Prueba (T1 26 15)? Hablan de Punta Cana y ese viaje va a CARTAGENA; no cargué nada.');
    expect(bloque('b15')).toEqual({ destino: 'CARTAGENA' });

    await responder('sí');
    await correr();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(ent()).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n15', confirmacion_pendiente: null });
    expect(bloque('b15').ciudad_origen).toBe('BOGOTÁ');
    expect((bloque('b15')._conflictos as Fila).destino).toMatchObject({ valor: 'Punta Cana' });
  });

  it('N4 · B3: sin solicitud no se crea un negocio; DESCARTAR lo cierra', async () => {
    entregaCon({ respuesta: 'NUEVO Pedro Prueba', opciones: OPCIONES, mensajes: [{ cuerpo: 'jajaja' }, { cuerpo: 'buenas noches' }] });
    salidaModelo = valoresModelo({}, { mensajes: [{ n: 1, clase: 'ruido' }, { n: 2, clase: 'ruido' }] });
    const negocios = t.negocios.length;
    await correr();
    await responder('sí'); // «¿Creo el cliente nuevo «Pedro Prueba»?»
    await correr();
    expect(enviados[1].texto).toContain('¿Es una solicitud de viaje? No la vi en estos 2 mensajes');
    expect(ent()).toMatchObject({ estado: 'esperando_negocio', confirmacion_pendiente: 'sin_solicitud' });
    expect(t.negocios.length).toBe(negocios);
    expect(t.contactos).toEqual([]);
    await responder('DESCARTAR');
    await correr();
    expect(ent()).toMatchObject({ estado: 'descartada' });
    expect(t.negocios.length).toBe(negocios);
  });

  it('N5 · D1: dos solicitudes no se mezclan; el bot sugiere repetir con encabezados y DESCARTAR cierra', async () => {
    entregaCon({ respuesta: 'NUEVO Carolina Prueba', opciones: OPCIONES, mensajes: [
      { cuerpo: 'Hola, soy Carolina, queremos Aruba del 5 al 10 de diciembre' }, { cuerpo: 'Buenas, soy Luisa, para Curazao somos 2' },
    ] });
    salidaModelo = valoresModelo({ destino: { valor: 'Aruba', frase: 'queremos Aruba' } }, {
      solicitudes: [{ cliente: 'Carolina', destino: 'Aruba', frase: 'soy Carolina, queremos Aruba' }, { cliente: 'Luisa', destino: 'Curazao', frase: 'soy Luisa, para Curazao' }],
    });
    const negocios = t.negocios.length;
    await correr();
    await responder('sí'); // «¿Creo el cliente nuevo «Carolina Prueba»?»
    await correr();
    expect(enviados[1].texto).toContain('¿Me las reenvías por separado? Veo dos solicitudes distintas (Carolina: Aruba · Luisa: Curazao)');
    expect(enviados[1].texto).toContain('después de su encabezado');
    expect(t.negocios.length).toBe(negocios);

    // «SEPARAR» ya no existe (el modelo no reparte): se repite la pregunta.
    await responder('SEPARAR');
    await correr();
    expect(enviados.at(-1)!.texto).toContain('No mezclo dos solicitudes: responde «descartar»');
    await responder('DESCARTAR');
    await correr();
    expect(ent()).toMatchObject({ estado: 'descartada' });
    expect(t.negocios.length).toBe(negocios);
  });

  it('N9 · NUEVO sin nombre: el bot pide el nombre; «NUEVO Marta Gómez» se muestra tal cual; sin llave no se crea, con ella sí', async () => {
    entregaCon({ respuesta: 'NUEVO', opciones: OPCIONES, mensajes: [{ cuerpo: 'queremos ir a Aruba' }] });
    salidaModelo = valoresModelo({ destino: { valor: 'Aruba', frase: 'ir a Aruba' } });
    await correr();
    expect(ent()).toMatchObject({ estado: 'esperando_contacto' });
    expect(enviados[0].texto).toContain('¿Para qué cliente es? No veo su nombre en los mensajes; escríbeme su nombre, o su celular o correo.');

    await responder('NUEVO Marta Gómez');
    await correr();
    // Un nombre que el bot no había mostrado no se crea así: se muestra tal cual (2026-10-03), y sin llave se pide (2026-10-05).
    expect(ent()).toMatchObject({ estado: 'esperando_contacto', contacto_nombre: 'Marta Gómez' });
    expect(enviados.at(-1)!.texto).toContain('No tengo a Marta Gómez en el directorio. ¿Me pasas su celular o su correo? Sin uno de los dos no lo creo.');
    expect(t.contactos).toEqual([]);
    await responder('NUEVO');
    await correr();
    expect(t.contactos).toEqual([]); // NUEVO a secas no basta: falta la llave
    await responder('@martagomez.viajes');
    await correr();
    expect(ent()).toMatchObject({ estado: 'negocio_creado' });
    expect(t.contactos.map(c => [c.nombre, c.usuario_whatsapp])).toEqual([['MARTA GÓMEZ', 'martagomez.viajes']]);
  });
});
