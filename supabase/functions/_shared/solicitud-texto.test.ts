import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La solicitud de viaje sin formulario, de punta a punta: pegar → «Entender» → resumen →
 * «Cargar», contra una base en memoria que APLICA los filtros (la misma receta que
 * `wa-carga-ejecucion.test.ts`). Lo que se cuida:
 *   · «Entender» no escribe en ningún negocio; «Cargar» deja el MISMO rastro que un reenvío al
 *     bot (materia prima, entendimiento, `_sugeridos` con `entrega_id`, traza), con `fuente: 'web'`;
 *   · una entrega web nunca la toma el cron ni contesta por WhatsApp;
 *   · los guardianes aplican igual a lo pegado.
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
        if (tabla === 'wa_bandeja_mensajes') {
          for (const f of filas) if (t[tabla].some(x => x.wa_message_id === f.wa_message_id)) return { data: null, error: { message: 'duplicate key value' } };
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
  return { from };
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
    wa_collaborators: [],
    negocios: [
      { id: 'n14', workspace_id: WS, linea_id: LINEA, codigo: 'T1 26 14', nombre: 'PUNTA CANA NOV', estado: 'abierto', created_at: '2026-09-20T10:00:00Z', contacto_id: 'c-marta', empresa_id: null, responsable_id: STAFF, contactos: { nombre: 'MARTA PRUEBA' }, empresas: null, workspaces: { slug: 'agencia' } },
    ],
    negocio_responsables: [],
    negocio_bloques: [
      { id: 'b14', negocio_id: 'n14', data: { destino: 'PUNTA CANA', fecha_salida: '2026-11-15', adultos: 2 }, updated_at: '2026-09-21T10:00:00Z', bloque_configs: bloqueConfig() },
    ],
    activity_log: [],
    wa_bandeja_entregas: [],
    wa_bandeja_mensajes: [],
    wa_bandeja_entendimientos: [],
    etapas_negocio: [{ id: 'et1', linea_id: LINEA, orden: 1, stage: 'venta' }],
    bloque_configs: [{ id: 'bc1', etapa_id: 'et1', workspace_id: WS, orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' } }],
    contactos: [{ id: 'c-marta', workspace_id: WS, nombre: 'MARTA PRUEBA', telefono: '3005550000' }],
    staff_areas: [{ staff_id: STAFF, area: 'comercial' }],
  };
}

let t: Tablas;
let db: ReturnType<typeof crearDb>;
let salidaModelo: unknown;
let respuestaModelo: () => Response;
let st: typeof import('./solicitud-texto.ts');
let bot: typeof import('./wa-entendimiento.ts');
const CTX = { workspaceId: WS, staffId: STAFF };

function modelo(citas: string | string[], valores: Record<string, { valor: string; frase: string }>, extra: Fila = {}) {
  const v: Record<string, unknown> = {};
  for (const f of FIELDS) v[f.slug] = valores[f.slug] ?? { valor: 'por_definir', frase: '' };
  salidaModelo = { citas: Array.isArray(citas) ? citas : [citas], cliente: { nombre: '', telefono: '' }, valores: v, ...extra };
}

const ok = () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(salidaModelo) }] } }] }), { status: 200 });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T15:00:00Z'));
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => (k === 'GEMINI_API_KEY' ? 'k' : undefined) } };
  respuestaModelo = ok;
  vi.stubGlobal('fetch', vi.fn(async () => respuestaModelo()));
  st = await import('./solicitud-texto.ts');
  bot = await import('./wa-entendimiento.ts');
  t = base();
  db = crearDb(t);
  enviados.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const TEXTO_NUEVO = 'Hola, soy Lucía. Queremos ir a Lisboa, salimos el 20 de noviembre y volvemos el 27. Somos 2 adultos desde Bogotá.';
function modeloNuevo() {
  modelo('Queremos ir a Lisboa', {
    destino: { valor: 'Lisboa', frase: 'ir a Lisboa' },
    fecha_salida: { valor: '2026-11-20', frase: 'salimos el 20 de noviembre' },
    fecha_regreso: { valor: '2026-11-27', frase: 'volvemos el 27' },
    adultos: { valor: '2', frase: 'Somos 2 adultos' },
  }, { cliente: { nombre: 'Lucía', telefono: '' } });
}

