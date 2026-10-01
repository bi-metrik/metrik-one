import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La prueba en vivo del 2026-10-01 (proyectos/trappvel/clarity/qa/bandeja-wa/vivo-2026-10-01.md) de
 * punta a punta: cada mensaje entra como lo hace el webhook (`rutaDelMensaje` → `atenderEnBandeja` o
 * el bot de siempre), el cron del entendimiento corre entre medio, y la base es una base en MEMORIA
 * que aplica los filtros y emula `wa_bandeja_registrar_mensaje` (abrir, agregar, cerrar, la
 * respuesta a la pregunta). Datos sintéticos: nombres de prueba y salidas del modelo grabadas a mano.
 *
 * La carrera de los webhooks se reproduce con dos relojes: la hora de Meta (`timestamp`, cuándo lo
 * mandó el comercial) y la hora de llegada (la del sistema cuando se procesa). Un mensaje puede
 * procesarse antes que su encabezado; lo que llega MIENTRAS un escrito espera a los mensajes en
 * camino se intercala con `esperaEnVuelo.dormir`.
 *
 * Mutaciones (2026-10-01; cada una aplicada sola sobre el árbol del PR, corriendo `_shared/` más
 * `campo-suma` y `niveles-solicitud-trappvel`, y restaurada con verificación byte a byte). Entre
 * paréntesis, cuántas pruebas cayeron; todas cayeron:
 *   M1a · vuelve la regla 4b (una pregunta escrita va al bot) (4) · M1b · todo lo escrito va al bot (21)
 *   M2 · la sesión del bot a medias no se corta (4) · M2b · un código corta la selección de negocio (2)
 *   M2c · no se cierra la sesión cortada (2) · M3 · la tanda se ordena por llegada (4)
 *   M4 · nunca se espera a los mensajes en camino (3) · M4b · el «listo» no espera (2)
 *   M5 · un «sí» también espera (2) · M6 · «somos N» vuelve a cerrar menores (10)
 *   M7a / M7b · el total suma lo conocido, en la bandeja / en la pantalla (4 / 4)
 *   M8 · el negocio nuevo vuelve a «CLIENTE · destino» (2) · M9 · el provisional cambia aunque lo
 *   hayan editado (1) · M9b · el provisional nunca cambia (1) · M10 · destinos sin normalizar (1)
 *   M11a · el borde no se pregunta (2) · M11b · «hasta 8M» no incluye el 8 (1)
 *   M12 · edades sin etiqueta (2) · M13 · «1.5» no es una edad (2) · M14 · el nombre del negocio no es
 *   encabezado (4) · M15 · el ambiguo no se pregunta en el acto (2) · M16 · formato «código · nombre» (24)
 *   M17 · «Lusia Prueba2» no pregunta (1) · M18 · una tanda de acuses se pregunta (1) · M19 · las risas
 *   se numeran (1) · M20 · «Dime de qué viaje es» sin nada que asignar (1) · M21 · el ejemplo dice «el 4»
 *   (2) · M22 · «bot» no se quita (1) · M23 · sin pista del prefijo (1) · M24 · la salida no recuerda el
 *   mes (2) · M25 · el cliente se repite cuando el nombre ya lo trae (2).
 *   M5b (descartada): un segundo filtro de «forma de respuesta» en `wa-bandeja.ts` no cambiaba nada
 *   observable porque `hayQueEsperarEnVuelo` ya lo mira; se quitó para que la regla viva en un solo lado.
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
  /** Lo que hace la base al insertar un negocio o sus bloques: el código y las relaciones que se leen embebidas. */
  function completar(tabla: string, f: Fila): Fila {
    if (tabla === 'negocios') {
      const c = t.contactos.find(x => x.id === f.contacto_id);
      const n = t.negocios.filter(x => String(x.codigo ?? '').startsWith(String(c?.nombre ?? 'X').charAt(0))).length + 1;
      return { codigo: `${String(c?.nombre ?? 'X').charAt(0)} 26 ${n}`, created_at: new Date().toISOString(), contactos: c ? { nombre: c.nombre } : null, empresas: null, workspaces: { slug: 'agencia' }, ...f };
    }
    if (tabla === 'negocio_bloques') {
      const bc = t.bloque_configs.find(x => x.id === f.bloque_config_id);
      return { updated_at: null, bloque_configs: bc ? { orden: bc.orden, config_extra: bc.config_extra, bloque_definitions: bc.bloque_definitions, etapas_negocio: { orden: 1 } } : null, ...f };
    }
    return f;
  }
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
        const filas = (Array.isArray(payload) ? payload : [payload!]).map(f => completar(tabla, { id: nuevoId(), ...f }));
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
      gt: (c: string, v: string) => { filtros.push(f => String(leer(f, c) ?? '') > v); return q; },
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

  /** `wa_bandeja_registrar_mensaje` como la migración 20261001120000 (sin el candado: aquí no hay hilos). */
  async function rpc(nombre: string, a: Fila) {
    if (nombre !== 'wa_bandeja_registrar_mensaje') throw new Error(`rpc no esperado: ${nombre}`);
    const ahora = new Date().toISOString();
    const dup = t.wa_bandeja_mensajes.find(m => m.wa_message_id === a.p_wa_message_id);
    if (dup) return { data: [{ accion: 'duplicado', entrega: dup.entrega_id, mensajes: null }], error: null };
    const msg = (entrega: unknown, papel: string): Fila => ({
      id: nuevoId(), workspace_id: a.p_workspace_id, entrega_id: entrega, wa_message_id: a.p_wa_message_id, remitente_phone: a.p_remitente_phone,
      papel, tipo: a.p_tipo, cuerpo: a.p_cuerpo, cuerpo_origen: a.p_cuerpo_origen, reenviado: a.p_reenviado === true, segmento: null,
      enviado_at: a.p_enviado_at, recibido_at: ahora,
    });
    let abierta = t.wa_bandeja_entregas.find(e => e.workspace_id === a.p_workspace_id && e.remitente_phone === a.p_remitente_phone && e.estado === 'abierta');
    if (a.p_es_cierre && !a.p_reenviado) {
      t.wa_bandeja_mensajes.push(msg(abierta?.id ?? null, 'cierre'));
      if (!abierta) return { data: [{ accion: 'cierre_sin_abierta', entrega: null, mensajes: 0 }], error: null };
      Object.assign(abierta, { estado: 'esperando_cliente', cerrada_at: ahora, motivo_cierre: 'palabra_cierre' });
      return { data: [{ accion: 'cerrar', entrega: abierta.id, mensajes: abierta.n_mensajes }], error: null };
    }
    if (abierta) {
      t.wa_bandeja_mensajes.push(msg(abierta.id, 'contenido'));
      abierta.n_mensajes = Number(abierta.n_mensajes ?? 0) + 1;
      return { data: [{ accion: 'agregar', entrega: abierta.id, mensajes: abierta.n_mensajes }], error: null };
    }
    const horas = Number(a.p_horas_respuesta_cliente ?? 24);
    if (!a.p_reenviado && a.p_puede_ser_respuesta !== false && ['text', 'audio'].includes(String(a.p_tipo)) && String(a.p_cuerpo ?? '').trim()) {
      const desde = new Date(Date.now() - horas * 3600_000).toISOString();
      const espera = t.wa_bandeja_entregas
        .filter(e => e.remitente_phone === a.p_remitente_phone && e.estado === 'esperando_cliente' && e.pregunta_enviada_at && String(e.pregunta_enviada_at) > desde)
        .sort((x, y) => String(y.cerrada_at).localeCompare(String(x.cerrada_at)))[0];
      if (espera) {
        t.wa_bandeja_mensajes.push(msg(espera.id, 'respuesta_cliente'));
        Object.assign(espera, { estado: 'con_cliente', cliente_texto: a.p_cuerpo, cliente_respondido_at: ahora });
        return { data: [{ accion: 'respuesta_cliente', entrega: espera.id, mensajes: espera.n_mensajes }], error: null };
      }
    }
    abierta = {
      id: nuevoId(), workspace_id: a.p_workspace_id, remitente_phone: a.p_remitente_phone, remitente_staff_id: a.p_remitente_staff_id ?? null,
      estado: 'abierta', n_mensajes: 1, created_at: ahora, pregunta_enviada_at: null, pregunta_error: null, plan_viajes: null, negocio_opciones: null,
    };
    t.wa_bandeja_entregas.push(abierta);
    t.wa_bandeja_mensajes.push(msg(abierta.id, 'contenido'));
    return { data: [{ accion: 'abrir', entrega: abierta.id, mensajes: 1 }], error: null };
  }
  return { from, rpc };
}

