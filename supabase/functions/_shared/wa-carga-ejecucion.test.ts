import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const UNICOS: Record<string, string> = { wa_bandeja_mensajes: 'wa_message_id', wa_bandeja_entendimientos: 'entrega_id' };

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
        const col = upsertOpts.onConflict!;
        if (t[tabla].some(x => x[col] === f[col])) return { data: [], error: null };
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
  return { from, rpc: () => { throw new Error('rpc no esperado'); } };
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
    negocios: [
      { id: 'n14', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 14', nombre: 'X', estado: 'abierto', created_at: '2026-09-20T10:00:00Z', contacto_id: 'c-marta', empresa_id: null, responsable_id: STAFF, contactos: { nombre: 'MARTA PRUEBA' }, empresas: null, workspaces: { slug: 'agencia' } },
      { id: 'n15', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 15', nombre: 'Y', estado: 'abierto', created_at: '2026-09-25T10:00:00Z', contacto_id: 'c-luis', empresa_id: null, responsable_id: null, contactos: { nombre: 'LUIS PRUEBA' }, empresas: null, workspaces: { slug: 'agencia' } },
      { id: 'n09', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 9', nombre: 'Z', estado: 'abierto', created_at: '2026-09-01T10:00:00Z', contacto_id: 'c-ana', empresa_id: null, responsable_id: null, contactos: { nombre: 'ANA PRUEBA' }, empresas: null, workspaces: { slug: 'agencia' } },
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
  };
}

let t: Tablas;
let db: ReturnType<typeof crearDb>;
let salidaModelo: unknown;
let mod: typeof import('./wa-entendimiento.ts');

function entrega(p: { respuesta: string; opciones: unknown; mensajes: Array<{ cuerpo: string; origen?: string }> }): string {
  const id = nuevoId();
  t.wa_bandeja_entregas.push({
    id, workspace_id: WS, remitente_phone: TEL, remitente_staff_id: STAFF, estado: 'con_cliente',
    cliente_texto: p.respuesta, cliente_respondido_at: '2026-09-30T14:00:00Z', negocio_opciones: p.opciones,
  });
  p.mensajes.forEach((m, i) => t.wa_bandeja_mensajes.push({
    id: nuevoId(), workspace_id: WS, entrega_id: id, wa_message_id: `w-${id}-${i}`, papel: 'contenido',
    cuerpo: m.cuerpo, cuerpo_origen: m.origen ?? 'texto', recibido_at: `2026-09-30T13:0${i}:00Z`,
  }));
  return id;
}

/** La salida del modelo: todo por definir salvo lo que se pase. */
function modelo(historia: string, valores: Record<string, { valor: string; frase: string }>) {
  const v: Record<string, unknown> = {};
  for (const f of FIELDS) v[f.slug] = valores[f.slug] ?? { valor: 'por_definir', frase: '' };
  salidaModelo = { historia, cliente: { nombre: '', telefono: '' }, valores: v };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T15:00:00Z'));
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => (k === 'GEMINI_API_KEY' ? 'k' : undefined) } };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(salidaModelo) }] } }],
  }), { status: 200 })));
  mod = await import('./wa-entendimiento.ts');
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
    expect(r!.texto).toContain('Recibí 2 mensajes. ¿A qué viaje van?');
    expect(r!.texto).toContain('1. T1 26 15 · LUIS PRUEBA · CARTAGENA');
    expect(r!.texto).toContain('2. T1 26 14 · MARTA PRUEBA · PUNTA CANA');
    expect(r!.texto).toContain('NUEVO');
  });

  it('si los mensajes nombran a un cliente con un único negocio abierto, va primero (y se pregunta igual)', async () => {
    const id = entrega({ respuesta: '', opciones: null, mensajes: [{ cuerpo: 'Audio de Ana Prueba: que al final son tres' }] });
    const r = await mod.armarPreguntaNegocio(db as never, id, WS, 1);
    expect(r!.opciones.map(o => o.id)).toEqual(['n09', 'n15', 'n14']);
    expect(r!.opciones[0].propuesto).toBe(true);
    expect(r!.texto).toContain('Parece de ANA PRUEBA: es la 1.');
  });

  it('sin negocios abiertos en la línea solo se ofrece NUEVO', async () => {
    t.negocios.forEach(n => { n.estado = 'completado'; });
    const id = entrega({ respuesta: '', opciones: null, mensajes: [{ cuerpo: 'hola' }] });
    const r = await mod.armarPreguntaNegocio(db as never, id, WS, 1);
    expect(r!.opciones).toEqual([]);
    expect(r!.texto).toBe('Recibí 1 mensaje. No tienes viajes abiertos: escribe NUEVO y el nombre del cliente para crear el viaje.');
  });
});