// ── Negocio nuevo ───────────────────────────────────────────────────────────

describe('negocio nuevo: pegar → resumen → «¿De quién es?» → cargar', () => {
  it('«Entender» guarda la materia prima y arma el resumen sin tocar ningún negocio', async () => {
    modeloNuevo();
    const antes = { negocios: t.negocios.length, bloques: JSON.stringify(t.negocio_bloques), act: t.activity_log.length };
    const r = await st.entenderTexto(db as never, CTX, { texto: TEXTO_NUEVO, quien: 'cliente' });
    if (!r.ok) throw new Error(r.mensaje);

    expect(r.aviso).toBeNull();
    expect(r.resumen).toBe('Entendí: Lisboa, 20-27 nov, 2 adultos.');
    expect(r.filas.map(f => [f.slug, f.grupo, f.legible])).toEqual([
      ['destino', 'nuevo', 'Lisboa'], ['fecha_salida', 'nuevo', '20 nov'], ['fecha_regreso', 'nuevo', '27 nov'], ['adultos', 'nuevo', '2'],
    ]);
    expect(r.contacto).toEqual({ tipo: 'ninguno', nombre: 'Lucía', telefono: null });

    // Nada cambió en los negocios.
    expect(t.negocios).toHaveLength(antes.negocios);
    expect(JSON.stringify(t.negocio_bloques)).toBe(antes.bloques);
    expect(t.activity_log).toHaveLength(antes.act);

    // La materia prima: entrega web sin teléfono, cerrada; mensaje con id `web:`, clase anotada.
    expect(t.wa_bandeja_entregas).toHaveLength(1);
    expect(t.wa_bandeja_entregas[0]).toMatchObject({ canal: 'web', remitente_phone: null, remitente_staff_id: STAFF, estado: 'con_cliente', motivo_cierre: 'web' });
    expect(t.wa_bandeja_mensajes).toHaveLength(1);
    expect(t.wa_bandeja_mensajes[0]).toMatchObject({ papel: 'contenido', reenviado: true, cuerpo: TEXTO_NUEVO, clase: 'cliente' });
    expect(String(t.wa_bandeja_mensajes[0].wa_message_id)).toMatch(/^web:/);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ canal: 'web', estado: 'por_confirmar', remitente_phone: null, finish_reason: 'STOP' });
    expect(enviados).toEqual([]);
  });

  it('«Cargar» con cliente nuevo crea contacto y viaje; lo cargado queda SUGERIDO con fuente web, con su traza', async () => {
    modeloNuevo();
    const r = await st.entenderTexto(db as never, CTX, { texto: TEXTO_NUEVO, quien: 'cliente' });
    if (!r.ok) throw new Error(r.mensaje);
    const c = await st.cargarTexto(db as never, CTX, { entendimientoId: r.entendimientoId, contacto: { tipo: 'nuevo', nombre: 'Lucía Prueba' } });
    if (!c.ok) throw new Error(c.mensaje);

    expect(c.mensaje).toBe('Cargué 4 datos. Faltan 2 para cotizar.');
    expect(t.contactos.map(x => x.nombre)).toContain('LUCÍA PRUEBA');
    const neg = t.negocios.find(n => n.id === c.negocioId)!;
    expect(neg).toMatchObject({ nombre: 'LISBOA NOV 20-27', linea_id: LINEA, responsable_id: STAFF });
    const d = t.negocio_bloques.find(b => b.negocio_id === c.negocioId)!.data as Fila;
    expect(d.destino).toBe('LISBOA');
    const marcas = d._sugeridos as Record<string, Fila>;
    expect(Object.keys(marcas)).toEqual(['destino', 'fecha_salida', 'fecha_regreso', 'adultos']);
    expect(marcas.destino).toMatchObject({ fuente: 'web', entrega_id: t.wa_bandeja_entregas[0].id, frase: 'ir a Lisboa' });
    expect(String(t.activity_log.at(-1)!.contenido)).toMatch(/^Solicitud entendida desde ONE \(texto pegado\)\./);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_creado', negocio_id: c.negocioId });
    expect(enviados).toEqual([]);
  });

  it('un cliente que ya está: «Cliente: … (ya está en ONE)» con sus viajes abiertos; «Cargar» en «Uno nuevo» lo usa', async () => {
    modelo('Marta', { destino: { valor: 'Lisboa', frase: 'ir a Lisboa' } }, { cliente: { nombre: 'Marta Prueba', telefono: '' } });
    const r = await st.entenderTexto(db as never, CTX, { texto: 'Soy Marta Prueba, queremos ir a Lisboa', quien: 'cliente' });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.contacto).toMatchObject({ tipo: 'unico', contacto: { id: 'c-marta', viajes: [{ id: 'n14', nombre: 'PUNTA CANA NOV' }] } });
    const c = await st.cargarTexto(db as never, CTX, { entendimientoId: r.entendimientoId, contacto: { tipo: 'existente', id: 'c-marta' }, negocio: { tipo: 'nuevo' } });
    expect(c.ok).toBe(true);
    expect(t.contactos).toHaveLength(1);
  });

  it('una fila quitada antes de cargar no se escribe', async () => {
    modeloNuevo();
    const r = await st.entenderTexto(db as never, CTX, { texto: TEXTO_NUEVO, quien: 'cliente' });
    if (!r.ok) throw new Error(r.mensaje);
    const c = await st.cargarTexto(db as never, CTX, { entendimientoId: r.entendimientoId, quitar: ['adultos'], contacto: { tipo: 'nuevo', nombre: 'Lucía Prueba' } });
    if (!c.ok) throw new Error(c.mensaje);
    const d = t.negocio_bloques.find(b => b.negocio_id === c.negocioId)!.data as Fila;
    expect(d.adultos).toBeUndefined();
    expect(Object.keys(d._sugeridos as Fila)).not.toContain('adultos');
  });

  it('sin «Cargar» no se escribe: un entendimiento descartado o ya cargado no se vuelve a cargar', async () => {
    modeloNuevo();
    const r = await st.entenderTexto(db as never, CTX, { texto: TEXTO_NUEVO, quien: 'cliente' });
    if (!r.ok) throw new Error(r.mensaje);
    expect((await st.descartarTexto(db as never, CTX, { entendimientoId: r.entendimientoId })).ok).toBe(true);
    const c = await st.cargarTexto(db as never, CTX, { entendimientoId: r.entendimientoId, contacto: { tipo: 'nuevo', nombre: 'X' } });
    expect(c.ok).toBe(false);
    expect(t.negocios).toHaveLength(1);
  });

  it('otro workspace no carga un entendimiento ajeno', async () => {
    modeloNuevo();
    const r = await st.entenderTexto(db as never, CTX, { texto: TEXTO_NUEVO, quien: 'cliente' });
    if (!r.ok) throw new Error(r.mensaje);
    const c = await st.cargarTexto(db as never, { workspaceId: 'ws-otro', staffId: null }, { entendimientoId: r.entendimientoId, contacto: { tipo: 'nuevo', nombre: 'X' } });
    expect(c.ok).toBe(false);
  });
});