// ── Escenario sintético ─────────────────────────────────────────────────────

const WS = 'ws-prueba';
const LINEA = 'linea-viajes';
const TEL = '573000000009';

const PRESUPUESTO = [
  { value: 'menos_3m', label: 'Menos de $3 millones' }, { value: '3m_5m', label: 'Entre $3 y $5 millones' },
  { value: '5m_8m', label: 'Entre $5 y $8 millones' }, { value: '8m_12m', label: 'Entre $8 y $12 millones' },
  { value: '12m_20m', label: 'Entre $12 y $20 millones' }, { value: 'mas_20m', label: 'Más de $20 millones' },
  { value: 'sin_definir', label: 'Aún no tiene presupuesto definido', no_definido: true },
];

/** La forma de la config de una línea de viajes (no son datos de nadie). */
const FIELDS = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde quieren viajar?' },
  { slug: 'ciudad_origen', tipo: 'texto', label: 'Ciudad de salida', nivel: 'minimo', pregunta: '¿Desde qué ciudad salen?' },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Fecha de salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'fecha_regreso', tipo: 'fecha', label: 'Fecha de regreso', nivel: 'minimo', pregunta: '¿Qué día regresan?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos viajan?' },
  { slug: 'ninos', tipo: 'numero', label: 'Niños', nivel: 'minimo', pregunta: '¿Viajan niños? ¿Cuántos?' },
  { slug: 'infantes', tipo: 'numero', label: 'Infantes', nivel: 'minimo', pregunta: '¿Viajan bebés menores de 2 años? ¿Cuántos?' },
  { slug: 'numero_pasajeros', tipo: 'numero', label: 'Número de pasajeros', suma_de: ['adultos', 'ninos', 'infantes'] },
  { slug: 'edades_menores', tipo: 'texto', label: 'Edades de los niños e infantes', nivel: 'minimo', pregunta: '¿Qué edad tiene cada niño?', pedir_si: { suma_de: ['ninos', 'infantes'], mayor_que: 0 } },
  { slug: 'presupuesto', tipo: 'select', label: 'Presupuesto aproximado del viaje', nivel: 'deseable', pregunta: '¿Cuánto tienen pensado invertir en el viaje, más o menos?', opciones: PRESUPUESTO },
  { slug: 'categoria_hotel', tipo: 'select', label: 'Categoría de hotel', nivel: 'minimo', pregunta: '¿De qué categoría prefieren el hotel?', opciones: [{ value: '3', label: '3 estrellas' }, { value: '4', label: '4 estrellas' }, { value: '5', label: '5 estrellas' }, { value: 'sin_preferencia', label: 'Sin preferencia', no_definido: true }] },
];

