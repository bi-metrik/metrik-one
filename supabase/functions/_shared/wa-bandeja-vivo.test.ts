import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { directorioCaido, rpcDelDirectorio } from './__fixtures__/directorio-doble.ts';

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
 *   Segunda vuelta (vivo-2026-10-01-v2.md), mismas condiciones; todas cayeron:
 *   V1 · con «¿A qué viaje van?» pendiente un código o «nuevo X» vuelven a ser encabezado (7) · V1b / V1c ·
 *   la pregunta de la entrega / del entendimiento no se reconoce como de viaje (6 / 1) · V2 · DESCARTAR no
 *   descarta (1) · V3 · el nombre en la lista no elige (2) · V3b · ni el de un viaje fuera de la lista (1)
 *   V4 · el «sí» corto vuelve a caer en la caja (2) · V4b · solo sin caja abierta (1) · V5 · «listo» se toma
 *   como «sí» (2) · V6 · «cancelar» vuelve a ser contenido (2) · V7 · el viaje del resumen no gana (1)
 *   V7b · lo aproximado empata con lo exacto (1) · V8 · «maletas» no nombra «maleta» (1) · V9 · sin avisos
 *   de falla (1) · V9b · el aviso se repite en cada intento (1) · V10 · REINTENTAR es contenido (1)
 *   V10b · REINTENTAR no reinicia los intentos (1) · V11 · se reintenta en la misma pasada (1) · V12 · un
 *   «ok gracias» suelto abre tanda (1) · V13 · solo el provisional se renombra (1) · V13b · se olvida el
 *   mes (1) · V14 / V15 · el bot de siempre sin cliente en la lista / en la selección de actividad (1 / 1)
 *   V16 · el nombre sin NUEVO no crea el contacto (1) · V17 · DESCARTAR cuenta el encabezado (1)
 *   V18 · el recordatorio de «¿A qué viaje van?» vuelve a decir «SÍ o corrige» (1).
 *   M5b (descartada): un segundo filtro de «forma de respuesta» en `wa-bandeja.ts` no cambiaba nada
 *   observable porque `hayQueEsperarEnVuelo` ya lo mira; se quitó para que la regla viva en un solo lado.
 */