// ── Negocio existente ───────────────────────────────────────────────────────

describe('negocio existente: la caja suma y no pisa', () => {
  it('el resumen agrupa en nuevo / choca / ya estaba (en seco) y «Cargar» deja el conflicto y la traza desde ONE', async () => {
    modelo('Mejor salimos el 20', {
      destino: { valor: 'Punta Cana', frase: 'a Punta Cana' },
      fecha_salida: { valor: '2026-11-20', frase: 'Mejor salimos el 20 de noviembre' },
      fecha_regreso: { valor: '2026-11-27', frase: 'volvemos el 27' },
    });
    const texto = 'Seguimos con lo de ir a Punta Cana. Mejor salimos el 20 de noviembre y volvemos el 27';
    const r = await st.entenderTexto(db as never, CTX, { texto, quien: 'cliente', negocioId: 'n14' });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.negocio).toEqual({ id: 'n14', nombre: 'PUNTA CANA NOV · Marta Prueba (T1 26 14)' });
    expect(r.filas.map(f => [f.slug, f.grupo, f.actual ?? null])).toEqual([
      ['destino', 'ya_estaba', null], ['fecha_salida', 'choca', '15 nov'], ['fecha_regreso', 'nuevo', null],
    ]);
    expect(r.contacto).toBeNull();
    expect(t.negocio_bloques[0].data).toEqual({ destino: 'PUNTA CANA', fecha_salida: '2026-11-15', adultos: 2 }); // en seco

    const c = await st.cargarTexto(db as never, CTX, { entendimientoId: r.entendimientoId });
    if (!c.ok) throw new Error(c.mensaje);
    const d = t.negocio_bloques[0].data as Fila;
    expect(d.fecha_salida).toBe('2026-11-15'); // lo de la persona se queda
    expect(d.fecha_regreso).toBe('2026-11-27');
    expect((d._sugeridos as Record<string, Fila>).fecha_regreso).toMatchObject({ fuente: 'web' });
    expect((d._conflictos as Record<string, Fila>).fecha_salida).toMatchObject({ fuente: 'web', valor: '2026-11-20', origen: 'mensaje' });
    expect(String(t.activity_log.at(-1)!.contenido)).toMatch(/^Se cargó 1 dato desde ONE \(Tatiana, 30-sep\)\.\nEn conflicto, sin cambiar: Salida\./);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n14', cargados: ['fecha_regreso'] });
    expect(enviados).toEqual([]);
  });

  it('parece de otro viaje: avisa («Cargar aquí igual» es la persona) y no escribe nada', async () => {
    modelo('Cancún', { destino: { valor: 'Cancún', frase: 'a Cancún' } });
    const r = await st.entenderTexto(db as never, CTX, { texto: 'queremos ir a Cancún', quien: 'cliente', negocioId: 'n14' });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.aviso).toEqual({ tipo: 'cruce', texto: 'Esto parece de otro viaje: aquí dice Cancún y este es PUNTA CANA NOV · Marta Prueba (T1 26 14).' });
    expect(t.negocio_bloques[0].data).toEqual({ destino: 'PUNTA CANA', fecha_salida: '2026-11-15', adultos: 2 });
  });

  it('nada nuevo: lo dice y no hay qué cargar', async () => {
    modelo('Punta Cana', { destino: { valor: 'Punta Cana', frase: 'a Punta Cana' } });
    const r = await st.entenderTexto(db as never, CTX, { texto: 'seguimos con lo de ir a Punta Cana', quien: 'cliente', negocioId: 'n14' });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.aviso).toEqual({ tipo: 'nada_nuevo', texto: 'No encontré datos nuevos para PUNTA CANA NOV · Marta Prueba (T1 26 14).' });
  });
});