const BLOQUE_CONFIG = { id: 'bc-solicitud', etapa_id: 'et-solicitud', workspace_id: WS, orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' } };

function base(): Tablas {
  return {
    workspaces: [{ id: WS, slug: 'agencia', linea_activa_id: LINEA, modules: { bandeja_solicitudes_wa: true }, config_extra: { bandeja_solicitudes: { linea_id: LINEA, modo_viajes: 'encabezado', confirmar: 'siempre' } } }],
    staff: [{ id: 'st-1', workspace_id: WS, full_name: 'TATIANA PRUEBA' }],
    wa_collaborators: [{ id: 'col-1', workspace_id: WS, name: 'COMERCIAL PRUEBA' }],
    negocios: [],
    negocio_responsables: [],
    negocio_bloques: [],
    activity_log: [],
    wa_bandeja_entregas: [],
    wa_bandeja_mensajes: [],
    wa_bandeja_entendimientos: [],
    etapas_negocio: [{ id: 'et-solicitud', linea_id: LINEA, orden: 1, stage: 'venta' }],
    bloque_configs: [BLOQUE_CONFIG],
    contactos: [],
    staff_areas: [],
    bot_sessions: [],
  };
}

let t: Tablas;
let db: ReturnType<typeof crearDb>;
let colaModelo: unknown[] = [];
let ent: typeof import('./wa-entendimiento.ts');
let bandeja: typeof import('./wa-bandeja.ts');
/** Lo que el bot de siempre habría recibido (con la bandeja encendida no debería ser casi nada). */
let alBot: string[] = [];
/** Lo que llega mientras un escrito espera a los mensajes en camino. */
let mientras: Array<() => Promise<void>> = [];
let esperas = 0;

const USER = { workspace_id: WS, phone: TEL, name: 'Comercial', role: 'operator', collaborator_id: 'col-1', subscription_status: 'trial', modulos: { modules: { bandeja_solicitudes_wa: true } } };
const T0 = Date.parse('2026-10-01T19:29:39Z');
let n = 0;

/**
 * Un mensaje del comercial como lo procesa el webhook. `enviado`: segundos desde T0 en que lo mandó
 * (la hora de Meta). `llega`: segundos desde T0 en que se procesa (por defecto, 2 s después).
 */
async function llega(texto: string, p: { enviado: number; llega?: number; reenviado?: boolean } = { enviado: 0 }) {
  vi.setSystemTime(new Date(T0 + (p.llega ?? p.enviado + 2) * 1000));
  const message = { phone: TEL, text: texto, type: 'text', reenviado: p.reenviado === true, wa_message_id: `wamid.vivo.${++n}`, timestamp: String(Math.floor((T0 + p.enviado * 1000) / 1000)) };
  const r = await bandeja.rutaDelMensaje(db as never, USER as never, message as never);
  if (r.atendido) return;
  if (r.ruta === 'bandeja' && r.config) await bandeja.atenderEnBandeja(db as never, USER as never, message as never, r.config);
  else alBot.push(r.textoParaElBot ?? texto);
}

/** El cron del entendimiento (cada minuto): entiende, atiende respuestas y saca lo que esperaba turno. */
async function cron(seg: number) {
  vi.setSystemTime(new Date(T0 + seg * 1000));
  await ent.procesarEntendimientos(db as never);
  await bandeja.enviarPreguntasEnCola(db as never);
}

const textos = () => enviados.map(e => e.texto);
const negocioDe = (contacto: string) => {
  const c = t.contactos.find(x => x.nombre === contacto);
  return t.negocios.find(x => x.contacto_id === c?.id);
};
const datosDe = (contacto: string) => t.negocio_bloques.find(b => b.negocio_id === negocioDe(contacto)?.id)?.data as Fila;

function salidaModelo(valores: Record<string, { valor: string; frase: string }>) {
  const v: Record<string, unknown> = {};
  for (const f of FIELDS) if (!f.suma_de) v[f.slug] = valores[f.slug] ?? { valor: 'por_definir', frase: '' };
  return { mensajes: [], citas: [], solicitudes: [], cliente: { nombre: '', telefono: '' }, valores: v };
}

/** Lo que Gemini devolvió en vivo para Laura (grabado a mano, sintético). */
const LAURA = salidaModelo({
  destino: { valor: 'Cartagena', frase: 'ir a Cartagena' },
  ciudad_origen: { valor: 'Bogotá', frase: 'salimos de Bogotá' },
  fecha_salida: { valor: '2026-12-12', frase: 'del 12 al 16 de diciembre' },
  fecha_regreso: { valor: '2026-12-16', frase: 'del 12 al 16 de diciembre' },
  adultos: { valor: '2', frase: 'somos 2 adultos' },
  ninos: { valor: '1', frase: '1 niño de 7 años' },
  edades_menores: { valor: '7', frase: '1 niño de 7 años' },
  categoria_hotel: { valor: '4', frase: 'hotel 4 estrellas' },
});
/** Y para Diego: los menores mal contados (2 niños + 1 bebé para dos edades), como en vivo. */
const DIEGO = salidaModelo({
  destino: { valor: 'puntacana y curasao', frase: 'puntacana y curasao' },
  adultos: { valor: '5', frase: '2 adultos y 2 menores y en la otra 3 adultos' },
  ninos: { valor: '2', frase: '2 menores' },
  infantes: { valor: '1', frase: 'un bebe de 1 y medio' },
  edades_menores: { valor: '7, 1.5', frase: 'Los niños tienen 7 años y un bebe de 1 y medio' },
});

const CARTAGENA = 'Hola, queremos ir a Cartagena del 12 al 16 de diciembre, somos 2 adultos y 1 niño de 7 años, hotel 4 estrellas, salimos de Bogotá';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => (k === 'GEMINI_API_KEY' ? 'k' : undefined) } };
  vi.stubGlobal('fetch', vi.fn(async () => {
    const s = colaModelo.length > 1 ? colaModelo.shift() : colaModelo[0];
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(s) }] } }] }), { status: 200 });
  }));
  ent = await import('./wa-entendimiento.ts');
  bandeja = await import('./wa-bandeja.ts');
  bandeja.esperaEnVuelo.dormir = async () => {
    esperas++;
    for (const f of mientras.splice(0)) await f();
  };
  t = base();
  db = crearDb(t);
  enviados.length = 0;
  alBot = [];
  mientras = [];
  esperas = 0;
  colaModelo = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── Escenario 1 del informe ─────────────────────────────────────────────────

