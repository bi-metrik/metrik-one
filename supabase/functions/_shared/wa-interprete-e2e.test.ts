import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rpcDelDirectorio } from './__fixtures__/directorio-doble.ts';

/**
 * De punta a punta con la base en memoria de `wa-bandeja-vivo.test.ts` (copiada tal cual: emula
 * `wa_bandeja_registrar_mensaje` y los filtros de PostgREST): un escrito pasa por el intérprete (con un
 * modelo falso), lo demás por la ruta de hoy (`rutaDelMensaje` → `atenderEnBandeja`), y al cerrar la
 * tanda el resumen sale del reparto real (`armarSegmentos` con la `interpretacion` guardada).
 * Sintético: Lina y Jorge Pérez, Carolina Ruiz; el comercial es «Vale».
 */

const enviados: Array<{ phone: string; texto: string }> = [];
vi.mock('./wa-respond.ts', () => ({
  sendTextMessage: vi.fn(async (phone: string, texto: string) => { enviados.push({ phone, texto }); }),
  sendButtons: vi.fn(async () => {}),
}));

type Tablas = Record<string, Fila[]>;

// ── Base en memoria (copia de wa-bandeja-vivo.test.ts) ──────────────────────

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
    if (nombre === 'wa_bandeja_cerrar_vencidas') {
      // Como la función SQL: cierra las abiertas sin mensajes en la ventana (5 min por defecto).
      const ahora = Date.now();
      const filas: Fila[] = [];
      for (const e of t.wa_bandeja_entregas.filter(x => x.estado === 'abierta')) {
        const ultimo = Math.max(...t.wa_bandeja_mensajes.filter(m => m.entrega_id === e.id).map(m => Date.parse(String(m.recibido_at))));
        if (ahora - ultimo < 5 * 60_000) continue;
        Object.assign(e, { estado: 'esperando_cliente', cerrada_at: new Date(ahora).toISOString(), motivo_cierre: 'inactividad' });
        filas.push({ entrega: e.id, workspace: e.workspace_id, telefono: e.remitente_phone, mensajes: e.n_mensajes });
      }
      return { data: filas, error: null };
    }
    const delDirectorio = rpcDelDirectorio(t, nombre, a);
    if (delDirectorio) return delDirectorio;
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

const WS = 'ws-prueba';

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

const LINEA = 'linea-viajes';
const TEL = '573000000009';
const T0 = Date.parse('2026-10-02T15:00:00Z');

function negocio(id: string, codigo: string, cliente: string, destino: string): { n: Fila; b: Fila } {
  return {
    n: { id, workspace_id: WS, linea_id: LINEA, estado: 'abierto', codigo, nombre: null, created_at: new Date(T0 - 86_400_000).toISOString(), contacto_id: `c-${id}`, empresa_id: null, responsable_id: null, contactos: { nombre: cliente }, empresas: null },
    b: { id: `b-${id}`, negocio_id: id, bloque_config_id: 'bc-solicitud', data: { destino } },
  };
}
const VIAJES = [negocio('v11', 'T1 26 11', 'CAROLINA RUIZ', 'PUNTA CANA'), negocio('v12', 'T1 26 12', 'JORGE PÉREZ', 'MADRID'), negocio('v14', 'T1 26 14', 'LINA PÉREZ', 'CARTAGENA')];

function base(): Tablas {
  return {
    workspaces: [{ id: WS, slug: 'agencia', linea_activa_id: LINEA, modules: { bandeja_solicitudes_wa: true }, config_extra: { bandeja_solicitudes: { linea_id: LINEA, modo_viajes: 'encabezado', confirmar: 'siempre' } } }],
    staff: [{ id: 'st-1', workspace_id: WS, full_name: 'DUEÑA PRUEBA' }],
    wa_collaborators: [{ id: 'col-1', workspace_id: WS, name: 'VALE PRUEBA' }],
    negocios: VIAJES.map(v => v.n), negocio_responsables: [], negocio_bloques: VIAJES.map(v => v.b), activity_log: [],
    wa_bandeja_entregas: [], wa_bandeja_mensajes: [], wa_bandeja_entendimientos: [],
    etapas_negocio: [{ id: 'et-solicitud', linea_id: LINEA, orden: 1, stage: 'venta' }],
    bloque_configs: [BLOQUE_CONFIG], contactos: [], empresas: [], staff_areas: [], bot_sessions: [], wa_message_log: [], wa_envios: [],
  };
}

let t: Tablas;
let db: ReturnType<typeof crearDb>;
let bandeja: typeof import('./wa-bandeja.ts');
let interprete: typeof import('./wa-interprete.ts');
let n = 0;