// ── Guardianes ──────────────────────────────────────────────────────────────

describe('los guardianes aplican igual a lo pegado', () => {
  it('una fecha que no dice el día no se carga: se pregunta', async () => {
    modelo('Lisboa en marzo', { destino: { valor: 'Lisboa', frase: 'Lisboa' }, fecha_salida: { valor: '2027-03-01', frase: 'en marzo' } });
    const r = await st.entenderTexto(db as never, CTX, { texto: 'Lucía, Lisboa en marzo, ella y el papá', quien: 'notas' });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.filas.map(f => f.slug)).toEqual(['destino']);
    expect(r.preguntas).toEqual([{ slug: 'fecha_salida', texto: 'No cargué la fecha: «en marzo» no dice el día. ¿Qué día salen?' }]);
    // «Son mis notas»: el mensaje no es reenviado, como un escrito del comercial.
    expect(t.wa_bandeja_mensajes[0].reenviado).toBe(false);
  });

  it('N4: sin solicitud lo dice y no carga nada', async () => {
    modelo('', {});
    const r = await st.entenderTexto(db as never, CTX, { texto: 'gracias por la info', quien: 'cliente' });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.aviso).toEqual({ tipo: 'sin_solicitud', texto: 'No vi una solicitud de viaje en este texto. No cargué nada.' });
  });

  it('N5: dos viajes no se mezclan; el entendimiento queda descartado y no se puede cargar', async () => {
    modelo('Aruba', { destino: { valor: 'Aruba', frase: 'queremos Aruba' } }, {
      solicitudes: [{ cliente: 'Carolina', destino: 'Aruba', frase: 'soy Carolina, queremos Aruba' }, { cliente: 'Luisa', destino: 'Curazao', frase: 'soy Luisa, para Curazao' }],
    });
    const r = await st.entenderTexto(db as never, CTX, { texto: 'Hola, soy Carolina, queremos Aruba. Buenas, soy Luisa, para Curazao somos 2', quien: 'cliente' });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.aviso).toEqual({ tipo: 'dos_viajes', texto: 'Veo dos solicitudes distintas (Carolina: Aruba · Luisa: Curazao). No las mezclo. Pega cada una por separado.' });
    expect(t.wa_bandeja_entendimientos[0].estado).toBe('descartada');
    expect((await st.cargarTexto(db as never, CTX, { entendimientoId: r.entendimientoId, contacto: { tipo: 'nuevo', nombre: 'Carolina' } })).ok).toBe(false);
  });

  it('error del modelo (respuesta cortada): «No pude leerlo ahora…», sin reintento solo', async () => {
    respuestaModelo = () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] }), { status: 200 });
    const r = await st.entenderTexto(db as never, CTX, { texto: TEXTO_NUEVO, quien: 'cliente' });
    expect(r).toEqual({ ok: false, error: 'modelo', mensaje: 'No pude leerlo ahora. Tu texto sigue aquí: inténtalo otra vez.' });
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'error', intentos: 3, finish_reason: 'MAX_TOKENS' });
  });
});