describe('escenario 1 de la prueba en vivo: Laura Prueba2 y Diego Prueba2, al ritmo de quien pega textos', () => {
  it('1a + 1b: el escrito que llega antes que su encabezado queda en la caja del encabezado; dos cargas correctas', async () => {
    // 1a · «nuevo Laura Prueba2» se manda a las 19:29:39 y se registra 6 s después; el mensaje de
    // Cartagena, mandado 3 s después del encabezado, se procesa ANTES (la carrera de la prueba).
    await llega(CARTAGENA, { enviado: 3, llega: 4 });
    await llega('nuevo Laura Prueba2', { enviado: 0, llega: 6 });
    expect(textos()).toEqual(['📌 NUEVO Laura Prueba2']);
    await llega('listo', { enviado: 5, llega: 7 });
    expect(alBot).toEqual([]); // nada al bot de actividades
    expect(textos().at(-1)).toBe([
      'Laura Prueba2 · Entendí 1 viaje:',
      '1) NUEVO Laura Prueba2 — 1 mensaje',
      '   1 «Hola, queremos ir a Cartagena del 12 al…»',
      'No cargué nada todavía. Revisa que cada mensaje esté en su viaje. ¿Así? Responde SÍ, o corrige: «el 1 es de Luisa», «descartar el 1». DESCARTAR descarta todo.',
    ].join('\n'));

    await llega('sí', { enviado: 20 });
    // 1b · 6 s después del «sí», sin esperar la carga: Diego. La carga de Laura llega en medio.
    await llega('nuevo Diego Prueba2', { enviado: 26 });
    expect(textos().at(-1)).toBe('📌 NUEVO Diego Prueba2');
    colaModelo = [LAURA];
    await cron(30);
    await llega('Quiero un viaje para puntacana y curasao', { enviado: 31 });
    await llega('en 1 habitación 2 adultos y 2 menores y en la otra 3 adultos', { enviado: 40 });
    await llega('Los niños tienen 7 años y un bebe de 1 y medio', { enviado: 50 });
    await llega('listo', { enviado: 55 });
    expect(textos().at(-1)).toMatch(/^Diego Prueba2 · Entendí 1 viaje:\n1\) NUEVO Diego Prueba2 — 3 mensajes\n   1 «Quiero un viaje para puntacana y curasao»/);
    await llega('sí', { enviado: 70 });
    colaModelo = [DIEGO];
    await cron(90);

    expect(alBot).toEqual([]);
    // La carga de Laura: el nombre como lo arma la agencia, las edades con etiqueta y el total de los tres.
    const cargaLaura = textos().find(x => x.startsWith('Entendí: Cartagena'))!;
    expect(cargaLaura.split('\n').slice(0, 3)).toEqual([
      'Entendí: Cartagena, Bogotá, 12-16 dic, 2 adultos, 1 niño, niño: 7 años, 4 estrellas.',
      'CARTAGENA DIC 12-16 · Laura Prueba2 (L 26 1) — Mínimo 9/9 (100 %) · Completo 9/10 (90 %)',
      'Ya está el mínimo para cotizar: https://agencia.metrikone.co/negocios/' + negocioDe('LAURA PRUEBA2')!.id,
    ]);
    expect(negocioDe('LAURA PRUEBA2')).toMatchObject({ nombre: 'CARTAGENA DIC 12-16', metadata: { nombre_auto: 'CARTAGENA DIC 12-16', nombre_provisional: false } });
    expect(datosDe('LAURA PRUEBA2')).toMatchObject({ destino: 'CARTAGENA', adultos: 2, ninos: 1, infantes: 0, numero_pasajeros: 3 });

    // La de Diego: destino normalizado, sin un total inventado y sin ceros en menores.
    const cargaDiego = textos().find(x => x.startsWith('Entendí: Punta Cana'))!;
    expect(cargaDiego.split('\n')[0]).toBe('Entendí: Punta Cana y Curazao, 5 adultos, niño: 7 años; bebé: 1,5 años.');
    expect(cargaDiego.split('\n')[1]).toMatch(/^PUNTA CANA Y CURAZAO · Diego Prueba2 \(D 26 1\) — Mínimo /);
    expect(cargaDiego).toContain('¿Viajan niños? ¿Cuántos?');
    expect(negocioDe('DIEGO PRUEBA2')).toMatchObject({ nombre: 'PUNTA CANA Y CURAZAO' });
    const diego = datosDe('DIEGO PRUEBA2');
    expect(diego).toMatchObject({ destino: 'PUNTA CANA Y CURAZAO', adultos: 5 });
    expect(diego.numero_pasajeros).toBeUndefined(); // en vivo quedó 5 (eran 7)
    expect(diego.ninos).toBeUndefined();
    expect(diego.infantes).toBeUndefined();

    // Cada mensaje en su viaje, y ninguna respuesta tomada como contenido.
    const contenido = t.wa_bandeja_mensajes.filter(m => m.papel === 'contenido' && m.segmento);
    expect(contenido.map(m => [String(m.cuerpo).slice(0, 12), (m.asignacion as Fila).destino])).toEqual([
      ['Hola, querem', { tipo: 'nuevo', cliente: 'Laura Prueba2' }],
      ['Quiero un vi', { tipo: 'nuevo', cliente: 'Diego Prueba2' }],
      ['en 1 habitac', { tipo: 'nuevo', cliente: 'Diego Prueba2' }],
      ['Los niños ti', { tipo: 'nuevo', cliente: 'Diego Prueba2' }],
    ]);
  });

  it.each([
    ['el encabezado se procesa primero', 1, false],
    ['el escrito se procesa primero', 1, true],
    ['el escrito se procesa primero', 2, true],
    ['el escrito se procesa primero', 3, true],
    ['el encabezado se procesa primero', 3, false],
  ])('%s, con %i s entre los dos: el escrito termina en la caja del encabezado', async (_n, gap, escritoPrimero) => {
    const enc = () => llega('nuevo Laura Prueba2', { enviado: 0, llega: escritoPrimero ? gap + 2 : 1 });
    const esc = () => llega(CARTAGENA, { enviado: gap, llega: escritoPrimero ? gap + 1 : gap + 2 });
    if (escritoPrimero) { await esc(); await enc(); } else { await enc(); await esc(); }
    await llega('listo', { enviado: gap + 2, llega: gap + 4 });
    expect(alBot).toEqual([]);
    expect(textos().at(-1)).toContain('1) NUEVO Laura Prueba2 — 1 mensaje\n   1 «Hola, queremos ir a Cartagena');
  });

  it('con el resumen de Laura sin contestar, el escrito de Diego que llega antes que su encabezado NO se toma como la respuesta', async () => {
    await llega('nuevo Laura Prueba2', { enviado: 0 });
    await llega(CARTAGENA, { enviado: 3 });
    await llega('listo', { enviado: 5 });
    expect(textos().at(-1)).toContain('Laura Prueba2 · Entendí 1 viaje:');
    // Sin contestar, el comercial pasa a Diego: el escrito se procesa primero y espera; mientras tanto
    // se registra el encabezado mandado 2 s antes.
    mientras.push(() => llega('nuevo Diego Prueba2', { enviado: 30, llega: 33 }));
    await llega('Quiero un viaje para puntacana y curasao', { enviado: 32, llega: 33 });
    expect(esperas).toBeGreaterThan(0);
    const laura = t.wa_bandeja_entregas.find(e => e.estado === 'esperando_cliente');
    expect(laura).toBeTruthy(); // el resumen de Laura sigue esperando su «sí»
    await llega('listo', { enviado: 40 });
    expect(textos().some(x => x.startsWith('No entendí «Quiero un viaje'))).toBe(false);
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'Quiero un viaje para puntacana y curasao')).toMatchObject({ papel: 'contenido' });
    // Diego espera turno (una pregunta abierta a la vez) y sale cuando se contesta la de Laura.
    expect(textos().at(-1)).toBe('Primero: Laura Prueba2 · ¿Así? SÍ o corrige\nLo que acabas de mandar te lo pregunto después.');
    await llega('sí', { enviado: 50 });
    colaModelo = [LAURA];
    await cron(60);
    expect(textos().at(-1)).toMatch(/^Diego Prueba2 · Entendí 1 viaje:\n1\) NUEVO Diego Prueba2 — 1 mensaje\n   1 «Quiero un viaje para puntacana y curasao»/);
  });

  it('un «listo» que se procesa antes que el último mensaje espera a que entre: el mensaje no queda fuera ni como respuesta', async () => {
    await llega('nuevo Laura Prueba2', { enviado: 0 });
    mientras.push(() => llega(CARTAGENA, { enviado: 3, llega: 8 }));
    await llega('listo', { enviado: 5, llega: 6 });
    expect(textos().at(-1)).toContain('1) NUEVO Laura Prueba2 — 1 mensaje\n   1 «Hola, queremos ir a Cartagena');
    expect(t.wa_bandeja_mensajes.filter(m => m.papel === 'respuesta_cliente')).toEqual([]);
  });

  it('un «sí» al resumen no espera: un encabezado mandado después no se lo traga', async () => {
    await llega('nuevo Laura Prueba2', { enviado: 0 });
    await llega(CARTAGENA, { enviado: 3 });
    await llega('listo', { enviado: 5 });
    mientras.push(() => llega('nuevo Diego Prueba2', { enviado: 22 }));
    await llega('sí', { enviado: 20 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'sí')).toMatchObject({ papel: 'respuesta_cliente' });
    expect(t.wa_bandeja_entregas.find(e => e.cliente_texto === 'sí')).toMatchObject({ estado: 'con_cliente' });
  });
});