const usuario = (bot: unknown) => ({ workspace_id: WS, phone: TEL, name: 'Vale', role: 'operator', collaborator_id: 'col-1', subscription_status: 'trial', modulos: { modules: { bandeja_solicitudes_wa: true }, bot_conversacional: bot } });

/** Un mensaje como lo procesa el webhook: 1a-int y, si no atiende, la ruta de hoy. */
async function llega(texto: string, o: { seg: number; reenviado?: boolean; modelo?: unknown; bot?: unknown }) {
  vi.setSystemTime(new Date(T0 + o.seg * 1000));
  const message = { phone: TEL, text: texto, type: 'text', reenviado: o.reenviado === true, wa_message_id: `wamid.e2e.${++n}`, timestamp: String(Math.floor((T0 + o.seg * 1000) / 1000)) };
  const user = usuario(o.bot === undefined ? { activo: true } : o.bot);
  const llamarModelo = vi.fn(async () => ({ ok: true as const, json: o.modelo ?? { acciones: [{ accion: 'pedir_aclaracion', evidencia: texto }] }, tokensIn: 1, tokensOut: 1, ms: 1 }));
  const r = await interprete.atenderEscrito(db as never, user as never, message as never, { llamarModelo, env: () => undefined });
  if (r.atendido) return;
  const ruta = await bandeja.rutaDelMensaje(db as never, user as never, message as never);
  if (ruta.atendido) return;
  if (ruta.ruta === 'bandeja' && ruta.config) await bandeja.atenderEnBandeja(db as never, user as never, message as never, ruta.config);
}
const textos = () => enviados.map(e => e.texto);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => undefined } };
  bandeja = await import('./wa-bandeja.ts');
  interprete = await import('./wa-interprete.ts');
  bandeja.esperaEnVuelo.dormir = async () => {};
  t = base();
  db = crearDb(t);
  enviados.length = 0;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const CARTAGENA = { acciones: [{ accion: 'abrir_viaje', evidencia: 'lo de Cartagena', ref_destino: 'Cartagena' }] };

describe('de punta a punta: la caja que decidió el intérprete llega al resumen', () => {
  it('encendido: «lo de Cartagena» abre la caja de Lina Pérez con 📌 y el resumen la respeta sin preguntar', async () => {
    await llega('lo de Cartagena', { seg: 0, modelo: CARTAGENA });
    expect(textos()).toEqual(['📌 Lina Pérez (T1 26 14)']);
    expect(t.wa_bandeja_mensajes[0]).toMatchObject({ cuerpo: 'lo de Cartagena', interpretacion: { accion: 'abrir_viaje', viaje_id: 'v14' } });
    await llega('Vale al final vamos 4, se suma mi cuñada', { seg: 5, reenviado: true });
    await llega('listo', { seg: 10 });
    const resumen = textos().at(-1)!;
    expect(resumen).toMatch(/Entendí 1 viaje/);
    expect(resumen).toMatch(/Lina Pérez \(T1 26 14\) — 1 mensaje/);
    expect(resumen).not.toMatch(/De qué viaje es/);
    // La telemetría del escrito atendido: una fila, con la acción de la bandeja (no cuenta para el tope de 30).
    expect(t.wa_message_log).toHaveLength(1);
    expect(t.wa_message_log[0]).toMatchObject({ interprete_accion: 'bandeja.abrir_viaje', interprete_resultado: 'atendido', parser_source: 'interprete' });
  });

  it('apagado: el mismo escrito sigue la ruta de hoy (lo aproximado pregunta con la lista) y no deja telemetría', async () => {
    await llega('lo de Cartagena', { seg: 0, bot: null });
    expect(textos()[0]).toMatch(/^¿De qué viaje es «lo de Cartagena»\?/);
    expect(t.wa_bandeja_mensajes[0].interpretacion).toBeUndefined();
    expect(t.wa_message_log).toEqual([]);
  });

  it('una nota interna no entra a la tanda: el resumen solo lleva lo del cliente', async () => {
    await llega('lo de Cartagena', { seg: 0, modelo: CARTAGENA });
    await llega('ojo que esta señora es súper regatera', { seg: 3, modelo: { acciones: [{ accion: 'nota_interna', evidencia: 'esta señora es súper regatera' }] } });
    await llega('Hola Vale, somos 2 adultos', { seg: 5, reenviado: true });
    await llega('listo', { seg: 10 });
    expect(textos()).toContain('No lo guardo: en la historia solo va lo que pide el cliente.');
    expect(t.wa_bandeja_mensajes.some(m => String(m.cuerpo).includes('regatera'))).toBe(false);
    expect(textos().at(-1)).toMatch(/Lina Pérez \(T1 26 14\) — 1 mensaje/);
  });
});