// ── El cron no toma lo pegado ───────────────────────────────────────────────

describe('una entrega web nunca la toma el cron', () => {
  it('ni la entrega sin entendimiento, ni un entendimiento web en error con intentos: no llama al modelo ni manda WhatsApp', async () => {
    t.wa_bandeja_entregas.push({ id: 'e-web', workspace_id: WS, canal: 'web', remitente_phone: null, remitente_staff_id: STAFF, estado: 'con_cliente', cliente_respondido_at: '2026-09-30T14:00:00Z' });
    t.wa_bandeja_mensajes.push({ id: 'm-web', workspace_id: WS, entrega_id: 'e-web', wa_message_id: 'web:1', papel: 'contenido', cuerpo: 'ir a Lisboa', reenviado: true, tipo: 'text', recibido_at: '2026-09-30T13:00:00Z' });
    t.wa_bandeja_entregas.push({ id: 'e-web2', workspace_id: WS, canal: 'web', remitente_phone: null, estado: 'con_cliente', cliente_respondido_at: '2026-09-30T14:00:00Z' });
    t.wa_bandeja_entendimientos.push({ id: 'x-web', workspace_id: WS, entrega_id: 'e-web2', segmento: 0, canal: 'web', remitente_phone: null, estado: 'error', intentos: 1, negocio_id: null, contacto_id: null, updated_at: '2026-09-30T10:00:00Z' });
    const r = await bot.procesarEntendimientos(db as never);
    expect(r).toEqual({ entendidas: 0, respuestas: 0 });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(t.wa_bandeja_entendimientos).toHaveLength(1);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'error', intentos: 1 });
    expect(enviados).toEqual([]);
  });

  it('una entrega de WhatsApp sigue entrando igual (sin columna canal, como las de antes)', async () => {
    t.wa_bandeja_entregas.push({ id: 'e-wa', workspace_id: WS, remitente_phone: TEL, remitente_staff_id: STAFF, estado: 'con_cliente', cliente_texto: 'NUEVO Lucía Prueba', cliente_respondido_at: '2026-09-30T14:00:00Z', negocio_opciones: [] });
    t.wa_bandeja_mensajes.push({ id: 'm-wa', workspace_id: WS, entrega_id: 'e-wa', wa_message_id: 'w-1', papel: 'contenido', cuerpo: TEXTO_NUEVO, cuerpo_origen: 'texto', reenviado: true, tipo: 'text', recibido_at: '2026-09-30T13:00:00Z' });
    modeloNuevo();
    const r = await bot.procesarEntendimientos(db as never);
    expect(r.entendidas).toBe(1);
    expect(enviados).toHaveLength(1);
  });
});