// ── Escenarios 4 a 6: lo que ya no se va al bot ─────────────────────────────

describe('con la bandeja encendida manda la bandeja (escenarios 4, 5 y 6)', () => {
  it('escenario 5: un escrito sin encabezado va a la bandeja y recibe «¿A qué viaje van?», no el flujo de actividades', async () => {
    await llega('Hola, quiero cotizar Santa Marta para 2 adultos del 8 al 12 de enero', { enviado: 0 });
    await llega('listo', { enviado: 4 });
    expect(alBot).toEqual([]);
    expect(textos().at(-1)).toMatch(/· Recibí 1 mensaje\. (No tienes viajes abiertos|¿A qué viaje van\?)/);
  });

  it('atrapado en el flujo de actividades: «listo» sigue en el bot; «cancelar» corta y vuelve a la bandeja; un encabezado también', async () => {
    const sesion = { id: 's1', user_phone: TEL, workspace_id: WS, state: 'awaiting_selection', expires_at: '2026-10-01T23:00:00Z', context: { pending_action: 'WAC' } };
    t.bot_sessions.push(sesion);
    await llega('listo', { enviado: 0 });
    expect(alBot).toEqual(['listo']);
    // Un código es la respuesta que espera la selección del negocio: no la corta.
    await llega('D 26 1', { enviado: 5 });
    expect(alBot).toEqual(['listo', 'D 26 1']);
    await llega('cancelar', { enviado: 10 });
    expect(sesion.state).toBe('completed');
    expect(textos().at(-1)).toBe('Listo, cancelé lo que el bot esperaba. Lo que escribas ahora va a la bandeja de solicitudes.');
    expect(t.wa_bandeja_mensajes.some(m => m.cuerpo === 'cancelar')).toBe(false);

    const otra = { id: 's2', user_phone: TEL, workspace_id: WS, state: 'awaiting_selection', expires_at: '2026-10-01T23:00:00Z', context: { pending_action: 'WAC' } };
    t.bot_sessions.push(otra);
    await llega('nuevo Sofia Prueba2', { enviado: 20 });
    expect(otra.state).toBe('completed');
    expect(textos().at(-1)).toBe('📌 NUEVO Sofia Prueba2');
    expect(alBot).toEqual(['listo', 'D 26 1']);
  });

  it('un gasto esperando su foto sigue en el bot; un código del viaje (no es lo que espera) lo corta', async () => {
    t.negocios.push({ id: 'n-car', workspace_id: WS, linea_id: LINEA, codigo: 'C 26 9', nombre: 'Punta Cana Nov', estado: 'abierto', created_at: '2026-09-20T10:00:00Z', contacto_id: 'c-car', empresa_id: null, responsable_id: null, contactos: { nombre: 'CAMILA PRUEBA' }, empresas: null });
    const sesion = { id: 's3', user_phone: TEL, workspace_id: WS, state: 'awaiting_image', expires_at: '2026-10-01T23:00:00Z' };
    t.bot_sessions.push(sesion);
    await llega('taxi al aeropuerto', { enviado: 0 });
    expect(alBot).toEqual(['taxi al aeropuerto']);
    await llega('C 26 9', { enviado: 5 });
    expect(sesion.state).toBe('completed');
    expect(textos().at(-1)).toBe('📌 Punta Cana Nov · Camila Prueba (C 26 9)');
  });

  it('las consultas al bot van con «bot …» (la palabra se quita); «gasto …» sigue igual', async () => {
    await llega('bot ¿cuánto vendimos en septiembre?', { enviado: 0 });
    await llega('gasto 20000 taxi', { enviado: 5 });
    expect(alBot).toEqual(['¿cuánto vendimos en septiembre?', 'gasto 20000 taxi']);
    expect(t.wa_bandeja_mensajes).toEqual([]);
  });

  it('una pregunta escrita sin prefijo abre una tanda y el bot dice cómo consultarle', async () => {
    await llega('¿cuánto vendimos en septiembre?', { enviado: 0 });
    expect(textos()).toEqual(['Lo guardé con las solicitudes de viaje. Si era una consulta para el bot, escríbela empezando con «bot», por ejemplo: «bot ¿cuánto vendimos en septiembre?».']);
  });

  it('escenario 6: «ok gracias» suelto no termina en «¿A qué viaje van?»', async () => {
    await llega('ok gracias', { enviado: 0 });
    await llega('listo', { enviado: 5 });
    expect(textos()).toEqual(['No tengo mensajes pendientes por agrupar.']);
    expect(t.wa_bandeja_entregas[0]).toMatchObject({ estado: 'esperando_cliente', pregunta_enviada_at: null });
    // No ocupa la cola: lo siguiente se pregunta enseguida.
    await llega('nuevo Laura Prueba2', { enviado: 20 });
    await llega(CARTAGENA, { enviado: 22 });
    await llega('listo', { enviado: 24 });
    expect(textos().at(-1)).toContain('Laura Prueba2 · Entendí 1 viaje:');
  });

  it('escenario 6: las risas no salen numeradas en el resumen', async () => {
    await llega('nuevo Sofia Prueba2', { enviado: 0 });
    await llega('Queremos ir a Medellín, somos 2 adultos, salimos de Cali', { enviado: 3 });
    await llega('jajaja', { enviado: 6 });
    await llega('😂😂', { enviado: 8 });
    await llega('Del 5 al 8 de noviembre, hotel 3 estrellas', { enviado: 10 });
    await llega('listo', { enviado: 12 });
    expect(textos().at(-1)).toContain('1) NUEVO Sofia Prueba2 — 2 mensajes\n   1 «Queremos ir a Medellín, somos 2 adultos…»\n   2 «Del 5 al 8 de noviembre, hotel 3 estrel…»');
  });
});