const enviados: Array<{ phone: string; texto: string }> = [];
vi.mock('./wa-respond.ts', () => ({
  sendTextMessage: vi.fn(async (phone: string, texto: string) => { enviados.push({ phone, texto }); }),
  sendButtons: vi.fn(async () => {}),
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
    empresas: [],
    staff_areas: [],
    bot_sessions: [],
    wa_message_log: [],
    wa_envios: [],
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
/** Gemini responde 403 (cobro), como en la segunda vuelta en vivo. */
let geminiCaido = false;

const USER = { workspace_id: WS, phone: TEL, name: 'Comercial', role: 'operator', collaborator_id: 'col-1', subscription_status: 'trial', modulos: { modules: { bandeja_solicitudes_wa: true } } };
const T0 = Date.parse('2026-10-01T19:29:39Z');
let n = 0;

/**
 * Un mensaje del comercial como lo procesa el webhook. `enviado`: segundos desde T0 en que lo mandó
 * (la hora de Meta). `llega`: segundos desde T0 en que se procesa (por defecto, 2 s después).
 */
async function llega(
  texto: string,
  p: {
    enviado: number; llega?: number; reenviado?: boolean;
    /**
     * Con el interruptor del intérprete PRENDIDO (`config_extra.bot_conversacional`): el escrito pasa primero por
     * el bloque 1a-int del webhook (`atenderEscrito`) con este modelo falso; si no lo atiende, sigue la ruta de hoy.
     */
    interprete?: { modelo?: unknown; llamadas?: { n: number } };
  } = { enviado: 0 },
) {
  vi.setSystemTime(new Date(T0 + (p.llega ?? p.enviado + 2) * 1000));
  const message = { phone: TEL, text: texto, type: 'text', reenviado: p.reenviado === true, wa_message_id: `wamid.vivo.${++n}`, timestamp: String(Math.floor((T0 + p.enviado * 1000) / 1000)) };
  if (p.interprete) {
    const user = { ...USER, modulos: { ...USER.modulos, bot_conversacional: { activo: true, modelo: 'gemini-3.8-flash' } } };
    const { atenderEscrito } = await import('./wa-interprete.ts');
    const cuenta = p.interprete.llamadas;
    const llamarModelo = async () => {
      if (cuenta) cuenta.n++;
      return { ok: true as const, json: p.interprete!.modelo ?? { acciones: [{ accion: 'pedir_aclaracion', evidencia: texto }] }, tokensIn: 1, tokensOut: 1, ms: 1 };
    };
    const hecho = await atenderEscrito(db as never, user as never, message as never, { llamarModelo, env: () => undefined });
    if (hecho.atendido) return;
  }
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

/** Los dos crons de `wa-alerts`: el cierre por inactividad (`bandeja_cierre`) y el del entendimiento. */
async function cronConCierre(seg: number) {
  vi.setSystemTime(new Date(T0 + seg * 1000));
  await bandeja.cerrarEntregasVencidas(db as never);
  await cron(seg);
}

const textos = () => enviados.map(e => e.texto);
/**
 * Decisión 1 de Mauricio (2026-10-05): un cliente nuevo no se crea sin celular, correo o usuario. Cada cliente
 * sintético de estas pruebas trae su celular en el encabezado: inventado, fijo por nombre (sin tildes ni mayúsculas,
 * así «daniel perez» y «Daniel Pérez» tienen el mismo).
 */
const celDe = (nombre: string) => {
  const n = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const h = [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 10_000_000, 7);
  return `300${String(h).padStart(7, '0')}`;
};
const celEscrito = (nombre: string) => { const d = celDe(nombre); return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`; };
/** El encabezado de un viaje nuevo con el celular del cliente: «nuevo Laura Prueba2 300 123 4567». */
const nuevo = (nombre: string) => `nuevo ${nombre} ${celEscrito(nombre)}`;
/** El acuse en el acto de un viaje nuevo de un cliente que no está en el directorio (con su llave). Con las líneas de los viajes parecidos. */
const acuse = (nombre: string, ...parecidos: string[]) => [
  `Va como viaje nuevo de ${nombre}, cliente nuevo (cel. ${celEscrito(nombre)}). Lo creo cuando me digas que sí en el resumen.`,
  'Reenvíame lo que te pidió y al final te muestro el resumen.', ...parecidos].join('\n');
/** Cómo el resumen nombra el viaje nuevo de ese cliente. */
const grupo = (nombre: string) => `Viaje nuevo de ${nombre} (cliente nuevo, cel. ${celEscrito(nombre)})`;
/** El destino guardado de un viaje nuevo de un cliente nuevo, con su llave. */
const destinoNuevo = (nombre: string) => ({ tipo: 'nuevo', cliente: nombre, resuelto: true, llave: { celular: celDe(nombre) } });
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
    if (geminiCaido) return new Response('{"error":{"code":403,"message":"billing"}}', { status: 403 });
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
  geminiCaido = false;
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
    await llega(nuevo('Laura Prueba2'), { enviado: 0, llega: 6 });
    expect(textos()).toEqual([acuse('Laura Prueba2')]);
    await llega('listo', { enviado: 5, llega: 7 });
    expect(alBot).toEqual([]); // nada al bot de actividades
    expect(textos().at(-1)).toBe([
      'Laura Prueba2 · ¿Lo cargo así?\nEntendí 1 viaje:',
      `1) ${grupo('Laura Prueba2')} — 1 mensaje`,
      '   1 «Hola, queremos ir a Cartagena del 12 al…»',
      'No cargué nada todavía. Responde «sí» para cargarlo, o corrige: «el 1 es de Luisa», «descartar el 1». Con «descartar» no cargo nada.',
    ].join('\n'));

    await llega('sí', { enviado: 20 });
    // 1b · 6 s después del «sí», sin esperar la carga: Diego. La carga de Laura llega en medio.
    await llega(nuevo('Diego Prueba2'), { enviado: 26 });
    expect(textos().at(-1)).toBe(acuse('Diego Prueba2'));
    colaModelo = [LAURA];
    await cron(30);
    await llega('Quiero un viaje para puntacana y curasao', { enviado: 31 });
    await llega('en 1 habitación 2 adultos y 2 menores y en la otra 3 adultos', { enviado: 40 });
    await llega('Los niños tienen 7 años y un bebe de 1 y medio', { enviado: 50 });
    await llega('listo', { enviado: 55 });
    expect(textos().at(-1)!.startsWith(`Diego Prueba2 · ¿Lo cargo así?\nEntendí 1 viaje:\n1) ${grupo('Diego Prueba2')} — 3 mensajes\n   1 «Quiero un viaje para puntacana y curasao»`)).toBe(true);
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
      ['Hola, querem', destinoNuevo('Laura Prueba2')],
      ['Quiero un vi', destinoNuevo('Diego Prueba2')],
      ['en 1 habitac', destinoNuevo('Diego Prueba2')],
      ['Los niños ti', destinoNuevo('Diego Prueba2')],
    ]);
  });

  it.each([
    ['el encabezado se procesa primero', 1, false],
    ['el escrito se procesa primero', 1, true],
    ['el escrito se procesa primero', 2, true],
    ['el escrito se procesa primero', 3, true],
    ['el encabezado se procesa primero', 3, false],
  ])('%s, con %i s entre los dos: el escrito termina en la caja del encabezado', async (_n, gap, escritoPrimero) => {
    const enc = () => llega(nuevo('Laura Prueba2'), { enviado: 0, llega: escritoPrimero ? gap + 2 : 1 });
    const esc = () => llega(CARTAGENA, { enviado: gap, llega: escritoPrimero ? gap + 1 : gap + 2 });
    if (escritoPrimero) { await esc(); await enc(); } else { await enc(); await esc(); }
    await llega('listo', { enviado: gap + 2, llega: gap + 4 });
    expect(alBot).toEqual([]);
    expect(textos().at(-1)).toContain(`1) ${grupo('Laura Prueba2')} — 1 mensaje\n   1 «Hola, queremos ir a Cartagena`);
  });

  it('con el resumen de Laura sin contestar, el escrito de Diego que llega antes que su encabezado NO se toma como la respuesta', async () => {
    await llega(nuevo('Laura Prueba2'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 3 });
    await llega('listo', { enviado: 5 });
    expect(textos().at(-1)).toContain('Laura Prueba2 · ¿Lo cargo así?\nEntendí 1 viaje:');
    // Sin contestar, el comercial pasa a Diego: el escrito se procesa primero y espera; mientras tanto
    // se registra el encabezado mandado 2 s antes.
    mientras.push(() => llega(nuevo('Diego Prueba2'), { enviado: 30, llega: 33 }));
    await llega('Quiero un viaje para puntacana y curasao', { enviado: 32, llega: 33 });
    expect(esperas).toBeGreaterThan(0);
    const laura = t.wa_bandeja_entregas.find(e => e.estado === 'esperando_cliente');
    expect(laura).toBeTruthy(); // el resumen de Laura sigue esperando su «sí»
    await llega('listo', { enviado: 40 });
    expect(textos().some(x => x.startsWith('No entendí «Quiero un viaje'))).toBe(false);
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'Quiero un viaje para puntacana y curasao')).toMatchObject({ papel: 'contenido' });
    // Diego espera turno (una pregunta abierta a la vez) y sale cuando se contesta la de Laura.
    expect(textos().at(-1)).toBe('Primero: Laura Prueba2 · ¿Lo cargo así?\nLo que acabas de mandar te lo pregunto después.');
    await llega('sí', { enviado: 50 });
    colaModelo = [LAURA];
    await cron(60);
    expect(textos().at(-1)!.startsWith(`Diego Prueba2 · ¿Lo cargo así?\nEntendí 1 viaje:\n1) ${grupo('Diego Prueba2')} — 1 mensaje\n   1 «Quiero un viaje para puntacana y curasao»`)).toBe(true);
  });

  it('un «listo» que se procesa antes que el último mensaje espera a que entre: el mensaje no queda fuera ni como respuesta', async () => {
    await llega(nuevo('Laura Prueba2'), { enviado: 0 });
    mientras.push(() => llega(CARTAGENA, { enviado: 3, llega: 8 }));
    await llega('listo', { enviado: 5, llega: 6 });
    expect(textos().at(-1)).toContain(`1) ${grupo('Laura Prueba2')} — 1 mensaje\n   1 «Hola, queremos ir a Cartagena`);
    expect(t.wa_bandeja_mensajes.filter(m => m.papel === 'respuesta_cliente')).toEqual([]);
  });

  it('un «sí» al resumen no espera: un encabezado mandado después no se lo traga', async () => {
    await llega(nuevo('Laura Prueba2'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 3 });
    await llega('listo', { enviado: 5 });
    mientras.push(() => llega(nuevo('Diego Prueba2'), { enviado: 22 }));
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
    expect(textos().at(-1)).toMatch(/· ¿De qué (?:cliente|viaje) es el mensaje\?/);
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
    await llega(nuevo('Sofia Prueba2'), { enviado: 20 });
    expect(otra.state).toBe('completed');
    expect(textos().at(-1)).toBe(acuse('Sofia Prueba2'));
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

  it('escenario 6: «ok gracias» suelto no abre una tanda (v2, N7) ni termina en «¿A qué viaje van?»', async () => {
    await llega('ok gracias', { enviado: 0 });
    expect(t.wa_bandeja_entregas).toEqual([]);
    expect(textos()).toEqual([]);
    await llega('listo', { enviado: 5 });
    expect(textos()).toEqual(['No tengo mensajes pendientes por agrupar.']);
    // No ocupa la cola: lo siguiente se pregunta enseguida.
    await llega(nuevo('Laura Prueba2'), { enviado: 20 });
    await llega(CARTAGENA, { enviado: 22 });
    await llega('listo', { enviado: 24 });
    expect(textos().at(-1)).toContain('Laura Prueba2 · ¿Lo cargo así?\nEntendí 1 viaje:');
  });

  it('escenario 6: las risas no salen numeradas en el resumen', async () => {
    await llega(nuevo('Sofia Prueba2'), { enviado: 0 });
    await llega('Queremos ir a Medellín, somos 2 adultos, salimos de Cali', { enviado: 3 });
    await llega('jajaja', { enviado: 6 });
    await llega('😂😂', { enviado: 8 });
    await llega('Del 5 al 8 de noviembre, hotel 3 estrellas', { enviado: 10 });
    await llega('listo', { enviado: 12 });
    expect(textos().at(-1)).toContain(`1) ${grupo('Sofia Prueba2')} — 2 mensajes\n   1 «Queremos ir a Medellín, somos 2 adultos…»\n   2 «Del 5 al 8 de noviembre, hotel 3 estrel…»`);
  });
});

// ── Parte B: los viajes se nombran como la agencia los recuerda ─────────────

describe('parte B: el nombre del negocio es encabezado y es como se muestra', () => {
  const negocio = (id: string, codigo: string, nombre: string, cliente: string, created = '2026-09-20T10:00:00Z'): Fila => ({
    id, workspace_id: WS, linea_id: LINEA, codigo, nombre, estado: 'abierto', created_at: created, contacto_id: `c-${id}`, empresa_id: null, responsable_id: null, contactos: { nombre: cliente }, empresas: null,
  });

  // Trappvel 2026-10-02 (regla 3): aproximado y repetido preguntan con la lista numerada; se contesta con el número.
  it('nombre exacto → 📌; código → 📌 con el nombre; aproximado y repetido → la lista numerada, que se contesta con el número', async () => {
    t.negocios.push(
      negocio('n5', 'M1 26 5', 'Europa 2 días', 'CAROLINA RUIZ'),
      negocio('n4', 'M1 26 4', 'ARMENIA 2N', 'JUAN PRUEBA'),
      negocio('n3', 'M1 26 3', 'ARMENIA 2N', 'PEDRO PRUEBA'),
    );
    await llega('europa 2 dias', { enviado: 0 });
    await llega('M1 26 4', { enviado: 5 });
    await llega('Europa 2 dia', { enviado: 10 });
    await llega('sí', { enviado: 12 });
    await llega('1', { enviado: 14 });
    await llega('Armenia 2N', { enviado: 20 });
    await llega('2', { enviado: 22 });
    const pie = 'Responde el número; si es un viaje nuevo, «nuevo» y el nombre del cliente; o «descartar».';
    expect(textos()).toEqual([
      '📌 Europa 2 días · Carolina Ruiz (M1 26 5)',
      '📌 ARMENIA 2N · Juan Prueba (M1 26 4)',
      `¿De qué viaje es «Europa 2 dia»? Hasta que me digas, no asigno lo que sigue.\n1. Europa 2 días · Carolina Ruiz (M1 26 5)\n${pie}`,
      `No entendí. ¿De qué viaje es «Europa 2 dia»? Hasta que me digas, no asigno lo que sigue.\n1. Europa 2 días · Carolina Ruiz (M1 26 5)\n${pie}`,
      '📌 Europa 2 días · Carolina Ruiz (M1 26 5)',
      `¿De qué viaje es «Armenia 2N»? Hasta que me digas, no asigno lo que sigue.\n1. ARMENIA 2N · Juan Prueba (M1 26 4)\n2. ARMENIA 2N · Pedro Prueba (M1 26 3)\n${pie}`,
      '📌 ARMENIA 2N · Pedro Prueba (M1 26 3)',
    ]);
  });

  it('el resumen y la carga en un viaje existente lo nombran igual', async () => {
    t.negocios.push(negocio('n5', 'M1 26 5', 'Europa 2 días', 'CAROLINA RUIZ'));
    t.negocio_bloques.push({ id: 'b5', negocio_id: 'n5', data: { destino: 'EUROPA' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
    await llega('Europa 2 días', { enviado: 0 });
    await llega('somos 2 adultos, salimos de Medellín', { enviado: 3 });
    await llega('listo', { enviado: 5 });
    expect(textos().at(-1)).toMatch(/^Europa 2 días · Carolina Ruiz \(M1 26 5\) · ¿Lo cargo así\?\nEntendí 1 viaje:\n1\) Europa 2 días · Carolina Ruiz \(M1 26 5\) — 1 mensaje/);
    await llega('sí', { enviado: 10 });
    colaModelo = [salidaModelo({ adultos: { valor: '2', frase: 'somos 2 adultos' }, ciudad_origen: { valor: 'Medellín', frase: 'salimos de Medellín' } })];
    await cron(30);
    expect(textos().at(-1)).toContain('Europa 2 días · Carolina Ruiz (M1 26 5) — Mínimo');
    expect(textos().at(-1)).toMatch(/^Cargué en Europa 2 días · Carolina Ruiz \(M1 26 5\): /);
  });

  it('sin destino el nombre es provisional y cambia cuando llega el destino; si alguien lo editó, no', async () => {
    await llega(nuevo('Laura Prueba'), { enviado: 0 });
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
    await llega(nuevo('Pedro Prueba'), { enviado: 200 });
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

// ── Segunda vuelta en vivo (vivo-2026-10-01-v2.md) ──────────────────────────

const negocioDePrueba = (id: string, codigo: string, nombre: string, cliente: string): Fila => ({
  id, workspace_id: WS, linea_id: LINEA, codigo, nombre, estado: 'abierto', created_at: '2026-09-20T10:00:00Z',
  contacto_id: `c-${id}`, empresa_id: null, responsable_id: null, contactos: { nombre: cliente }, empresas: null, workspaces: { slug: 'agencia' },
});

/** Dos viajes abiertos con su bloque (P 26 2 a San Andrés, M 26 2 a Bariloche). */
function viajesAbiertos() {
  t.negocios.push(
    negocioDePrueba('n-p', 'P 26 2', 'SAN ANDRÉS DIC', 'PEDRO PRUEBA5'),
    negocioDePrueba('n-m', 'M 26 2', 'BARILOCHE JUL 3-10', 'MATEO PRUEBA5'),
  );
  for (const [id, destino] of [['n-p', 'SAN ANDRÉS'], ['n-m', 'BARILOCHE']]) {
    t.negocio_bloques.push({ id: `b-${id}`, negocio_id: id, data: { destino }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
  }
}

const PEDIDO = 'Hola, quiero cotizar para 2 adultos del 8 al 12 de enero';
const pedido = () => salidaModelo({ adultos: { valor: '2', frase: '2 adultos' } });

/** Escenario 5: un escrito sin encabezado y «listo» → «¿A qué viaje van?» con la lista. */
async function preguntaDeViaje() {
  viajesAbiertos();
  await llega(PEDIDO, { enviado: 0 });
  await llega('listo', { enviado: 3 });
  expect(textos().at(-1)).toMatch(/¿De qué viaje (?:es|son)/);
}

describe('v2 · N2: «¿A qué viaje van?» se contesta con cada forma que el bot ofrece', () => {
  it.each([
    ['el número de la lista (con el formato «Nombre · Cliente (código)»)', '1'],
    ['el código', 'P 26 2'],
    ['el nombre del negocio', 'San Andrés dic'],
    ['el nombre del cliente', 'Pedro Prueba5'],
  ])('%s («%s»): carga en el viaje, sin abrir una caja nueva aunque haya una abierta', async (_n, respuesta) => {
    await preguntaDeViaje();
    expect(textos().at(-1)).toContain('1. SAN ANDRÉS DIC · Pedro Prueba5 (P 26 2)');
    const antes = textos().length;
    // Un reenvío del cliente abre una caja mientras tanto: la respuesta igual va a la pregunta.
    await llega('perdón, son 3 adultos', { enviado: 6, reenviado: true });
    // Regla 3 (2026-10-02): el contenido que abre una tanda con la pregunta abierta la vuelve a mostrar, corta.
    expect(textos().slice(antes)).toEqual([expect.stringMatching(/^Primero: Tanda de las \d\d:\d\d · ¿De qué viaje son\?$/)]);
    await llega(respuesta, { enviado: 9 });
    expect(textos().slice(antes + 1)).toEqual([]); // ni 📌, ni la lista del encabezado, ni «Primero: …»
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === respuesta)).toMatchObject({ papel: 'respuesta_cliente' });
    colaModelo = [pedido()];
    await cron(60);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n-p' });
  });

  it('el nombre de un viaje abierto que no está en la lista corta también vale', async () => {
    t.negocios.push({ ...negocioDePrueba('n-v', 'C 26 1', 'EUROPA 2 DÍAS', 'CAROLINA RUIZ'), created_at: '2026-01-01T10:00:00Z' });
    t.negocio_bloques.push({ id: 'b-n-v', negocio_id: 'n-v', data: { destino: 'EUROPA' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
    for (const k of [1, 2, 3, 4]) t.negocios.push({ ...negocioDePrueba(`n-x${k}`, `X 26 ${k}`, `VIAJE ${k}`, `CLIENTE ${k}`), created_at: `2026-09-2${k}T10:00:00Z` });
    await preguntaDeViaje();
    expect(textos().at(-1)).not.toContain('EUROPA 2 DÍAS');
    await llega('Europa 2 días', { enviado: 9 });
    colaModelo = [pedido()];
    await cron(60);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n-v' });
  });

  /** Nada creado ni cargado: ni contacto, ni negocio, ni un bloque tocado. */
  function nadaCreado(negociosAntes: number) {
    expect(t.contactos).toEqual([]);
    expect(t.negocios.length).toBe(negociosAntes);
    expect(t.negocio_bloques.find(b => b.negocio_id === 'n-p')!.data).toEqual({ destino: 'SAN ANDRÉS' });
    expect(t.negocio_bloques.find(b => b.negocio_id === 'n-m')!.data).toEqual({ destino: 'BARILOCHE' });
  }

  it('«nuevo Valeria Prueba5»: no es un encabezado ni abre caja; pregunta «¿Creo el cliente nuevo …?» y crea solo con el «sí»', async () => {
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    await llega(nuevo('Valeria Prueba5'), { enviado: 9 });
    expect(textos().some(x => x.startsWith('📌'))).toBe(false);
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toEqual([]);
    colaModelo = [pedido()];
    await cron(60);
    // 2026-10-05: la pregunta es por el VIAJE nuevo y dice lo que sabe el directorio. Comparte el apellido con los dos
    // viajes de la lista: la confirmación lo dice, con su número.
    const conf = textos().at(-1)!;
    expect(conf.startsWith(`Tanda de las ${conf.slice(13, 18)} · ¿Va como viaje nuevo de Valeria Prueba5? No lo tengo en el directorio: lo creo como cliente nuevo, con cel. ${celEscrito('Valeria Prueba5')}.\n`)).toBe(true);
    expect(conf).toMatch(/\nYa hay viajes de (Pedro|Mateo) Prueba5 \([PM] 26 2\) y (Pedro|Mateo) Prueba5 \([PM] 26 2\): si es para uno de esos, responde 1 o 2\.\nResponde sí, o el número del viaje si es uno que ya existe\. No he creado ni cargado nada\.$/);
    nadaCreado(negocios);
    await llega('sí', { enviado: 100 });
    colaModelo = [pedido()];
    await cron(160);
    expect(negocioDe('VALERIA PRUEBA5')).toMatchObject({ nombre: 'Viaje de Valeria Prueba5' });
  });

  // Lo que pide el brief del 2026-10-03: nombres INVENTADOS de cada forma. Todos piden el «sí» antes de crear
  // (sin él no hay contacto, negocio ni carga) y crean al recibirlo, con el nombre tal cual se mostró.
  it.each([
    ['persona de 1 palabra', 'Salgar'],
    ['persona de 2 palabras', 'Ignacio Salgar'],
    ['persona de 4 palabras', 'Juan Pablo Ortega Zuleta'],
    ['empresa con palabra de la agencia', 'Colegio Los Arrayanes'],
    ['apellido común', 'Camila Nieto'],
    ['sustantivo de la agencia que no está en ninguna lista', 'combo playero'],
  ])('%s («nuevo %s»): pide el «sí» antes de crear y crea al recibirlo', async (_q, nombre) => {
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    await llega(nuevo(nombre), { enviado: 9 });
    colaModelo = [pedido()];
    await cron(60);
    expect(textos().at(-1)!.replace(/^Tanda de las \d\d:\d\d · /, '')).toBe(`¿Va como viaje nuevo de ${nombre}? No lo tengo en el directorio: lo creo como cliente nuevo, con cel. ${celEscrito(nombre)}.\nResponde sí, o el número del viaje si es uno que ya existe. No he creado ni cargado nada.`);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled(); // nada se leyó ni se cargó todavía
    nadaCreado(negocios);
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toMatchObject({
      espera: 'viaje', corta: `¿Va como viaje nuevo de ${nombre}? Sí, el nombre correcto, o el número o código del viaje`,
      // El intérprete la ve como su propia pregunta, con la lista de la entrega (cuarto control de Vera, CF7).
      nuevoPorConfirmar: nombre, entregaId: expect.any(String),
    });
    await llega('SÍ', { enviado: 100 });
    colaModelo = [pedido()];
    await cron(160);
    expect(t.contactos.map(c => [c.nombre, c.telefono])).toEqual([[nombre.toUpperCase(), celDe(nombre)]]);
    expect(negocioDe(nombre.toUpperCase())).toMatchObject({ nombre: expect.stringMatching(new RegExp(`^Viaje de ${nombre}$`, 'i')) });
    expect(datosDe(nombre.toUpperCase())).toMatchObject({ adultos: 2 });
  });

  it('sin el «sí» no hay cliente, negocio ni carga: un acuse no vale, un nombre reemplaza y vuelve a preguntar, el número del viaje cancela el nuevo', async () => {
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    await llega(nuevo('combo playero'), { enviado: 9 });
    await cron(60);
    // «ok» y «👍» no son el «sí»: se vuelve a preguntar.
    await llega('ok', { enviado: 70 });
    await cron(100);
    expect(textos().at(-1)).toContain('No entendí «ok».\n¿Va como viaje nuevo de combo playero?');
    nadaCreado(negocios);
    // El nombre correcto reemplaza al propuesto y se vuelve a preguntar.
    await llega('Ignacio Salgar', { enviado: 110 });
    await cron(160);
    expect(textos().at(-1)).toContain('¿Va como viaje nuevo de Ignacio Salgar?');
    nadaCreado(negocios);
    // El número del viaje cancela el nuevo: carga en ese viaje y no crea a nadie.
    const n = textos().find(x => x.includes('¿De qué viaje '))!.split('\n').find(l => l.includes('Pedro Prueba5'))!.charAt(0);
    await llega(n, { enviado: 170 });
    colaModelo = [pedido()];
    await cron(220);
    expect(t.contactos).toEqual([]);
    expect(t.negocios.length).toBe(negocios);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n-p' });
  });

  it('repetir el mismo nombre cuenta como «sí»; «el de …» señala un viaje y no es un nombre (cuarto control de Vera)', async () => {
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    await llega(nuevo('Ignacio Salgar'), { enviado: 9 });
    await cron(60);
    // «el de Pedro» no es el cliente «el de Pedro»: se vuelve a preguntar, sin cambiar el nombre propuesto.
    await llega('el de Pedro', { enviado: 70 });
    await cron(100);
    expect(textos().at(-1)).toContain('No entendí «el de Pedro».\n¿Va como viaje nuevo de Ignacio Salgar?');
    nadaCreado(negocios);
    // El mismo nombre que muestra la pregunta: crea, con ese nombre tal cual.
    await llega('Ignacio Salgar', { enviado: 110 });
    colaModelo = [pedido()];
    await cron(160);
    expect(t.contactos.map(c => c.nombre)).toEqual(['IGNACIO SALGAR']);
  });

  it('quinto control de Vera, con el interruptor apagado: un «sí» con reserva no crea; un número con artículo fuera de la lista vuelve a preguntar y dentro de ella elige el viaje; nunca es un nombre', async () => {
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    await llega(nuevo('Matilde Osorio'), { enviado: 9 });
    await cron(60);
    await llega('sí, aunque falta el segundo apellido', { enviado: 70 });
    await cron(100);
    expect(textos().at(-1)).toContain('No entendí «sí, aunque falta el segundo apellido».\n¿Va como viaje nuevo de Matilde Osorio?');
    nadaCreado(negocios);
    await llega('opción 9', { enviado: 110 });
    await cron(150);
    expect(textos().at(-1)).toContain('No entendí «opción 9».\n¿Va como viaje nuevo de Matilde Osorio?');
    expect(textos().some(x => x.includes('¿Va como viaje nuevo de opción 9?'))).toBe(false);
    nadaCreado(negocios);
    const n = textos().find(x => x.includes('¿De qué viaje '))!.split('\n').find(l => l.includes('Pedro Prueba5'))!.charAt(0);
    await llega(`la ${n}`, { enviado: 170 });
    colaModelo = [pedido()];
    await cron(220);
    expect(t.contactos).toEqual([]);
    expect(t.negocios.length).toBe(negocios);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n-p' });
  });

  it('«DESCARTAR» a la confirmación: descarta la tanda y no crea a nadie', async () => {
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    await llega('nueva brindoleta grupal', { enviado: 9 });
    await cron(60);
    await llega('DESCARTAR', { enviado: 100 });
    await cron(160);
    nadaCreado(negocios);
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toBeNull();
  });

  it('PI3: los dos nombres de pila de una clienta con viaje abierto (el atajo): la confirmación lo dice y su número carga en su viaje', async () => {
    t.negocios.push(negocioDePrueba('n-am', 'A 26 7', 'CANCÚN NOV', 'ANA MARÍA QUIÑONES'));
    t.negocio_bloques.push({ id: 'b-n-am', negocio_id: 'n-am', data: { destino: 'CANCÚN' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
    await preguntaDeViaje();
    const lista = textos().at(-1)!;
    const k = lista.split('\n').find(l => l.includes('Ana María Quiñones'))!.charAt(0);
    const negocios = t.negocios.length;
    await llega('nueva Ana María', { enviado: 9 });
    await cron(60);
    expect(textos().at(-1)).toContain(`¿Va como viaje nuevo de Ana María? No lo tengo en el directorio: después del sí te pido su celular o correo (sin uno de los dos no lo creo).\nYa hay un viaje de Ana María Quiñones (A 26 7): si es para ese, responde ${k}.`);
    expect(t.contactos).toEqual([]);
    await llega(k, { enviado: 100 });
    colaModelo = [pedido()];
    await cron(160);
    expect(t.contactos).toEqual([]);
    expect(t.negocios.length).toBe(negocios);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n-am' });
  });

  it('«nueva cotización con hotel 4 estrellas» (pasa el tope del nombre): no crea cliente, vuelve a preguntar con la lista y no es contenido (control de Vera, I3)', async () => {
    await preguntaDeViaje();
    const contactosAntes = t.contactos?.length ?? 0;
    const negociosAntes = t.negocios.length;
    // Con una caja abierta mientras tanto: la frase tampoco se vuelve contenido de esa caja.
    await llega('perdón, son 3 adultos', { enviado: 6, reenviado: true });
    await llega('nueva cotización con hotel 4 estrellas', { enviado: 9 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'nueva cotización con hotel 4 estrellas')).toMatchObject({ papel: 'respuesta_cliente' });
    colaModelo = [pedido()];
    await cron(60);
    expect(textos().at(-1)).toContain('No entendí «nueva cotización con hotel 4 estr');
    expect(textos().at(-1)).toContain('1. SAN ANDRÉS DIC · Pedro Prueba5 (P 26 2)');
    expect(negocioDe('COTIZACION CON HOTEL 4 ESTRELLAS')).toBeFalsy();
    expect(t.negocios.length).toBe(negociosAntes);
    expect(t.contactos?.length ?? 0).toBe(contactosAntes);
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toMatchObject({ espera: 'viaje' });
    // La re-pregunta se sigue contestando como siempre (y el «sí» crea).
    await llega(nuevo('Daniela Rojas'), { enviado: 100 });
    await cron(160);
    expect(textos().at(-1)).toContain('¿Va como viaje nuevo de Daniela Rojas?');
    await llega('sí', { enviado: 170 });
    colaModelo = [pedido()];
    await cron(220);
    expect(negocioDe('DANIELA ROJAS')).toBeTruthy();
  });

  it('«NUEVO» a secas: sigue el camino de siempre (el nombre sale de los mensajes y se muestra antes de crearlo)', async () => {
    await preguntaDeViaje();
    await llega('NUEVO', { enviado: 9 });
    colaModelo = [pedido()];
    await cron(60);
    expect(textos().at(-1)).toContain('¿Para qué cliente es? No veo su nombre en los mensajes');
    expect(t.contactos).toEqual([]);
  });

  it('«DESCARTAR»: descarta la tanda en el acto (regla 4, 2026-10-02)', async () => {
    await preguntaDeViaje();
    await llega('DESCARTAR', { enviado: 9 });
    expect(textos().at(-1)).toMatch(/^Descarté lo pendiente de la tanda de las \d\d:\d\d \(1 mensaje\)\. No creé ni cargué nada\.$/);
    await cron(60);
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toBeNull();
    expect(t.wa_bandeja_entendimientos).toEqual([]);
    expect(t.negocio_bloques.find(b => b.negocio_id === 'n-p')!.data).toEqual({ destino: 'SAN ANDRÉS' });
  });

  it('tras un «sí» que no entiende, la re-pregunta también se contesta con «nuevo X», y el recordatorio dice qué responder', async () => {
    await preguntaDeViaje();
    await llega('sí', { enviado: 9 });
    await cron(60);
    expect(textos().at(-1)).toContain('No entendí «sí».');
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toMatchObject({ espera: 'viaje', corta: '¿De qué viaje son?' });
    await llega(nuevo('Valeria Rojas'), { enviado: 100 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === nuevo('Valeria Rojas'))).toMatchObject({ papel: 'respuesta_negocio' });
    await cron(160);
    await llega('sí', { enviado: 170 });
    colaModelo = [pedido()];
    await cron(220);
    expect(negocioDe('VALERIA ROJAS')).toBeTruthy();
  });

  it('«NUEVO» solo y después el nombre sin NUEVO: lo muestra tal cual; sin llave no lo crea, con ella sí (2026-10-05)', async () => {
    await preguntaDeViaje();
    await llega('NUEVO', { enviado: 9 });
    colaModelo = [pedido()];
    await cron(60);
    expect(textos().at(-1)).toContain('¿Para qué cliente es? No veo su nombre en los mensajes');
    await llega('Valeria Prueba5', { enviado: 100 });
    expect(textos().some(x => x.startsWith('¿Cambias a'))).toBe(false);
    await cron(160);
    expect(textos().at(-1)).toContain('No tengo a Valeria Prueba5 en el directorio. ¿Me pasas su celular o su correo?');
    expect(t.contactos).toEqual([]);
    await llega('NUEVO', { enviado: 170 });
    await cron(220);
    expect(t.contactos).toEqual([]);
    await llega('valeria5@correo.co', { enviado: 230 });
    await cron(280);
    expect(negocioDe('VALERIA PRUEBA5')).toBeTruthy();
    expect(t.contactos.map(c => c.email)).toEqual(['valeria5@correo.co']);
  });
});

describe('v2 · N1: un «sí» o un «no» cortos con una pregunta pendiente nunca son contenido', () => {
  async function resumenDeLaura() {
    await llega(nuevo('Laura Prueba5'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 2 });
    await llega('listo', { enviado: 4 });
    expect(textos().at(-1)).toContain('Laura Prueba5 · ¿Lo cargo así?\nEntendí 1 viaje:');
  }

  it('«sí» seguido 3 s después por un encabezado ambiguo que se procesa antes: el «sí» va al resumen', async () => {
    t.negocios.push(negocioDePrueba('n-d', 'D 26 3', 'PUNTA CANA', 'DIEGO PRUEBA5'), negocioDePrueba('n-l', 'L 26 3', 'CARTAGENA DIC 12-16', 'LAURA PRUEBA5'));
    await resumenDeLaura();
    // Solo el apellido, con dos viajes: abre caja. Con el resumen abierto, la lista no se pregunta en el
    // acto (una pregunta a la vez): se decide en el resumen de esa tanda, y se recuerda la pendiente.
    await llega('Prueba5', { enviado: 23, llega: 24 });
    expect(textos().at(-1)).toMatch(/^«Prueba5» puede ser PUNTA CANA · Diego Prueba5 \(D 26 3\) o CARTAGENA DIC 12-16 · Laura Prueba5 \(L 26 3\): lo decides en el resumen de esta tanda\.\nPrimero: Laura Prueba5 · ¿Lo cargo así\?$/);
    await llega('sí', { enviado: 20, llega: 25 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'sí')).toMatchObject({ papel: 'respuesta_cliente' });
    expect(t.wa_bandeja_entregas.find(e => e.cliente_texto === 'sí')).toMatchObject({ estado: 'con_cliente' });
  });

  it('un «no» a «¿Es la misma persona?» va a esa pregunta aunque un encabezado haya abierto una caja', async () => {
    await resumenDeLaura();
    // Entre el resumen y el «sí», otra puerta guardó ese celular a nombre de otra persona: el guardián vuelve a
    // buscar la llave justo antes de crear y no crea con ella (diseño 2026-10-05, §3.2 paso 4).
    t.contactos.push({ id: 'c-otra', workspace_id: WS, nombre: 'MARÍA PRUEBA5', telefono: celDe('Laura Prueba5'), created_at: '2026-01-01T00:00:00Z' });
    await llega('sí', { enviado: 10 });
    colaModelo = [LAURA];
    await cron(60);
    expect(textos().at(-1)).toMatch(/Ese celular o correo ya lo tenemos a nombre de María Prueba5 \(cel\. …\d{4}\)\. ¿Es la misma persona\?$/);
    expect(t.contactos).toHaveLength(1);
    await llega(nuevo('Diego Prueba5'), { enviado: 100 }); // la pregunta es de contacto: el encabezado sí abre caja
    await llega('no', { enviado: 103 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'no')).toMatchObject({ papel: 'respuesta_contacto' });
  });
});

describe('v2 · N4: «cancelar» dentro de una caja abierta', () => {
  it('descarta la tanda y dice cuál y cuántos mensajes; lo siguiente no espera en cola', async () => {
    await llega(nuevo('Laura Prueba5'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 2 });
    await llega('salimos de Bogotá', { enviado: 4, reenviado: true });
    await llega('cancelar', { enviado: 6 });
    expect(textos().at(-1)).toBe('Descarté lo pendiente de Laura Prueba5 (2 mensajes). No creé ni cargué nada.');
    expect(t.wa_bandeja_entregas[0]).toMatchObject({ estado: 'esperando_cliente', pregunta_enviada_at: null });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'cancelar')).toMatchObject({ papel: 'cierre' });
    await llega(nuevo('Diego Prueba5'), { enviado: 20 });
    await llega('Quiero un viaje para puntacana y curasao', { enviado: 22 });
    await llega('listo', { enviado: 24 });
    expect(textos().at(-1)).toMatch(/^Diego Prueba5 · ¿Lo cargo así\?\nEntendí 1 viaje:/);
  });

  it('N11: «DESCARTAR» al resumen cuenta los mensajes del resumen, no el encabezado', async () => {
    await llega(nuevo('Laura Prueba5'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 2 });
    await llega('listo', { enviado: 4 });
    await llega('DESCARTAR', { enviado: 8 });
    expect(textos().at(-1)).toBe('Descarté lo pendiente de Laura Prueba5 (1 mensaje). No creé ni cargué nada.');
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'DESCARTAR')).toMatchObject({ papel: 'respuesta_cliente' });
    await cron(60);
    expect(t.negocios).toEqual([]);
  });

  it('sin nada pendiente, lo dice', async () => {
    await llega('cancelar', { enviado: 0 });
    expect(textos()).toEqual(['No tienes nada pendiente para descartar.']);
    expect(t.wa_bandeja_entregas).toEqual([]);
  });
});

describe('v2 · N3: «el 2 es de Mateo Prueba5» aunque haya un viaje de «Mateo Prueba2» a un error', () => {
  it('por nombre del cliente, por nombre del negocio y por código', async () => {
    t.negocios.push(negocioDePrueba('n-m2', 'M 26 1', 'BARILOCHE JUL', 'MATEO PRUEBA2'));
    await llega(nuevo('Andrea Prueba5'), { enviado: 0 });
    await llega('Queremos ir a Cancún del 10 al 15 de febrero, 2 adultos, salimos de Medellín', { enviado: 2 });
    await llega('El presupuesto es de unos 8 millones en total', { enviado: 4 });
    await llega(nuevo('Mateo Prueba5'), { enviado: 6 });
    await llega('Queremos conocer Bariloche del 3 al 10 de julio, somos 3 adultos', { enviado: 8 });
    await llega('listo', { enviado: 10 });
    await llega('el 2 es de Mateo Prueba5', { enviado: 15 });
    await cron(60);
    expect(textos().at(-1)).toContain('Corregido. Así queda:');
    expect(textos().at(-1)).toContain(`2) ${grupo('Mateo Prueba5')} — 2 mensajes`);
    await llega('el 1 es de BARILOCHE JUL', { enviado: 70 });
    await cron(120);
    expect(textos().at(-1)).toMatch(/BARILOCHE JUL · Mateo Prueba2 \(M 26 1\) — 1 mensaje/);
    await llega('el 2 es de M 26 1', { enviado: 130 });
    await cron(180);
    expect(textos().at(-1)).toMatch(/BARILOCHE JUL · Mateo Prueba2 \(M 26 1\) — 2 mensajes/);
  });
});

describe('v2 · S1: si falla el entendimiento, el bot avisa y se puede REINTENTAR', () => {
  it('un aviso al primer error y otro al agotar los intentos; REINTENTAR lo vuelve a correr', async () => {
    geminiCaido = true;
    await llega(nuevo('Laura Prueba4'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 2 });
    await llega('listo', { enviado: 4 });
    await llega('sí', { enviado: 8 });
    await cron(60);
    expect(textos().at(-1)).toBe('No pude procesar los mensajes de Laura Prueba4 por un problema técnico; los reintento solo.');
    const n = textos().length;
    await cron(120);
    expect(textos().length).toBe(n); // el segundo intento no repite el aviso
    await cron(180);
    expect(textos().at(-1)).toBe('No pude cargar Laura Prueba4. Los mensajes quedan guardados; cuando quieras, escribe «reintentar Laura Prueba4».');
    await cron(240);
    expect(textos().length).toBe(n + 1); // agotado: ni reintenta ni avisa más
    expect(t.wa_bandeja_entendimientos.find(e => e.segmento === 1)).toMatchObject({ estado: 'error', intentos: 3 });

    await llega('REINTENTAR Diego', { enviado: 300 });
    expect(textos().at(-1)).toBe('¿Cuál reintento? No sé cuál es «Diego».\nEscribe «reintentar» y una de estas:\n- Laura Prueba4');
    geminiCaido = false;
    await llega('reintentar laura prueba4', { enviado: 310 });
    expect(textos().at(-1)).toBe('Reintento Laura Prueba4. Te aviso cuando quede cargado.');
    expect(t.wa_bandeja_mensajes.some(m => /reintentar/i.test(String(m.cuerpo)))).toBe(false);
    colaModelo = [LAURA];
    await cron(360);
    expect(textos().at(-1)).toContain('CARTAGENA DIC 12-16 · Laura Prueba4 (L 26 1) — Mínimo');
  });
});

describe('v2 · S3: el nombre automático sigue al viaje', () => {
  it('cambia si cambian el destino o las fechas y recuerda el mes; editado a mano, no', async () => {
    await llega(nuevo('Pedro Prueba5'), { enviado: 0 });
    await llega('queremos ir a San Andrés en diciembre, somos 4', { enviado: 2 });
    await llega('listo', { enviado: 4 });
    await llega('sí', { enviado: 6 });
    colaModelo = [salidaModelo({ destino: { valor: 'San Andrés', frase: 'ir a San Andrés' } })];
    await cron(60);
    const pedro = negocioDe('PEDRO PRUEBA5')!;
    expect(pedro.nombre).toBe('SAN ANDRÉS DIC');
    // Un mensaje que no habla del mes no lo borra.
    const carga = async (texto: string, salida: unknown, seg: number) => {
      await llega('P 26 1', { enviado: seg });
      await llega(texto, { enviado: seg + 2 });
      await llega('listo', { enviado: seg + 4 });
      await llega('sí', { enviado: seg + 6 });
      colaModelo = [salida];
      await cron(seg + 60);
    };
    await carga('somos 4 adultos', salidaModelo({ adultos: { valor: '4', frase: 'somos 4 adultos' } }), 100);
    expect(pedro.nombre).toBe('SAN ANDRÉS DIC');
    // Cambian el destino y las fechas (N8): primero el aviso de otro destino; con «sí», carga y renombra.
    await carga('Mejor Santa Marta, del 8 al 12 de enero', salidaModelo({
      destino: { valor: 'Santa Marta', frase: 'Mejor Santa Marta' },
      fecha_salida: { valor: '2027-01-08', frase: 'del 8 al 12 de enero' }, fecha_regreso: { valor: '2027-01-12', frase: 'del 8 al 12 de enero' },
    }), 200);
    expect(textos().at(-1)).toContain('? Hablan de Santa Marta');
    await llega('sí', { enviado: 270 });
    await cron(320);
    expect(pedro.nombre).toBe('SANTA MARTA ENE 8-12');
    pedro.nombre = 'Pedro, el de la playa';
    await carga('Mejor del 9 al 13 de enero', salidaModelo({
      fecha_salida: { valor: '2027-01-09', frase: 'del 9 al 13 de enero' }, fecha_regreso: { valor: '2027-01-13', frase: 'del 9 al 13 de enero' },
    }), 400);
    expect(pedro.nombre).toBe('Pedro, el de la playa');
  });
});

describe('v2 · S3: el bot de siempre nombra los negocios «Nombre · Cliente (código)»', () => {
  const ctxDe = (intent: string, salida: string[], botones: Array<{ cuerpo: string; titulos: string[] }>) => ({
    user: USER, supabase: db, message: { phone: TEL, text: 'llamé al cliente' },
    parsed: { intent, confidence: 1, fields: { mensaje_original: 'llamé al cliente' } },
    session: { id: 's-bot', state: 'started', context: {} },
    sendMessage: async (x: string) => { salida.push(x); },
    sendButtons: async (cuerpo: string, b: Array<{ title: string }>) => { botones.push({ cuerpo, titulos: b.map(x => x.title) }); },
    updateSession: async () => {},
  });
  beforeEach(() => {
    t.bot_sessions.push({ id: 's-bot', user_phone: TEL, workspace_id: WS, state: 'started', context: {} });
    t.negocios.push({ ...negocioDePrueba('n-s', 'S 26 2', 'MEDELLÍN NOV 5-8', 'SOFIA PRUEBA5'), stage_actual: 'venta', precio_estimado: 0, precio_aprobado: null, updated_at: '2026-10-01T10:00:00Z' });
  });

  it('«bot cuántos viajes tengo»', async () => {
    const salida: string[] = [];
    const { handleConsulta } = await import('./handlers/consulta.ts');
    await handleConsulta(ctxDe('ESTADO_NEGOCIOS', salida, []) as never);
    expect(salida[0]).toContain('• MEDELLÍN NOV 5-8 · Sofia Prueba5 (S 26 2) — ');
  });

  it('«¿En cuál negocio registro esta actividad?»: la lista con el formato y los botones con el código', async () => {
    const botones: Array<{ cuerpo: string; titulos: string[] }> = [];
    const { handleActividad } = await import('./handlers/actividad.ts');
    await handleActividad(ctxDe('ACTIVIDAD', [], botones) as never);
    expect(botones[0].cuerpo).toContain('• MEDELLÍN NOV 5-8 · Sofia Prueba5 (S 26 2)');
    expect(botones[0].titulos).toEqual(['S 26 2']);
  });
});

// ── «ayuda»: la guía de la bandeja (2026-10-02, bandeja encendida en Trappvel) ──────────────────

describe('«ayuda» escrito contesta la guía de la bandeja y no toca nada más', () => {
  let GUIA: string;
  beforeEach(async () => { GUIA = (await import('./wa-bandeja-reglas.ts')).TEXTO_GUIA_BANDEJA; });

  it('sin tanda: «Ayuda!» contesta la guía; no abre tanda ni va al bot', async () => {
    await llega('Ayuda!', { enviado: 0 });
    expect(textos()).toEqual([GUIA]);
    expect(t.wa_bandeja_entregas).toEqual([]);
    expect(t.wa_bandeja_mensajes).toEqual([]);
    expect(alBot).toEqual([]);
  });

  it('con una tanda abierta: «¿cómo funciona?» no entra a la tanda; el «listo» la cierra con lo que tenía', async () => {
    await llega(nuevo('Laura Prueba2'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 3 });
    await llega('¿cómo funciona?', { enviado: 6 });
    expect(textos().at(-1)).toBe(GUIA);
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toHaveLength(1);
    expect(t.wa_bandeja_mensajes.some(m => m.cuerpo === '¿cómo funciona?')).toBe(false);
    await llega('listo', { enviado: 9 });
    expect(textos().at(-1)).toContain(`1) ${grupo('Laura Prueba2')} — 1 mensaje`);
  });

  it('con «¿A qué viaje van?» pendiente: «menú» no la consume y la respuesta siguiente la contesta', async () => {
    await preguntaDeViaje();
    const entregas = t.wa_bandeja_entregas.length;
    await llega('menú', { enviado: 6 });
    expect(textos().at(-1)).toBe(GUIA);
    expect(t.wa_bandeja_entregas).toHaveLength(entregas);
    expect(t.wa_bandeja_entregas[0]).toMatchObject({ estado: 'esperando_cliente' });
    expect(t.wa_bandeja_mensajes.some(m => m.cuerpo === 'menú')).toBe(false);
    await llega('1', { enviado: 9 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === '1')).toMatchObject({ papel: 'respuesta_cliente' });
    colaModelo = [pedido()];
    await cron(60);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n-p' });
  });

  it('con el resumen «¿Así? SÍ» pendiente: «ayuda» no lo contesta; el «sí» de después carga', async () => {
    await llega(nuevo('Laura Prueba2'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 3 });
    await llega('listo', { enviado: 5 });
    expect(textos().at(-1)).toContain('¿Lo cargo así?');
    await llega('AYUDA', { enviado: 10 });
    expect(textos().at(-1)).toBe(GUIA);
    expect(t.wa_bandeja_entregas[0]).toMatchObject({ estado: 'esperando_cliente' });
    await llega('sí', { enviado: 20 });
    colaModelo = [LAURA];
    await cron(30);
    expect(negocioDe('LAURA PRUEBA2')).toBeTruthy();
  });

  it('un gasto esperando su foto: «ayuda» contesta la guía y el gasto sigue esperando', async () => {
    const sesion = { id: 's-g', user_phone: TEL, workspace_id: WS, state: 'awaiting_image', expires_at: '2026-10-01T23:00:00Z' };
    t.bot_sessions.push(sesion);
    await llega('ayuda', { enviado: 0 });
    expect(textos()).toEqual([GUIA]);
    expect(sesion.state).toBe('awaiting_image');
    expect(alBot).toEqual([]);
  });

  it('un reenvío que dice «ayuda» es material de la solicitud; «necesito ayuda con el hotel» también', async () => {
    await llega('ayuda', { enviado: 0, reenviado: true });
    await llega('necesito ayuda con el hotel', { enviado: 3 });
    expect(textos()).not.toContain(GUIA);
    expect(t.wa_bandeja_mensajes.map(m => m.cuerpo)).toEqual(['ayuda', 'necesito ayuda con el hotel']);
  });

  it('«bot ayuda» y «bot ¿cómo funciona?» van al bot como «ayuda» (el atajo de AYUDA del parser)', async () => {
    const { fastPathParse } = await import('./wa-parse-reglas.ts');
    await llega('bot ayuda', { enviado: 0 });
    await llega('bot ¿cómo funciona?', { enviado: 3 });
    expect(alBot).toEqual(['ayuda', 'ayuda']);
    expect(fastPathParse('ayuda')?.intent).toBe('AYUDA');
    expect(textos()).toEqual([]);
  });

  it('bandeja apagada: «ayuda» va al bot como siempre', async () => {
    const apagado = { ...USER, modulos: { modules: {} } };
    const message = { phone: TEL, text: 'ayuda', type: 'text', reenviado: false, wa_message_id: 'wamid.apagada', timestamp: String(Math.floor(T0 / 1000)) };
    expect(await bandeja.rutaDelMensaje(db as never, apagado as never, message as never)).toEqual({ ruta: 'bot', config: null });
    expect(textos()).toEqual([]);
  });
});

describe('handleAyuda («bot ayuda»)', () => {
  const ctx = (user: unknown, salida: string[]) => ({
    user, supabase: db, message: { phone: TEL, text: 'ayuda' },
    parsed: { intent: 'AYUDA', confidence: 1, fields: {} },
    session: { id: 's-ayuda', state: 'started', context: {} },
    sendMessage: async (x: string) => { salida.push(x); },
  });
  beforeEach(() => { t.bot_sessions.push({ id: 's-ayuda', user_phone: TEL, workspace_id: WS, state: 'started', context: {} }); });

  it('con la bandeja encendida: la guía arriba y la ayuda de siempre abajo, con el prefijo que la lleva al bot', async () => {
    const { handleAyuda, textoAyudaBotConBandeja } = await import('./handlers/ayuda.ts');
    const { TEXTO_GUIA_BANDEJA, CONFIG_BANDEJA_POR_DEFECTO } = await import('./wa-bandeja-reglas.ts');
    const salida: string[] = [];
    await handleAyuda(ctx(USER, salida) as never);
    expect(salida).toEqual([`${TEXTO_GUIA_BANDEJA}\n\n${textoAyudaBotConBandeja(CONFIG_BANDEJA_POR_DEFECTO)}`]);
    expect(salida[0]).toContain('💰 *Gastos:* "gasto 180 mil en materiales para Pérez"');
    expect(salida[0]).toContain('📊 *Consulta:* "bot mis números"');
    expect(t.bot_sessions.find(s => s.id === 's-ayuda')!.state).toBe('completed');
  });

  it('el prefijo de consulta sale de la config del workspace', async () => {
    (t.workspaces[0].config_extra as Fila).bandeja_solicitudes = { modo_viajes: 'encabezado', prefijos_consulta: ['one'] };
    const { handleAyuda } = await import('./handlers/ayuda.ts');
    const salida: string[] = [];
    await handleAyuda(ctx(USER, salida) as never);
    expect(salida[0]).toContain('• Para preguntarme algo, empieza con `one`.');
    expect(salida[0]).toContain('"one mis números"');
  });

  it('con la bandeja apagada: la ayuda de siempre, idéntica', async () => {
    const { handleAyuda } = await import('./handlers/ayuda.ts');
    const salida: string[] = [];
    await handleAyuda(ctx({ ...USER, modulos: { modules: {} } }, salida) as never);
    expect(salida).toEqual([`👋 Soy tu asistente MéTRIK ONE. Escríbeme con naturalidad:

💰 *Gastos:* "Gasté 180 mil en materiales para Pérez" · "Pagué 50K en almuerzo"

📝 *Actividad:* "Llamé a Pérez" · "Reunión con Torres ayer" · "Nota: revisión pendiente"

👤 *Contactos:* "Nuevo contacto Juan Pérez 3001234567"

📊 *Consulta:* "Mis números" · "¿Quién me debe?" · "Qué negocios tengo"

Los cobros, cambios de etapa y horas se gestionan desde la app.`]);
  });
});

// ── Trappvel, 2026-10-02: la bandeja no pega mensajes al viaje de otro cliente ─────────────────────
// brief-max-2026-10-02-bandeja-no-confunde-clientes.md. La secuencia del comercial, mensaje por
// mensaje y con sus tiempos, con nombres SINTÉTICOS: «Daniel Pérez» (cliente nuevo) contra un viaje
// abierto de «Lina Pérez» (mismo apellido, otro nombre de pila).

describe('Trappvel 2026-10-02: «cliente nuevo Daniel Pérez» con un viaje abierto de Lina Pérez', () => {
  // 2026-10-05: «otro cliente» sin nombre pregunta para quién es el viaje nuevo.
  const PIDE_NOMBRE = 'Listo, un viaje nuevo. ¿Para qué cliente es?';
  const LINA = 'Ya hay un viaje de Lina Pérez (L1 26 1): si es para ese, escribe L1 26 1.';
  /** «cliente nuevo Daniel Pérez» sin celular: el bot no lo tiene y pide una llave (decisión 1 del 2026-10-05). */
  const PIDE_LLAVE_DANIEL = 'No tengo a Daniel Pérez en el directorio. ¿Me pasas su celular o su correo? Así reviso que no lo tengamos con otro nombre, y sin uno de los dos no lo creo.';
  const CHINA = salidaModelo({ destino: { valor: 'China', frase: 'una cotizacion a China' } });

  function viajeDeLina() {
    t.negocios.push(negocioDePrueba('n-lina', 'L1 26 1', 'L1 CTG ENE 27', 'LINA PÉREZ'));
    t.negocio_bloques.push({ id: 'b-lina', negocio_id: 'n-lina', data: { destino: 'CARTAGENA' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
  }

  /** Nada quedó trabado: ni tanda abierta, ni pregunta abierta o en cola, ni entendimiento esperando. */
  async function nadaTrabado() {
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toEqual([]);
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'esperando_cliente' && !e.pregunta_error)).toEqual([]);
    expect(t.wa_bandeja_entendimientos.filter(e => /^esperando_/.test(String(e.estado)))).toEqual([]);
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toBeNull();
  }

  it('la secuencia completa: termina en un viaje NUEVO «Daniel Pérez», nada en el de Lina, ninguna tanda trabada', async () => {
    viajeDeLina();
    // 9:00 · «cliente nuevo …» es un NUEVO (regla 2), no «¿Cambias a L1 26 1 · Lina Pérez?».
    await llega('cliente nuevo Daniel Pérez', { enviado: 0 });
    // Comparte el apellido con Lina: el acuse lo dice (2026-10-03), sin preguntar ni tocar su viaje; sin celular, lo pide.
    expect(textos()).toEqual([[PIDE_LLAVE_DANIEL, LINA].join('\n')]);
    // 9:01 · el «si» y el «no» no contestan nada (la caja espera la llave) y no van al resumen.
    await llega('si', { enviado: 42 });
    await llega('no', { enviado: 59 });
    // 9:02 · «otro cliente» sin nombre pide el nombre y no es contenido.
    await llega('otro cliente', { enviado: 74 });
    // 9:04 · «nuevo daniel perez»: el mismo cliente nuevo.
    await llega(nuevo('daniel perez'), { enviado: 225 });
    // El «si» suelto recuerda una vez lo que falta (la llave); el «no» de después ya no.
    expect(textos()).toEqual([[PIDE_LLAVE_DANIEL, LINA].join('\n'), PIDE_LLAVE_DANIEL, PIDE_NOMBRE, acuse('daniel perez', LINA)]);
    // 9:10 · la tanda cierra por inactividad: solo trajo encabezados y acuses. No se pregunta «¿Así?».
    await cronConCierre(545);
    expect(textos().at(-1)).toBe('Daniel Pérez · No me pasaste mensajes del cliente: no creé ni cargué nada.');
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toBeNull();

    // 9:28 · «2» suelto (no hay pregunta): abre una tanda. «descartar» la descarta enseguida (regla 4).
    await llega('2', { enviado: 1627 });
    await llega('descartar', { enviado: 1646 });
    expect(textos().at(-1)).toMatch(/^Descarté lo pendiente de la tanda de las \d\d:\d\d \(1 mensaje\)\. No creé ni cargué nada\.$/);
    // 9:28-9:31 · «nuevo daniel perez», «otro cliente» y «DESCARTAR»: la caja sin mensajes se descarta.
    await llega(nuevo('daniel perez'), { enviado: 1654 });
    await llega('otro cliente', { enviado: 1707 });
    await llega('DESCARTAR', { enviado: 1814 });
    expect(textos().slice(-3)).toEqual([acuse('daniel perez', LINA), PIDE_NOMBRE, 'Descarté lo pendiente de daniel perez (sin mensajes). No creé ni cargué nada.']);
    // 9:32 · lo único que es del cliente.
    await llega('El me esta pidiendo una cotizacion a China', { enviado: 1883 });
    await cronConCierre(2200);
    expect(textos().at(-1)).toMatch(/· ¿De qué viaje es el mensaje\?\n1\. L1 CTG ENE 27 · Lina Pérez \(L1 26 1\)\nResponde el número o el código\. Si es un viaje nuevo, escribe «nuevo» y el nombre del cliente; si no va, «descartar»\.$/);
    // La respuesta: el cliente nuevo, en cualquier forma.
    await llega(`cliente nuevo Daniel Pérez ${celEscrito('Daniel Pérez')}`, { enviado: 2260 });
    expect(t.wa_bandeja_mensajes.find(m => m.wa_message_id === `wamid.vivo.${n}`)).toMatchObject({ papel: 'respuesta_cliente' });
    await cron(2320);
    // La confirmación dice el viaje de Lina con su número; el «sí» es el viaje nuevo de Daniel Pérez, cliente nuevo.
    expect(textos().at(-1)).toContain(`¿Va como viaje nuevo de Daniel Pérez? No lo tengo en el directorio: lo creo como cliente nuevo, con cel. ${celEscrito('Daniel Pérez')}.\nYa hay un viaje de Lina Pérez (L1 26 1): si es para ese, responde 1.`);
    expect(negocioDe('DANIEL PÉREZ')).toBeFalsy();
    await llega('sí', { enviado: 2330 });
    colaModelo = [CHINA];
    await cron(2380);

    // Un viaje NUEVO de Daniel Pérez con lo de China; nada en el de Lina.
    const daniel = negocioDe('DANIEL PÉREZ');
    expect(daniel).toBeTruthy();
    expect(datosDe('DANIEL PÉREZ')).toMatchObject({ destino: 'CHINA' });
    expect(t.negocio_bloques.find(b => b.id === 'b-lina')!.data).toEqual({ destino: 'CARTAGENA' });
    expect(t.wa_bandeja_entendimientos.some(e => e.negocio_id === 'n-lina' || e.negocio_destino_id === 'n-lina')).toBe(false);
    expect(t.wa_bandeja_mensajes.some(m => JSON.stringify(m.asignacion ?? null).includes('n-lina'))).toBe(false);
    expect(textos().some(x => x.startsWith('¿Cambias a'))).toBe(false);
    expect(alBot).toEqual([]);
    await nadaTrabado();
  });

  it('«Daniel Pérez» sin «nuevo» no es candidato del viaje de Lina Pérez (otro nombre de pila): no pregunta ni la toca', async () => {
    viajeDeLina();
    await llega('Daniel Pérez', { enviado: 0 });
    await llega('quiere cotizar Cartagena para 2', { enviado: 3, reenviado: true });
    expect(textos()).toEqual([]);
    await llega('listo', { enviado: 6 });
    expect(textos().at(-1)).toMatch(/¿De qué viaje (?:es|son)/);
    expect(t.wa_bandeja_entregas[0].plan_viajes).toBeNull(); // sin encabezado: nada se asignó a Lina
  });

  it('solo el apellido con UN viaje: la lista numerada con NUEVO (nunca sí/no); «nuevo Daniel Pérez» abre su caja', async () => {
    viajeDeLina();
    await llega('Pérez', { enviado: 0 });
    expect(textos()).toEqual(['¿De qué viaje es «Pérez»? Hasta que me digas, no asigno lo que sigue.\n1. L1 CTG ENE 27 · Lina Pérez (L1 26 1)\nResponde el número; si es un viaje nuevo, «nuevo» y el nombre del cliente; o «descartar».']);
    await llega('si', { enviado: 3 }); // no elige
    await llega(nuevo('Daniel Pérez'), { enviado: 6 });
    await llega('quiere cotizar Cartagena para 2', { enviado: 9, reenviado: true });
    await llega('listo', { enviado: 12 });
    expect(textos().at(-1)).toContain(`1) ${grupo('Daniel Pérez')} — 1 mensaje`);
    // Nada va al viaje de Lina; el resumen solo avisa que se parece, y el «sí» es el cliente nuevo.
    expect(textos().at(-1)).not.toContain('L1 CTG ENE 27');
    expect(textos().at(-1)).toContain('⚠ 1) Ya hay un viaje de Lina Pérez (L1 26 1): si es para ese, escribe «el 1 es de L1 26 1»; si es un viaje nuevo, déjalo así.');
  });
});

describe('Trappvel 2026-10-02 · regla 4: «descartar» descarta TODO lo pendiente del remitente', () => {
  it('«descartar» en minúscula como primer mensaje, con preguntas pendientes en dos capas (el entendimiento y una entrega en cola): todo descartado', async () => {
    // Capa 1: el resumen de Laura, re-preguntado por el entendimiento (esperando_negocio).
    await llega(nuevo('Laura Prueba7'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 2, reenviado: true });
    await llega('listo', { enviado: 4 });
    await llega('el 5 es de Pedro', { enviado: 8 });
    await cron(60);
    expect(textos().at(-1)).toContain('No sé a qué viaje te refieres con «de Pedro».');
    expect(t.wa_bandeja_entendimientos).toMatchObject([{ estado: 'esperando_negocio' }]);
    // Capa 2: la tanda de Diego cerrada con la pregunta en cola (una pregunta a la vez).
    await llega(nuevo('Diego Prueba7'), { enviado: 100 });
    await llega('Quiero un viaje para puntacana y curasao', { enviado: 102, reenviado: true });
    await llega('listo', { enviado: 104 });
    expect(textos().at(-1)).toBe('Primero: Laura Prueba7 · ¿Lo cargo así?\nLo que acabas de mandar te lo pregunto después.');

    await llega('descartar', { enviado: 200 });
    expect(textos().at(-1)).toBe('Descarté lo pendiente de Laura Prueba7 y Diego Prueba7 (2 mensajes). No creé ni cargué nada.');
    expect(t.wa_bandeja_entendimientos).toMatchObject([{ estado: 'descartada' }]);
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'descartar')).toMatchObject({ papel: 'respuesta_negocio' });
    // Nada vuelve: ni el cron ni la cola preguntan o cargan algo de eso.
    const n0 = textos().length;
    colaModelo = [LAURA];
    await cron(260);
    expect(textos().length).toBe(n0);
    expect(t.negocios).toEqual([]);
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toBeNull();
    // Y lo siguiente se pregunta enseguida, no en cola.
    await llega(nuevo('Sofia Prueba7'), { enviado: 300 });
    await llega('Queremos ir a Medellín, somos 2 adultos', { enviado: 302, reenviado: true });
    await llega('listo', { enviado: 304 });
    expect(textos().at(-1)).toMatch(/^Sofia Prueba7 · ¿Lo cargo así\?\nEntendí 1 viaje:/);
  });

  it('con la tanda abierta y una respuesta que el cron todavía no tomó: «Descártalo» descarta las dos', async () => {
    await llega(nuevo('Laura Prueba7'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 2, reenviado: true });
    await llega('listo', { enviado: 4 });
    await llega('sí', { enviado: 8 }); // contestada, el cron aún no corre
    expect(t.wa_bandeja_entregas[0]).toMatchObject({ estado: 'con_cliente' });
    await llega(nuevo('Diego Prueba7'), { enviado: 10 });
    await llega('Quiero un viaje para puntacana y curasao', { enviado: 12, reenviado: true });
    await llega('Descártalo', { enviado: 14 });
    expect(textos().at(-1)).toBe('Descarté lo pendiente de Diego Prueba7 y Laura Prueba7 (2 mensajes). No creé ni cargué nada.');
    colaModelo = [LAURA];
    await cron(60);
    expect(t.negocios).toEqual([]);
    expect(t.wa_bandeja_entendimientos).toEqual([]);
  });

  it('«descartar el 1» sigue siendo una corrección del resumen, no un descarte total', async () => {
    await llega(nuevo('Laura Prueba7'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 2, reenviado: true });
    await llega('salimos de Bogotá', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 4 });
    await llega('descartar el 1', { enviado: 8 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'descartar el 1')).toMatchObject({ papel: 'respuesta_cliente' });
    await cron(60);
    expect(textos().at(-1)).toContain('Corregido. Así queda:');
    expect(textos().at(-1)).toContain('Descartados: 1');
  });
});

describe('Trappvel 2026-10-02 · regla 3: con una pregunta abierta, su respuesta la contesta aunque haya una caja abierta', () => {
  it('una corrección del resumen escrita con una caja abierta va al resumen, no a la caja', async () => {
    await llega(nuevo('Laura Prueba7'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 2, reenviado: true });
    await llega('salimos de Bogotá', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 4 });
    await llega(nuevo('Diego Prueba7'), { enviado: 10 });
    await llega('Quiero un viaje para puntacana y curasao', { enviado: 12, reenviado: true });
    await llega('el 2 es nuevo Pedro Prueba7', { enviado: 14 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'el 2 es nuevo Pedro Prueba7')).toMatchObject({ papel: 'respuesta_cliente' });
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toHaveLength(1); // la de Diego sigue abierta, sin ese mensaje
  });
});

describe('sexto control de Vera, con el interruptor apagado (la ruta de producción hoy)', () => {
  /** Nada creado ni cargado en los viajes de prueba. */
  function nadaCreado(negociosAntes: number) {
    expect(t.contactos).toEqual([]);
    expect(t.negocios.length).toBe(negociosAntes);
    expect(t.negocio_bloques.find(b => b.negocio_id === 'n-p')!.data).toEqual({ destino: 'SAN ANDRÉS' });
    expect(t.negocio_bloques.find(b => b.negocio_id === 'n-m')!.data).toEqual({ destino: 'BARILOCHE' });
  }
  /** La confirmación «¿Creo el cliente nuevo «Valentina Arce»?» pendiente, con una tanda abierta en la caja de Mateo Prueba5. */
  async function confirmacionConTandaAbierta() {
    await preguntaDeViaje();
    await llega(nuevo('Valentina Arce'), { enviado: 9 });
    // La tanda de otro cliente se abre antes de que el cron pregunte: su encabezado no contesta nada.
    await llega('Mateo Prueba5', { enviado: 20 });
    await llega('quieren salir el 3 de julio', { enviado: 22, reenviado: true });
    await cron(60);
    expect(textos().at(-1)).toContain('¿Va como viaje nuevo de Valentina Arce?');
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toHaveLength(1);
  }
  const papelDe = (cuerpo: string) => t.wa_bandeja_mensajes.find(m => m.cuerpo === cuerpo)?.papel;

  it('C: con una tanda abierta, la respuesta a la confirmación nunca entra a su caja, aunque sea larga; la cortesía con verbo de alta crea', async () => {
    await confirmacionConTandaAbierta();
    const negocios = t.negocios.length;
    // Una respuesta larga que no se entiende: es la respuesta (no contenido de la caja de Mateo) y se vuelve a preguntar.
    const larga = 'espéreme un ratico que le confirmo bien el apellido';
    await llega(larga, { enviado: 70 });
    expect(papelDe(larga)).toBe('respuesta_negocio');
    await cron(100);
    expect(textos().at(-1)).toContain(`No entendí «${larga.slice(0, 40)}».\n¿Va como viaje nuevo de Valentina Arce?`);
    expect(textos().some(x => x.includes(`¿Va como viaje nuevo de ${larga}`))).toBe(false); // B: no es un nombre
    nadaCreado(negocios);
    // La cortesía con el verbo de alta (más de tres palabras): también es la respuesta, y crea a Valentina Arce.
    const si = 'hágame el favor y la registra de una vez';
    await llega(si, { enviado: 110 });
    expect(papelDe(si)).toBe('respuesta_negocio');
    colaModelo = [pedido()];
    await cron(160);
    expect(t.contactos.map(c => c.nombre)).toEqual(['VALENTINA ARCE']);
    // La caja de Mateo sigue con lo suyo: ninguna de las dos respuestas quedó como su contenido.
    const tanda = t.wa_bandeja_entregas.find(e => e.estado === 'abierta')!;
    expect(t.wa_bandeja_mensajes.filter(m => m.entrega_id === tanda.id && m.papel === 'contenido').map(m => m.cuerpo)).toEqual(['Mateo Prueba5', 'quieren salir el 3 de julio']);
  });

  it('B: un acuse, «espéreme» o «es otra …» no se vuelven el nombre propuesto; «bótalo» descarta', async () => {
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    await llega(nuevo('Valentina Arce'), { enviado: 9 });
    await cron(60);
    for (const [k, r] of ['listo jefe, ya miro', 'déjeme y le confirmo', 'es otra Valentina Arce'].entries()) {
      await llega(r, { enviado: 70 + k * 30 });
      await cron(90 + k * 30);
      expect(textos().at(-1)).toContain(`No entendí «${r}».\n¿Va como viaje nuevo de Valentina Arce?`);
      expect(textos().some(x => x.includes(`¿Va como viaje nuevo de ${r}?`))).toBe(false);
    }
    nadaCreado(negocios);
    await llega('bótalo', { enviado: 200 });
    await cron(260);
    nadaCreado(negocios);
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toBeNull();
  });

  it('C: un mensaje que nombra a otro cliente con viaje abierto queda en la caja marcado, y el «sí» no lo carga sin decidir', async () => {
    viajesAbiertos();
    t.negocios.push(negocioDePrueba('n-r', 'R 26 4', 'LIMA OCT', 'RAQUEL ORTIZ'));
    t.negocio_bloques.push({ id: 'b-n-r', negocio_id: 'n-r', data: { destino: 'LIMA' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
    await llega('Pedro Prueba5', { enviado: 0 });
    await llega('somos 2 adultos', { enviado: 2, reenviado: true });
    await llega('Raquel Ortiz pregunta si el hotel tiene piscina', { enviado: 4 });
    await llega('listo', { enviado: 6 });
    expect(textos().at(-1)).toContain('⚠ Por decidir antes del sí: 1 mensaje\n   2 «Raquel Ortiz pregunta si el hotel tiene…» (nombra a Raquel Ortiz (R 26 4), que tiene un viaje abierto');
    await llega('sí', { enviado: 10 });
    await cron(60);
    expect(textos().at(-1)).toContain('Todavía no lo cargo. ¿Qué hago con el 2 (⚠)?');
    expect(t.negocio_bloques.find(b => b.negocio_id === 'n-p')!.data).toEqual({ destino: 'SAN ANDRÉS' });
    // Decidido: «el 2 es de Raquel Ortiz» lo mueve, y el «sí» carga cada uno en su viaje.
    await llega('el 2 es de Raquel Ortiz', { enviado: 70 });
    await cron(120);
    expect(textos().at(-1)).toContain('Corregido. Así queda:');
  });
});

// ── 2026-10-05: ¿quién es el cliente? (diseño de cliente y conversación, PR A) ─────────────────────────
// brief-max-2026-10-05-viaje-nuevo-cliente-existente.md. «Nuevo» es un VIAJE nuevo; el cliente lo resuelve el
// código contra TODO el directorio (llave con `buscar_contacto_duplicado`, nombre con `buscar_clientes_por_nombre`,
// que el doble emula). Nombres, celulares y correos INVENTADOS.

describe('2026-10-05 · la prueba de Mauricio, parafraseada: viaje nuevo de un cliente que ya existe', () => {
  /** Un cliente con 5 viajes abiertos (todos de la app) y su celular. */
  function clienteConCincoViajes() {
    t.contactos.push({ id: 'c-mr', workspace_id: WS, nombre: 'MARTÍN ROBLEDO', telefono: '3001239444', email: null, created_at: '2026-01-10T10:00:00Z' });
    const viajes: Array<[string, string, string]> = [['n-mr1', 'M1 26 1', 'MIAMI 7N'], ['n-mr2', 'M1 26 2', 'ARMENIA 2N'], ['n-mr3', 'M1 26 3', 'ARMENIA 2N'], ['n-mr4', 'M1 26 4', 'EUROPA 20D'], ['n-mr5', 'M1 26 5', 'EUROPA 2 DÍAS']];
    for (const [id, codigo, nombre] of viajes) {
      t.negocios.push({ ...negocioDePrueba(id, codigo, nombre, 'MARTÍN ROBLEDO'), contacto_id: 'c-mr' });
      t.negocio_bloques.push({ id: `b-${id}`, negocio_id: id, data: { destino: nombre.split(' ')[0] }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
    }
  }
  const YA_LO_TENEMOS = 'Va como viaje nuevo de Martín Robledo, el que ya tenemos (cel. …9444, 5 viajes abiertos).\nReenvíame lo que te pidió y al final te muestro el resumen.';

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`interruptor ${modo}: «nuevo viaje» → el cliente → el mismo viaje nuevo, sin listas ni «cliente nuevo»; el «sí» del resumen lo carga en su ficha`, async () => {
      clienteConCincoViajes();
      const llamadas = { n: 0 };
      const interprete = modo === 'prendido' ? { llamadas } : undefined;
      const bloquesAntes = JSON.stringify(t.negocio_bloques);
      // Turno 1: «nuevo viaje» es un VIAJE nuevo, y no se sabe de quién.
      await llega('Bueno, vamos a montar un viaje nuevo', { enviado: 0, interprete });
      expect(textos()).toEqual(['Listo, un viaje nuevo. ¿Para qué cliente es?']);
      // Turno 2: el cliente tiene 5 viajes abiertos; ya no sale la lista: es el cliente del viaje nuevo (decisión 2).
      await llega('El cliente es Martín Robledo', { enviado: 10, interprete });
      expect(textos().at(-1)).toBe(YA_LO_TENEMOS);
      // Turnos 3 a 5: las formas de insistir dicen lo mismo y no cambian nada.
      await llega('Nuevo Martín Robledo', { enviado: 20, interprete });
      expect(textos().at(-1)).toBe(YA_LO_TENEMOS);
      await llega('No. Es para uno nuevo', { enviado: 30, interprete });
      expect(textos().at(-1)).toBe(YA_LO_TENEMOS);
      await llega('No es un cliente nuevo, es una cotización nueva sobre un cliente antiguo', { enviado: 40, interprete });
      expect(textos().at(-1)).toBe(YA_LO_TENEMOS);
      expect(textos().some(x => /¿De qué viaje es|cliente nuevo\?|¿Cómo se llama/.test(x))).toBe(false);
      // Con el interruptor prendido, el código de hoy lee las cinco frases: el modelo no se llama.
      expect(llamadas.n).toBe(0);
      if (modo === 'prendido') {
        // Una forma que el código no lee: la entiende el modelo y el validador la resuelve con el cliente de la caja (V8v).
        await llega('ya es cliente, ábrele otra cotización por favor', {
          enviado: 45, interprete: { llamadas, modelo: { acciones: [{ accion: 'abrir_viaje', evidencia: 'ábrele otra cotización', nuevo_sin_nombre: true, cliente_existente: true }] } },
        });
        expect(llamadas.n).toBe(1);
        expect(textos().at(-1)).toBe(YA_LO_TENEMOS);
      }
      await llega('Hola, quiero ir a Cartagena del 12 al 16 de diciembre, somos 2 adultos, hotel 4 estrellas, salimos de Bogotá', { enviado: 50, reenviado: true });
      await llega('listo', { enviado: 60 });
      const resumen = textos().at(-1)!;
      expect(resumen).toMatch(/^Martín Robledo · ¿Lo cargo así\?\nEntendí 1 viaje:\n1\) Viaje nuevo de Martín Robledo \(ya es cliente: cel\. …9444, 5 viajes abiertos\) — 1 mensaje\n   1 «Hola, quiero ir a Cartagena/);
      expect(resumen).not.toContain('Ya hay un viaje');
      await llega('dale', { enviado: 70 });
      colaModelo = [LAURA];
      await cron(120);
      // Un viaje NUEVO en la ficha que ya existía: ningún contacto nuevo, y la empresa espejo como la crea la app.
      expect(t.contactos).toHaveLength(1);
      const nuevoViaje = t.negocios.filter(x => x.contacto_id === 'c-mr' && !String(x.id).startsWith('n-mr'));
      expect(nuevoViaje).toHaveLength(1);
      expect(nuevoViaje[0]).toMatchObject({ empresa_id: t.empresas[0].id });
      expect(t.empresas).toEqual([expect.objectContaining({ nombre: 'MARTÍN ROBLEDO', tipo_persona: 'natural', contacto_id: 'c-mr' })]);
      expect(t.negocio_bloques.filter(b => String(b.negocio_id).startsWith('n-mr'))).toEqual(JSON.parse(bloquesAntes).filter((b: Fila) => String(b.negocio_id).startsWith('n-mr')));
      expect(textos().at(-1)).toMatch(/^Entendí: Cartagena/);
    });
  }

  it('sin decir «nuevo» («Martín Robledo» a secas): «¿Va en uno de esos o es un viaje nuevo?»; «uno nuevo» es su viaje nuevo, «el de Miami» es ese', async () => {
    clienteConCincoViajes();
    await llega('Martín Robledo', { enviado: 0 });
    expect(textos().at(-1)).toBe(['Martín Robledo tiene 5 viajes abiertos. ¿Va en uno de esos o es un viaje nuevo?',
      '1. MIAMI 7N (M1 26 1)', '2. ARMENIA 2N (M1 26 2)', '3. ARMENIA 2N (M1 26 3)', '4. EUROPA 20D (M1 26 4)', '5. EUROPA 2 DÍAS (M1 26 5)'].join('\n'));
    await llega('uno nuevo', { enviado: 5 });
    expect(textos().at(-1)).toBe(YA_LO_TENEMOS);
    await llega('Martín Robledo', { enviado: 10 });
    await llega('el de Miami', { enviado: 15 });
    expect(textos().at(-1)).toBe('📌 MIAMI 7N · Martín Robledo (M1 26 1)');
  });

  it('un cliente con TODOS sus viajes cerrados también se encuentra (R3)', async () => {
    t.contactos.push({ id: 'c-rm', workspace_id: WS, nombre: 'ROSA MEJÍA', telefono: null, email: 'rosa@correo.co', created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba('n-rm', 'R 26 1', 'CARTAGENA MAR', 'ROSA MEJÍA'), contacto_id: 'c-rm', estado: 'completado' });
    await llega('nuevo Rosa Mejía', { enviado: 0 });
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Rosa Mejía, el que ya tenemos (con correo, último viaje: CARTAGENA MAR).\nReenvíame lo que te pidió y al final te muestro el resumen.');
  });
});

describe('2026-10-05 · el cliente nuevo: una llave, nunca la de otro, nunca sin buscar', () => {
  function paola() {
    t.contactos.push({ id: 'c-par', workspace_id: WS, nombre: 'PAOLA ANDREA RINCÓN DÍAZ', telefono: '3005551234', email: null, created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba('n-par', 'P 26 9', 'CARTAGENA MAR', 'PAOLA ANDREA RINCÓN DÍAZ'), contacto_id: 'c-par', estado: 'completado' });
  }

  it('P1: sin celular ni correo no se crea; el «sí» espera la llave; con ella, se crea con esa llave', async () => {
    await llega('nuevo Simón Arango', { enviado: 0 });
    expect(textos().at(-1)).toBe('No tengo a Simón Arango en el directorio. ¿Me pasas su celular o su correo? Así reviso que no lo tengamos con otro nombre, y sin uno de los dos no lo creo.');
    await llega('quiere ir a Santa Marta en enero, somos 3', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 6 });
    expect(textos().at(-1)).toContain('1) Viaje nuevo de Simón Arango (no lo tengo en el directorio: falta su celular o correo) — 1 mensaje');
    await llega('sí', { enviado: 10 });
    await cron(60);
    expect(textos().at(-1)).toContain('Todavía no lo cargo. ¿Me pasas el celular o el correo de Simón Arango?');
    expect(t.contactos).toEqual([]);
    await llega('su correo es simon.arango@correo.co', { enviado: 70 });
    await cron(120);
    expect(textos().at(-1)).toContain('1) Viaje nuevo de Simón Arango (cliente nuevo, correo simon.arango@correo.co) — 1 mensaje');
    await llega('sí', { enviado: 130 });
    colaModelo = [salidaModelo({ destino: { valor: 'Santa Marta', frase: 'ir a Santa Marta' } })];
    await cron(180);
    expect(t.contactos.map(c => [c.nombre, c.email, c.telefono])).toEqual([['SIMÓN ARANGO', 'simon.arango@correo.co', null]]);
  });

  it('la llave que espera el resumen lo contesta aunque haya otra caja abierta: nunca se vuelve la llave del otro cliente', async () => {
    await llega('nuevo Simón Arango', { enviado: 0 });
    await llega('quiere ir a Santa Marta', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 6 });
    await llega(nuevo('Diego Prueba7'), { enviado: 10 });
    await llega('300 246 8100', { enviado: 13 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === '300 246 8100')).toMatchObject({ papel: 'respuesta_cliente' });
    await cron(60);
    expect(textos().some(x => x.includes('1) Viaje nuevo de Simón Arango (cliente nuevo, cel. 300 246 8100) — 1 mensaje'))).toBe(true);
  });

  it('D2: «cliente nueva» que se parece a una ficha; su celular es de esa ficha → «¿Es la misma persona?»; «sí, es ella» la usa', async () => {
    paola();
    await llega('nueva clienta Paola Rincón', { enviado: 0 });
    expect(textos().at(-1)).toBe('No tengo a Paola Rincón tal cual. ¿Es Paola Andrea Rincón Díaz (cel. …1234, último viaje: CARTAGENA MAR), o es otra persona?');
    await llega('300 555 1234', { enviado: 3 });
    expect(textos().at(-1)).toBe('Ese celular ya lo tenemos a nombre de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR). ¿Es la misma persona?');
    await llega('sí, es ella, se registró con el nombre completo', { enviado: 6 });
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Paola Andrea Rincón Díaz, el que ya tenemos (cel. …1234, último viaje: CARTAGENA MAR).\nReenvíame lo que te pidió y al final te muestro el resumen.');
    await llega('quiere San Andrés en enero', { enviado: 9, reenviado: true });
    await llega('listo', { enviado: 12 });
    expect(textos().at(-1)).toContain('1) Viaje nuevo de Paola Andrea Rincón Díaz (ya es cliente: cel. …1234, último viaje: CARTAGENA MAR) — 1 mensaje');
    await llega('sí', { enviado: 15 });
    colaModelo = [salidaModelo({ destino: { valor: 'San Andrés', frase: 'San Andrés' } })];
    await cron(60);
    expect(t.contactos).toHaveLength(1);
    expect(t.negocios.filter(x => x.contacto_id === 'c-par' && x.estado === 'abierto')).toHaveLength(1);
  });

  it('D2 con «no, es la mamá»: nunca se crea con ese celular; se pide otra llave y el «sí» espera', async () => {
    paola();
    await llega(`nueva clienta Paola Rincón 300 555 1234`, { enviado: 0 });
    expect(textos().at(-1)).toBe('Ese celular ya lo tenemos a nombre de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR). ¿Es la misma persona?');
    await llega('no, es la mamá, comparten celular', { enviado: 3 });
    expect(textos().at(-1)).toBe('Entonces a Paola Rincón la creas desde la app, para no mezclarla con Paola Andrea Rincón Díaz; o pásame otro celular o correo. Lo de este viaje queda esperando.');
    await llega('quiere San Andrés en enero', { enviado: 6, reenviado: true });
    await llega('listo', { enviado: 9 });
    expect(textos().at(-1)).toContain('1) Viaje nuevo de Paola Rincón (no lo tengo en el directorio: falta su celular o correo) — 1 mensaje');
    await llega('sí', { enviado: 12 });
    await cron(60);
    expect(t.contactos).toHaveLength(1); // solo la ficha que ya existía
    expect(t.negocios.filter(x => x.estado === 'abierto')).toEqual([]);
  });

  it('D3: dos homónimos: se pregunta cuál con lo que los distingue; «el de Miami» elige; «ninguno, es otro» pide la llave', async () => {
    t.contactos.push(
      { id: 'c-ag1', workspace_id: WS, nombre: 'ANDRÉS GÓMEZ', telefono: '3014454410', email: null, created_at: '2026-01-10T10:00:00Z' },
      { id: 'c-ag2', workspace_id: WS, nombre: 'ANDRES GOMEZ', telefono: null, email: 'agomez@correo.co', created_at: '2026-02-10T10:00:00Z' },
    );
    t.negocios.push({ ...negocioDePrueba('n-ag1', 'A 26 1', 'MIAMI MAY', 'ANDRÉS GÓMEZ'), contacto_id: 'c-ag1' });
    await llega('nueva cotización para Andrés Gómez', { enviado: 0 });
    expect(textos().at(-1)).toBe('Tengo dos Andrés Gómez: el primero, cel. …4410 (un viaje abierto: MIAMI MAY); el segundo, con correo (sin viajes). ¿Cuál es, o es otra persona?');
    await llega('el de Miami', { enviado: 3 });
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Andrés Gómez, el que ya tenemos (cel. …4410, un viaje abierto: MIAMI MAY).\nReenvíame lo que te pidió y al final te muestro el resumen.');
    await llega('nueva cotización para Andrés Gómez', { enviado: 10 });
    await llega('ninguno, es otro', { enviado: 13 });
    expect(textos().at(-1)).toBe('No tengo a Andrés Gómez en el directorio. ¿Me pasas su celular o su correo? Así reviso que no lo tengamos con otro nombre, y sin uno de los dos no lo creo.');
  });

  it('D4: «nuevo viaje» y solo el usuario de Instagram: no lo tengo, ¿cómo se llama?; con el nombre, cliente nuevo con esa llave', async () => {
    await llega('nuevo viaje', { enviado: 0 });
    await llega('@laurapc', { enviado: 3 });
    expect(textos().at(-1)).toBe('No tengo a nadie con usuario @laurapc. ¿Cómo se llama? Mientras tanto guardo lo que me mandes.');
    await llega('Laura', { enviado: 6 });
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Laura, cliente nuevo (usuario @laurapc). Lo creo cuando me digas que sí en el resumen.\nReenvíame lo que te pidió y al final te muestro el resumen.');
    await llega('Hola, quiero cotizar Punta Cana para 4 en semana santa', { enviado: 9, reenviado: true });
    await llega('listo', { enviado: 12 });
    expect(textos().at(-1)).toContain('1) Viaje nuevo de Laura (cliente nuevo, usuario @laurapc) — 1 mensaje');
    await llega('sí', { enviado: 15 });
    colaModelo = [salidaModelo({ destino: { valor: 'Punta Cana', frase: 'Punta Cana' } })];
    await cron(60);
    expect(t.contactos.map(c => [c.nombre, c.usuario_whatsapp])).toEqual([['LAURA', 'laurapc']]);
  });

  it('completar sin pisar: el contacto que ya existe recibe el celular que le faltaba; uno que ya tenía no se toca', async () => {
    t.contactos.push(
      { id: 'c-rm', workspace_id: WS, nombre: 'ROSA MEJÍA', telefono: null, email: null, created_at: '2026-01-10T10:00:00Z' },
      { id: 'c-tg', workspace_id: WS, nombre: 'TOMÁS GIL', telefono: '3010000001', email: null, created_at: '2026-01-10T10:00:00Z' },
    );
    await llega('nuevo Rosa Mejía 300 777 8899', { enviado: 0 });
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Rosa Mejía, el que ya tenemos (sin celular ni correo, sin viajes).\nReenvíame lo que te pidió y al final te muestro el resumen.');
    await llega('quiere Cartagena en marzo', { enviado: 3, reenviado: true });
    await llega('nuevo Tomás Gil tomas@correo.co', { enviado: 6 });
    await llega('quiere Bogotá en abril', { enviado: 9, reenviado: true });
    await llega('listo', { enviado: 12 });
    await llega('sí', { enviado: 15 });
    colaModelo = [salidaModelo({ destino: { valor: 'Cartagena', frase: 'Cartagena' } }), salidaModelo({ destino: { valor: 'Bogotá', frase: 'Bogotá' } })];
    await cron(60);
    await cron(120);
    expect(t.contactos.map(c => [c.nombre, c.telefono, c.email])).toEqual([['ROSA MEJÍA', '3007778899', null], ['TOMÁS GIL', '3010000001', 'tomas@correo.co']]);
  });

  it('«error al comprobar ≠ permiso para crear»: con el directorio caído no se crea nadie; cuando vuelve, sí', async () => {
    directorioCaido.valor = true;
    try {
      await llega(nuevo('Hugo Prieto'), { enviado: 0 });
      expect(textos().at(-1)).toBe('No pude revisar el directorio de clientes. No creo a nadie sin revisarlo: vuelve a escribirme el nombre en un momento.');
      await llega('quiere ir a Leticia', { enviado: 3, reenviado: true });
      await llega('listo', { enviado: 6 });
      expect(textos().at(-1)).toContain('1) Viaje nuevo de Hugo Prieto (no pude revisar el directorio) — 1 mensaje');
      await llega('sí', { enviado: 9 });
      await cron(60);
      expect(t.contactos).toEqual([]);
    } finally {
      directorioCaido.valor = false;
    }
    await llega('sí', { enviado: 70 });
    colaModelo = [salidaModelo({ destino: { valor: 'Leticia', frase: 'Leticia' } })];
    await cron(120);
    expect(t.contactos.map(c => [c.nombre, c.telefono])).toEqual([['HUGO PRIETO', celDe('Hugo Prieto')]]);
  });
});