// ── Cargar en un negocio existente ──────────────────────────────────────────

const OPCIONES = [
  { id: 'n15', codigo: 'T1 26 15', cliente: 'LUIS PRUEBA', destino: 'CARTAGENA' },
  { id: 'n14', codigo: 'T1 26 14', cliente: 'MARTA PRUEBA', destino: 'PUNTA CANA' },
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
    expect(enviados[0].texto).toContain('Cargué en T1 26 14: regreso 27 nov, niños 1.');
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
    modelo('Segunda conversación: regresan el 27.', { fecha_regreso: { valor: '2026-11-27', frase: 'volvemos el 27' } });
    await correr();
    entrega({ respuesta: '2', opciones: OPCIONES, mensajes: [{ cuerpo: 'somos de Cali' }] });
    modelo('Tercera conversación: salen de Cali.', { ciudad_origen: { valor: 'Cali', frase: 'somos de Cali' } });
    await correr();

    const act = t.activity_log.filter(a => a.entidad_id === 'n14').map(a => String(a.contenido));
    expect(act).toHaveLength(3);
    expect(act[0]).toBe('Historia del 20-sep: primera conversación.');
    expect(act[1]).toContain('Historia del 30-sep:\nSegunda conversación: regresan el 27.');
    expect(act[2]).toContain('Historia del 30-sep:\nTercera conversación: salen de Cali.');
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
  it('NUEVO sigue el camino de siempre (buscar o crear el contacto) y no toca los negocios existentes', async () => {
    entrega({ respuesta: 'NUEVO Carla Prueba', opciones: OPCIONES, mensajes: [{ cuerpo: 'quiere ir a Aruba' }] });
    modelo('Quiere ir a Aruba.', { destino: { valor: 'Aruba', frase: 'ir a Aruba' } });
    const antes = JSON.stringify(t.negocio_bloques);
    await correr();
    expect(ent()).toMatchObject({ destino: 'nuevo', estado: 'esperando_contacto', contacto_nombre: 'Carla Prueba' });
    expect(JSON.stringify(t.negocio_bloques)).toBe(antes);
    expect(enviados[0].texto).toContain('No encontré a «Carla Prueba»');
  });

  it('una respuesta que no se entiende vuelve a preguntar con la MISMA lista; la respuesta nueva se toma y se carga', async () => {
    entrega({ respuesta: 'el de marta', opciones: OPCIONES, mensajes: [{ cuerpo: 'volvemos el 27' }] });
    modelo('Regresan el 27.', { fecha_regreso: { valor: '2026-11-27', frase: 'volvemos el 27' } });
    await correr();
    expect(ent()).toMatchObject({ estado: 'esperando_negocio' });
    expect(enviados[0].texto).toContain('No entendí «el de marta».');
    expect(enviados[0].texto).toContain('2. T1 26 14 · MARTA PRUEBA · PUNTA CANA');
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
    modelo('Quiere ir a Aruba.', {});
    await correr();
    expect(ent()).toMatchObject({ estado: 'esperando_contacto', contacto_nombre: 'Carla Prueba' });
    expect(ent().destino).toBeUndefined();
  });
});