// ── Parte B: los viajes se nombran como la agencia los recuerda ─────────────

describe('parte B: el nombre del negocio es encabezado y es como se muestra', () => {
  const negocio = (id: string, codigo: string, nombre: string, cliente: string, created = '2026-09-20T10:00:00Z'): Fila => ({
    id, workspace_id: WS, linea_id: LINEA, codigo, nombre, estado: 'abierto', created_at: created, contacto_id: `c-${id}`, empresa_id: null, responsable_id: null, contactos: { nombre: cliente }, empresas: null,
  });

  it('nombre exacto → 📌; código → 📌 con el nombre; aproximado → «¿Cambias a…?»; repetido → pregunta cuál, con cliente y código', async () => {
    t.negocios.push(
      negocio('n5', 'M1 26 5', 'Europa 2 días', 'CAROLINA RUIZ'),
      negocio('n4', 'M1 26 4', 'ARMENIA 2N', 'JUAN PRUEBA'),
      negocio('n3', 'M1 26 3', 'ARMENIA 2N', 'PEDRO PRUEBA'),
    );
    await llega('europa 2 dias', { enviado: 0 });
    await llega('M1 26 4', { enviado: 5 });
    await llega('Europa 2 dia', { enviado: 10 });
    await llega('sí', { enviado: 12 });
    await llega('Armenia 2N', { enviado: 20 });
    expect(textos()).toEqual([
      '📌 Europa 2 días · Carolina Ruiz (M1 26 5)',
      '📌 ARMENIA 2N · Juan Prueba (M1 26 4)',
      '¿Cambias a Europa 2 días · Carolina Ruiz (M1 26 5)? sí/no',
      '📌 Europa 2 días · Carolina Ruiz (M1 26 5)',
      '¿Cuál viaje? «Armenia 2N» puede ser:\n- ARMENIA 2N · Juan Prueba (M1 26 4)\n- ARMENIA 2N · Pedro Prueba (M1 26 3)\nEscribe su código. Hasta entonces no asigno lo que sigue.',
    ]);
  });

  it('el resumen y la carga en un viaje existente lo nombran igual', async () => {
    t.negocios.push(negocio('n5', 'M1 26 5', 'Europa 2 días', 'CAROLINA RUIZ'));
    t.negocio_bloques.push({ id: 'b5', negocio_id: 'n5', data: { destino: 'EUROPA' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
    await llega('Europa 2 días', { enviado: 0 });
    await llega('somos 2 adultos, salimos de Medellín', { enviado: 3 });
    await llega('listo', { enviado: 5 });
    expect(textos().at(-1)).toMatch(/^Europa 2 días · Carolina Ruiz \(M1 26 5\) · Entendí 1 viaje:\n1\) Europa 2 días · Carolina Ruiz \(M1 26 5\) — 1 mensaje/);
    await llega('sí', { enviado: 10 });
    colaModelo = [salidaModelo({ adultos: { valor: '2', frase: 'somos 2 adultos' }, ciudad_origen: { valor: 'Medellín', frase: 'salimos de Medellín' } })];
    await cron(30);
    expect(textos().at(-1)).toContain('Europa 2 días · Carolina Ruiz (M1 26 5) — Mínimo');
    expect(textos().at(-1)).toMatch(/^Cargué en Europa 2 días · Carolina Ruiz \(M1 26 5\): /);
  });

  it('sin destino el nombre es provisional y cambia cuando llega el destino; si alguien lo editó, no', async () => {
    await llega('nuevo Laura Prueba', { enviado: 0 });
    await llega('somos 2 adultos, salimos de Cali', { enviado: 3 });
    await llega('listo', { enviado: 5 });
    await llega('sí', { enviado: 8 });
    colaModelo = [salidaModelo({ adultos: { valor: '2', frase: 'somos 2 adultos' }, ciudad_origen: { valor: 'Cali', frase: 'salimos de Cali' } })];
    await cron(30);
    const laura = negocioDe('LAURA PRUEBA')!;
    expect(laura).toMatchObject({ nombre: 'Viaje de Laura Prueba', metadata: { nombre_auto: 'Viaje de Laura Prueba', nombre_provisional: true } });
    expect(textos().at(-1)).toContain('Viaje de Laura Prueba (L 26 1) — Mínimo'); // el nombre ya trae al cliente: no se repite

    // Llega el destino y el mes: el nombre se arma con la convención.
    await llega('L 26 1', { enviado: 100 });
    await llega('Queremos Cartagena en diciembre', { enviado: 103 });
    await llega('listo', { enviado: 105 });
    await llega('sí', { enviado: 108 });
    colaModelo = [salidaModelo({ destino: { valor: 'Cartagena', frase: 'Queremos Cartagena' } })];
    await cron(150);
    expect(laura).toMatchObject({ nombre: 'CARTAGENA DIC', metadata: { nombre_auto: 'CARTAGENA DIC', nombre_provisional: false } });
    expect(textos().at(-1)).toContain('CARTAGENA DIC · Laura Prueba (L 26 1) — Mínimo');
    // La pregunta de la fecha recuerda el mes que dijeron (informe, error 12).
    expect(textos().at(-1)).toContain('¿Qué día salen? (dijeron diciembre)');

    // Otro provisional, editado a mano antes de que llegue el destino: no se toca.
    await llega('nuevo Pedro Prueba', { enviado: 200 });
    await llega('somos 4 adultos', { enviado: 203 });
    await llega('listo', { enviado: 205 });
    await llega('sí', { enviado: 208 });
    colaModelo = [salidaModelo({ adultos: { valor: '4', frase: 'somos 4 adultos' } })];
    await cron(250);
    const pedro = negocioDe('PEDRO PRUEBA')!;
    expect(pedro.nombre).toBe('Viaje de Pedro Prueba');
    pedro.nombre = 'Pedro luna de miel';
    await llega('P 26 1', { enviado: 300 });
    await llega('vamos a San Andrés', { enviado: 303 });
    await llega('listo', { enviado: 305 });
    await llega('sí', { enviado: 308 });
    colaModelo = [salidaModelo({ destino: { valor: 'San Andrés', frase: 'vamos a San Andrés' } })];
    await cron(350);
    expect(pedro.nombre).toBe('Pedro luna de miel');
    expect(datosDe('PEDRO PRUEBA')).toMatchObject({ destino: 'SAN ANDRÉS', adultos: 4 });
    // «somos 4 adultos» no cerró los menores (informe, error 4).
    expect(datosDe('PEDRO PRUEBA').ninos).toBeUndefined();
  });
});