// ── Paridad del rastro ──────────────────────────────────────────────────────

describe('lo pegado deja el mismo rastro que un reenvío', () => {
  it('mismas columnas en el entendimiento, misma forma de la marca (salvo la fuente), misma clase en el mensaje', async () => {
    // Por WhatsApp: «NUEVO Lucía Prueba» con el texto reenviado.
    t.wa_bandeja_entregas.push({ id: 'e-wa', workspace_id: WS, remitente_phone: TEL, remitente_staff_id: STAFF, estado: 'con_cliente', cliente_texto: 'NUEVO Lucía Prueba', cliente_respondido_at: '2026-09-30T14:00:00Z', negocio_opciones: [] });
    t.wa_bandeja_mensajes.push({ id: 'm-wa', workspace_id: WS, entrega_id: 'e-wa', wa_message_id: 'w-1', papel: 'contenido', cuerpo: TEXTO_NUEVO, cuerpo_origen: 'texto', reenviado: true, tipo: 'text', recibido_at: '2026-09-30T13:00:00Z' });
    modeloNuevo();
    await bot.procesarEntendimientos(db as never);
    const entWa = t.wa_bandeja_entendimientos.find(e => e.entrega_id === 'e-wa')!;
    expect(entWa.estado).toBe('negocio_creado');

    // Por la web: el mismo texto, pegado.
    const r = await st.entenderTexto(db as never, CTX, { texto: TEXTO_NUEVO, quien: 'cliente' });
    if (!r.ok) throw new Error(r.mensaje);
    const c = await st.cargarTexto(db as never, CTX, { entendimientoId: r.entendimientoId, contacto: { tipo: 'nuevo', nombre: 'Lucía Prueba 2' } });
    if (!c.ok) throw new Error(c.mensaje);
    const entWeb = t.wa_bandeja_entendimientos.find(e => e.id === r.entendimientoId)!;

    for (const col of ['historia', 'sugeridos', 'descartados', 'cliente', 'huecos', 'modelo', 'finish_reason', 'negocio_id', 'contacto_id', 'linea_id']) {
      expect([col, entWeb[col] !== undefined && entWeb[col] !== null]).toEqual([col, entWa[col] !== undefined && entWa[col] !== null]);
    }
    expect(entWeb.sugeridos).toEqual(entWa.sugeridos);
    expect(entWeb.historia).toBe(entWa.historia);

    const marcas = (negocioId: unknown) => (t.negocio_bloques.find(b => b.negocio_id === negocioId)!.data as Fila)._sugeridos as Record<string, Fila>;
    const mWa = marcas(entWa.negocio_id);
    const mWeb = marcas(c.negocioId);
    expect(Object.keys(mWeb)).toEqual(Object.keys(mWa));
    for (const k of Object.keys(mWa)) {
      expect(Object.keys(mWeb[k]).sort()).toEqual(Object.keys(mWa[k]).sort());
      expect(mWa[k].fuente).toBe('whatsapp');
      expect(mWeb[k].fuente).toBe('web');
      expect(mWeb[k].frase).toBe(mWa[k].frase);
    }
    expect(t.wa_bandeja_mensajes.find(m => m.id === 'm-wa')!.clase).toBe('cliente');
    expect(t.wa_bandeja_mensajes.find(m => String(m.wa_message_id).startsWith('web:'))!.clase).toBe('cliente');
    // La historia va a la actividad en los dos.
    const act = (id: unknown) => t.activity_log.filter(a => a.entidad_id === id).map(a => String(a.contenido));
    expect(act(entWa.negocio_id)[0].split('\n\n').slice(1)).toEqual(act(c.negocioId)[0].split('\n\n').slice(1));
  });
});
