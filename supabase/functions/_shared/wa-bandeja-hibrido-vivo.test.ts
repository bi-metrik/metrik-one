// ============================================================
// El bot híbrido de la bandeja (2026-10-06), de punta a punta, con `bot_conversacional.hibrido = true`
// ============================================================
//
// Es `wa-bandeja-vivo.test.ts` con el interruptor del workspace PRENDIDO: las mismas secuencias, ahora con los puntos de
// decisión (botones y listas, lo exacto sin el modelo, lo demás con el modelo falso), más las pruebas propias del bot
// híbrido. `wa-bandeja-vivo.test.ts` queda tal cual está en `main` y corre con el interruptor APAGADO: es la prueba de
// que, apagado, el bot se porta exactamente como antes.
// ============================================================

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directorioCaido, rpcDelDirectorio } from './__fixtures__/directorio-doble.ts';
import type { PuntoDecision } from './wa-decision-reglas.ts';
import type { PlanViajes } from './wa-viajes-reglas.ts';

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

const enviados: Array<{ phone: string; texto: string; botones?: Array<{ id: string; title: string }>; lista?: boolean }> = [];
vi.mock('./wa-respond.ts', () => ({
  sendTextMessage: vi.fn(async (phone: string, texto: string) => { enviados.push({ phone, texto }); }),
  // Los botones de respuesta (2026-10-05): el cuerpo cuenta como lo que se le dijo; los botones quedan aparte.
  sendButtons: vi.fn(async (phone: string, texto: string, botones: Array<{ id: string; title: string }>) => { enviados.push({ phone, texto, botones }); return 'wamid.botones'; }),
  // Las listas del bot híbrido (2026-10-06): las filas cuentan como botones que se tocan (`boton(título)`).
  sendList: vi.fn(async (phone: string, texto: string, _b: string, filas: Array<{ id: string; title: string }>) => { enviados.push({ phone, texto, botones: filas.map(f => ({ id: f.id, title: f.title })), lista: true }); return 'wamid.lista'; }),
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
        const ya = t[tabla].find(x => cols.every(c => (x[c] ?? 0) === (f[c] ?? 0)));
        // Como la base: con `ignoreDuplicates` no toca la fila que ya está; sin él, la actualiza con lo dado.
        if (ya && upsertOpts.ignoreDuplicates) return { data: [], error: null };
        if (ya) {
          Object.assign(ya, payload as Fila);
          return { data: [proyectar(ya)], error: null };
        }
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
    workspaces: [{ id: WS, slug: 'agencia', linea_activa_id: LINEA, modules: { bandeja_solicitudes_wa: true }, config_extra: { bandeja_solicitudes: { linea_id: LINEA, modo_viajes: 'encabezado', confirmar: 'siempre' }, bot_conversacional: { hibrido: true } } }],
    staff: [{ id: 'st-1', workspace_id: WS, full_name: 'TATIANA PRUEBA' }],
    wa_collaborators: [{ id: 'col-1', workspace_id: WS, name: 'COMERCIAL PRUEBA' }],
    negocios: [],
    negocio_responsables: [],
    negocio_bloques: [],
    activity_log: [],
    wa_bandeja_entregas: [],
    wa_bandeja_mensajes: [],
    wa_bandeja_entendimientos: [],
    wa_bandeja_conversacion: [],
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
let decision: typeof import('./wa-decision.ts');
/**
 * El modelo falso del punto de decisión (bot híbrido, 2026-10-06): lo que «devuelve» para cada escrito, por su texto
 * exacto. Lo que no está aquí es «contenido». `null` en un texto: el modelo no responde (timeout).
 */
let decisiones: Map<string, unknown> = new Map();
/** Los escritos que llegaron al modelo del punto de decisión, en orden. */
let alModeloDeDecision: string[] = [];
const decide = (texto: string, json: unknown) => { decisiones.set(texto, json); };
/**
 * Lo que el modelo falso contesta a lo que la prueba no declara, como lo haría un lector sensato: una corrección del
 * resumen con su número es «corrección»; un acuse o un «sí»/«no» sueltos (que no son exactos para esa pregunta) son
 * «no sé»; lo demás (un encabezado, un dato del cliente) es «contenido». Una respuesta que el modelo tiene que elegir
 * (el nombre de un viaje, «nuevo Ana Ruiz», «el de Miami») se declara con `elige`/`decide`.
 */
function porDefecto(texto: string, usuario = ''): unknown {
  const t = texto.trim().toLowerCase();
  const correccion = correccionFalsa(t, usuario);
  if (correccion) return correccion;
  if (/^(?:s[ií]+|no|ok|okey|listo ya|dale|👍)$/.test(t)) return { tipo: 'no_se' };
  return { tipo: 'contenido' };
}
/**
 * Una corrección del resumen, armada como la arma el modelo (los números y el destino de cada cambio). El destino es el
 * id de la opción cuya línea en el contexto nombra lo que el texto dice (el cliente, el nombre o el código del viaje).
 */
function correccionFalsa(t: string, usuario: string): unknown {
  const sinT = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const opciones = [...usuario.matchAll(/^- (\w+): (.*)$/gm)].map(m => ({ clave: m[1], linea: sinT(m[2]) }));
  const numeros = (/Mensajes del resumen: ([\d, ]+)\./.exec(usuario)?.[1] ?? '').split(',').map(x => Number(x.trim())).filter(Boolean);
  const cambios: Array<Record<string, unknown>> = [];
  if (/^dejar (?:todos|todo)$/.test(t)) return { tipo: 'correccion', cambios: [{ mensajes: numeros, destino: 'dejar' }] };
  for (const parte of t.replace(/^corregir\s*:?\s*/, '').split(/\s*;\s*/)) {
    const quita = /^(?:quita|quitar|saca|sacar|descarta|descartar)\s+(?:el|la|los|las)?\s*([\d\s,y]+)$/.exec(parte);
    const deja = /^(?:deja|dejar)\s+(?:el|la|los|las)?\s*([\d\s,y]+)$/.exec(parte);
    const mueve = /^(?:el|la|los|las)?\s*([\d\s,y]+?)\s+(?:es|son|va|van)\s+(?:(?:de|del|para)\s+)?(.+)$/.exec(parte);
    const ns = (s: string) => s.split(/[\s,y]+/).map(Number).filter(Boolean);
    if (quita) { cambios.push({ mensajes: ns(quita[1]), destino: 'descartar' }); continue; }
    if (deja) { cambios.push({ mensajes: ns(deja[1]), destino: 'dejar' }); continue; }
    if (!mueve) return null;
    const nuevo = /^nuevo (.+)$/.exec(mueve[2]);
    if (nuevo) { cambios.push({ mensajes: ns(mueve[1]), destino: 'nuevo', nombre: nuevo[1] }); continue; }
    const quien = sinT(mueve[2]);
    const o = opciones.find(x => x.clave.startsWith('g') && x.linea.includes(quien)) ?? opciones.find(x => x.clave.startsWith('x') && x.linea.includes(quien));
    if (!o) return null;
    cambios.push({ mensajes: ns(mueve[1]), destino: o.clave });
  }
  return cambios.length ? { tipo: 'correccion', cambios } : null;
}
const elige = (texto: string, opcion: string, nombre?: string) => decide(texto, { tipo: 'opcion', opcion, ...(nombre ? { nombre } : {}) });
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
    /** Un toque en un botón de respuesta (2026-10-05): llega como Meta lo manda, con el título como texto y el id aparte. */
    boton?: { id: string; title: string };
  } = { enviado: 0 },
) {
  vi.setSystemTime(new Date(T0 + (p.llega ?? p.enviado + 2) * 1000));
  const base = { phone: TEL, text: texto, wa_message_id: `wamid.vivo.${++n}`, timestamp: String(Math.floor((T0 + p.enviado * 1000) / 1000)) };
  const message = p.boton ? { ...base, type: 'interactive', interactive_reply: p.boton.id } : { ...base, type: 'text', reenviado: p.reenviado === true };
  if (p.interprete) {
    // El banco con Gemini real elige el modelo de la decisión como lo haría el workspace (`modelo_decision`).
    const banco = process.env.BANCO_DECISION_MODELO ? { modelo_decision: process.env.BANCO_DECISION_MODELO } : {};
    const user = { ...USER, modulos: { ...USER.modulos, bot_conversacional: { activo: true, modelo: 'gemini-3.8-flash', ...banco } } };
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
/** Toca un botón de los que mandó el bot. */
const toca = (boton: { id: string; title: string }, p: { enviado: number; interprete?: { modelo?: unknown; llamadas?: { n: number } } }) =>
  llega(boton.title, { ...p, boton });
/** Los botones del último mensaje que los llevaba, y el que tiene ese título. */
const ultimosBotones = () => enviados.filter(e => e.botones?.length).at(-1)?.botones ?? [];
const boton = (titulo: string) => {
  const b = ultimosBotones().find(x => x.title === titulo);
  if (!b) throw new Error(`no hay botón «${titulo}» en ${JSON.stringify(ultimosBotones())}`);
  return b;
};
/** Un botón de cualquier mensaje enviado (el más reciente con ese título): «Sí, ese» va en su propio mensaje, antes de la lista. */
const botonEnviado = (titulo: string) => {
  for (const e of [...enviados].reverse()) {
    const b = e.botones?.find(x => x.title === titulo);
    if (b) return b;
  }
  throw new Error(`no se envió ningún botón «${titulo}»`);
};
/** La propuesta de un viaje (2026-10-06): «¿Van en «X»?» con [Sí, ese] y, aparte, la lista para elegir otro. */
const PROPUESTA = /^¿Van en «.+»\? Toca «Sí, ese» o responde «sí»\. No he cargado nada\.$/;
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
/** Nunca silencio (2026-10-05): lo que dice un escrito que abre una tanda sin cliente. */
const TANDA_SIN_CLIENTE = 'Lo guardo en una tanda nueva. Escríbeme de qué cliente o viaje es (el código sirve), o «nuevo» y el nombre del cliente. Cuando termines, «listo».';
/** Cómo el resumen nombra el viaje nuevo de ese cliente. */
/** El bloque del viaje nuevo de ese cliente en el resumen (2026-10-05): el viaje en negrita y su cliente debajo. */
const grupo = (nombre: string) => `Viaje nuevo · ${nombre}*\nCliente nuevo · cel. ${celEscrito(nombre)}`;
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
  decision = await import('./wa-decision.ts');
  decisiones = new Map();
  alModeloDeDecision = [];
  decision.modeloDeDecision.llamar = async (p) => {
    const texto = /Mensaje del comercial: ([\s\S]*)$/.exec(p.usuario)?.[1] ?? '';
    alModeloDeDecision.push(texto);
    const r = decisiones.has(texto) ? decisiones.get(texto) : porDefecto(texto, p.usuario);
    if (r === null) return { ok: false as const, motivo: 'timeout' as const, ms: 4000 };
    return { ok: true as const, json: r, ms: 1 };
  };
  // Estas pruebas miden el cron de cada minuto; las de la conversación con memoria lo prenden.
  bandeja.procesarEnElActo.activo = false;
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
    // El escrito abrió la tanda sin cliente (su encabezado venía en camino): el bot lo dice, nunca calla (2026-10-05).
    expect(textos()).toEqual([TANDA_SIN_CLIENTE, acuse('Laura Prueba2')]);
    await llega('listo', { enviado: 5, llega: 7 });
    expect(alBot).toEqual([]); // nada al bot de actividades
    expect(textos().at(-1)).toBe([
      '¿Cargo este viaje?',
      '',
      `*${grupo('Laura Prueba2')}`,
      '',
      '1. «Hola, queremos ir a Cartagena del 12 al…»',
      '',
      'Para mover o quitar uno, escríbeme: «el 1 es de Luisa» o «quita el 1».',
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
    expect(textos().at(-1)!.startsWith(`¿Cargo este viaje?\n\n*${grupo('Diego Prueba2')}\n\n1. «Quiero un viaje para puntacana y curasao»`)).toBe(true);
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
    expect(textos().at(-1)).toContain(`${grupo('Laura Prueba2')}\n\n1. «Hola, queremos ir a Cartagena`);
  });

  it('con el resumen de Laura sin contestar, el escrito de Diego que llega antes que su encabezado NO se toma como la respuesta', async () => {
    await llega(nuevo('Laura Prueba2'), { enviado: 0 });
    await llega(CARTAGENA, { enviado: 3 });
    await llega('listo', { enviado: 5 });
    expect(textos().at(-1)).toContain('¿Cargo este viaje?\n\n*Viaje nuevo · Laura Prueba2*');
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
    expect(textos().at(-1)!.startsWith(`¿Cargo este viaje?\n\n*${grupo('Diego Prueba2')}\n\n1. «Quiero un viaje para puntacana y curasao»`)).toBe(true);
  });

  it('un «listo» que se procesa antes que el último mensaje espera a que entre: el mensaje no queda fuera ni como respuesta', async () => {
    await llega(nuevo('Laura Prueba2'), { enviado: 0 });
    mientras.push(() => llega(CARTAGENA, { enviado: 3, llega: 8 }));
    await llega('listo', { enviado: 5, llega: 6 });
    expect(textos().at(-1)).toContain(`${grupo('Laura Prueba2')}\n\n1. «Hola, queremos ir a Cartagena`);
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
    expect(textos().at(-1)).toContain('¿Cargo este viaje?\n\n*Viaje nuevo · Laura Prueba2*');
  });

  it('escenario 6: las risas no salen numeradas en el resumen', async () => {
    await llega(nuevo('Sofia Prueba2'), { enviado: 0 });
    await llega('Queremos ir a Medellín, somos 2 adultos, salimos de Cali', { enviado: 3 });
    await llega('jajaja', { enviado: 6 });
    await llega('😂😂', { enviado: 8 });
    await llega('Del 5 al 8 de noviembre, hotel 3 estrellas', { enviado: 10 });
    await llega('listo', { enviado: 12 });
    expect(textos().at(-1)).toContain(`${grupo('Sofia Prueba2')}\n\n1. «Queremos ir a Medellín, somos 2 adultos…»\n2. «Del 5 al 8 de noviembre, hotel 3 estrel…»`);
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
    const pie = (ej: string) => `Dime cuál (por ejemplo «el de ${ej}»). Si es un viaje nuevo, «nuevo» y el nombre del cliente; o «descartar».`;
    expect(textos()).toEqual([
      '📌 Europa 2 días · Carolina Ruiz (M1 26 5)',
      '📌 ARMENIA 2N · Juan Prueba (M1 26 4)',
      `¿De qué viaje es «Europa 2 dia»? Hasta que me digas, no asigno lo que sigue.\n1. Europa 2 días · Carolina Ruiz (M1 26 5)\n${pie('Carolina')}`,
      // Bot híbrido: el «sí» a la lista no elige nada; el modelo no sabe y se vuelve a preguntar, en corto, con la lista.
      'No me quedó claro. ¿De qué viaje es «Europa 2 dia»?',
      '📌 Europa 2 días · Carolina Ruiz (M1 26 5)',
      `¿De qué viaje es «Armenia 2N»? Hasta que me digas, no asigno lo que sigue.\n1. ARMENIA 2N · Juan Prueba (M1 26 4)\n2. ARMENIA 2N · Pedro Prueba (M1 26 3)\n${pie('Juan')}`,
      '📌 ARMENIA 2N · Pedro Prueba (M1 26 3)',
    ]);
  });

  it('el resumen y la carga en un viaje existente lo nombran igual', async () => {
    t.negocios.push(negocio('n5', 'M1 26 5', 'Europa 2 días', 'CAROLINA RUIZ'));
    t.negocio_bloques.push({ id: 'b5', negocio_id: 'n5', data: { destino: 'EUROPA' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
    await llega('Europa 2 días', { enviado: 0 });
    await llega('somos 2 adultos, salimos de Medellín', { enviado: 3 });
    await llega('listo', { enviado: 5 });
    expect(textos().at(-1)).toMatch(/^¿Cargo este viaje\?\n\n\*Europa 2 días · Carolina Ruiz \(M1 26 5\)\*\n\n1\. «/);
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

// ── Elegir viaje con palabras (2026-10-06, Mauricio): los números escritos y la propuesta [Sí, ese] ──────────────
// El código lee los números escritos con su artículo como el número de la lista («la dos», «el segundo», «la 2», «el
// último» si la lista lo deja claro). Cuando el modelo reconoce un viaje por su nombre o por un dato, el bot no carga:
// lo propone con un solo botón [Sí, ese] y la lista para elegir otro. Solo el toque o el «sí» escrito solo cargan.
// ── El interruptor (`config_extra.bot_conversacional.hibrido`), de punta a punta ─────────────────────────────
// Apagado, la bandeja se porta como antes (todo `wa-bandeja-vivo.test.ts`, tal cual está en `main`, corre así). Aquí la
// misma secuencia con la llave apagada y prendida, en el mismo workspace de prueba.
describe('el modelo del llamado de decisión: gemini-3.5-flash-lite por defecto; el intérprete sigue con el suyo', () => {
  beforeEach(() => { bandeja.procesarEnElActo.activo = true; });
  it.each([
    [{ hibrido: true }, 'gemini-3.5-flash-lite'],
    [{ hibrido: true, activo: true, modelo: 'gemini-3.8-flash', timeout_ms: 4000 }, 'gemini-3.5-flash-lite'],
    [{ hibrido: true, modelo_decision: 'gemini-3.8-flash' }, 'gemini-3.8-flash'],
  ])('bot_conversacional %j → la decisión pide %s, con el tiempo máximo del workspace', async (bot, esperado) => {
    (t.workspaces[0].config_extra as Fila).bot_conversacional = bot;
    await preguntaDeViaje();
    const pedidos: Array<{ modelo: string; timeoutMs: number }> = [];
    decision.modeloDeDecision.llamar = async (p) => { pedidos.push({ modelo: p.modelo, timeoutMs: p.timeoutMs }); return { ok: true as const, json: { tipo: 'no_se' }, ms: 1 }; };
    const user = { ...USER, modulos: { ...USER.modulos, bot_conversacional: bot } };
    await bandeja.atenderEnBandeja(db as never, user as never, { phone: TEL, type: 'text', text: 'esto con palabras', timestamp: String(Math.floor(Date.now() / 1000)), wa_message_id: 'w-modelo' } as never, await (async () => (await import('./wa-bandeja-reglas.ts')).leerConfigBandeja(t.workspaces[0].config_extra))());
    expect(pedidos).toEqual([{ modelo: esperado, timeoutMs: 4000 }]);
  });
});

describe('el interruptor bot_conversacional.hibrido: la misma secuencia apagado y prendido', () => {
  beforeEach(() => { bandeja.procesarEnElActo.activo = true; });
  const interruptor = (hibrido: boolean) => {
    const ce = t.workspaces[0].config_extra as Fila;
    ce.bot_conversacional = hibrido ? { hibrido: true } : {};
  };

  it('apagado: «¿A qué viaje van?» sale como texto, «el de san andrés» lo lee el lector de siempre y carga, sin el modelo de decisión', async () => {
    interruptor(false);
    await preguntaDeViaje();
    expect(enviados.at(-1)!.lista).toBeFalsy();
    expect(textos().at(-1)).toContain('Dime cuál (por ejemplo «el de San Andrés»)');
    await llega('el de san andrés', { enviado: 9 });
    expect(alModeloDeDecision).toEqual([]);
    colaModelo = [pedido()];
    await cron(60);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n-p' });
    expect(enviados.some(e => e.lista)).toBe(false);
  });

  it('prendido: la misma pregunta sale como lista; «el de san andrés» lo lee el modelo y el bot propone el viaje, sin cargar', async () => {
    interruptor(true);
    await preguntaDeViaje();
    expect(enviados.at(-1)!.lista).toBe(true);
    expect(textos().at(-1)).toContain('Tócalo en la lista o escribe su número.');
    elige('el de san andrés', 'v1');
    await llega('el de san andrés', { enviado: 9 });
    expect(alModeloDeDecision).toEqual(['el de san andrés']);
    expect(textos().at(-2)).toMatch(PROPUESTA);
    expect(t.wa_bandeja_entendimientos).toEqual([]);
    await llega('sí', { enviado: 12 });
    colaModelo = [pedido()];
    await cron(60);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n-p' });
  });

  it('apagado: «👌» al resumen no pasa por el modelo de decisión (lo lee el código de siempre)', async () => {
    interruptor(false);
    await llega(nuevo('Octavio Prueba8'), { enviado: 0 });
    await llega('queremos ir a Capurganá en febrero, somos 4 adultos', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 6 });
    await llega('👌', { enviado: 10 });
    expect(alModeloDeDecision).toEqual([]);
    expect(enviados.some(e => e.lista)).toBe(false);
  });
});

describe('bot híbrido: elegir viaje con palabras, los números escritos y la propuesta [Sí, ese]', () => {
  beforeEach(() => { bandeja.procesarEnElActo.activo = true; });
  const cargadoEn = async (id: string) => {
    colaModelo = [pedido()];
    await cron(60);
    return t.wa_bandeja_entendimientos.some(e => e.estado === 'negocio_actualizado' && e.negocio_id === id);
  };

  it.each(['la dos', 'el segundo', 'la 2', 'La segunda.', 'el último'])('«%s» lo lee el código, sin el modelo, y carga en el viaje 2', async (texto) => {
    await preguntaDeViaje();
    expect(textos().at(-1)).toContain('2. BARILOCHE JUL 3-10 · Mateo Prueba5 (M 26 2)');
    await llega(texto, { enviado: 9 });
    expect(alModeloDeDecision).toEqual([]);
    expect(await cargadoEn('n-m')).toBe(true);
  });

  it.each(['la quinta', 'el 9', 'la opción 7'])('«%s», fuera de la lista: «Ese número no está en la lista», sin el modelo y sin cargar', async (texto) => {
    await preguntaDeViaje();
    await llega(texto, { enviado: 9 });
    expect(alModeloDeDecision).toEqual([]);
    expect(textos().at(-1)).toMatch(/^Ese número no está en la lista\. .*¿De qué viaje son\?$/);
    expect(enviados.at(-1)!.lista).toBe(true);
    expect(await cargadoEn('n-m')).toBe(false);
    expect(t.wa_bandeja_entendimientos).toEqual([]);
  });

  it('«van en el de Mateo»: el bot propone el viaje con [Sí, ese] y la lista; no carga. El toque de «Sí, ese» carga', async () => {
    await preguntaDeViaje();
    elige('van en el de Mateo', 'v2');
    await llega('van en el de Mateo', { enviado: 9 });
    expect(textos().slice(-2)).toEqual(['¿Van en «BARILOCHE JUL 3-10 · Mateo Prueba5 · M 26 2»? Toca «Sí, ese» o responde «sí». No he cargado nada.', 'Si no es ese, elige en la lista.']);
    expect(enviados.at(-2)!.botones!.map(b => b.title)).toEqual(['Sí, ese']);
    expect(enviados.at(-1)!.lista).toBe(true);
    expect(t.wa_bandeja_entendimientos).toEqual([]);
    expect(t.wa_bandeja_entregas.every(e => e.estado !== 'con_cliente')).toBe(true);
    await toca(botonEnviado('Sí, ese'), { enviado: 12 });
    expect(await cargadoEn('n-m')).toBe(true);
  });

  it('«van en el de Mateo» y después «sí» escrito solo: carga en el viaje propuesto, sin volver al modelo', async () => {
    await preguntaDeViaje();
    elige('van en el de Mateo', 'v2');
    await llega('van en el de Mateo', { enviado: 9 });
    const m = alModeloDeDecision.length;
    await llega('sí', { enviado: 12 });
    expect(alModeloDeDecision.length).toBe(m);
    expect(await cargadoEn('n-m')).toBe(true);
  });

  it('un «sí» con más palabras no es el «sí» a la propuesta: lo lee el modelo y no carga', async () => {
    await preguntaDeViaje();
    elige('van en el de Mateo', 'v2');
    await llega('van en el de Mateo', { enviado: 9 });
    decide('sí, pero espérame', { tipo: 'no_se' });
    await llega('sí, pero espérame', { enviado: 12 });
    expect(textos().at(-1)).toMatch(/^No me quedó claro\. /);
    // Y después de otra decisión, la propuesta ya no vale: el «sí» solo no carga.
    await llega('sí', { enviado: 15 });
    expect(await cargadoEn('n-m')).toBe(false);
    expect(t.wa_bandeja_entendimientos).toEqual([]);
  });

  it('el toque viejo de «Sí, ese» (de una pregunta que ya cambió) no carga: lo dice y vuelve a mostrar la pregunta vigente', async () => {
    await preguntaDeViaje();
    elige('van en el de Mateo', 'v2');
    await llega('van en el de Mateo', { enviado: 9 });
    const b = botonEnviado('Sí, ese');
    const partes = b.id.split('|');
    partes[4] = `${partes[4]}-vieja`;
    await toca({ id: partes.join('|'), title: b.title }, { enviado: 12 });
    expect(textos().at(-1)).toMatch(/^Ese botón es de/);
    expect(await cargadoEn('n-m')).toBe(false);
    expect(t.wa_bandeja_entendimientos).toEqual([]);
  });

  it('en «¿Creo el cliente nuevo …?», el «sí» después de proponer un viaje es el «sí» a ese viaje: no crea a nadie', async () => {
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    elige(nuevo('Mateo Prueba'), 'nuevo', 'Mateo Prueba');
    await llega(nuevo('Mateo Prueba'), { enviado: 9 });
    colaModelo = [pedido()];
    await cron(60);
    expect(textos().at(-1)).toMatch(/¿Creo el cliente nuevo «Mateo Prueba»\?|¿Va como viaje nuevo de Mateo Prueba\?/);
    elige('no, es el de Bariloche', 'p2');
    await llega('no, es el de Bariloche', { enviado: 70 });
    expect(textos().at(-2)).toMatch(PROPUESTA);
    await llega('sí', { enviado: 75 });
    colaModelo = [pedido()];
    await cron(120);
    expect(t.contactos.filter(c => /MATEO PRUEBA$/.test(String(c.nombre)))).toEqual([]);
    expect(t.negocios.length).toBe(negocios);
    expect(t.wa_bandeja_entendimientos[0]).toMatchObject({ estado: 'negocio_actualizado', negocio_id: 'n-m' });
  });
});

describe('v2 · N2: «¿A qué viaje van?» se contesta con cada forma que el bot ofrece', () => {
  it.each([
    ['el número de la lista (con el formato «Nombre · Cliente (código)»)', '1'],
    ['el código', 'P 26 2'],
    ['el nombre del negocio', 'San Andrés dic'],
    ['el nombre del cliente', 'Pedro Prueba5'],
  ])('%s («%s»): carga en el viaje, sin abrir una caja nueva aunque haya una abierta (con palabras, tras el toque)', async (_n, respuesta) => {
    await preguntaDeViaje();
    expect(textos().at(-1)).toContain('1. SAN ANDRÉS DIC · Pedro Prueba5 (P 26 2)');
    const antes = textos().length;
    // Un reenvío del cliente abre una caja mientras tanto: la respuesta igual va a la pregunta.
    await llega('perdón, son 3 adultos', { enviado: 6, reenviado: true });
    // Regla 3 (2026-10-02): el contenido que abre una tanda con la pregunta abierta la vuelve a mostrar, corta.
    expect(textos().slice(antes)).toEqual([expect.stringMatching(/^Primero: Tanda de las \d\d:\d\d · ¿De qué viaje son\?$/)]);
    // Bot híbrido (2026-10-06): el número y el código los lee el código; el nombre del viaje o del cliente, el modelo
    // (con la fila del viaje como opción). Elegir el viaje carga en él: el bot lo propone con [Sí, ese] y el «sí» carga.
    const exacto = /^(?:\d+|P 26 2)$/.test(respuesta);
    if (!exacto) {
      elige(respuesta, 'v1');
      await llega(respuesta, { enviado: 9 });
      expect(textos().slice(antes + 1)).toEqual(['¿Van en «SAN ANDRÉS DIC · Pedro Prueba5 · P 26 2»? Toca «Sí, ese» o responde «sí». No he cargado nada.', 'Si no es ese, elige en la lista.']);
      expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === respuesta)).toBeUndefined();
      expect(t.wa_bandeja_entendimientos).toEqual([]);
      await llega('sí', { enviado: 10 });
    } else {
      await llega(respuesta, { enviado: 9 });
      expect(textos().slice(antes + 1)).toEqual([]); // ni 📌, ni la lista del encabezado, ni «Primero: …»
      expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === respuesta)).toMatchObject({ papel: 'respuesta_cliente' });
    }
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
    // Fuera de la lista: el modelo lo ve como opción oculta (con su código), y el código la valida. Cargar ahí no sale
    // de lo leído: el bot lo propone con [Sí, ese] (que se puede tocar aunque no esté en la lista) y el toque lo carga.
    elige('Europa 2 días', 'xc261');
    await llega('Europa 2 días', { enviado: 9 });
    expect(textos().slice(-2)).toEqual(['¿Van en «EUROPA 2 DÍAS · Carolina Ruiz · C 26 1»? Toca «Sí, ese» o responde «sí». No he cargado nada.', 'Si no es ese, elige en la lista.\nSi no está, escríbeme el código o el nombre.']);
    expect(t.wa_bandeja_entendimientos).toEqual([]);
    await toca(botonEnviado('Sí, ese'), { enviado: 10 });
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
    elige(nuevo('Valeria Prueba5'), 'nuevo', 'Valeria Prueba5');
    await llega(nuevo('Valeria Prueba5'), { enviado: 9 });
    expect(textos().some(x => x.startsWith('📌'))).toBe(false);
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toEqual([]);
    colaModelo = [pedido()];
    await cron(60);
    // 2026-10-05: la pregunta es por el VIAJE nuevo y dice lo que sabe el directorio. Comparte el apellido con los dos
    // viajes de la lista: la confirmación lo dice, con su número.
    const conf = textos().at(-1)!;
    expect(conf.startsWith(`Tanda de las ${conf.slice(13, 18)} · ¿Va como viaje nuevo de Valeria Prueba5? No lo tengo en el directorio: lo creo como cliente nuevo, con cel. ${celEscrito('Valeria Prueba5')}.\n`)).toBe(true);
    expect(conf).toMatch(/\nYa hay viajes de (Pedro|Mateo) Prueba5 \([PM] 26 2\) y (Pedro|Mateo) Prueba5 \([PM] 26 2\): si es para uno de esos, tócalo o responde 1 o 2\.\nToca «Crear» o responde sí; si es un viaje que ya existe, toca «No es nuevo»\. No he creado ni cargado nada\.$/);
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
    elige(nuevo(nombre), 'nuevo', nombre);
    await llega(nuevo(nombre), { enviado: 9 });
    colaModelo = [pedido()];
    await cron(60);
    expect(textos().at(-1)!.replace(/^Tanda de las \d\d:\d\d · /, '')).toBe(`¿Va como viaje nuevo de ${nombre}? No lo tengo en el directorio: lo creo como cliente nuevo, con cel. ${celEscrito(nombre)}.\nToca «Crear» o responde sí; si es un viaje que ya existe, toca «No es nuevo». No he creado ni cargado nada.`);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled(); // nada se leyó ni se cargó todavía
    nadaCreado(negocios);
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toMatchObject({
      espera: 'viaje', corta: `¿Va como viaje nuevo de ${nombre}? Sí, el nombre correcto, o dime el viaje si ya existe`,
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
    elige(nuevo('combo playero'), 'nuevo', 'combo playero');
    await llega(nuevo('combo playero'), { enviado: 9 });
    await cron(60);
    // «ok» no es el «sí» (no es exacto, y el modelo no sabe): se vuelve a preguntar, en el acto, con los botones.
    decide('ok', { tipo: 'no_se' });
    await llega('ok', { enviado: 70 });
    expect(textos().at(-1)).toMatch(/^No me quedó claro\. .*¿Creo el cliente nuevo «combo playero»\?$/);
    expect(ultimosBotones().map(b => b.title)).toEqual(['Crear', 'No es nuevo', '🗑 Descartar']);
    nadaCreado(negocios);
    // El nombre correcto (lo copia el modelo tal cual) reemplaza al propuesto y se vuelve a preguntar.
    decide('Ignacio Salgar', { tipo: 'nombre', nombre: 'Ignacio Salgar' });
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

  it('repetir el mismo nombre ya no crea (pide el toque); «el de …» que el modelo no sabe vuelve a preguntar (cuarto control de Vera)', async () => {
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    elige(nuevo('Ignacio Salgar'), 'nuevo', 'Ignacio Salgar');
    await llega(nuevo('Ignacio Salgar'), { enviado: 9 });
    await cron(60);
    // «el de Pedro» no es el cliente «el de Pedro»: se vuelve a preguntar, sin cambiar el nombre propuesto.
    decide('el de Pedro', { tipo: 'no_se' });
    await llega('el de Pedro', { enviado: 70 });
    expect(textos().at(-1)).toMatch(/^No me quedó claro\. .*¿Creo el cliente nuevo «Ignacio Salgar»\?$/);
    nadaCreado(negocios);
    // Bot híbrido, punto 5: el mismo nombre que muestra la pregunta es el «sí» a crear, y crear pasa por el botón.
    decide('Ignacio Salgar', { tipo: 'nombre', nombre: 'Ignacio Salgar' });
    await llega('Ignacio Salgar', { enviado: 110 });
    expect(textos().at(-1)).toMatch(/^Para crear el cliente, toca «Crear»\. No he creado nada\.\n/);
    await cron(140);
    nadaCreado(negocios);
    await toca(boton('Crear'), { enviado: 150 });
    colaModelo = [pedido()];
    await cron(160);
    expect(t.contactos.map(c => c.nombre)).toEqual(['IGNACIO SALGAR']);
  });

  it('quinto control de Vera, con el interruptor apagado: un «sí» con reserva no crea; un número con artículo fuera de la lista vuelve a preguntar y dentro de ella elige el viaje; nunca es un nombre', async () => {
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    elige(nuevo('Matilde Osorio'), 'nuevo', 'Matilde Osorio');
    await llega(nuevo('Matilde Osorio'), { enviado: 9 });
    await cron(60);
    // El «sí» con reserva no es exacto: el modelo (falso) no sabe, y se vuelve a preguntar en el acto. «opción 9» es un
    // número escrito (2026-10-06) fuera de la lista: lo lee el código, sin el modelo, y vuelve a preguntar.
    decide('sí, aunque falta el segundo apellido', { tipo: 'no_se' });
    await llega('sí, aunque falta el segundo apellido', { enviado: 70 });
    expect(textos().at(-1)).toMatch(/^No me quedó claro\. .*¿Creo el cliente nuevo «Matilde Osorio»\?$/);
    nadaCreado(negocios);
    const m9 = alModeloDeDecision.length;
    await llega('opción 9', { enviado: 110 });
    expect(alModeloDeDecision.length).toBe(m9);
    expect(textos().at(-1)).toMatch(/^Ese número no está en la lista\. .*¿Creo el cliente nuevo «Matilde Osorio»\?$/);
    expect(textos().some(x => x.includes('¿Va como viaje nuevo de opción 9?'))).toBe(false);
    nadaCreado(negocios);
    const n = textos().find(x => x.includes('¿De qué viaje '))!.split('\n').find(l => l.includes('Pedro Prueba5'))!.charAt(0);
    // «la 2» es el número de la lista escrito con su artículo (2026-10-06): lo lee el código, sin el modelo, y elige esa
    // fila (oculta en la confirmación, con su número).
    const m0 = alModeloDeDecision.length;
    await llega(`la ${n}`, { enviado: 170 });
    expect(alModeloDeDecision.length).toBe(m0);
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

  it('PI3: los dos nombres de pila de una clienta con viaje abierto (el atajo): la confirmación lo dice; «el de Cancún» propone su viaje y el toque lo carga', async () => {
    t.negocios.push(negocioDePrueba('n-am', 'A 26 7', 'CANCÚN NOV', 'ANA MARÍA QUIÑONES'));
    t.negocio_bloques.push({ id: 'b-n-am', negocio_id: 'n-am', data: { destino: 'CANCÚN' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
    await preguntaDeViaje();
    const negocios = t.negocios.length;
    elige('nueva Ana María', 'nuevo', 'Ana María');
    await llega('nueva Ana María', { enviado: 9 });
    await cron(60);
    expect(textos().at(-1)).toContain(`¿Va como viaje nuevo de Ana María? No lo tengo en el directorio: después del sí te pido su celular o correo (sin uno de los dos no lo creo).\nYa hay un viaje de Ana María Quiñones (A 26 7): si es para ese, tócalo o responde 1.`);
    expect(t.contactos).toEqual([]);
    // Lo que la confirmación ofrece: el viaje parecido es una fila de la lista. Escrito, el modelo la elige, pero cargar
    // en un viaje sale solo de lo exacto: pide el toque, y el toque carga.
    expect(ultimosBotones().map(b => b.title)).toEqual(['Crear', 'Es Ana María Quiñones', 'No es nuevo', '🗑 Descartar']);
    elige('el de Cancún', 'p1');
    await llega('el de Cancún', { enviado: 100 });
    expect(textos().slice(-2)).toEqual([expect.stringMatching(/^¿Van en «Ana María Quiñones · .*A 26 7»\? Toca «Sí, ese» o responde «sí»\. No he cargado nada\.$/), 'Si no es ese, elige en la lista.']);
    expect(t.wa_bandeja_entendimientos[0]).not.toMatchObject({ negocio_id: 'n-am' });
    await toca(boton('Es Ana María Quiñones'), { enviado: 110 });
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
    // El modelo no sabe de quién es («nueva cotización» sin un nombre): se vuelve a preguntar con la lista, en el acto.
    decide('nueva cotización con hotel 4 estrellas', { tipo: 'no_se' });
    await llega('nueva cotización con hotel 4 estrellas', { enviado: 9 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === 'nueva cotización con hotel 4 estrellas')).toBeUndefined();
    expect(textos().at(-1)).toMatch(/^No me quedó claro\. Tanda de las \d\d:\d\d · ¿De qué viaje son\?$/);
    expect(ultimosBotones()[0].title).toBe('1. SAN ANDRÉS DIC');
    colaModelo = [pedido()];
    await cron(60);
    expect(negocioDe('COTIZACION CON HOTEL 4 ESTRELLAS')).toBeFalsy();
    expect(t.negocios.length).toBe(negociosAntes);
    expect(t.contactos?.length ?? 0).toBe(contactosAntes);
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toMatchObject({ espera: 'viaje' });
    // La re-pregunta se sigue contestando como siempre (y el «sí» crea).
    elige(nuevo('Daniela Rojas'), 'nuevo', 'Daniela Rojas');
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
    elige('NUEVO', 'nuevo');
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
    // «sí» a «¿A qué viaje van?» no elige nada (la lista no tiene un «sí»): el modelo no sabe y se vuelve a preguntar.
    decide('sí', { tipo: 'no_se' });
    await llega('sí', { enviado: 9 });
    expect(textos().at(-1)).toMatch(/^No me quedó claro\. Tanda de las \d\d:\d\d · ¿De qué viaje son\?$/);
    expect(await ent.preguntaAbierta(db as never, WS, TEL)).toMatchObject({ espera: 'viaje', corta: '¿De qué viaje son?' });
    elige(nuevo('Valeria Rojas'), 'nuevo', 'Valeria Rojas');
    await llega(nuevo('Valeria Rojas'), { enviado: 100 });
    expect(t.wa_bandeja_mensajes.find(m => m.cuerpo === nuevo('Valeria Rojas'))).toMatchObject({ papel: 'respuesta_cliente' });
    await cron(160);
    await llega('sí', { enviado: 170 });
    colaModelo = [pedido()];
    await cron(220);
    expect(negocioDe('VALERIA ROJAS')).toBeTruthy();
  });

  it('«NUEVO» solo y después el nombre sin NUEVO: lo muestra tal cual; sin llave no lo crea, con ella sí (2026-10-05)', async () => {
    await preguntaDeViaje();
    elige('NUEVO', 'nuevo');
    await llega('NUEVO', { enviado: 9 });
    colaModelo = [pedido()];
    await cron(60);
    expect(textos().at(-1)).toContain('¿Para qué cliente es? No veo su nombre en los mensajes');
    decide('Valeria Prueba5', { tipo: 'nombre', nombre: 'Valeria Prueba5' });
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
    expect(textos().at(-1)).toContain('¿Cargo este viaje?\n\n*Viaje nuevo · Laura Prueba5*');
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
    expect(textos().at(-1)).toMatch(/^¿Cargo este viaje\?\n\n\*Viaje nuevo · Diego Prueba5\*/);
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
    expect(textos().at(-1)).toContain(`${grupo('Mateo Prueba5')}`);
    await llega('el 1 es de BARILOCHE JUL', { enviado: 70 });
    await cron(120);
    expect(textos().at(-1)).toMatch(/\*1\) BARILOCHE JUL · Mateo Prueba2 \(M 26 1\)\*\n\n1\. «/);
    await llega('el 2 es de M 26 1', { enviado: 130 });
    await cron(180);
    expect(textos().at(-1)).toMatch(/\*1\) BARILOCHE JUL · Mateo Prueba2 \(M 26 1\)\*\n\n1\. «[^\n]*\n2\. «/);
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
    expect(textos().at(-1)).toContain(`${grupo('Laura Prueba2')}`);
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
    expect(textos().at(-1)).toContain('¿Cargo este viaje?');
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
  const LINA = 'Ya hay un viaje de Lina Pérez (L1 26 1): si es para ese, escribe «L1 CTG ENE 27».';
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
    // 9:01 · el «si» y el «no» no contestan nada (la caja espera la llave) y no van al resumen: se vuelve a preguntar.
    await llega('si', { enviado: 42 });
    await llega('no', { enviado: 59 });
    const otraVez = 'No me quedó claro. ¿Me pasas su celular o su correo?';
    // 9:02 · «otro cliente» sin nombre pide el nombre y no es contenido.
    await llega('otro cliente', { enviado: 74 });
    // 9:04 · «nuevo daniel perez»: el mismo cliente nuevo.
    await llega(nuevo('daniel perez'), { enviado: 225 });
    // Cada uno vuelve a preguntar la llave, en corto (bot híbrido: el punto de decisión, no la lista de palabras).
    expect(textos()).toEqual([[PIDE_LLAVE_DANIEL, LINA].join('\n'), otraVez, otraVez, PIDE_NOMBRE, acuse('daniel perez', LINA)]);
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
    expect(textos().at(-1)).toMatch(/· ¿De qué viaje es el mensaje\?\n1\. L1 CTG ENE 27 · Lina Pérez \(L1 26 1\)\nTócalo en la lista o escribe su número\. Si es un viaje nuevo, escribe «nuevo» y el nombre del cliente; si no va, «descartar»\.$/);
    // La respuesta: el cliente nuevo, en cualquier forma (la lee el modelo: «Viaje nuevo», con el nombre tal cual).
    elige(`cliente nuevo Daniel Pérez ${celEscrito('Daniel Pérez')}`, 'nuevo', 'Daniel Pérez');
    await llega(`cliente nuevo Daniel Pérez ${celEscrito('Daniel Pérez')}`, { enviado: 2260 });
    expect(t.wa_bandeja_mensajes.find(m => m.wa_message_id === `wamid.vivo.${n}`)).toMatchObject({ papel: 'respuesta_cliente' });
    await cron(2320);
    // La confirmación dice el viaje de Lina con su número; el «sí» es el viaje nuevo de Daniel Pérez, cliente nuevo.
    expect(textos().at(-1)).toContain(`¿Va como viaje nuevo de Daniel Pérez? No lo tengo en el directorio: lo creo como cliente nuevo, con cel. ${celEscrito('Daniel Pérez')}.\nYa hay un viaje de Lina Pérez (L1 26 1): si es para ese, tócalo o responde 1.`);
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
    // No la toca ni pregunta por Lina; dice que lo guardó y qué espera (nunca silencio, 2026-10-05).
    expect(textos()).toEqual([TANDA_SIN_CLIENTE]);
    await llega('listo', { enviado: 6 });
    expect(textos().at(-1)).toMatch(/¿De qué viaje (?:es|son)/);
    expect(t.wa_bandeja_entregas[0].plan_viajes).toBeNull(); // sin encabezado: nada se asignó a Lina
  });

  it('solo el apellido con UN viaje: la lista numerada con NUEVO (nunca sí/no); «nuevo Daniel Pérez» abre su caja', async () => {
    viajeDeLina();
    await llega('Pérez', { enviado: 0 });
    expect(textos()).toEqual(['¿De qué viaje es «Pérez»? Hasta que me digas, no asigno lo que sigue.\n1. L1 CTG ENE 27 · Lina Pérez (L1 26 1)\nDime cuál (por ejemplo «el de Cartagena»). Si es un viaje nuevo, «nuevo» y el nombre del cliente; o «descartar».']);
    await llega('si', { enviado: 3 }); // no elige
    await llega(nuevo('Daniel Pérez'), { enviado: 6 });
    await llega('quiere cotizar Cartagena para 2', { enviado: 9, reenviado: true });
    await llega('listo', { enviado: 12 });
    expect(textos().at(-1)).toContain(`${grupo('Daniel Pérez')}`);
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
    // (Bot híbrido: una corrección que nombra un mensaje que no existe ya no llega al cron, el punto la vuelve a preguntar;
    // para dejar la re-pregunta del entendimiento se usa una corrección válida.)
    await llega('el 1 es de nuevo Pedro Prueba7', { enviado: 8 });
    await cron(60);
    expect(textos().at(-1)).toContain('Corregido. Así queda:');
    expect(t.wa_bandeja_entendimientos).toMatchObject([{ estado: 'esperando_negocio' }]);
    // Capa 2: la tanda de Diego cerrada con la pregunta en cola (una pregunta a la vez).
    await llega(nuevo('Diego Prueba7'), { enviado: 100 });
    await llega('Quiero un viaje para puntacana y curasao', { enviado: 102, reenviado: true });
    await llega('listo', { enviado: 104 });
    expect(textos().at(-1)).toBe('Primero: Pedro Prueba7 · ¿Lo cargo así?\nLo que acabas de mandar te lo pregunto después.');

    await llega('descartar', { enviado: 200 });
    expect(textos().at(-1)).toBe('Descarté lo pendiente de Pedro Prueba7 y Diego Prueba7 (2 mensajes). No creé ni cargué nada.');
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
    expect(textos().at(-1)).toMatch(/^¿Cargo este viaje\?\n\n\*Viaje nuevo · Sofia Prueba7\*/);
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
    elige(nuevo('Valentina Arce'), 'nuevo', 'Valentina Arce');
    await llega(nuevo('Valentina Arce'), { enviado: 9 });
    // La tanda de otro cliente se abre antes de que el cron pregunte: su encabezado no contesta nada.
    await llega('Mateo Prueba5', { enviado: 20 });
    await llega('quieren salir el 3 de julio', { enviado: 22, reenviado: true });
    await cron(60);
    expect(textos().at(-1)).toContain('¿Va como viaje nuevo de Valentina Arce?');
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toHaveLength(1);
  }
  const papelDe = (cuerpo: string) => t.wa_bandeja_mensajes.find(m => m.cuerpo === cuerpo)?.papel;

  it('C: con una tanda abierta, la respuesta a la confirmación nunca entra a su caja, aunque sea larga; la cortesía con verbo de alta pide el toque', async () => {
    await confirmacionConTandaAbierta();
    const negocios = t.negocios.length;
    // Una respuesta larga que el modelo no sabe leer: no es contenido de la caja de Mateo; se vuelve a preguntar en el acto.
    const larga = 'espéreme un ratico que le confirmo bien el apellido';
    decide(larga, { tipo: 'no_se' });
    await llega(larga, { enviado: 70 });
    expect(papelDe(larga)).toBeUndefined();
    expect(textos().at(-1)).toMatch(/^No me quedó claro\. .*¿Creo el cliente nuevo «Valentina Arce»\?$/);
    expect(textos().some(x => x.includes(`¿Va como viaje nuevo de ${larga}`))).toBe(false); // B: no es un nombre
    nadaCreado(negocios);
    // La cortesía con el verbo de alta: el modelo la lee como «Crear», pero crear pasa por el botón (punto 5).
    const si = 'hágame el favor y la registra de una vez';
    elige(si, 'crear');
    await llega(si, { enviado: 110 });
    expect(papelDe(si)).toBeUndefined();
    expect(textos().at(-1)).toMatch(/^Para crear el cliente, toca «Crear»\./);
    nadaCreado(negocios);
    await toca(boton('Crear'), { enviado: 115 });
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
    elige(nuevo('Valentina Arce'), 'nuevo', 'Valentina Arce');
    await llega(nuevo('Valentina Arce'), { enviado: 9 });
    await cron(60);
    for (const [k, r] of ['listo jefe, ya miro', 'déjeme y le confirmo', 'es otra Valentina Arce'].entries()) {
      decide(r, { tipo: 'no_se' });
      await llega(r, { enviado: 70 + k * 30 });
      await cron(90 + k * 30);
      expect(textos().at(-1)).toMatch(/^No me quedó claro\. .*¿Creo el cliente nuevo «Valentina Arce»\?$/);
      expect(textos().some(x => x.includes(`¿Va como viaje nuevo de ${r}?`))).toBe(false);
    }
    nadaCreado(negocios);
    elige('bótalo', 'des');
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
    expect(textos().at(-1)).toContain('⚠ Por decidir: 1 mensaje\n2. «Raquel Ortiz pregunta si el hotel tiene…» (nombra a Raquel Ortiz (R 26 4), que tiene un viaje abierto');
    // Sin «Cargar» (hay un ⚠ por decidir): el «sí» escrito no carga, y el bot dice qué falta, en el acto.
    await llega('sí', { enviado: 10 });
    expect(textos().at(-1)).toMatch(/^Todavía no lo cargo\. .*Primero dime qué hago con lo marcado con ⚠/);
    await cron(60);
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
      // Bot híbrido: «¿Para qué cliente es?» es un punto de decisión; el modelo copia el nombre tal cual.
      decide('El cliente es Martín Robledo', { tipo: 'nombre', nombre: 'Martín Robledo' });
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
      expect(resumen).toMatch(/^¿Cargo este viaje\?\n\n\*Viaje nuevo · Martín Robledo\*\nYa es cliente · cel\. …9444 · 5 viajes abiertos\n\n1\. «Hola, quiero ir a Cartagena/);
      expect(resumen).not.toContain('Ya hay un viaje');
      // «dale» lo lee el modelo como «Cargar», pero cargar sale solo de lo exacto (2026-10-06, SR3): pide el toque.
      elige('dale', 'si');
      await llega('dale', { enviado: 70 });
      expect(textos().at(-1)).toMatch(/^Para cargarlo, toca «✅ Cargar»\. No he cargado nada\.\n/);
      expect(t.negocios.filter(x => x.contacto_id === 'c-mr' && !String(x.id).startsWith('n-mr'))).toEqual([]);
      await toca(boton('✅ Cargar'), { enviado: 72 });
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
    // La lista de sus viajes con «Viaje nuevo» (bot híbrido): el modelo lee «uno nuevo» como esa fila.
    expect(ultimosBotones().map(b => b.title)).toEqual(['1. MIAMI 7N', '2. ARMENIA 2N', '3. ARMENIA 2N', '4. EUROPA 20D', '5. EUROPA 2 DÍAS', 'Viaje nuevo', '🗑 Descartar']);
    elige('uno nuevo', 'nuevo');
    await llega('uno nuevo', { enviado: 5 });
    expect(textos().at(-1)).toBe(YA_LO_TENEMOS);
    // Octavo control de Vera (bloqueante 2): dentro de la caja de su viaje nuevo, su nombre es contenido de esa caja;
    // ya no vuelve a abrir la lista de sus viajes.
    const antes = textos().length;
    await llega('Martín Robledo', { enviado: 10 });
    expect(textos()).toHaveLength(antes);
    await llega('descartar', { enviado: 12 });
    await llega('Martín Robledo', { enviado: 14 });
    expect(textos().at(-1)).toMatch(/^Martín Robledo tiene 5 viajes abiertos\. ¿Va en uno de esos o es un viaje nuevo\?/);
    elige('el de Miami', 'e1');
    await llega('el de Miami', { enviado: 15 });
    expect(textos().at(-1)).toBe('📌 MIAMI 7N · Martín Robledo (M1 26 1)');
  });

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`la secuencia de las 09:26, interruptor ${modo}: «¿Qué viajes tiene abiertos?» se contesta en solo lectura y nunca es contenido`, async () => {
      clienteConCincoViajes();
      const llamadas = { n: 0 };
      const interprete = modo === 'prendido' ? { llamadas } : undefined;
      const bloquesAntes = JSON.stringify(t.negocio_bloques);
      await llega('Vamos a hacer una nueva cotización para Martín Robledo', { enviado: 0, interprete });
      expect(textos().at(-1)).toBe(YA_LO_TENEMOS);
      const registrados = t.wa_bandeja_mensajes.length;
      // 09:26 · la pregunta al bot: «tiene» es el cliente de la tanda abierta.
      await llega('Que viajes tiene abiertos?', { enviado: 10, interprete });
      expect(textos().at(-1)).toBe(['Martín Robledo tiene 5 viajes abiertos:', '- MIAMI 7N (M1 26 1)', '- ARMENIA 2N (M1 26 2)', '- ARMENIA 2N (M1 26 3)',
        '- EUROPA 20D (M1 26 4)', '- EUROPA 2 DÍAS (M1 26 5)'].join('\n'));
      expect(textos().some(x => /¿Qué hago con esto\?|No te entendí/.test(x))).toBe(false);
      // Solo lectura: no se registra en la tanda.
      expect(t.wa_bandeja_mensajes.length).toBe(registrados);
      // Lo que el cliente pregunta, reenviado, sí es contenido (regla 1 de la frontera).
      await llega('¿cuánto cuesta el de 7 noches? ¿y qué viajes tienen abiertos para enero?', { enviado: 20, reenviado: true });
      expect(t.wa_bandeja_mensajes.length).toBe(registrados + 1);
      // Otra pregunta al bot: qué lleva la tanda.
      await llega('¿qué te he mandado?', { enviado: 30, interprete });
      expect(textos().at(-1)).toMatch(/^Llevas 1 mensaje de .*Martín Robledo.*\. Cuando termines, escribe «listo»\.$/);
      // Y del viaje nuevo: todavía no existe.
      await llega('qué le falta?', { enviado: 35, interprete });
      expect(textos().at(-1)).toMatch(/^El viaje nuevo de Martín Robledo todavía no está creado/);
      expect(t.wa_bandeja_mensajes.length).toBe(registrados + 1);
      // Con el interruptor prendido, el código de hoy las lee exactas: el modelo no se llama.
      expect(llamadas.n).toBe(0);
      await llega('listo', { enviado: 40 });
      const resumen = textos().at(-1)!;
      expect(resumen).toMatch(/\*Viaje nuevo · Martín Robledo\*\nYa es cliente · cel\. …9444 · 5 viajes abiertos\n\n1\. «¿cuánto cuesta el de 7 noches\?/);
      expect(resumen).not.toContain('Que viajes tiene');
      expect(JSON.stringify(t.negocio_bloques)).toBe(bloquesAntes);
    });
  }

  it('prendido: una paráfrasis que solo lee el modelo («me haces la lista de lo que tiene abierto?») también es la consulta', async () => {
    clienteConCincoViajes();
    await llega('Vamos a hacer una nueva cotización para Martín Robledo', { enviado: 0 });
    const registrados = t.wa_bandeja_mensajes.length;
    const texto = 'oye y me haces la lista de lo que tiene abierto?';
    await llega(texto, { enviado: 10, interprete: { modelo: { acciones: [{ accion: 'consulta', evidencia: texto, tema: 'viajes' }] } } });
    expect(textos().at(-1)).toMatch(/^Martín Robledo tiene 5 viajes abiertos:\n- MIAMI 7N \(M1 26 1\)/);
    expect(t.wa_bandeja_mensajes.length).toBe(registrados);
  });

  it('en la caja de un viaje que ya existe, «¿qué le falta?» dice su avance y lo que falta; la pregunta abierta se recuerda', async () => {
    clienteConCincoViajes();
    await llega('M1 26 1', { enviado: 0 });
    await llega('¿qué le falta?', { enviado: 5 });
    expect(textos().at(-1)).toMatch(/MIAMI 7N/);
    expect(textos().at(-1)).toMatch(/\nLe falta para cotizar: |\nYa tiene todo lo mínimo para cotizar\./);
    expect(t.wa_bandeja_mensajes.filter(m => String(m.cuerpo).includes('le falta'))).toEqual([]);
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
    expect(textos().at(-1)).toContain('Viaje nuevo · Simón Arango*\nNo lo tengo en el directorio: falta su celular o correo');
    await llega('sí', { enviado: 10 });
    expect(textos().at(-1)).toBe('Todavía no lo cargo. Simón Arango · ¿Me pasas su celular o su correo?');
    await cron(60);
    expect(t.contactos).toEqual([]);
    await llega('su correo es simon.arango@correo.co', { enviado: 70 });
    await cron(120);
    expect(textos().at(-1)).toContain('Viaje nuevo · Simón Arango*\nCliente nuevo · correo simon.arango@correo.co');
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
    expect(textos().some(x => x.includes('Viaje nuevo · Simón Arango*\nCliente nuevo · cel. 300 246 8100'))).toBe(true);
  });

  it('D2: «cliente nueva» que se parece a una ficha; su celular es de esa ficha → «¿Es la misma persona?»; «sí, es ella» la usa', async () => {
    paola();
    await llega('nueva clienta Paola Rincón', { enviado: 0 });
    expect(textos().at(-1)).toBe('No tengo a Paola Rincón tal cual. ¿Es Paola Andrea Rincón Díaz (cel. …1234, último viaje: CARTAGENA MAR), o es otra persona?');
    await llega('300 555 1234', { enviado: 3 });
    expect(textos().at(-1)).toBe('Ese celular ya lo tenemos a nombre de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR). ¿Es la misma persona?');
    elige('sí, es ella, se registró con el nombre completo', 'si');
    await llega('sí, es ella, se registró con el nombre completo', { enviado: 6 });
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Paola Andrea Rincón Díaz, el que ya tenemos (cel. …1234, último viaje: CARTAGENA MAR).\nReenvíame lo que te pidió y al final te muestro el resumen.');
    await llega('quiere San Andrés en enero', { enviado: 9, reenviado: true });
    await llega('listo', { enviado: 12 });
    expect(textos().at(-1)).toContain('Viaje nuevo · Paola Andrea Rincón Díaz*\nYa es cliente · cel. …1234 · último viaje: CARTAGENA MAR');
    await llega('sí', { enviado: 15 });
    colaModelo = [salidaModelo({ destino: { valor: 'San Andrés', frase: 'San Andrés' } })];
    await cron(60);
    expect(t.contactos).toHaveLength(1);
    expect(t.negocios.filter(x => x.contacto_id === 'c-par' && x.estado === 'abierto')).toHaveLength(1);
  });

  it('D2 con botones (2026-10-05): «¿Es la misma persona?» de la caja trae «Sí, es la misma» y «No, es otra»; el toque contesta como el escrito', async () => {
    paola();
    await llega(`nueva clienta Paola Rincón 300 555 1234`, { enviado: 0 });
    expect(enviados.at(-1)!.texto).toBe('Ese celular ya lo tenemos a nombre de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR). ¿Es la misma persona?');
    expect(enviados.at(-1)!.botones!.map(b => b.title)).toEqual(['✅ Sí, es la misma', '❌ No, es otra']);
    await toca(boton('✅ Sí, es la misma'), { enviado: 3 });
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Paola Andrea Rincón Díaz, el que ya tenemos (cel. …1234, último viaje: CARTAGENA MAR).\nReenvíame lo que te pidió y al final te muestro el resumen.');
    // El mismo toque otra vez: la pregunta ya no está abierta y no hace nada.
    const n0 = t.wa_bandeja_mensajes.length;
    await toca({ id: enviados.filter(e => e.botones?.length).at(-1)!.botones![0].id, title: '✅ Sí, es la misma' }, { enviado: 5 });
    expect(textos().at(-1)).toBe('Ese botón es de una pregunta que ya no está abierta: no hice nada.');
    expect(t.wa_bandeja_mensajes.length).toBe(n0);
  });

  it('D2 con «no, es la mamá»: nunca se crea con ese celular; se pide otra llave y el «sí» espera', async () => {
    paola();
    await llega(`nueva clienta Paola Rincón 300 555 1234`, { enviado: 0 });
    expect(textos().at(-1)).toBe('Ese celular ya lo tenemos a nombre de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR). ¿Es la misma persona?');
    elige('no, es la mamá, comparten celular', 'no');
    await llega('no, es la mamá, comparten celular', { enviado: 3 });
    expect(textos().at(-1)).toBe('Entonces a Paola Rincón la creas desde la app, para no mezclarla con Paola Andrea Rincón Díaz; o pásame otro celular o correo. Lo de este viaje queda esperando.');
    await llega('quiere San Andrés en enero', { enviado: 6, reenviado: true });
    await llega('listo', { enviado: 9 });
    expect(textos().at(-1)).toContain('Viaje nuevo · Paola Rincón*\nNo lo tengo en el directorio: falta su celular o correo');
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
    // Bot híbrido: «¿Cuál es?» sale con la lista de las fichas, «Otra persona» y «Descartar».
    expect(ultimosBotones().map(b => b.title)).toEqual(['1. Andrés Gómez', '2. Andres Gomez', 'Otra persona', '🗑 Descartar']);
    elige('el de Miami', 'c1');
    await llega('el de Miami', { enviado: 3 });
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Andrés Gómez, el que ya tenemos (cel. …4410, un viaje abierto: MIAMI MAY).\nReenvíame lo que te pidió y al final te muestro el resumen.');
    await llega('nueva cotización para Andrés Gómez', { enviado: 10 });
    elige('ninguno, es otro', 'otra');
    await llega('ninguno, es otro', { enviado: 13 });
    expect(textos().at(-1)).toBe('No tengo a Andrés Gómez en el directorio. ¿Me pasas su celular o su correo? Así reviso que no lo tengamos con otro nombre, y sin uno de los dos no lo creo.');
  });

  it('D4: «nuevo viaje» y solo el usuario de Instagram: no lo tengo, ¿cómo se llama?; con el nombre, cliente nuevo con esa llave', async () => {
    await llega('nuevo viaje', { enviado: 0 });
    await llega('@laurapc', { enviado: 3 });
    expect(textos().at(-1)).toBe('No tengo a nadie con usuario @laurapc. ¿Cómo se llama? Mientras tanto guardo lo que me mandes.');
    decide('Laura', { tipo: 'nombre', nombre: 'Laura' });
    await llega('Laura', { enviado: 6 });
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Laura, cliente nuevo (usuario @laurapc). Lo creo cuando me digas que sí en el resumen.\nReenvíame lo que te pidió y al final te muestro el resumen.');
    await llega('Hola, quiero cotizar Punta Cana para 4 en semana santa', { enviado: 9, reenviado: true });
    await llega('listo', { enviado: 12 });
    expect(textos().at(-1)).toContain('Viaje nuevo · Laura*\nCliente nuevo · usuario @laurapc');
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
    // Octavo control de Vera (hallazgo 9): lo que se le agrega a la ficha se dice en el acuse y en el resumen.
    expect(textos().at(-1)).toBe('Va como viaje nuevo de Rosa Mejía, el que ya tenemos (sin celular ni correo, sin viajes).\nLe agrego a su ficha el cel. 300 777 8899.\nReenvíame lo que te pidió y al final te muestro el resumen.');
    await llega('quiere Cartagena en marzo', { enviado: 3, reenviado: true });
    await llega('nuevo Tomás Gil tomas@correo.co', { enviado: 6 });
    await llega('quiere Bogotá en abril', { enviado: 9, reenviado: true });
    await llega('listo', { enviado: 12 });
    expect(textos().at(-1)).toContain('Viaje nuevo · Rosa Mejía*\nYa es cliente · sin celular ni correo · sin viajes · le agrego a su ficha el cel. 300 777 8899');
    expect(textos().at(-1)).toContain('Viaje nuevo · Tomás Gil*\nYa es cliente · cel. …0001 · sin viajes · le agrego a su ficha el correo tomas@correo.co');
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
      expect(textos().at(-1)).toContain('Viaje nuevo · Hugo Prieto*\nNo pude revisar el directorio');
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

describe('octavo control de Vera (2026-10-05): el «sí» con reserva y el cliente de la caja nueva, de punta a punta', () => {
  /** Un cliente con UN viaje abierto: el caso en que nombrarlo sacaba la tanda del viaje nuevo sin preguntar. */
  function clienteConUnViaje() {
    t.contactos.push({ id: 'c-gq', workspace_id: WS, nombre: 'GERARDO QUINTERO', telefono: '3004447788', email: null, created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba('n-gq1', 'G 26 1', 'VILLA DE LEYVA 2N', 'GERARDO QUINTERO'), contacto_id: 'c-gq' });
    t.negocio_bloques.push({ id: 'b-n-gq1', negocio_id: 'n-gq1', data: { destino: 'Villa de Leyva' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
  }
  const confirmar = (evidencia: string) => ({ acciones: [{ accion: 'confirmar', evidencia }] });

  it('bloqueante 1, prendido: «sí, pero espérame …» al resumen de un viaje nuevo no lo crea ni lo carga; «sí, créalo» sí', async () => {
    const llamadas = { n: 0 };
    await llega(nuevo('Octavio Prueba8'), { enviado: 0 });
    await llega('queremos ir a Capurganá en febrero, somos 4 adultos', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 6 });
    expect(textos().at(-1)).toContain(`${grupo('Octavio Prueba8')}`);
    const antes = textos().length;
    // Bot híbrido: el resumen es un punto de decisión. El «sí» con reserva lo lee su modelo (no el del intérprete): «no sé».
    for (const [i, reserva] of ['sí, pero espérame que me manda las edades', 'sí cuando me confirme el hotel'].entries()) {
      decide(reserva, { tipo: 'no_se' });
      await llega(reserva, { enviado: 10 + i, interprete: { llamadas, modelo: confirmar(reserva) } });
      expect(textos().at(-1)).toMatch(/¿Lo cargo así\?$/);
      await cron(60 + i);
    }
    expect(llamadas.n).toBe(0);
    expect(alModeloDeDecision).toEqual(['sí, pero espérame que me manda las edades', 'sí cuando me confirme el hotel']);
    expect(t.contactos).toEqual([]);
    expect(t.negocios).toEqual([]);
    expect(textos().slice(antes).some(x => /^Entendí|Cargué|Creé/.test(x))).toBe(false);
    // «sí, créalo» lo lee el modelo como «Cargar», pero crear al cliente pasa por el botón (punto 5): se toca.
    elige('sí, créalo', 'si');
    await llega('sí, créalo', { enviado: 70, interprete: { llamadas, modelo: confirmar('sí, créalo') } });
    expect(textos().at(-1)).toMatch(/^Para cargarlo y crear el cliente, toca «.+»\. No he cargado nada\./);
    expect(t.contactos).toEqual([]);
    await toca(boton('✅ Cargar'), { enviado: 72 });
    colaModelo = [salidaModelo({ destino: { valor: 'Capurganá', frase: 'ir a Capurganá' } })];
    await cron(120);
    expect(t.contactos.map(c => c.nombre)).toEqual(['OCTAVIO PRUEBA8']);
    expect(t.negocios).toHaveLength(1);
  });

  // SR3 (corrida ×1 con Gemini real, 2026-10-06): el modelo leyó «👌» como «Cargar» y creó el viaje. Lo que escribe en un
  // viaje o crea algo sale solo de lo exacto: el toque o el «sí» escrito solo. Aquí el modelo falso hace lo mismo que el
  // real (devuelve «si») y el bot pide el toque, en los dos modos y con un viaje nuevo o uno que ya existe.
  for (const modo of ['apagado', 'prendido'] as const) {
    for (const texto of ['👌', '👍', 'ok', 'dale']) {
      it(`SR3, ${modo}: «${texto}» al resumen, leído como «Cargar» por el modelo, no carga ni crea; pide el toque y el toque carga`, async () => {
        const llamadas = { n: 0 };
        const interprete = modo === 'prendido' ? { llamadas, modelo: confirmar(texto) } : undefined;
        await llega(nuevo('Octavio Prueba8'), { enviado: 0 });
        await llega('queremos ir a Capurganá en febrero, somos 4 adultos', { enviado: 3, reenviado: true });
        await llega('listo', { enviado: 6 });
        elige(texto, 'si');
        await llega(texto, { enviado: 10, interprete });
        expect(alModeloDeDecision.at(-1)).toBe(texto);
        expect(textos().at(-1)).toMatch(/^Para cargarlo y crear el cliente, toca «.+»\. No he cargado nada\.\n.*¿Lo cargo así\?$/s);
        expect(enviados.at(-1)!.botones?.length ?? 0).toBeGreaterThan(0);
        await cron(60);
        expect(t.contactos).toEqual([]);
        expect(t.negocios).toEqual([]);
        expect(llamadas.n).toBe(0);
        await toca(boton('✅ Cargar'), { enviado: 70 });
        colaModelo = [salidaModelo({ destino: { valor: 'Capurganá', frase: 'ir a Capurganá' } })];
        await cron(120);
        expect(t.contactos.map(c => c.nombre)).toEqual(['OCTAVIO PRUEBA8']);
        expect(t.negocios).toHaveLength(1);
      });
    }
  }

  it('SR3 con un viaje que ya existe: «👌» no carga en su ficha; el «sí» escrito solo, sin el modelo, sí', async () => {
    clienteConUnViaje();
    const bloquesAntes = JSON.stringify(t.negocio_bloques);
    await llega('G 26 1', { enviado: 0 });
    await llega('ahora son 3 noches, no 2', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 6 });
    elige('👌', 'si');
    await llega('👌', { enviado: 10 });
    expect(textos().at(-1)).toMatch(/^Para cargarlo, toca «.+»\. No he cargado nada\./);
    colaModelo = [salidaModelo({ destino: { valor: 'Villa de Leyva', frase: '' } })];
    await cron(60);
    expect(JSON.stringify(t.negocio_bloques)).toBe(bloquesAntes);
    expect(t.wa_bandeja_entregas.map(e => e.cliente_texto ?? null)).toEqual([null]);
    const m0 = alModeloDeDecision.length;
    await llega('sí', { enviado: 70 });
    expect(alModeloDeDecision.length).toBe(m0);
    // El «sí» escrito solo es la respuesta al resumen (como el toque): queda tomado para cargar.
    expect(t.wa_bandeja_entregas.map(e => [e.estado, e.cliente_texto])).toEqual([['con_cliente', 'sí']]);
  });

  it('bloqueante 1, prendido: con un viaje que ya existe, «sí aunque falta un mensaje» tampoco carga nada en su ficha', async () => {
    clienteConUnViaje();
    const bloquesAntes = JSON.stringify(t.negocio_bloques);
    await llega('G 26 1', { enviado: 0 });
    await llega('ahora son 3 noches, no 2', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 6 });
    const reserva = 'sí aunque falta un mensaje que me va a mandar';
    decide(reserva, { tipo: 'no_se' });
    await llega(reserva, { enviado: 10, interprete: { modelo: confirmar(reserva) } });
    colaModelo = [salidaModelo({ destino: { valor: 'Villa de Leyva', frase: '' } })];
    await cron(60);
    expect(JSON.stringify(t.negocio_bloques)).toBe(bloquesAntes);
    expect(textos().at(-1)).toMatch(/¿Lo cargo así\?$/);
  });

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`bloqueante 2, ${modo}: en la caja del viaje NUEVO de Gerardo Quintero, «Gerardo quiere …» no se va a su viaje abierto`, async () => {
      clienteConUnViaje();
      const bloquesAntes = JSON.stringify(t.negocio_bloques);
      const conModelo = (modelo: unknown) => (modo === 'prendido' ? { interprete: { modelo } } : {});
      await llega('vamos a hacer una cotización nueva para Gerardo Quintero', { enviado: 0 });
      expect(textos().at(-1)).toMatch(/^Va como viaje nuevo de Gerardo Quintero, el que ya tenemos/);
      await llega('quiere ir a Jardín, Antioquia en semana santa', { enviado: 3, reenviado: true });
      // El nombre de pila con su tratamiento, y una frase con el nombre: el modelo los devuelve como su viaje abierto.
      await llega('don Gerardo', { enviado: 6, ...conModelo({ acciones: [{ accion: 'abrir_viaje', evidencia: 'don Gerardo', ref_cliente: 'Gerardo' }] }) });
      await llega('Gerardo prefiere que sea finca con piscina', {
        enviado: 9, ...conModelo({ acciones: [{ accion: 'contenido', evidencia: 'Gerardo prefiere que sea finca con piscina', ref_cliente: 'Gerardo' }] }),
      });
      expect(textos().some(x => x.startsWith('📌'))).toBe(false);
      await llega('listo', { enviado: 12 });
      const resumen = textos().at(-1)!;
      expect(resumen).toMatch(/^¿Cargo este viaje\?\n\n\*Viaje nuevo · Gerardo Quintero\*\nYa es cliente/);
      expect(resumen).not.toContain('G 26 1');
      expect(resumen).toMatch(/\n1\. «[^\n]*\n2\. «[^\n]*\n3\. «/);
      expect(resumen).toContain('«Gerardo prefiere que sea finca');
      expect(JSON.stringify(t.negocio_bloques)).toBe(bloquesAntes);
    });
  }

  /** Un cliente con dos viajes abiertos: «¿Va en uno de esos o es un viaje nuevo?». */
  function clienteConDosViajes() {
    t.contactos.push({ id: 'c-bc', workspace_id: WS, nombre: 'BRUNO CIFUENTES', telefono: '3006665544', email: null, created_at: '2026-01-10T10:00:00Z' });
    for (const [id, codigo, nombre] of [['n-bc1', 'B 26 1', 'GUATAPÉ 2N'], ['n-bc2', 'B 26 2', 'TAYRONA 3N']]) {
      t.negocios.push({ ...negocioDePrueba(id, codigo, nombre, 'BRUNO CIFUENTES'), contacto_id: 'c-bc' });
    }
  }
  const BRUNO_YA = 'Va como viaje nuevo de Bruno Cifuentes, el que ya tenemos (cel. …5544, 2 viajes abiertos).\nReenvíame lo que te pidió y al final te muestro el resumen.';

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`hallazgo 4, ${modo}: a la lista de un solo cliente, «va aparte» es su viaje nuevo sin otra vuelta`, async () => {
      clienteConDosViajes();
      const llamadas = { n: 0 };
      const interprete = modo === 'prendido' ? { llamadas } : undefined;
      await llega('Bruno Cifuentes', { enviado: 0, interprete });
      expect(textos().at(-1)).toMatch(/^Bruno Cifuentes tiene 2 viajes abiertos.*¿Va en uno de esos o es un viaje nuevo\?$/);
      const antes = llamadas.n;
      elige('va aparte', 'nuevo');
      await llega('va aparte', { enviado: 3, interprete });
      expect(textos().at(-1)).toBe(BRUNO_YA);
      // Prendido, lo lee el punto de decisión (su modelo, con la fila «Viaje nuevo»): el intérprete no se llama.
      expect(llamadas.n).toBe(antes);
    });
  }

  it('hallazgo 4, prendido: una forma que solo lee el modelo («es otra cosa, ábrela por fuera») también', async () => {
    clienteConDosViajes();
    await llega('Bruno Cifuentes', { enviado: 0 });
    elige('es otra cosa, ábrela por fuera', 'nuevo');
    await llega('es otra cosa, ábrela por fuera', { enviado: 3, interprete: { modelo: { acciones: [{ accion: 'responder', opcion: 'nuevo', evidencia: 'es otra cosa, ábrela por fuera' }] } } });
    expect(textos().at(-1)).toBe(BRUNO_YA);
    await llega('quiere ir a Salento en junio', { enviado: 6, reenviado: true });
    await llega('listo', { enviado: 9 });
    expect(textos().at(-1)).toMatch(/^¿Cargo este viaje\?\n\n\*Viaje nuevo · Bruno Cifuentes\*\nYa es cliente · cel\. …5544 · 2 viajes abiertos\n\n1\. «/);
  });

  it('hallazgo 6, prendido: «sí, es ella, se casó y cambió el apellido» contesta «¿Es la misma persona?»', async () => {
    t.contactos.push({ id: 'c-lv', workspace_id: WS, nombre: 'LUCÍA VARGAS', telefono: '3009990011', email: null, created_at: '2026-01-10T10:00:00Z' });
    await llega('nueva clienta Lucía Rendón 300 999 0011', { enviado: 0 });
    expect(textos().at(-1)).toMatch(/a nombre de Lucía Vargas .*¿Es la misma persona\?$/);
    const texto = 'sí, es ella, se casó y cambió el apellido';
    elige(texto, 'si');
    await llega(texto, { enviado: 3, interprete: { modelo: { acciones: [{ accion: 'confirmar', evidencia: texto }] } } });
    expect(textos().at(-1)).toMatch(/^Va como viaje nuevo de Lucía Vargas, el que ya tenemos/);
  });

  it('hallazgo 7, apagado: «anótale a don Simeón el cel …» en su caja es la llave, no contenido', async () => {
    await llega('nuevo Simeón Arcila', { enviado: 0 });
    expect(textos().at(-1)).toMatch(/^No tengo a Simeón Arcila en el directorio\. ¿Me pasas su celular o su correo\?/);
    // La llave con más palabras: el modelo dice que la trae («llave») y el código la copia del mensaje.
    decide('anótale a don Simeón el cel 300 222 3344', { tipo: 'llave' });
    await llega('anótale a don Simeón el cel 300 222 3344', { enviado: 3 });
    expect(textos().at(-1)).toMatch(/^Va como viaje nuevo de Simeón Arcila, cliente nuevo \(cel\. 300 222 3344\)/);
    await llega('quiere ir a Nuquí en agosto', { enviado: 6, reenviado: true });
    await llega('listo', { enviado: 9 });
    expect(textos().at(-1)).toContain('Viaje nuevo · Simeón Arcila*\nCliente nuevo · cel. 300 222 3344');
  });

  it('bloqueante 2, prendido: el destino de su viaje abierto («lo de Villa de Leyva») sí cambia a ese viaje', async () => {
    clienteConUnViaje();
    await llega('vamos a hacer una cotización nueva para Gerardo Quintero', { enviado: 0 });
    await llega('lo de Villa de Leyva de Gerardo', {
      enviado: 3, interprete: { modelo: { acciones: [{ accion: 'abrir_viaje', evidencia: 'lo de Villa de Leyva de Gerardo', ref_cliente: 'Gerardo', ref_destino: 'Villa de Leyva' }] } },
    });
    expect(textos().at(-1)).toBe('📌 VILLA DE LEYVA 2N · Gerardo Quintero (G 26 1)');
  });
});

describe('noveno control de Vera (2026-10-05): la fórmula delante del nombre no crea un duplicado, de punta a punta', () => {
  function renata() {
    t.contactos.push({ id: 'c-ro', workspace_id: WS, nombre: 'RENATA OSORIO', telefono: '3004424411', email: null, created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba('n-ro', 'R 25 3', 'BARICHARA MAR', 'RENATA OSORIO'), contacto_id: 'c-ro', estado: 'completado' });
  }

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`interruptor ${modo}: «es mi clienta de siempre, Renata Osorio» tras «¿Para qué cliente es?» es la que ya tenemos; el «sí» no crea otra`, async () => {
      renata();
      const interprete = modo === 'prendido' ? {} : undefined;
      await llega('Bueno, vamos a montar un viaje nuevo', { enviado: 0, interprete });
      expect(textos().at(-1)).toBe('Listo, un viaje nuevo. ¿Para qué cliente es?');
      decide('es mi clienta de siempre, Renata Osorio', { tipo: 'nombre', nombre: 'Renata Osorio' });
      await llega('es mi clienta de siempre, Renata Osorio', { enviado: 5, interprete });
      expect(textos().at(-1)).toMatch(/^Va como viaje nuevo de Renata Osorio, el que ya tenemos \(cel\. …4411/);
      await llega('quiere ir a Mompox en semana santa, son 2', { enviado: 8, reenviado: true });
      await llega('listo', { enviado: 10 });
      expect(textos().at(-1)).toContain('*Viaje nuevo · Renata Osorio*\nYa es cliente · cel. …4411');
      await llega('sí', { enviado: 15 });
      colaModelo = [salidaModelo({ destino: { valor: 'Mompox', frase: 'ir a Mompox' } })];
      await cron(60);
      expect(t.contactos.map(c => c.nombre)).toEqual(['RENATA OSORIO']);
      expect(t.negocios.filter(x => x.contacto_id === 'c-ro' && x.estado === 'abierto')).toHaveLength(1);
    });
  }

  it('«nuevo para Renata Osorio» con un celular nuevo: es ella (se le agrega el celular), nunca una ficha nueva', async () => {
    t.contactos.push({ id: 'c-ro', workspace_id: WS, nombre: 'RENATA OSORIO', telefono: null, email: null, created_at: '2026-01-10T10:00:00Z' });
    await llega('nuevo para Renata Osorio 300 777 1122', { enviado: 0 });
    expect(textos().at(-1)).toMatch(/^Va como viaje nuevo de Renata Osorio, el que ya tenemos/);
    await llega('quiere ir a Mompox', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 5 });
    await llega('sí', { enviado: 8 });
    colaModelo = [salidaModelo({ destino: { valor: 'Mompox', frase: 'ir a Mompox' } })];
    await cron(60);
    expect(t.contactos.map(c => [c.nombre, c.telefono])).toEqual([['RENATA OSORIO', '3007771122']]);
  });

  it('sin nadie con ese nombre, «la persona que viaja es Bernardo Lizcano» no crea con el prefijo: el modelo copia el nombre sin la fórmula', async () => {
    await llega('Bueno, vamos a montar un viaje nuevo', { enviado: 0 });
    decide('la persona que viaja es Bernardo Lizcano 300 555 6677', { tipo: 'nombre', nombre: 'Bernardo Lizcano' });
    await llega('la persona que viaja es Bernardo Lizcano 300 555 6677', { enviado: 5 });
    // Bot híbrido: el nombre lo copia el modelo tal cual, sin la fórmula; la llave la lee el código del mensaje.
    expect(textos().at(-1)).toMatch(/^Va como viaje nuevo de Bernardo Lizcano, cliente nuevo \(cel\. 300 555 6677\)/);
    await llega('quiere ir a Mompox', { enviado: 8, reenviado: true });
    await llega('listo', { enviado: 10 });
    await llega('sí', { enviado: 15 });
    colaModelo = [salidaModelo({ destino: { valor: 'Mompox', frase: 'ir a Mompox' } })];
    await cron(60);
    expect(t.contactos.filter(c => /PERSONA/.test(String(c.nombre)))).toEqual([]);
  });

  it('«la persona es Bernardo Lizcano» (corto, sin nadie así): se pregunta el nombre; con el nombre limpio y su celular, se crea limpio', async () => {
    await llega('Bueno, vamos a montar un viaje nuevo', { enviado: 0 });
    decide('la persona es Bernardo Lizcano', { tipo: 'nombre', nombre: 'Bernardo Lizcano' });
    await llega('la persona es Bernardo Lizcano', { enviado: 5 });
    // Sin llave y sin nadie así en el directorio: se pide su celular o correo.
    expect(textos().at(-1)).toMatch(/^No tengo a Bernardo Lizcano en el directorio\. ¿Me pasas su celular o su correo\?/);
    decide('Bernardo Lizcano 300 555 6677', { tipo: 'llave' });
    await llega('Bernardo Lizcano 300 555 6677', { enviado: 7 });
    expect(textos().at(-1)).toMatch(/^Va como viaje nuevo de Bernardo Lizcano, cliente nuevo/);
    await llega('quiere ir a Mompox', { enviado: 8, reenviado: true });
    await llega('listo', { enviado: 10 });
    await llega('sí', { enviado: 15 });
    colaModelo = [salidaModelo({ destino: { valor: 'Mompox', frase: 'ir a Mompox' } })];
    await cron(60);
    expect(t.contactos.map(c => c.nombre)).toEqual(['BERNARDO LIZCANO']);
  });
});

describe('2026-10-05 · conversación con memoria: la secuencia de las 12:15, de punta a punta (textos inventados)', () => {
  /** Un viaje abierto de Fermín Ocampo a San Andrés, con lo poco que tiene. */
  function viajeDeFermin() {
    t.contactos.push({ id: 'c-fo', workspace_id: WS, nombre: 'FERMÍN OCAMPO', telefono: '3006661122', email: null, created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba('n-fo', 'F 26 1', 'SAN ANDRÉS DIC', 'FERMÍN OCAMPO'), contacto_id: 'c-fo' });
    t.negocio_bloques.push({ id: 'b-n-fo', negocio_id: 'n-fo', data: { destino: 'SAN ANDRÉS' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
  }
  /** Y otro de Gloria Arbeláez a Cartagena. */
  function viajeDeGloria() {
    t.contactos.push({ id: 'c-ga', workspace_id: WS, nombre: 'GLORIA ARBELÁEZ', telefono: '3007773344', email: null, created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba('n-ga', 'G 26 1', 'CARTAGENA ENE', 'GLORIA ARBELÁEZ'), contacto_id: 'c-ga' });
    t.negocio_bloques.push({ id: 'b-n-ga', negocio_id: 'n-ga', data: { destino: 'CARTAGENA' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
  }
  const datosDel = (id: string) => t.negocio_bloques.find(b => b.negocio_id === id)!.data as Fila;
  const PRIMERA_CARGA = salidaModelo({
    destino: { valor: 'San Andrés', frase: 'San Andrés' }, fecha_salida: { valor: '2026-12-10', frase: 'del 10 al 15 de diciembre' },
    fecha_regreso: { valor: '2026-12-15', frase: 'del 10 al 15 de diciembre' }, adultos: { valor: '2', frase: '2 adultos' }, ninos: { valor: '1', frase: 'un niño' },
  });
  /** La tanda sin encabezado de Fermín, el «listo» y el «1» a la lista: la carga corre en el acto. */
  async function cargaDeFermin(interprete?: { llamadas: { n: number } }) {
    await llega('quieren ir a San Andrés del 10 al 15 de diciembre, son 2 adultos y un niño', { enviado: 0, reenviado: true });
    await llega('listo', { enviado: 5, interprete });
    expect(textos().at(-1)).toMatch(/¿De qué viaje es el mensaje\?\n1\. SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\)/);
    colaModelo = [PRIMERA_CARGA];
    await llega('1', { enviado: 10, interprete });
  }
  beforeEach(() => { bandeja.procesarEnElActo.activo = true; });

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`interruptor ${modo}: «1» se acusa y carga en el acto; «me falta» va directo al viaje; las preguntas contestan lo que preguntan y nunca «¿De qué viaje?»`, async () => {
      viajeDeFermin();
      const llamadas = { n: 0 };
      const interprete = modo === 'prendido' ? { llamadas } : undefined;
      await cargaDeFermin(interprete);
      // 12:16 · el «1» se acusa en el acto y la carga corre ya: sin `cron`, los datos ya están y el bot dijo qué falta.
      expect(textos().slice(-2)).toEqual([
        'Listo, va a SAN ANDRÉS DIC · Fermín Ocampo (F 26 1). Lo estoy leyendo.',
        expect.stringMatching(/^Cargué en SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\): [\s\S]*\nPara empezar a cotizar me falta:\n1\. ¿Desde qué ciudad salen\?/),
      ]);
      expect(datosDel('n-fo')).toMatchObject({ adultos: 2, ninos: 1 });
      // 12:17 · lo que pedía «me falta», escrito: el foco sugiere el viaje en un resumen corto con «Cargar» (2026-10-06);
      // sin tanda, pero nada se carga hasta el «sí» o el toque.
      colaModelo = [salidaModelo({ categoria_hotel: { valor: '4', frase: 'lo quieren 4 estrellas' }, ciudad_origen: { valor: 'Medellín', frase: 'salen de Medellín' }, edades_menores: { valor: '8', frase: 'el niño tiene 8' } })];
      const antes2 = textos().length;
      const datosAntes = JSON.stringify(datosDel('n-fo'));
      await llega('El hotel lo quieren 4 estrellas, salen de Medellín y el niño tiene 8', { enviado: 30, interprete });
      expect(textos().slice(antes2)).toEqual(['Anoto en SAN ANDRÉS DIC · Fermín Ocampo (F 26 1): «El hotel lo quieren 4 estrellas, salen de Medellín y el niño tiene 8».']);
      expect(enviados.at(-1)!.botones!.map(b => b.title)).toEqual(['✅ Cargar', '🗑 Descartar']);
      expect(JSON.stringify(datosDel('n-fo'))).toBe(datosAntes);
      await llega('sí', { enviado: 32, interprete });
      expect(textos().slice(-2)).toEqual([
        'Listo, lo cargo. Te aviso en cuanto quede.',
        expect.stringMatching(/^Cargué en SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\): [\s\S]*ciudad de salida MEDELLÍN[\s\S]*Mínimo 9\/9 \(100 %\)/),
      ]);
      expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toEqual([]);
      expect(datosDel('n-fo')).toMatchObject({ ciudad_origen: 'MEDELLÍN', categoria_hotel: '4' });
      // 12:19 · las preguntas por lo que falta: el viaje en foco, contestando lo que preguntan (completo: lo que queda).
      const antes3 = textos().length;
      await llega('que queda pendiente para completar la solicitud del viaje de Fermín Ocampo', { enviado: 60, interprete });
      await llega('que faltaría para entregarlo completo?', { enviado: 70, interprete });
      await llega('Pero faltan 4 puntos para que quede completo', { enviado: 80, interprete });
      await llega('y para cotizar qué le falta?', { enviado: 90, interprete });
      const completo = 'SAN ANDRÉS DIC · Fermín Ocampo (F 26 1) — Mínimo 9/9 (100 %) · Completo 9/10 (90 %)\nLe falta 1 dato para completo: presupuesto aproximado del viaje.';
      expect(textos().slice(antes3)).toEqual([completo, completo, completo,
        'SAN ANDRÉS DIC · Fermín Ocampo (F 26 1) — Mínimo 9/9 (100 %) · Completo 9/10 (90 %)\nYa tiene todo lo mínimo para cotizar.']);
      expect(textos().some(x => /¿De qué viaje\?/.test(x))).toBe(false);
      // Con el interruptor prendido, el código las lee: el modelo no se llama.
      expect(llamadas.n).toBe(0);
    });
  }

  it('sin viaje en foco, «¿qué falta para completo?» pregunta de qué viaje y la respuesta («Del de San Andrés de don Fermín») la contesta con el mismo alcance', async () => {
    viajeDeFermin();
    await llega('qué falta para completo?', { enviado: 0 });
    expect(textos().at(-1)).toBe('¿De qué viaje? Dime el cliente o el nombre del viaje y te digo cómo va.');
    await llega('Del de San Andrés de don Fermín', { enviado: 5 });
    expect(textos().at(-1)).toMatch(/^SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\) — .*\nLe faltan \d+ datos para completo: /);
    expect(t.wa_bandeja_entregas).toEqual([]);
  });

  it('dos viajes con lo que falta: el dato que no nombra ninguno pregunta una vez cuál; «el de Cartagena» lo carga ahí', async () => {
    viajeDeFermin();
    viajeDeGloria();
    await cargaDeFermin();
    await llega('quieren ir a Cartagena en enero, son 3 adultos', { enviado: 20, reenviado: true });
    await llega('listo', { enviado: 25 });
    colaModelo = [salidaModelo({ destino: { valor: 'Cartagena', frase: 'Cartagena' }, adultos: { valor: '3', frase: '3 adultos' } })];
    const lista = textos().at(-1)!;
    const k = lista.split('\n').find(l => l.includes('Gloria Arbeláez'))!.charAt(0);
    await llega(k, { enviado: 30 });
    expect(datosDel('n-ga')).toMatchObject({ adultos: 3 });
    const antes = textos().length;
    await llega('prefieren hotel todo incluido', { enviado: 40 });
    expect(textos().slice(antes)).toEqual([expect.stringMatching(/^¿Para cuál viaje es lo que me escribiste: CARTAGENA ENE · Gloria Arbeláez \(G 26 1\) o SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\)\? Dime cuál/)]);
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toEqual([]);
    colaModelo = [salidaModelo({ categoria_hotel: { valor: '5', frase: 'hotel todo incluido' } })];
    await llega('el de Cartagena', { enviado: 45 });
    expect(textos().at(-1)).toBe('Anoto en CARTAGENA ENE · Gloria Arbeláez (G 26 1): «prefieren hotel todo incluido».');
    expect(t.wa_bandeja_mensajes.filter(m => m.cuerpo === 'prefieren hotel todo incluido')).toHaveLength(1);
    expect(datosDel('n-ga')).not.toHaveProperty('categoria_hotel');
    await toca(enviados.at(-1)!.botones![0], { enviado: 50 });
    // Con el toque se carga en CARTAGENA (la guarda de la frase decide qué valor entra; aquí, ninguno nuevo).
    expect(textos().at(-1)).toMatch(/^(?:Cargué en|No encontré datos nuevos para) CARTAGENA ENE · Gloria Arbeláez \(G 26 1\)/);
    expect(t.wa_bandeja_entendimientos.some(e => e.negocio_id === 'n-ga' && String(e.estado).startsWith('negocio_actualizado'))).toBe(true);
  });

  it('una consulta durante una carga en vuelo espera y lo dice; un escrito que repite la respuesta no abre tanda', async () => {
    viajeDeFermin();
    // Una carga del mismo remitente en vuelo (un entendimiento procesando para F 26 1).
    t.wa_bandeja_entendimientos.push({ id: 'e-vuelo', workspace_id: WS, entrega_id: 'x', segmento: 1, remitente_phone: TEL, estado: 'procesando', negocio_destino_id: 'n-fo', updated_at: new Date(T0).toISOString() });
    bandeja.esperaDeCarga.ms = 0;
    bandeja.esperaDeCarga.dormir = async () => { t.wa_bandeja_entendimientos.find(e => e.id === 'e-vuelo')!.estado = 'negocio_actualizado'; };
    vi.setSystemTime(new Date(T0));
    await llega('el de San Andrés', { enviado: 0, llega: 1 });
    expect(textos().at(-1)).toBe(bandeja.TEXTO_EN_VUELO);
    expect(t.wa_bandeja_entregas).toEqual([]);
    await llega('qué le falta al de San Andrés?', { enviado: 2, llega: 3 });
    expect(textos().slice(-2)).toEqual(['Lo estoy cargando; te digo en un momento.', expect.stringMatching(/^SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\) — /)]);
  });

  it('la frontera: tras la carga, «nuevo Lucía Prueba» abre su viaje (no es un dato de Fermín); un reenvío del cliente va a la tanda', async () => {
    viajeDeFermin();
    await cargaDeFermin();
    await llega(nuevo('Lucía Prueba'), { enviado: 30 });
    expect(textos().at(-1)).toBe(acuse('Lucía Prueba'));
    await llega('listo', { enviado: 35 });
    await llega('sí', { enviado: 36 });
    // Un reenvío del cliente con las respuestas: es la voz del cliente y puede ser otro pedido; va a la tanda (el resumen
    // dice a qué viaje), nunca directo al viaje en foco.
    await llega('salimos de Pereira, el niño tiene 6', { enviado: 60, reenviado: true });
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toHaveLength(1);
  });

  it('la respuesta a lo que falta en dos mensajes: cada uno va al viaje en foco', async () => {
    viajeDeFermin();
    await cargaDeFermin();
    colaModelo = [salidaModelo({ ciudad_origen: { valor: 'Medellín', frase: 'salen de Medellín' } })];
    await llega('salen de Medellín', { enviado: 30 });
    colaModelo = [salidaModelo({ edades_menores: { valor: '8', frase: 'el niño tiene 8 años' } })];
    const primero = enviados.at(-1)!;
    await llega('el niño tiene 8 años', { enviado: 40 });
    // El segundo se agrega al mismo resumen corto, que se vuelve a mostrar con los dos (y botones nuevos).
    expect(textos().at(-1)).toBe('Anoto en SAN ANDRÉS DIC · Fermín Ocampo (F 26 1): «salen de Medellín» y «el niño tiene 8 años».');
    expect(enviados.at(-1)!.botones![0].id).not.toBe(primero.botones![0].id);
    expect(t.wa_bandeja_entregas.filter(e => e.motivo_cierre === 'respuesta_a_lo_que_falta')).toHaveLength(1);
    expect(datosDel('n-fo')).not.toHaveProperty('ciudad_origen');
    // El botón del primer resumen ya no sirve; el del segundo carga los dos.
    await toca(primero.botones![0], { enviado: 45 });
    expect(datosDel('n-fo')).not.toHaveProperty('ciudad_origen');
    colaModelo = [salidaModelo({ ciudad_origen: { valor: 'Medellín', frase: 'salen de Medellín' }, edades_menores: { valor: '8', frase: 'el niño tiene 8 años' } })];
    await toca(enviados.filter(e => e.botones?.length).at(-1)!.botones![0], { enviado: 50 });
    expect(datosDel('n-fo')).toMatchObject({ ciudad_origen: 'MEDELLÍN', edades_menores: '8' });
  });

  it('las listas numeradas aceptan el número: «¿De qué viaje es el mensaje?» al cerrar la tanda y la del encabezado aproximado', async () => {
    viajeDeFermin();
    await cargaDeFermin();
    expect(datosDel('n-fo')).toMatchObject({ adultos: 2 });
    await llega('Ocampo', { enviado: 30 });
    expect(textos().at(-1)).toMatch(/^¿De qué viaje es «Ocampo»\?/);
    await llega('1', { enviado: 31 });
    expect(textos().at(-1)).toBe('📌 SAN ANDRÉS DIC · Fermín Ocampo (F 26 1)');
  });
});

describe('2026-10-05 · el resumen con botones «Cargar» y «Descartar», de punta a punta (textos inventados)', () => {
  function viajeDe(id: string, codigo: string, nombre: string, cliente: string, destino: string) {
    t.contactos.push({ id: `c-${id}`, workspace_id: WS, nombre: cliente, telefono: celDe(cliente), email: null, created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba(id, codigo, nombre, cliente), contacto_id: `c-${id}` });
    t.negocio_bloques.push({ id: `b-${id}`, negocio_id: id, data: { destino }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
  }
  const fermin = () => viajeDe('n-fo', 'F 26 1', 'SAN ANDRÉS DIC', 'FERMÍN OCAMPO', 'SAN ANDRÉS');
  const gloria = () => viajeDe('n-ga', 'G 26 1', 'CARTAGENA ENE', 'GLORIA ARBELÁEZ', 'CARTAGENA');
  const datosDel = (id: string) => t.negocio_bloques.find(b => b.negocio_id === id)!.data as Fila;
  const CARGA = salidaModelo({ destino: { valor: 'San Andrés', frase: 'San Andrés' }, adultos: { valor: '2', frase: '2 adultos' } });
  const TITULOS = (bs: Array<{ title: string }>) => bs.map(b => b.title);
  /** La tanda de Fermín por su código, dos mensajes del cliente y el «listo»: el resumen con sus botones. */
  async function tandaDeFermin(interprete?: { llamadas: { n: number } }, desde = 0) {
    await llega('F 26 1', { enviado: desde, interprete });
    await llega('quieren ir a San Andrés en diciembre', { enviado: desde + 2, reenviado: true });
    await llega('son 2 adultos', { enviado: desde + 3, reenviado: true });
    await llega('listo', { enviado: desde + 5, interprete });
  }
  beforeEach(() => { bandeja.procesarEnElActo.activo = true; });

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`interruptor ${modo}: «Cargar» carga como el «sí» escrito, sin el modelo del intérprete, y deja el viaje en foco; el toque repetido no carga dos veces`, async () => {
      fermin();
      const llamadas = { n: 0 };
      const interprete = modo === 'prendido' ? { llamadas } : undefined;
      await tandaDeFermin(interprete);
      const resumen = enviados.at(-1)!;
      expect(resumen.texto).toBe('¿Cargo este viaje?\n\n*SAN ANDRÉS DIC · Fermín Ocampo (F 26 1)*\n\n1. «quieren ir a San Andrés en diciembre»\n2. «son 2 adultos»\n\nPara mover o quitar uno, escríbeme: «el 2 es de Luisa» o «quita el 2».');
      expect(TITULOS(resumen.botones!)).toEqual(['✅ Cargar', '🗑 Descartar']);
      const n0 = llamadas.n;
      colaModelo = [CARGA];
      const antes = textos().length;
      await toca(boton('✅ Cargar'), { enviado: 10, interprete });
      // En el acto, sin `cron`: el acuse del «sí» y la carga.
      expect(textos().slice(antes)).toEqual([
        'Listo, lo cargo. Te aviso en cuanto quede.',
        expect.stringMatching(/^Cargué en SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\): [\s\S]*me falta:/),
      ]);
      expect(datosDel('n-fo')).toMatchObject({ adultos: 2 });
      expect(llamadas.n).toBe(n0); // el toque no pasa por el modelo
      // Convive con la memoria: el viaje queda en foco igual que con el «sí» escrito, y el dato que pide «me falta» va directo.
      expect((t.wa_bandeja_conversacion[0].focos as Array<{ negocio_id: string; por: string }>)[0]).toMatchObject({ negocio_id: 'n-fo', por: 'carga' });
      colaModelo = [salidaModelo({ ciudad_origen: { valor: 'Medellín', frase: 'salen de Medellín' } })];
      await llega('salen de Medellín', { enviado: 30, interprete });
      expect(textos().at(-1)).toBe('Anoto en SAN ANDRÉS DIC · Fermín Ocampo (F 26 1): «salen de Medellín».');
      expect(datosDel('n-fo')).not.toHaveProperty('ciudad_origen');
      await toca(boton('✅ Cargar'), { enviado: 32, interprete });
      expect(datosDel('n-fo')).toMatchObject({ ciudad_origen: 'MEDELLÍN' });
      // El mismo «Cargar» otra vez (un doble toque, o uno tardío): la tanda ya se cerró y no se carga dos veces.
      const ents = t.wa_bandeja_entendimientos.length;
      await toca(resumen.botones![0], { enviado: 40, interprete });
      expect(textos().at(-1)).toBe('Esa tanda ya se cerró: no cargué ni descarté nada.');
      expect(t.wa_bandeja_entendimientos.length).toBe(ents);
    });
  }

  it('«¿Seguro que van en …?» trae «Sí, cargarlos» y «Descartar»; el toque carga sin volver a llamar al modelo', async () => {
    fermin();
    await llega('F 26 1', { enviado: 0 });
    await llega('Confirmamos Punta Cana, salimos de Bogotá', { enviado: 2, reenviado: true });
    await llega('listo', { enviado: 5 });
    colaModelo = [salidaModelo({ destino: { valor: 'Punta Cana', frase: 'Confirmamos Punta Cana' }, ciudad_origen: { valor: 'Bogotá', frase: 'salimos de Bogotá' } })];
    await toca(boton('✅ Cargar'), { enviado: 8 });
    expect(textos().at(-1)).toMatch(/¿Seguro que (?:estos mensajes van|este mensaje va) en SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\)\?/);
    expect(TITULOS(ultimosBotones())).toEqual(['✅ Sí, cargarlos', '🗑 Descartar']);
    expect(datosDel('n-fo')).toEqual({ destino: 'SAN ANDRÉS' });
    const llamadas = vi.mocked(fetch).mock.calls.length;
    await toca(boton('✅ Sí, cargarlos'), { enviado: 12 });
    expect(datosDel('n-fo')).toMatchObject({ ciudad_origen: 'BOGOTÁ' });
    expect(vi.mocked(fetch).mock.calls.length).toBe(llamadas);
  });

  it('«Descartar» no carga nada', async () => {
    fermin();
    await tandaDeFermin();
    await toca(boton('🗑 Descartar'), { enviado: 10 });
    expect(textos().at(-1)).toMatch(/^Listo: descarté/);
    expect(datosDel('n-fo')).toEqual({ destino: 'SAN ANDRÉS' });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('el toque viejo tras una corrección no confirma nada: lo dice y vuelve a mostrar el resumen vigente con sus botones nuevos', async () => {
    fermin();
    await tandaDeFermin();
    const viejo = boton('✅ Cargar');
    await llega('quita el 1', { enviado: 8 });
    expect(textos().at(-1)).toMatch(/^Corregido\. Así queda: ¿Cargo este viaje\?/);
    const nuevoCargar = boton('✅ Cargar');
    expect(nuevoCargar.id).not.toBe(viejo.id);
    await toca(viejo, { enviado: 10 });
    expect(textos().at(-1)).toMatch(/^Ese botón es de un resumen anterior: no cargué ni descarté nada\. Este es el resumen vigente:\n¿Cargo este viaje\?\n\n\*SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\)\*\n\n\d\. «son 2 adultos»\n\nDescartados: 1/);
    expect(TITULOS(ultimosBotones())).toEqual(['✅ Cargar', '🗑 Descartar']);
    expect(ultimosBotones()[0].id).toBe(nuevoCargar.id);
    expect(datosDel('n-fo')).toEqual({ destino: 'SAN ANDRÉS' });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    // El vigente sí carga.
    colaModelo = [CARGA];
    await toca(boton('✅ Cargar'), { enviado: 15 });
    expect(datosDel('n-fo')).toMatchObject({ adultos: 2 });
  });

  it('el toque de otra tanda (ya contestada) no carga la que está abierta: lo dice y muestra el resumen vigente', async () => {
    fermin();
    gloria();
    await tandaDeFermin();
    const deFermin = boton('✅ Cargar');
    colaModelo = [CARGA];
    await llega('sí', { enviado: 8 });
    expect(datosDel('n-fo')).toMatchObject({ adultos: 2 });
    await llega('G 26 1', { enviado: 20 });
    await llega('vamos 3 a Cartagena en enero', { enviado: 22, reenviado: true });
    await llega('listo', { enviado: 25 });
    expect(textos().at(-1)).toMatch(/^¿Cargo este viaje\?\n\n\*CARTAGENA ENE · Gloria Arbeláez \(G 26 1\)\*/);
    const deGloria = boton('✅ Cargar');
    await toca(deFermin, { enviado: 30 });
    expect(textos().at(-1)).toMatch(/^Esa tanda ya se cerró: no cargué ni descarté nada\. Este es el resumen vigente:\n¿Cargo este viaje\?\n\n\*CARTAGENA ENE · Gloria Arbeláez \(G 26 1\)\*/);
    expect(ultimosBotones()[0].id).toBe(deGloria.id);
    expect(datosDel('n-ga')).toEqual({ destino: 'CARTAGENA' });
  });

  it('el «sí» escrito sigue valiendo igual: con reserva no carga; sin reserva, sí', async () => {
    fermin();
    await tandaDeFermin();
    // Bot híbrido: el «sí» con reserva lo lee el modelo del punto de decisión («no sé»): no carga y vuelve a preguntar
    // en el acto, en corto, con los botones del resumen vigente.
    decide('sí, pero espera que me confirme las fechas', { tipo: 'no_se' });
    await llega('sí, pero espera que me confirme las fechas', { enviado: 8 });
    expect(datosDel('n-fo')).toEqual({ destino: 'SAN ANDRÉS' });
    expect(textos().at(-1)).toBe('No me quedó claro. SAN ANDRÉS DIC · Fermín Ocampo (F 26 1) · ¿Lo cargo así?');
    expect(TITULOS(enviados.at(-1)!.botones!)).toEqual(['✅ Cargar', '🗑 Descartar']);
    colaModelo = [CARGA];
    await llega('sí', { enviado: 12 });
    expect(datosDel('n-fo')).toMatchObject({ adultos: 2 });
  });

  it('con algo por decidir (⚠) no hay «Cargar»: solo la pregunta y «Descartar»; decidido, el resumen nuevo trae los dos', async () => {
    fermin();
    await llega('F 26 1', { enviado: 0 });
    await llega('son 2 adultos', { enviado: 2, reenviado: true });
    await llega('Hola Tati, buenas tardes', { enviado: 3, reenviado: true });
    await llega('del 10 al 15 de diciembre', { enviado: 4, reenviado: true });
    await llega('listo', { enviado: 6 });
    expect(textos().at(-1)).toMatch(/^¿Qué hago con los 2-3 \(⚠\)\?\n/);
    expect(TITULOS(ultimosBotones())).toEqual(['🗑 Descartar']);
    await llega('dejar todos', { enviado: 9 });
    expect(textos().at(-1)).toMatch(/¿Cargo este viaje\?/);
    expect(TITULOS(ultimosBotones())).toEqual(['✅ Cargar', '🗑 Descartar']);
  });

  it('un resumen de más de 1024 caracteres va entero como texto y los botones en un mensaje corto aparte; «Cargar» carga', async () => {
    fermin();
    await llega('F 26 1', { enviado: 0 });
    await llega('son 2 adultos', { enviado: 1, reenviado: true });
    for (let i = 2; i <= 24; i++) await llega(`mensaje número ${i} del cliente sobre el viaje a San Andrés`, { enviado: i, reenviado: true });
    await llega('listo', { enviado: 30 });
    const [texto, cortos] = enviados.slice(-2);
    expect(texto.botones).toBeUndefined();
    expect(texto.texto.length).toBeGreaterThan(1024);
    expect(texto.texto).toMatch(/^¿Cargo este viaje\?/);
    expect(texto.texto).toContain('24. «mensaje número 24 del cliente');
    expect(texto.texto).toMatch(/Para mover o quitar uno, escríbeme: «el 24 es de Luisa» o «quita el 24»\.$/);
    expect(cortos).toMatchObject({ texto: '¿Lo cargo?' });
    expect(TITULOS(cortos.botones!)).toEqual(['✅ Cargar', '🗑 Descartar']);
    colaModelo = [CARGA];
    await toca(boton('✅ Cargar'), { enviado: 40 });
    expect(datosDel('n-fo')).toMatchObject({ adultos: 2 });
  });
});

describe('2026-10-05 · el modelo redacta, de punta a punta (`bot_conversacional.redaccion`; textos inventados)', () => {
  function fermin() {
    t.contactos.push({ id: 'c-fo', workspace_id: WS, nombre: 'FERMÍN OCAMPO', telefono: '3006661122', email: null, created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba('n-fo', 'F 26 1', 'SAN ANDRÉS DIC', 'FERMÍN OCAMPO'), contacto_id: 'c-fo' });
    t.negocio_bloques.push({ id: 'b-n-fo', negocio_id: 'n-fo', data: { destino: 'SAN ANDRÉS' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
  }
  const CARGA = salidaModelo({ destino: { valor: 'San Andrés', frase: 'San Andrés' }, adultos: { valor: '2', frase: '2 adultos' } });
  const datosDel = (id: string) => t.negocio_bloques.find(b => b.negocio_id === id)!.data as Fila;
  /** Lo que el modelo de redacción recibió (el texto fijo y la entrada completa) y cómo responde. */
  const vistos: Array<{ fijo: string; usuario: string }> = [];
  let responde: 'natural' | 'trampa' | 'falla' = 'natural';
  let original: typeof redaccion.redaccionDeps.llamarModelo;
  let redaccion: typeof import('./wa-redaccion.ts');
  beforeEach(async () => {
    redaccion = await import('./wa-redaccion.ts');
    original = redaccion.redaccionDeps.llamarModelo;
    bandeja.procesarEnElActo.activo = true;
    vistos.length = 0;
    responde = 'natural';
    redaccion.redaccionDeps.llamarModelo = async (p) => {
      const fijo = /TEXTO FIJO:\n<<<\n([\s\S]*?)\n>>>/.exec(p.usuario)![1];
      vistos.push({ fijo, usuario: p.usuario });
      if (responde === 'falla') return { ok: false, motivo: 'timeout', ms: 3000 };
      // «natural»: una redacción válida (una palabra común delante). «trampa»: datos que solo están en los turnos o en ningún lado.
      const texto = responde === 'natural' ? `Mira: ${fijo}` : `${fijo}\nYa quedó cargado para Juan Pérez, 5 estrellas, el 20 de enero.`;
      return { ok: true, json: { texto }, ms: 5, tokensIn: 1, tokensOut: 1, tokensRazonamiento: 0 };
    };
  });
  afterEach(() => { redaccion.redaccionDeps.llamarModelo = original; });
  const prender = () => { (t.workspaces[0].config_extra as Fila).bot_conversacional = { redaccion: true, hibrido: true }; };

  /** La tanda de Fermín, el resumen, «Cargar» y la pregunta por lo que falta. */
  async function secuencia(interprete?: { llamadas: { n: number } }) {
    await llega('F 26 1', { enviado: 0, interprete });
    await llega('el cliente dijo que quiere 5 estrellas, se llama Juan Pérez', { enviado: 1, interprete: undefined });
    await llega('quieren ir a San Andrés, son 2 adultos', { enviado: 2, reenviado: true });
    await llega('listo', { enviado: 5, interprete });
    const resumen = enviados.at(-1)!;
    colaModelo = [CARGA];
    await toca(boton('✅ Cargar'), { enviado: 10, interprete });
    const tras = textos().slice(-2);
    await llega('qué le falta para cotizar?', { enviado: 30, interprete });
    return { resumen, tras, consulta: textos().at(-1)! };
  }

  it('apagado (por defecto): el modelo de redacción no se llama y salen los textos fijos', async () => {
    fermin();
    const r = await secuencia();
    expect(vistos).toEqual([]);
    expect(r.resumen.texto).toMatch(/^¿Cargo este viaje\?/);
    expect(r.tras[0]).toBe('Listo, lo cargo. Te aviso en cuanto quede.');
    expect(r.tras[1]).toMatch(/^Cargué en SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\)/);
  });

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`prendido, intérprete ${modo}: el modelo redacta el resumen (los botones quedan fijos), la carga y la consulta; los acuses no pasan por él`, async () => {
      fermin();
      prender();
      const r = await secuencia(modo === 'prendido' ? { llamadas: { n: 0 } } : undefined);
      expect(r.resumen.texto).toMatch(/^Mira: ¿Cargo este viaje\?\n\n\*SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\)\*/);
      expect(r.resumen.botones!.map(b => b.title)).toEqual(['✅ Cargar', '🗑 Descartar']);
      expect(r.tras[0]).toBe('Listo, lo cargo. Te aviso en cuanto quede.');
      expect(r.tras[1]).toMatch(/^Mira: Cargué en SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\)/);
      expect(r.consulta).toMatch(/^Mira: SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\) — Mínimo/);
      expect(datosDel('n-fo')).toMatchObject({ adultos: 2 });
      // Los turnos: lo que escribió el comercial y lo que dijo el bot, nunca el reenvío del cliente.
      const ultimo = vistos.at(-1)!.usuario;
      expect(ultimo).toContain('- comercial: el cliente dijo que quiere 5 estrellas, se llama Juan Pérez');
      expect(ultimo).not.toContain('quieren ir a San Andrés, son 2 adultos');
    });
  }

  it('hechos trampa: el modelo mete datos de los turnos y de ningún lado; la validación los rechaza y salen los fijos (0 datos inventados)', async () => {
    fermin();
    prender();
    responde = 'trampa';
    const r = await secuencia();
    expect(vistos.length).toBeGreaterThanOrEqual(3);
    expect(textos().filter(x => /Juan Pérez|20 de enero|quedó cargado/.test(x) && !x.startsWith('el cliente'))).toEqual([]);
    expect(r.resumen.texto).toMatch(/^¿Cargo este viaje\?/);
    expect(r.tras[1]).toMatch(/^Cargué en SAN ANDRÉS DIC/);
    expect(r.consulta).toMatch(/^SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\) — Mínimo/);
  });

  it('el modelo falla (timeout): salen los fijos, nunca silencio', async () => {
    fermin();
    prender();
    responde = 'falla';
    const r = await secuencia();
    expect(vistos.length).toBeGreaterThanOrEqual(3);
    expect(r.resumen.texto).toMatch(/^¿Cargo este viaje\?/);
    expect(r.tras[1]).toMatch(/^Cargué en SAN ANDRÉS DIC/);
    expect(r.consulta).toMatch(/^SAN ANDRÉS DIC · Fermín Ocampo \(F 26 1\) — Mínimo/);
  });
});

describe('décimo control de Vera (2026-10-05): la carga directa en el viaje en foco solo con el dato pedido y sin otro cliente ni otro viaje, de punta a punta', () => {
  function viajeDe(id: string, codigo: string, nombre: string, cliente: string, destino: string) {
    t.contactos.push({ id: `c-${id}`, workspace_id: WS, nombre: cliente, telefono: celDe(cliente), email: null, created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba(id, codigo, nombre, cliente), contacto_id: `c-${id}` });
    t.negocio_bloques.push({ id: `b-${id}`, negocio_id: id, data: { destino }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
  }
  const datosDel = (id: string) => t.negocio_bloques.find(b => b.negocio_id === id)!.data as Fila;
  /** Isidro Ballesteros va a Leticia (el viaje en foco); Teodora Quiceno tiene otro viaje abierto, a Pasto. */
  async function focoDeIsidro(interprete?: { modelo?: unknown }) {
    viajeDe('n-ib', 'I 26 1', 'LETICIA MAR', 'ISIDRO BALLESTEROS', 'LETICIA');
    viajeDe('n-tq', 'T 26 4', 'PASTO ABR', 'TEODORA QUICENO', 'PASTO');
    await llega('I 26 1', { enviado: 0, interprete });
    await llega('van a Leticia en marzo, son 2 adultos', { enviado: 2, reenviado: true });
    await llega('listo', { enviado: 4, interprete });
    colaModelo = [salidaModelo({ destino: { valor: 'Leticia', frase: 'van a Leticia' }, adultos: { valor: '2', frase: '2 adultos' } })];
    await llega('sí', { enviado: 6, interprete });
    expect(textos().at(-1)).toMatch(/^Cargué en LETICIA MAR · Isidro Ballesteros \(I 26 1\)[\s\S]*me falta:/);
  }
  beforeEach(() => { bandeja.procesarEnElActo.activo = true; });

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`interruptor ${modo}: lo de otro cliente o de otro viaje, una pregunta sin signo o una orden NO se cargan en el viaje en foco; el dato pedido sí`, async () => {
      const contenido = (texto: string) => (modo === 'prendido' ? { modelo: { acciones: [{ accion: 'contenido', evidencia: texto }] } } : undefined);
      await focoDeIsidro(modo === 'prendido' ? {} : undefined);
      const antes = JSON.stringify(datosDel('n-ib'));
      const ents = t.wa_bandeja_entendimientos.length;
      for (const [i, texto] of [
        'la señora Teodora sale desde Ipiales',            // otro cliente del directorio, por el nombre de pila
        'los de Pasto viajan con 3 niños',                 // el destino de otro viaje abierto
        'T 26 4: salen el 20 de abril',                    // el código de otro viaje
        'cuándo fue que dijeron que salían',               // pregunta sin signo
        'bórrale la fecha de salida',                      // una orden
        'no, eso de los niños era para el de Pasto',       // una corrección
      ].entries()) {
        await llega(texto, { enviado: 20 + i * 3, interprete: contenido(texto) });
        // Nunca silencio: con o sin el intérprete, dice algo.
        expect(textos().at(-1)).not.toMatch(/^Anoto en LETICIA MAR/);
        await llega('descartar', { enviado: 21 + i * 3 });
      }
      expect(JSON.stringify(datosDel('n-ib'))).toBe(antes);
      expect(t.wa_bandeja_entendimientos.filter(e => e.negocio_destino_id === 'n-ib' || e.negocio_id === 'n-ib').length).toBe(1);
      expect(t.wa_bandeja_entendimientos.length).toBe(ents);
      // El dato que se pidió, sin nombrar a nadie más: el resumen corto con «Cargar» (2026-10-06); carga con el «sí».
      colaModelo = [salidaModelo({ ciudad_origen: { valor: 'Bogotá', frase: 'salen desde Bogotá' } })];
      await llega('salen desde Bogotá', { enviado: 60, interprete: contenido('salen desde Bogotá') });
      expect(textos().at(-1)).toBe('Anoto en LETICIA MAR · Isidro Ballesteros (I 26 1): «salen desde Bogotá».');
      expect(datosDel('n-ib')).not.toHaveProperty('ciudad_origen');
      await llega('sí', { enviado: 62 });
      expect(datosDel('n-ib')).toMatchObject({ ciudad_origen: 'BOGOTÁ' });
    });
  }

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`interruptor ${modo}: con el foco abierto, NINGÚN escrito carga en el viaje sin el toque o el «sí» al resumen corto; el «sí» y el toque sí cargan (2026-10-06)`, async () => {
      const contenido = (texto: string) => (modo === 'prendido' ? { modelo: { acciones: [{ accion: 'contenido', evidencia: texto }] } } : undefined);
      await focoDeIsidro(modo === 'prendido' ? {} : undefined);
      const antes = JSON.stringify(datosDel('n-ib'));
      const cargas = () => t.wa_bandeja_entendimientos.filter(e => e.negocio_id === 'n-ib' && String(e.estado).startsWith('negocio_actualizado')).length;
      const c0 = cargas();
      // Lo que antes podía ir directo y no debía: un apodo, un deíctico, alguien que el directorio no tiene, una pregunta
      // indirecta. Ahora, como mucho, sale el resumen corto: nada se carga.
      for (const [i, texto] of [
        'la Mona sale de Pereira con los 2 niños',
        'la otra señora prefiere hotel 5 estrellas',
        'Gerardina Pulido también va, saldría de Neiva',
        'me averiguas si salen desde Cali o desde Buga',
        'salen desde Bogotá',
      ].entries()) {
        await llega(texto, { enviado: 20 + i * 4, interprete: contenido(texto) });
        expect(JSON.stringify(datosDel('n-ib'))).toBe(antes);
        expect(cargas()).toBe(c0);
        // Acuses, un «sí» con reserva o una pregunta tampoco cargan el resumen corto.
        for (const r of ['ok', 'sí, pero espera que confirme', '¿lo cargo?']) {
          await llega(r, { enviado: 21 + i * 4 });
          expect(cargas()).toBe(c0);
        }
        await llega('descartar', { enviado: 23 + i * 4 });
      }
      expect(JSON.stringify(datosDel('n-ib'))).toBe(antes);
      // El «sí» al resumen corto carga.
      colaModelo = [salidaModelo({ ciudad_origen: { valor: 'Bogotá', frase: 'salen desde Bogotá' } })];
      await llega('salen desde Bogotá', { enviado: 60, interprete: contenido('salen desde Bogotá') });
      const resumenCorto = enviados.at(-1)!;
      expect(resumenCorto.texto).toBe('Anoto en LETICIA MAR · Isidro Ballesteros (I 26 1): «salen desde Bogotá».');
      await llega('sí', { enviado: 62 });
      expect(datosDel('n-ib')).toMatchObject({ ciudad_origen: 'BOGOTÁ' });
      expect(cargas()).toBe(c0 + 1);
      // El toque del mismo resumen ya cargado no carga otra vez.
      await toca(resumenCorto.botones![0], { enviado: 64 });
      expect(cargas()).toBe(c0 + 1);
      // Y el toque de un resumen corto nuevo, sí.
      colaModelo = [salidaModelo({ categoria_hotel: { valor: '4', frase: 'hotel 4 estrellas' } })];
      await llega('quieren hotel 4 estrellas', { enviado: 70, interprete: contenido('quieren hotel 4 estrellas') });
      await toca(boton('✅ Cargar'), { enviado: 72 });
      expect(datosDel('n-ib')).toMatchObject({ categoria_hotel: '4' });
      expect(cargas()).toBe(c0 + 2);
    });
  }

  it.each([
    'ponlo a nombre de la señora Leonor Pardo', 'anótalo para doña Leonor Pardo', 'cárgaselo a Leonor Pardo', 'es para mi clienta Leonor Pardo',
    'créalo con Leonor Pardo', 'ese viaje es de la señora Leonor Pardo', 'apúntalo a Leonor Pardo por favor',
  ])('interruptor apagado: tras «¿Para qué cliente es?», «%s» lee el nombre con el verbo o la fórmula delante: es la que ya tenemos (regla 8)', async (respuesta) => {
    t.contactos.push({ id: 'c-lp', workspace_id: WS, nombre: 'LEONOR PARDO', telefono: '3001239876', email: null, created_at: '2026-01-10T10:00:00Z' });
    await llega('vamos a montar un viaje nuevo', { enviado: 0 });
    expect(textos().at(-1)).toBe('Listo, un viaje nuevo. ¿Para qué cliente es?');
    decide(respuesta, { tipo: 'nombre', nombre: 'Leonor Pardo' });
    await llega(respuesta, { enviado: 3 });
    await llega('quieren ir a Guatapé un fin de semana', { enviado: 5, reenviado: true });
    await llega('listo', { enviado: 8 });
    expect(textos().at(-1)).toContain('*Viaje nuevo · Leonor Pardo*\nYa es cliente · cel. …9876');
  });

  it('interruptor prendido: un escrito que el validador registra como contenido y abre una tanda sin cliente dice qué espera (nunca silencio)', async () => {
    const texto = 'son dos parejas y quieren algo con playa';
    const n0 = textos().length;
    await llega(texto, { enviado: 0, interprete: { modelo: { acciones: [{ accion: 'contenido', evidencia: texto }] } } });
    expect(t.wa_bandeja_entregas.filter(e => e.estado === 'abierta')).toHaveLength(1);
    expect(textos().slice(n0)).toEqual([TANDA_SIN_CLIENTE]);
  });
});

// ── Bot híbrido (brief del 2026-10-06): cada punto de decisión, de punta a punta ─────────────────────────
// En cada pregunta que espera que el comercial elija, con el interruptor apagado y prendido: el toque vigente y uno
// viejo; un número dentro y fuera de la lista; el código exacto; y el texto libre con el modelo falso devolviendo un id
// válido, un id inventado, «no sé», «contenido», «pregunta» y timeout. Nombres, celulares y viajes inventados.

describe('bot híbrido (2026-10-06): cada punto de decisión, de punta a punta', () => {
  type Caso = 'toque' | 'toque_viejo' | 'numero' | 'numero_fuera' | 'codigo' | 'id_valido' | 'id_inventado' | 'no_se' | 'contenido' | 'pregunta' | 'timeout';
  interface Punto {
    /** Deja la pregunta vigente. */
    montar: () => Promise<void>;
    /** El botón o la fila que elige (sin destruir nada). */
    toque?: string;
    /** Lo que el código lee exacto: el número de la lista, el código de un viaje (o la llave sola). */
    numero?: string;
    codigo?: string;
    /** Lo que el modelo devuelve para elegir una opción con un escrito libre. */
    idValido: unknown;
    /**
     * La opción que elige el modelo escribe en un viaje (cargar, mandar los mensajes a un viaje): leída de un escrito
     * libre no se aplica, se pide el toque (2026-10-06, SR3 «👌»).
     */
    escribe?: boolean;
    /** Elegir ese viaje con palabras no carga: el bot lo propone con [Sí, ese] y la lista; el «sí» solo lo carga. */
    propone?: boolean;
    /** ¿Se aplicó la elección? */
    elegido: () => Promise<boolean> | boolean;
  }
  const cfg = async () => (await import('./wa-bandeja-reglas.ts')).leerConfigBandeja(t.workspaces[0].config_extra);
  const vigente = async () => decision.puntoDeDecision(db as never, WS, TEL, await cfg());
  const LIBRE = 'esto lo escribe el comercial con sus palabras';
  beforeEach(() => { bandeja.procesarEnElActo.activo = true; });

  const PUNTOS: Record<string, Punto> = {
    '«¿A qué viaje van?» (lista de viajes)': {
      montar: preguntaDeViaje,
      toque: '1. SAN ANDRÉS DIC', numero: '1', codigo: 'P 26 2', idValido: { tipo: 'opcion', opcion: 'v1' }, escribe: true, propone: true,
      elegido: () => t.wa_bandeja_entregas.some(e => e.estado === 'con_cliente') || t.wa_bandeja_entendimientos.some(e => e.negocio_destino_id === 'n-p'),
    },
    'el resumen (Cargar / Descartar)': {
      montar: async () => {
        t.contactos.push({ id: 'c-fo', workspace_id: WS, nombre: 'FERMÍN OCAMPO', telefono: '3006661122', email: null, created_at: '2026-01-10T10:00:00Z' });
        t.negocios.push({ ...negocioDePrueba('n-fo', 'F 26 1', 'SAN ANDRÉS DIC', 'FERMÍN OCAMPO'), contacto_id: 'c-fo' });
        t.negocio_bloques.push({ id: 'b-n-fo', negocio_id: 'n-fo', data: { destino: 'SAN ANDRÉS' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
        await llega('F 26 1', { enviado: 0 });
        await llega('quieren ir a San Andrés en diciembre', { enviado: 2, reenviado: true });
        await llega('listo', { enviado: 4 });
        colaModelo = [salidaModelo({ destino: { valor: 'San Andrés', frase: 'San Andrés' } })];
      },
      toque: '✅ Cargar', idValido: { tipo: 'opcion', opcion: 'si' }, escribe: true,
      elegido: () => t.wa_bandeja_entregas.some(e => e.cliente_texto === 'sí'),
    },
    '«¿Creo el cliente nuevo «X»?» ([Crear] [No es nuevo] [Descartar])': {
      montar: async () => {
        await preguntaDeViaje();
        elige(nuevo('Gabriela Ossa'), 'nuevo', 'Gabriela Ossa');
        await llega(nuevo('Gabriela Ossa'), { enviado: 9 });
        colaModelo = [pedido()];
      },
      toque: 'No es nuevo', numero: '1', codigo: 'P 26 2', idValido: { tipo: 'opcion', opcion: 'no_nuevo' },
      elegido: async () => !(await ent.preguntaAbierta(db as never, WS, TEL))?.nuevoPorConfirmar,
    },
    '«¿Para qué cliente es?» del contacto (el nombre, o «Descartar»)': {
      montar: async () => {
        await preguntaDeViaje();
        // «Viaje nuevo» a secas abre un viaje: con el toque (escrito, el modelo lo leería y pediría el toque).
        colaModelo = [pedido()];
        await toca(boton('Viaje nuevo'), { enviado: 9 });
      },
      idValido: { tipo: 'nombre', nombre: 'Gabriela Ossa' },
      // Con el nombre, la pregunta pasa a ser la de su llave (ya no espera el nombre).
      elegido: async () => (await ent.preguntaAbierta(db as never, WS, TEL))?.espera === 'otra',
    },
    '«¿De qué viaje es …?» de la caja abierta (lista del encabezado)': {
      montar: async () => {
        t.negocios.push({ ...negocioDePrueba('n5', 'M1 26 5', 'Europa 2 días', 'CAROLINA RUIZ') });
        await llega('Europa 2 dia', { enviado: 0 });
      },
      toque: '1. Europa 2 días', numero: '1', codigo: 'M1 26 5', idValido: { tipo: 'opcion', opcion: 'e1' },
      elegido: () => textos().some(x => x === '📌 Europa 2 días · Carolina Ruiz (M1 26 5)'),
    },
    '«¿Es la misma persona?» de la caja (botones de #1034)': {
      montar: async () => {
        t.contactos.push({ id: 'c-par', workspace_id: WS, nombre: 'PAOLA ANDREA RINCÓN DÍAZ', telefono: '3005551234', email: null, created_at: '2026-01-10T10:00:00Z' });
        await llega('nueva clienta Paola Rincón 300 555 1234', { enviado: 0 });
      },
      toque: '✅ Sí, es la misma', idValido: { tipo: 'opcion', opcion: 'si' },
      elegido: () => textos().some(x => x.startsWith('Va como viaje nuevo de Paola Andrea Rincón Díaz, el que ya tenemos')),
    },
    '«¿Cuál es?» de la caja (lista de las fichas)': {
      montar: async () => {
        t.contactos.push(
          { id: 'c-ag1', workspace_id: WS, nombre: 'ANDRÉS GÓMEZ', telefono: '3014454410', email: null, created_at: '2026-01-10T10:00:00Z' },
          { id: 'c-ag2', workspace_id: WS, nombre: 'ANDRES GOMEZ', telefono: null, email: 'agomez@correo.co', created_at: '2026-02-10T10:00:00Z' },
        );
        await llega('nueva cotización para Andrés Gómez', { enviado: 0 });
      },
      toque: '1. Andrés Gómez', numero: '1', idValido: { tipo: 'opcion', opcion: 'c1' },
      elegido: () => textos().some(x => x.startsWith('Va como viaje nuevo de Andrés Gómez, el que ya tenemos (cel. …4410')),
    },
    '«¿Me pasas su celular o su correo?» de la caja (la llave)': {
      montar: async () => { await llega('nuevo Simón Arango', { enviado: 0 }); },
      numero: '300 222 3344', idValido: { tipo: 'llave' },
      elegido: () => textos().some(x => x.startsWith('Va como viaje nuevo de Simón Arango, cliente nuevo')),
    },
    '«¿Para qué cliente es?» de la caja (el nombre)': {
      montar: async () => { await llega('vamos a montar un viaje nuevo', { enviado: 0 }); },
      idValido: { tipo: 'nombre', nombre: 'Bernardo Lizcano' },
      elegido: () => textos().some(x => x.startsWith('No tengo a Bernardo Lizcano en el directorio')),
    },
  };

  /** El texto libre de cada caso (lleva la llave en el de la caja que la pide, para que el código la copie). */
  const libre = (nombre: string) => (nombre.includes('la llave') ? `${LIBRE}: 300 222 3344` : nombre.includes('el nombre') || nombre.includes('del contacto') ? `${LIBRE}, Bernardo Lizcano y Gabriela Ossa` : LIBRE);

  async function correr(nombre: string, caso: Caso, modo: 'apagado' | 'prendido') {
    const p = PUNTOS[nombre];
    await p.montar();
    const antes = await vigente();
    expect(antes).not.toBeNull();
    const llamadas = { n: 0 };
    const interprete = modo === 'prendido' ? { llamadas, modelo: { acciones: [{ accion: 'contenido', evidencia: LIBRE }] } } : undefined;
    const modeloAntes = alModeloDeDecision.length;
    const mensajesAntes = t.wa_bandeja_mensajes.length;
    const texto = libre(nombre);
    const sinCambio = async () => {
      const despues = await vigente();
      expect(despues?.ref).toBe(antes!.ref);
      expect(despues?.version).toBe(antes!.version);
      expect(await p.elegido()).toBe(false);
    };
    const nadaGuardado = () => expect(t.wa_bandeja_mensajes.filter(m => m.cuerpo === texto)).toEqual([]);
    const conPregunta = () => expect(enviados.at(-1)!.botones?.length ?? 0).toBeGreaterThan(0);
    switch (caso) {
      case 'toque':
        await toca(boton(p.toque!), { enviado: 30, interprete });
        expect(await p.elegido()).toBe(true);
        break;
      case 'toque_viejo': {
        const b = ultimosBotones()[0];
        const partes = b.id.split('|');
        partes[3] = `${partes[3]}-viejo`;
        await toca({ id: partes.join('|'), title: b.title }, { enviado: 30, interprete });
        expect(textos().at(-1)).toMatch(/^(?:Ese botón es de|Esa tanda ya se cerró)/);
        await sinCambio();
        break;
      }
      case 'numero':
      case 'codigo':
        await llega(caso === 'numero' ? p.numero! : p.codigo!, { enviado: 30, interprete });
        expect(alModeloDeDecision.length).toBe(modeloAntes); // el código lo lee sin el modelo
        expect(await p.elegido()).toBe(true);
        break;
      case 'numero_fuera':
        await llega('9', { enviado: 30, interprete });
        expect(alModeloDeDecision.length).toBe(modeloAntes);
        expect(textos().at(-1)).toMatch(/^Ese número no está en la lista\. /);
        conPregunta();
        await sinCambio();
        break;
      case 'id_valido':
        decide(texto, p.idValido);
        await llega(texto, { enviado: 30, interprete });
        expect(alModeloDeDecision.slice(modeloAntes)).toEqual([texto]);
        if (p.propone) {
          // Un viaje reconocido por su nombre o por un dato: se propone con [Sí, ese] y la lista; nada se carga.
          expect(textos().slice(-2)).toEqual([expect.stringMatching(PROPUESTA), 'Si no es ese, elige en la lista.']);
          expect(enviados.at(-2)!.botones!.map(b => b.title)).toEqual(['Sí, ese']);
          conPregunta();
          nadaGuardado();
          await sinCambio();
          // El «sí» escrito solo, sin el modelo, carga en el viaje propuesto.
          const m = alModeloDeDecision.length;
          await llega('sí', { enviado: 40, interprete });
          expect(alModeloDeDecision.length).toBe(m);
          expect(await p.elegido()).toBe(true);
        } else if (p.escribe) {
          // Lo que escribe en un viaje no sale de lo que el modelo leyó: pide el toque, con la pregunta, y no hace nada.
          expect(textos().at(-1)).toMatch(/(?:tócalo en la lista|toca «.+»)\. No he cargado nada\.\n/);
          conPregunta();
          nadaGuardado();
          await sinCambio();
        } else {
          expect(await p.elegido()).toBe(true);
        }
        break;
      case 'id_inventado':
      case 'no_se':
        decide(texto, caso === 'no_se' ? { tipo: 'no_se' } : { tipo: 'opcion', opcion: 'zz9' });
        await llega(texto, { enviado: 30, interprete });
        expect(textos().at(-1)).toMatch(/^No me quedó claro\. /);
        conPregunta();
        nadaGuardado();
        await sinCambio();
        break;
      case 'timeout':
        decide(texto, null);
        await llega(texto, { enviado: 30, interprete });
        expect(textos().at(-1)).toMatch(/^No te entendí; toca una opción\.\n/);
        conPregunta();
        nadaGuardado();
        await sinCambio();
        break;
      case 'pregunta':
        decide(texto, { tipo: 'pregunta' });
        await llega(texto, { enviado: 30, interprete: modo === 'prendido' ? { llamadas, modelo: { acciones: [{ accion: 'contenido', evidencia: LIBRE }] } } : undefined });
        // Apagado se vuelve a mostrar la pregunta; prendido el intérprete no puede guardarla como contenido: igual.
        expect(textos().at(-1)).toMatch(/^Eso te lo contesto después\. Primero: /);
        nadaGuardado();
        await sinCambio();
        break;
      case 'contenido':
        decide(texto, { tipo: 'contenido' });
        await llega(texto, { enviado: 30, interprete });
        // Es contenido: entra a una tanda (nunca como la respuesta a la pregunta), y la pregunta sigue igual.
        expect(t.wa_bandeja_mensajes.filter(m => m.cuerpo === texto).map(m => m.papel)).toEqual(['contenido']);
        await sinCambio();
        break;
    }
    // El intérprete no contesta las preguntas de la bandeja: solo puede llamarse con lo que el punto dijo que no la contesta.
    if (!['contenido', 'pregunta'].includes(caso)) expect(llamadas.n).toBe(0);
    expect(t.wa_bandeja_mensajes.length).toBeGreaterThanOrEqual(mensajesAntes);
  }

  const CASOS: Caso[] = ['toque', 'toque_viejo', 'numero', 'numero_fuera', 'codigo', 'id_valido', 'id_inventado', 'no_se', 'contenido', 'pregunta', 'timeout'];
  for (const modo of ['apagado', 'prendido'] as const) {
    for (const [nombre, p] of Object.entries(PUNTOS)) {
      const aplica = (c: Caso) => (c === 'toque' ? !!p.toque : c === 'numero' ? !!p.numero : c === 'codigo' ? !!p.codigo
        : c === 'numero_fuera' ? !!p.numero && /^\d+$/.test(p.numero) : true);
      for (const caso of CASOS.filter(aplica)) {
        it(`${modo} · ${nombre} · ${caso}`, () => correr(nombre, caso, modo));
      }
    }
  }
});

// ── Bot híbrido (brief del 2026-10-06): el conjunto de desarrollo, de punta a punta ─────────────────────────
// Los turnos de los controles 8 a 11 de Vera (ya gastados: conjunto de desarrollo) que caen en un punto de decisión de la
// bandeja (`__fixtures__/bandeja-hibrida-desarrollo.json`, con las semillas y erratas de sus arneses). Cada turno corre
// de punta a punta, con el interruptor apagado y prendido, y con dos modelos falsos:
//   · el ORÁCULO: devuelve lo que la verdad de terreno de Vera espera (su `esperado`), traducido a las opciones vigentes;
//   · el CAÍDO: timeout. El bot no adivina.
// El efecto se lee de lo que quedó en la base y de lo que dijo el bot, con el vocabulario de Vera (`ef`), y se califica
// con su regla (dañina primero; `~x` = contiene x). Lo que se exige: 0 dañinas en los dos modelos y los dos modos.

describe('bot híbrido (2026-10-06): el conjunto de desarrollo (controles 8 a 11 de Vera, gastados), de punta a punta', () => {
  type Pat = Record<string, unknown>;
  interface CasoDes { id: string; escenario?: string; pendiente: string; tanda?: string; texto: string; esperado: Pat[]; parcial?: Pat[]; danino?: Pat[]; regresion?: boolean }
  interface Ctl {
    control: string;
    contexto: { equipo: string[]; directorio: Array<Record<string, unknown>>; viajes: Array<{ id: string; codigo: string; cliente: string; contacto: string; destino: string }> };
    pendientes: Record<string, Record<string, unknown>>;
    semillas: Record<string, Array<[string, boolean]>>;
    casos: CasoDes[];
  }
  const DES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/bandeja-hibrida-desarrollo.json'), 'utf8')) as { controles: Ctl[] };
  const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@. ]/g, ' ').replace(/\s+/g, ' ').trim();
  const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, x => x.toUpperCase());
  const cfg = async () => (await import('./wa-bandeja-reglas.ts')).leerConfigBandeja(t.workspaces[0].config_extra);
  beforeEach(() => { bandeja.procesarEnElActo.activo = true; });

  /** El mundo del control: el equipo, el directorio (con sus viajes cerrados) y los viajes abiertos. */
  function mundo(c: Ctl) {
    t.staff = c.contexto.equipo.map((nombre, i) => ({ id: `st-${i}`, workspace_id: WS, full_name: nombre.toUpperCase() }));
    for (const d of c.contexto.directorio) {
      t.contactos.push({ id: d.id, workspace_id: WS, nombre: d.nombre, telefono: d.celular ?? null, email: d.correo ?? null, usuario_whatsapp: d.usuario ?? null, created_at: '2026-01-10T10:00:00Z' });
      if (d.ultimo_cerrado) t.negocios.push({ ...negocioDePrueba(`cerrado-${d.id}`, `Z 25 ${String(d.id).slice(1)}`, String(d.ultimo_cerrado).split(' · ')[0], String(d.nombre)), contacto_id: d.id, estado: 'completado' });
    }
    for (const v of c.contexto.viajes) {
      t.negocios.push({ ...negocioDePrueba(v.id, v.codigo, null as unknown as string, v.cliente), nombre: null, contacto_id: v.contacto });
      t.negocio_bloques.push({ id: `b-${v.id}`, negocio_id: v.id, data: { destino: v.destino }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
    }
  }
  const viaje = (c: Ctl, id: string) => c.contexto.viajes.find(v => v.id === id)!;
  const opcionDe = (c: Ctl, id: string) => { const v = viaje(c, id); return { id: v.id, codigo: v.codigo, cliente: v.cliente, destino: v.destino, nombre: null }; };
  const ahora = () => new Date().toISOString();
  let k = 0;
  /** Una entrega cerrada (con su pregunta enviada) y dos mensajes del cliente. */
  function entrega(extra: Fila): string {
    const id = `ent-${++k}`;
    t.wa_bandeja_entregas.push({ id, workspace_id: WS, remitente_phone: TEL, remitente_staff_id: null, estado: 'esperando_cliente', n_mensajes: 2, created_at: ahora(), cerrada_at: ahora(), pregunta_enviada_at: ahora(), pregunta_error: null, plan_viajes: null, negocio_opciones: null, ...extra });
    for (const [n, cuerpo] of ['Hola, quiero cotizar un viaje', 'Seríamos 2 adultos'].entries()) {
      t.wa_bandeja_mensajes.push({ id: `m-${id}-${n}`, workspace_id: WS, entrega_id: id, wa_message_id: `w-${id}-${n}`, remitente_phone: TEL, papel: 'contenido', tipo: 'text', cuerpo, cuerpo_origen: 'texto', reenviado: true, segmento: null, enviado_at: ahora(), recibido_at: ahora() });
    }
    return id;
  }
  /** Una ficha del directorio como la devuelve la búsqueda (para el viaje nuevo de un contacto que ya existe). */
  const ficha = (c: Ctl, cid: string) => {
    const d = c.contexto.directorio.find(x => x.id === cid)!;
    return { id: cid, nombre: d.nombre, cel4: d.celular ? String(d.celular).slice(-4) : null, correo: !!d.correo, abiertos: ((d.abiertos as string[]) ?? []).map(v => ({ codigo: viaje(c, v).codigo, nombre: null })), cerrado: null };
  };
  /** Deja vigente el estado del caso: la pregunta abierta, o la caja con sus semillas. */
  async function estado(c: Ctl, caso: CasoDes) {
    const P = c.pendientes[caso.pendiente] ?? {};
    const b = P.bandeja as Fila | undefined;
    if (caso.pendiente === 'entrega') {
      entrega({ negocio_opciones: ((b?.opciones as string[]) ?? []).map(id => opcionDe(c, id)) });
    } else if (caso.pendiente === 'resumen' || caso.pendiente === 'resumen_vn') {
      const plan = (P.plan as Array<{ n: number; viaje?: string; contacto?: string }>).map(m => ({
        n: m.n, por: 'encabezado',
        destino: m.viaje ? { tipo: 'existente', negocio_id: m.viaje, codigo: viaje(c, m.viaje).codigo, cliente: viaje(c, m.viaje).cliente, nombre: null }
          : { tipo: 'nuevo', cliente: titulo(String(c.contexto.directorio.find(x => x.id === m.contacto)!.nombre)), resuelto: true, contacto: ficha(c, m.contacto!) },
      }));
      const id = entrega({ plan_viajes: { version: 2, mensajes: plan, encabezados: [], avisos: [] }, n_mensajes: plan.length });
      for (let n = 2; n < plan.length; n++) t.wa_bandeja_mensajes.push({ id: `m-${id}-x${n}`, workspace_id: WS, entrega_id: id, wa_message_id: `w-${id}-x${n}`, remitente_phone: TEL, papel: 'contenido', tipo: 'text', cuerpo: `Otro mensaje ${n}`, cuerpo_origen: 'texto', reenviado: true, segmento: null, enviado_at: ahora(), recibido_at: ahora() });
    } else if (caso.pendiente === 'conf_llave') {
      const conf = P.confirmar as { nombre: string; llave: Fila | null; opciones: string[] };
      const id = entrega({ estado: 'con_cliente', cliente_texto: `nuevo ${conf.nombre}`, negocio_opciones: conf.opciones.map(x => opcionDe(c, x)) });
      t.wa_bandeja_entendimientos.push({
        id: `en-${id}`, workspace_id: WS, entrega_id: id, segmento: 0, remitente_phone: TEL, remitente_staff_id: null, estado: 'esperando_negocio', intentos: 1,
        destino: 'nuevo', contacto_nombre: conf.nombre, cliente: { nombre: '', telefono: '', ...(conf.llave ? { llave: conf.llave } : {}) },
        pregunta_negocio_at: ahora(), respuesta_negocio: null, confirmacion_pendiente: null, negocio_destino_id: null, negocio_id: null, contacto_id: null,
        sugeridos: {}, historia: [], descartados: [], updated_at: ahora(), created_at: ahora(),
      });
    } else {
      // Las preguntas de la caja: la tanda abierta con las semillas que la dejan así (las de los arneses de Vera).
      const sem = (caso.tanda ? c.semillas[`tanda:${caso.tanda}`] : null) ?? c.semillas[`pend:${caso.pendiente}`] ?? [];
      const id = `tanda-${++k}`;
      t.wa_bandeja_entregas.push({ id, workspace_id: WS, remitente_phone: TEL, remitente_staff_id: null, estado: 'abierta', n_mensajes: sem.length, created_at: ahora(), pregunta_enviada_at: null, pregunta_error: null, plan_viajes: null, negocio_opciones: null });
      sem.forEach(([cuerpo, reenviado], n) => {
        const en = new Date(Date.now() - (sem.length - n) * 20_000).toISOString();
        t.wa_bandeja_mensajes.push({ id: `m-${id}-${n}`, workspace_id: WS, entrega_id: id, wa_message_id: `w-${id}-${n}`, remitente_phone: TEL, papel: 'contenido', tipo: 'text', cuerpo, cuerpo_origen: 'texto', reenviado, segmento: null, enviado_at: en, recibido_at: en });
      });
    }
    return decision.puntoDeDecision(db as never, WS, TEL, await cfg());
  }

  /** El oráculo: lo que espera Vera, traducido a una salida del modelo con las opciones vigentes. */
  function oraculo(c: Ctl, caso: CasoDes, p: PuntoDecision): unknown {
    const op = (pred: (o: PuntoDecision['opciones'][number]) => boolean) => p.opciones.find(pred);
    /** El nombre como lo escribió el comercial: desde la primera palabra del contacto, las palabras con mayúscula que siguen. */
    const literal = (nombre: string) => {
      const crudas = caso.texto.split(/\s+/);
      const primera = norm(String(nombre).split(/\s+/)[0]);
      const i = crudas.findIndex(w => norm(w) === primera);
      if (i < 0) {
        const ws = String(nombre).split(/\s+/);
        for (let n = ws.length; n >= 1; n--) for (let j = 0; j + n <= ws.length; j++) {
          const tramo = ws.slice(j, j + n).join(' ');
          if (norm(caso.texto).includes(norm(tramo))) return tramo;
        }
        return null;
      }
      let f = i + 1;
      while (f < crudas.length && /^\p{Lu}/u.test(crudas[f])) f++;
      return crudas.slice(i, f).join(' ').replace(/[.,;:!?]+$/, '');
    };
    const tieneLlave = /\d{7,}|\d{3}\s\d{3}\s\d{4}|@/.test(caso.texto);
    // Un viaje nuevo de OTRO cliente que el de la lista de la caja: la lista no tiene esa opción (el modelo no sabe).
    const clienteDeLaLista = p.tipo === 'eleccion' ? c.contexto.viajes.find(v => v.id === p.opciones.find(o => o.ref)?.ref)?.contacto : null;
    const salidas = caso.esperado.map(e => traducir(String(e.ef ?? ''))).filter(Boolean) as Array<Record<string, unknown>>;
    return salidas.find(s => s.tipo !== 'no_se') ?? { tipo: 'no_se' };
    function traducir(ef0: string): Record<string, unknown> | null {
      const ef = ef0.replace(/^~/, '').replace(/;$/, '');
      const [tipo, arg0 = ''] = ef.split(/:(.*)/s);
      const arg = arg0.split('|')[0];
      const contacto = c.contexto.directorio.find(x => x.id === arg);
      const nombreDe = (ids: string[]) => ids.map(id => c.contexto.directorio.find(x => x.id === id)).filter(Boolean).map(x => literal(titulo(String(x!.nombre)))).find(Boolean) ?? null;
      if (['pregunta', 'nada', 'no_modelo', 'pide_cliente'].includes(tipo)) return { tipo: 'no_se' };
      if (tipo === 'consulta') return { tipo: 'pregunta' };
      if (tipo === 'elige' || tipo === 'identidad') {
        if (p.pide?.llave && tieneLlave && tipo === 'identidad') return { tipo: 'llave' };
        const nom = nombreDe(arg.split(','));
        if (p.tipo === 'viaje' && nom) return { tipo: 'opcion', opcion: 'nuevo', nombre: nom };
        return p.pide?.nombre && nom ? { tipo: 'nombre', nombre: nom } : null;
      }
      if (tipo === 'descarta' || tipo === 'descarta_todo' || tipo === 'descarta_tanda') return op(o => o.clave === 'des') ? { tipo: 'opcion', opcion: 'des' } : null;
      if (tipo === 'carga_plan' || tipo === 'crea_viaje') { const o = op(x => x.clave === 'si') ?? op(x => x.clave === 'crear'); return o ? { tipo: 'opcion', opcion: o.clave } : null; }
      if (tipo === 'crea') { const o = op(x => x.clave === 'crear') ?? op(x => x.clave === 'si'); return o ? { tipo: 'opcion', opcion: o.clave } : null; }
      if (tipo === 'carga' || tipo === 'caja') { const o = op(x => x.ref === arg); return o ? { tipo: 'opcion', opcion: o.clave } : null; }
      if (tipo === 'borrador') {
        if (!p.pide?.correccion) return null;
        const cambios: Array<Record<string, unknown>> = [];
        for (const parte of arg0.split(';').filter(Boolean)) {
          const m = /^([\d,]+)>(?:v:(\w+)|(descartar)|(dejar)|nuevo:(.+))$/.exec(parte);
          if (!m) return null;
          const mensajes = m[1].split(',').map(Number);
          if (m[3] || m[4]) { cambios.push({ mensajes, destino: m[3] ?? m[4] }); continue; }
          if (m[5]) { const nom = literal(titulo(m[5])); if (!nom) return null; cambios.push({ mensajes, destino: 'nuevo', nombre: nom }); continue; }
          const o = op(x => x.clave.startsWith('g') && x.ref === m[2]) ?? op(x => x.ref === m[2]);
          if (!o) return null;
          cambios.push({ mensajes, destino: o.clave });
        }
        return { tipo: 'correccion', cambios };
      }
      if (tipo === 'contenido') return { tipo: 'contenido' };
      if (tipo === 'viaje_nuevo' && contacto) {
        const nom = literal(titulo(String(contacto.nombre)));
        if (p.tipo === 'eleccion') return clienteDeLaLista === arg && op(o => o.clave === 'nuevo') ? { tipo: 'opcion', opcion: 'nuevo' } : null;
        if (p.tipo === 'elegir_cliente') { const o = op(x => x.ref === arg); return o ? { tipo: 'opcion', opcion: o.clave } : null; }
        if (p.tipo === 'misma') return { tipo: 'opcion', opcion: 'si' };
        if (p.tipo === 'nuevo') return { tipo: 'opcion', opcion: 'crear' };
        if (p.tipo === 'viaje' && nom) return { tipo: 'opcion', opcion: 'nuevo', nombre: nom };
        return p.pide?.nombre && nom ? { tipo: 'nombre', nombre: nom } : null;
      }
      if (tipo === 'pide_si' || tipo === 'cliente_nuevo' || tipo === 'caja_nueva') {
        if (p.pide?.llave && tieneLlave && p.tipo !== 'nuevo' && p.tipo !== 'nombre') return { tipo: 'llave' };
        const nom = literal(arg);
        if (p.tipo === 'viaje' && nom) return { tipo: 'opcion', opcion: 'nuevo', nombre: nom };
        if (p.pide?.nombre && nom) return { tipo: 'nombre', nombre: nom };
        return p.pide?.llave && tieneLlave ? { tipo: 'llave' } : null;
      }
      if (tipo === 'pide_llave') {
        if (op(o => o.clave === 'otra')) return { tipo: 'opcion', opcion: 'otra' };
        if (p.tipo === 'misma') return { tipo: 'opcion', opcion: 'no' };
        return null;
      }
      return null;
    }
  }

  /** El efecto del turno, con el vocabulario de Vera (`ef`): lo que quedó en la base y lo que dijo el bot. */
  function efecto(c: Ctl, antes: { contactos: Set<string>; negocios: Set<string>; mensajes: number; textos: number; planes: Map<string, string> }, texto: string): string {
    const ef: string[] = [];
    const porNombre = (n: string) => c.contexto.directorio.find(x => norm(x.nombre) === norm(n))?.id ?? `?${norm(n)}`;
    const porCodigo = (cod: string) => c.contexto.viajes.find(v => norm(v.codigo) === norm(cod))?.id ?? `?${cod}`;
    /** Lo que cambió el reparto: «2>v:tv6», «3>descartar», «1,2>dejar», «4>nuevo:pedro gomez» (los números del resumen). */
    const borradorDe = (planes: Map<string, string>) => {
      const por = new Map<string, number[]>();
      for (const e of t.wa_bandeja_entregas) {
        const viejo = planes.get(String(e.id));
        const plan = e.plan_viajes as PlanViajes | null;
        if (!viejo || !plan) continue;
        const antes = JSON.parse(viejo) as PlanViajes;
        for (const m of plan.mensajes) {
          const a = antes.mensajes.find(x => x.n === m.n);
          if (!a || JSON.stringify(a) === JSON.stringify(m)) continue;
          const d = m.destino as Fila | null;
          const destino = m.descartado ? 'descartar' : !d ? '?' : JSON.stringify(a.destino) === JSON.stringify(d) ? 'dejar'
            : d.tipo === 'existente' ? `v:${d.negocio_id}` : `nuevo:${norm(d.cliente)}`;
          por.set(destino, [...(por.get(destino) ?? []), m.n]);
        }
      }
      return `borrador:${[...por.entries()].map(([d, ns]) => `${ns.join(',')}>${d}`).join(';')}`;
    };
    /** Entre homónimos, el que tiene ese dato (los 4 dígitos del celular, o el correo). */
    const porNombreYDato = (n: string, cel4: string | null, correo: boolean) => {
      const xs = c.contexto.directorio.filter(x => norm(x.nombre) === norm(n));
      const y = xs.find(x => (cel4 ? String(x.celular ?? '').endsWith(cel4) : correo ? !!x.correo && !x.celular : false)) ?? xs[0];
      return y?.id ?? `?${norm(n)}`;
    };
    for (const x of t.contactos.filter(x => !antes.contactos.has(String(x.id)))) ef.push(`crea:${norm(x.nombre)}|${x.telefono ?? x.email ?? x.usuario_whatsapp ?? ''}`);
    for (const x of t.negocios.filter(x => !antes.negocios.has(String(x.id)))) if (antes.contactos.has(String(x.contacto_id))) ef.push(`crea_viaje:${x.contacto_id}`);
    for (const e of t.wa_bandeja_entendimientos) {
      const destino = String(e.negocio_destino_id ?? e.negocio_id ?? '');
      // Un viaje del reparto confirmado (segmento > 0) es la consecuencia del «sí» al resumen: Vera lo cuenta como carga_plan.
      if (e.estado === 'negocio_actualizado' && destino && !destino.startsWith('id-') && !Number(e.segmento ?? 0)) ef.push(`carga:${destino}`);
      if (e.estado === 'descartada') ef.push('descarta');
    }
    for (const e of t.wa_bandeja_entregas.filter(x => x.plan_confirmado_at)) {
      for (const m of ((e.plan_viajes as PlanViajes | null)?.mensajes ?? [])) {
        const d = m.destino as Fila | null;
        if (!d) continue;
        if (d.tipo === 'existente') ef.push('carga_plan');
        else if (d.contacto) ef.push(`crea_viaje:${(d.contacto as Fila).id}`);
        else ef.push(`crea:${norm(d.cliente)}`);
      }
    }
    for (const x of textos().slice(antes.textos)) {
      // Volver a preguntar lo mismo es «pregunta» (lo que repite de la pregunta no es un efecto nuevo).
      if (/^(?:No me quedó claro|No te entendí|Todavía no lo cargo|Para crear|Para cargarlo|Para seguir|Para ir a ese viaje|Si es «|Escríbeme solo|Eso te lo contesto|Ese número no está|No entendí|Ese botón|¿Van en «|Si no es ese)/.test(x)) {
        ef.push('pregunta');
        continue;
      }
      const consulta = /^(.+?) tiene \d+ viajes abiertos:/.exec(x);
      if (consulta) { ef.push(`consulta:viajes:${porNombre(consulta[1])}`); continue; }
      const caja = /^📌 .*\(([A-Z0-9]+ \d+ \d+)\)$/.exec(x);
      if (caja) ef.push(`caja:${porCodigo(caja[1])}`);
      const vn = /Va como viaje nuevo de (.+?), el que ya tenemos \((?:cel\. …(\d{4})|(con correo))?/.exec(x);
      if (vn) ef.push(`viaje_nuevo:${porNombreYDato(vn[1], vn[2] ?? null, !!vn[3])}`);
      const cn = /Va como viaje nuevo de (.+?), cliente nuevo/.exec(x);
      if (cn) ef.push(`cliente_nuevo:${norm(cn[1])}`, `pide_si:${norm(cn[1])}`);
      const sin = /^No tengo a (.+?) en el directorio/.exec(x);
      if (sin) ef.push(`cliente_nuevo:${norm(sin[1])}`);
      const ps = /¿Va como viaje nuevo de (.+?)\?|¿Creo el cliente nuevo «(.+?)»\?/.exec(x);
      if (ps) ef.push(`pide_si:${norm(ps[1] ?? ps[2])}`);
      const ya = /Ya es cliente: (.+?) \(/.exec(x);
      if (ya) ef.push(`viaje_nuevo:${porNombre(ya[1])}`);
      const id = /ya lo tenemos a nombre de (.+?) \(/.exec(x);
      if (id) ef.push(`identidad:${porNombre(id[1])}`);
      if (/¿Me pasas (?:su|el) celular/.test(x)) ef.push('pide_llave');
      if (/¿Para qué cliente es/.test(x)) ef.push('pide_cliente');
      if (/tiene \d+ viajes abiertos/.test(x)) ef.push('viaje_o_nuevo');
      if (/o es otra persona\?/.test(x)) ef.push('elige');
      if (/^Corregido\. Así queda/.test(x)) ef.push(borradorDe(antes.planes));
      if (/Descarté|descarté/.test(x)) ef.push('descarta');
    }
    if (t.wa_bandeja_mensajes.slice(antes.mensajes).some(m => m.cuerpo === texto && (m.interpretacion as Fila | null)?.accion === 'contenido')) ef.push('contenido:');
    return [...new Set(ef)].join(';') || 'nada';
  }
  /** Lo que queda preguntando (para «elige:<ids>», como lo escribe Vera). */
  async function preguntaDespues(antes: PuntoDecision): Promise<string | null> {
    const p = await decision.puntoDeDecision(db as never, WS, TEL, await cfg());
    // La misma pregunta otra vez no es una pregunta nueva.
    if (p?.tipo !== 'elegir_cliente' || (p.ref === antes.ref && p.version === antes.version)) return null;
    const ids = p.opciones.map(o => o.ref).filter(Boolean).sort();
    return `${ids.length === 1 ? `identidad:${ids[0]};` : ''}elige:${ids.join(',')}`;
  }
  function coincide(ef: string, p: Pat): boolean {
    const v = String(p.ef ?? '');
    return v.startsWith('~') ? ef.includes(v.slice(1)) : ef === v;
  }
  function calificar(caso: CasoDes, ef: string): 'danina' | 'bien' | 'parcial' | 'falla' {
    if ((caso.danino ?? []).some(p => coincide(ef, p))) return 'danina';
    if (caso.esperado.some(p => coincide(ef, p))) return 'bien';
    if ((caso.parcial ?? []).some(p => coincide(ef, p))) return 'parcial';
    return 'falla';
  }

  const tabla: Record<string, Record<string, number>> = {};
  const dañinas: string[] = [];
  const regresiones: string[] = [];
  const fallasOraculo: string[] = [];
  /** Cada turno calificado (con DESARROLLO_SALIDA se escribe, para compararlo con main turno por turno). */
  const porCaso: Array<Record<string, string>> = [];
  afterAll(() => {
    // La tabla para el PR (se imprime una vez; no cambia lo que se exige).
    console.log(`[conjunto de desarrollo] ${JSON.stringify(tabla)}`);
    if (regresiones.length) console.log(`[conjunto de desarrollo] regresión:true que no quedó bien: ${regresiones.join(', ')}`);
    if (fallasOraculo.length) console.log(`[conjunto de desarrollo] fallas con el oráculo:\n${fallasOraculo.join('\n')}`);
    if (process.env.DESARROLLO_SALIDA) writeFileSync(process.env.DESARROLLO_SALIDA, JSON.stringify(porCaso, null, 1));
  });

  /** Un turno de punta a punta: el mundo, el estado, el escrito y su efecto calificado. `salida`: lo que devuelve el modelo. */
  async function turno(c: Ctl, caso: CasoDes, modo: 'apagado' | 'prendido', salida: (p: PuntoDecision) => unknown | 'real', antesDelTurno?: () => void) {
    // Cada turno con la base limpia: el mundo del control y su estado.
    t = base(); db = crearDb(t); enviados.length = 0; decisiones = new Map(); alModeloDeDecision = [];
    mundo(c);
    vi.setSystemTime(new Date(T0 + 600_000));
    const p = await estado(c, caso);
    if (!p) return null;
    const s = salida(p);
    if (s !== 'real') decide(caso.texto, s);
    colaModelo = [salidaModelo({ destino: { valor: 'Destino', frase: '' } })];
    const antes = {
      contactos: new Set(t.contactos.map(x => String(x.id))), negocios: new Set(t.negocios.map(x => String(x.id))), mensajes: t.wa_bandeja_mensajes.length, textos: enviados.length,
      planes: new Map(t.wa_bandeja_entregas.filter(e => e.plan_viajes).map(e => [String(e.id), JSON.stringify(e.plan_viajes)])),
    };
    antesDelTurno?.();
    await llega(caso.texto, { enviado: 600, interprete: modo === 'prendido' ? { modelo: { acciones: [{ accion: 'pedir_aclaracion', evidencia: caso.texto }] } } : undefined });
    const pd = await preguntaDespues(p);
    const ef = [efecto(c, antes, caso.texto), pd].filter(x => x && x !== 'nada').join(';') || 'nada';
    return { ef, clase: calificar(caso, ef), sinModelo: alModeloDeDecision.length === 0 };
  }

  for (const c of DES.controles) {
    for (const modelo of ['oraculo', 'caido'] as const) {
      for (const modo of ['apagado', 'prendido'] as const) {
        it(`control ${c.control} · modelo ${modelo} · ${modo}: 0 dañinas en los ${c.casos.length} turnos en un punto de decisión`, async () => {
          const malas: string[] = [];
          for (const caso of c.casos) {
            const r = await turno(c, caso, modo, p => (modelo === 'oraculo' ? oraculo(c, caso, p) : null));
            if (!r) { malas.push(`${caso.id}: sin punto de decisión`); continue; }
            const { ef, clase: k2, sinModelo } = r;
            const clave = `${c.control}·${modelo}·${modo}`;
            (tabla[clave] ??= { bien: 0, parcial: 0, falla: 0, danina: 0 })[k2]++;
            porCaso.push({ control: c.control, id: caso.id, modelo, modo, clase: k2, ef });
            if (k2 === 'danina') malas.push(`${caso.id} «${caso.texto}» → ${ef}`);
            if (modelo === 'oraculo' && caso.regresion && (k2 === 'falla' || k2 === 'danina')) regresiones.push(`${c.control}/${caso.id}(${modo}): ${ef}`);
            if (modelo === 'oraculo' && k2 === 'falla') fallasOraculo.push(`${modo} ${c.control}/${caso.id} «${caso.texto}» → ${ef} (esperado ${caso.esperado.map(x => x.ef).join(' | ')})`);
            // Sin modelo (timeout), lo que el modelo tenía que leer no escribe nada y se vuelve a preguntar. (Lo exacto, el
            // número, el código o la llave, no pasa por el modelo: sigue como siempre.)
            if (modelo === 'caido' && !sinModelo) {
              expect(ef, caso.id).not.toMatch(/(?:^|;)(?:crea|crea_viaje|carga|carga_plan|descarta|borrador|contenido|caja)(?::|;|$)/);
              expect(ef, caso.id).toMatch(/(?:^|;)pregunta(?:;|$)/);
            }
          }
          dañinas.push(...malas);
          expect(malas).toEqual([]);
        });
      }
    }
  }

  // ── El banco con Gemini real: UNA corrida, solo con la llave de PRUEBAS ─────────────────────────────────────
  // No corre en CI ni sin la variable. Lo lanza `comparador/hibrido/correr.sh`, que solo exporta la llave de pruebas
  // (nunca la de producción) en GEMINI_API_KEY. Regla de gasto del 2026-10-06: todo se desarrolla con el modelo falso; con
  // Gemini real, como máximo una corrida ×1 del conjunto de desarrollo, al final y con 0 dañinas en el falso. El control
  // que decide lo corre Vera aparte. Escribe, por control, el formato que lee `comparador/comparar.ts`
  // (`proto/res/<control>-<etiqueta>.json`) con los llamados, los tokens, la latencia y por qué volvió a preguntar.
  // El tiempo máximo es el de Trappvel en producción (`bot_conversacional.timeout_ms`, leído con SELECT el 2026-10-06:
  // 4000 ms, que es también el valor por defecto); el banco verifica que la capa lo pase así. La latencia se mide con
  // `performance.now()`: en estas pruebas `Date` es falso (por eso la corrida anterior marcó p50/p90 en 0).
  const BANCO = process.env.BANCO_DECISION_MODELO ?? '';
  const TIMEOUT_DE_PRODUCCION_MS = 4000;
  const fetchReal = globalThis.fetch;
  const NOMBRE_DEL_CONTROL: Record<string, string> = { '08': '05', '09': '05b', '10': '05c', '11': '06' };
  type Uso = { tokensIn: number; tokensOut: number; tokensRazonamiento: number };
  /** Por qué no hubo respuesta del modelo: el tiempo máximo, un 429 (cuota), otro HTTP, la red, o una salida rota. */
  type Caida = 'timeout' | 'http429' | 'http' | 'red' | 'esquema';
  type Real = ({ ok: true; json: unknown; ms: number } | { ok: false; motivo: 'timeout' | 'http' | 'esquema'; ms: number; detalle: string }) & { uso: Uso | null; caida: Caida | null };
  async function llamarReal(p: { modelo: string; sistema: string; usuario: string; timeoutMs: number }): Promise<Real> {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const { generacionPara } = await import('./wa-interprete-reglas.ts');
    const { esquemaDecision } = await import('./wa-decision-reglas.ts');
    let res: Response;
    try {
      res = await fetchReal(`https://generativelanguage.googleapis.com/v1beta/models/${p.modelo}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
        body: JSON.stringify({ system_instruction: { parts: [{ text: p.sistema }] }, contents: [{ role: 'user', parts: [{ text: p.usuario }] }], generationConfig: generacionPara(p.modelo, esquemaDecision()) }),
        signal: AbortSignal.timeout(p.timeoutMs),
      });
    } catch (err) {
      const n = (err as { name?: string })?.name ?? '';
      const timeout = n === 'TimeoutError' || n === 'AbortError';
      return { ok: false, motivo: timeout ? 'timeout' : 'http', ms: ms(), detalle: n || 'red', uso: null, caida: timeout ? 'timeout' : 'red' };
    }
    if (res.status !== 200) {
      await res.text().catch(() => '');
      return { ok: false, motivo: 'http', ms: ms(), detalle: `HTTP ${res.status}`, uso: null, caida: res.status === 429 ? 'http429' : 'http' };
    }
    try {
      const d = await res.json() as { usageMetadata?: Record<string, number>; candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
      const u = d.usageMetadata ?? {};
      const uso = { tokensIn: u.promptTokenCount ?? 0, tokensOut: u.candidatesTokenCount ?? 0, tokensRazonamiento: u.thoughtsTokenCount ?? 0 };
      const cand = d.candidates?.[0];
      if (cand?.finishReason !== 'STOP') return { ok: false, motivo: 'esquema', ms: ms(), detalle: `finishReason ${cand?.finishReason ?? 'ninguno'}`, uso, caida: 'esquema' };
      const json = JSON.parse((cand.content?.parts ?? []).filter(x => !x.thought).map(x => x.text ?? '').join(''));
      return { ok: true, json, ms: ms(), uso, caida: null };
    } catch (err) {
      return { ok: false, motivo: 'esquema', ms: ms(), detalle: String(err), uso: null, caida: 'esquema' };
    }
  }
  /**
   * Por qué el bot volvió a preguntar en el turno (lo dice su texto). `toque` = lo que el modelo leyó escribía o creaba y
   * se pide el toque (decisión 2 y su extensión del 2026-10-06): esperado. `fallback` = el modelo no respondió.
   */
  function vueltaDe(desde: number): 'propuesta' | 'toque' | 'fallback' | 'no_se' | 'todavia' | 'pregunta' | 'fuera' | null {
    for (const x of textos().slice(desde)) {
      if (/^¿Van en «/.test(x)) return 'propuesta';
      if (/^(?:Para cargarlo|Para crear|Para seguir|Para ir a ese viaje|Si es «|Escríbeme solo)/.test(x)) return 'toque';
      if (/^No te entendí; toca una opción/.test(x)) return 'fallback';
      if (/^No me quedó claro/.test(x)) return 'no_se';
      if (/^Todavía no lo cargo/.test(x)) return 'todavia';
      if (/^Eso te lo contesto después/.test(x)) return 'pregunta';
      if (/^Ese número no está/.test(x)) return 'fuera';
    }
    return null;
  }
  for (const c of DES.controles) {
    it.skipIf(!BANCO)(`banco con Gemini (${BANCO || 'sin modelo'}): control ${c.control}, interruptor prendido, una corrida por turno`, async () => {
      if (Number(process.env.BANCO_CORRIDAS ?? 1) !== 1) throw new Error('Con Gemini real, una sola corrida (regla de gasto del 2026-10-06).');
      const filas: Array<{ id: string; texto: string; efs: string[]; ms: number[]; llamadas: number; uso: Uso; vuelta: string | null; caida: string | null; detalle: string | null; veredicto: string | null }> = [];
      const total = { llamadas: 0, tokensIn: 0, tokensOut: 0, tokensRazonamiento: 0, fallbacks: 0 };
      const clases: Record<string, number> = { bien: 0, parcial: 0, falla: 0, danina: 0, fallback: 0 };
      const caidas: Record<Caida, number> = { timeout: 0, http429: 0, http: 0, red: 0, esquema: 0 };
      const vueltas: Record<string, number> = {};
      const msModelo: number[] = [];
      const timeouts = new Set<number>();
      for (const caso of c.casos) {
        const uso: Uso = { tokensIn: 0, tokensOut: 0, tokensRazonamiento: 0 };
        let llamadas = 0;
        let ultimo: { ms: number; caida: Caida | null; detalle: string | null; json: unknown } = { ms: 0, caida: null, detalle: null, json: null };
        decision.modeloDeDecision.llamar = async (p) => {
          alModeloDeDecision.push(caso.texto);
          timeouts.add(p.timeoutMs);
          // El banco corre el modelo que elige la capa (`bot_conversacional.modelo_decision`, por defecto 3.5-flash-lite).
          if (p.modelo !== BANCO) throw new Error(`la capa pidió ${p.modelo} y el banco es de ${BANCO}`);
          const r = await llamarReal(p);
          llamadas++;
          msModelo.push(r.ms);
          ultimo = { ms: r.ms, caida: r.caida, detalle: r.ok ? null : r.detalle, json: r.ok ? r.json : null };
          if (r.caida) caidas[r.caida]++;
          if (r.uso) { uso.tokensIn += r.uso.tokensIn; uso.tokensOut += r.uso.tokensOut; uso.tokensRazonamiento += r.uso.tokensRazonamiento; }
          return r;
        };
        let desde = 0;
        const r = await turno(c, caso, 'prendido', () => 'real', () => { desde = enviados.length; });
        if (!r) continue;
        const vuelta = vueltaDe(desde);
        const fallback = !!ultimo.caida;
        const clase = fallback ? 'fallback' : r.clase;
        clases[clase]++;
        if (vuelta) vueltas[vuelta] = (vueltas[vuelta] ?? 0) + 1;
        total.llamadas += llamadas; total.tokensIn += uso.tokensIn; total.tokensOut += uso.tokensOut; total.tokensRazonamiento += uso.tokensRazonamiento;
        if (fallback) total.fallbacks++;
        const veredicto = ultimo.json && typeof ultimo.json === 'object' ? JSON.stringify(ultimo.json) : null;
        filas.push({ id: caso.id, texto: caso.texto, efs: [`${clase}:${r.ef}`], ms: [ultimo.ms], llamadas, uso, vuelta, caida: ultimo.caida, detalle: ultimo.detalle, veredicto });
      }
      // El tiempo máximo que usó la capa en cada llamado es el de producción.
      expect([...timeouts]).toEqual(timeouts.size ? [TIMEOUT_DE_PRODUCCION_MS] : []);
      const q = (xs: number[], f: number) => { const o = [...xs].sort((x, y) => x - y); return o.length ? o[Math.min(o.length - 1, Math.floor(o.length * f))] : null; };
      const resumen = {
        modelo: BANCO, corridas: 1, control: c.control, timeoutMs: [...timeouts][0] ?? null, turnos: filas.length, clases, caidas, vueltas, ...total,
        msP50: q(msModelo, 0.5), msP90: q(msModelo, 0.9), msMax: q(msModelo, 1),
      };
      const salida = process.env.BANCO_SALIDA;
      if (salida) writeFileSync(join(salida, `${NOMBRE_DEL_CONTROL[c.control]}-hibrido-${BANCO}.json`), JSON.stringify({ resumen, filas }, null, 1));
      console.log(`[banco] ${JSON.stringify(resumen)}`);
      expect(clases.danina).toBe(0);
    }, 3_600_000);
  }
});

// ── Bot híbrido (2026-10-06): crear un cliente pasa por un botón, y el apellido de más es un parecido ───────────────
// Punto 5 del brief y hallazgo 8 del undécimo control de Vera: «nuevo <clienta> <apellido de más> <cel nuevo>» creaba
// un contacto nuevo con el «Cargar», sin preguntar. Ahora el guardián lo ve como un parecido y lo pregunta con la lista.

describe('bot híbrido (2026-10-06): el apellido de más ya no crea un duplicado (hallazgo 8 del undécimo control)', () => {
  function celmira() {
    t.contactos.push({ id: 'c-cr', workspace_id: WS, nombre: 'CELMIRA ROJAS', telefono: '3006668899', email: null, created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba('n-cr', 'T1 26 708', 'BARÚ PUENTE', 'CELMIRA ROJAS'), contacto_id: 'c-cr' });
    t.negocio_bloques.push({ id: 'b-n-cr', negocio_id: 'n-cr', data: { destino: 'BARÚ' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
  }
  beforeEach(() => { bandeja.procesarEnElActo.activo = true; });

  for (const modo of ['apagado', 'prendido'] as const) {
    it(`${modo}: «nuevo Celmira Rojas Peña» con un celular nuevo pregunta si es Celmira Rojas, con la lista; «Otra persona» y «Cargar» crean a la nueva`, async () => {
      celmira();
      const interprete = modo === 'prendido' ? { llamadas: { n: 0 } } : undefined;
      await llega('nuevo Celmira Rojas Peña 320 555 1234', { enviado: 0, interprete });
      // Antes: «Va como viaje nuevo de Celmira Rojas Peña, cliente nuevo …» y el «Cargar» la creaba.
      expect(textos().at(-1)).toBe('No tengo a Celmira Rojas Peña tal cual. ¿Es Celmira Rojas (cel. …8899, un viaje abierto: BARÚ PUENTE), o es otra persona?');
      expect(ultimosBotones().map(b => b.title)).toEqual(['1. Celmira Rojas', 'Otra persona', '🗑 Descartar']);
      await llega('quieren Barú para el puente', { enviado: 3, reenviado: true });
      await llega('listo', { enviado: 6, interprete });
      // Sin decidir quién es, el resumen no trae «Cargar» (no se puede crear ni cargar).
      expect(ultimosBotones().map(b => b.title)).toEqual(['1. Celmira Rojas', 'Otra persona', '🗑 Descartar']);
      expect(t.contactos).toHaveLength(1);
      await toca(boton('Otra persona'), { enviado: 10, interprete });
      expect(textos().some(x => /Viaje nuevo · Celmira Rojas Peña\*\nCliente nuevo · cel\. 320 555 1234/.test(x))).toBe(true);
      expect(t.contactos).toHaveLength(1); // todavía nada: crear pasa por el botón
      colaModelo = [salidaModelo({ destino: { valor: 'Barú', frase: 'Barú' } })];
      await toca(boton('✅ Cargar'), { enviado: 15, interprete });
      expect(t.contactos.map(c => c.nombre)).toEqual(['CELMIRA ROJAS', 'CELMIRA ROJAS PEÑA']);
    });
  }

  it('el resumen que pregunta «¿Es la misma persona?»: el toque de «Sí, es la misma» la usa (en main entraba como «sí» y no cargaba nada)', async () => {
    t.contactos.push({ id: 'c-par', workspace_id: WS, nombre: 'PAOLA ANDREA RINCÓN DÍAZ', telefono: '3005551234', email: null, created_at: '2026-01-10T10:00:00Z' });
    await llega('nueva clienta Paola Rincón 300 555 1234', { enviado: 0 });
    await llega('quiere San Andrés en enero', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 6 });
    expect(ultimosBotones().map(b => b.title)).toEqual(['✅ Sí, es la misma', '❌ No, es otra', '🗑 Descartar']);
    await toca(boton('✅ Sí, es la misma'), { enviado: 10 });
    expect(textos().some(x => x.startsWith('Todavía no lo cargo'))).toBe(false);
    expect(textos().at(-1)).toMatch(/Viaje nuevo · Paola Andrea Rincón Díaz\*\nYa es cliente · cel\. …1234/);
    expect(ultimosBotones().map(b => b.title)).toEqual(['✅ Cargar', '🗑 Descartar']);
  });

  it('la fila de la ficha es ella: el viaje nuevo va a Celmira Rojas, sin crear a nadie', async () => {
    celmira();
    await llega('nuevo Celmira Rojas Peña 320 555 1234', { enviado: 0 });
    await toca(boton('1. Celmira Rojas'), { enviado: 2 });
    expect(textos().at(-1)).toMatch(/^Va como viaje nuevo de Celmira Rojas, el que ya tenemos/);
    await llega('quieren Barú para el puente', { enviado: 3, reenviado: true });
    await llega('listo', { enviado: 6 });
    colaModelo = [salidaModelo({ destino: { valor: 'Barú', frase: 'Barú' } })];
    await toca(boton('✅ Cargar'), { enviado: 10 });
    expect(t.contactos).toHaveLength(1);
    expect(t.negocios.filter(x => x.contacto_id === 'c-cr')).toHaveLength(2);
  });

  it('«¿Creo el cliente nuevo «X»?»: un «sí» escrito con palabras no crea (pide el toque); el toque de «Crear» sí', async () => {
    await preguntaDeViaje();
    elige(nuevo('Rosa Ibáñez'), 'nuevo', 'Rosa Ibáñez');
    colaModelo = [pedido()];
    await llega(nuevo('Rosa Ibáñez'), { enviado: 9 });
    expect(ultimosBotones().map(b => b.title)).toEqual(['Crear', 'No es nuevo', '🗑 Descartar']);
    elige('sí, créamela de una vez', 'crear');
    await llega('sí, créamela de una vez', { enviado: 20 });
    expect(textos().at(-1)).toMatch(/^Para crear el cliente, toca «Crear»\. No he creado nada\./);
    expect(t.contactos).toEqual([]);
    await toca(boton('Crear'), { enviado: 30 });
    expect(t.contactos.map(c => c.nombre)).toEqual(['ROSA IBÁÑEZ']);
  });

  it('«No es nuevo» vuelve a la lista de viajes sin crear a nadie; un toque de la confirmación ya cambiada no hace nada', async () => {
    await preguntaDeViaje();
    elige(nuevo('Rosa Ibáñez'), 'nuevo', 'Rosa Ibáñez');
    await llega(nuevo('Rosa Ibáñez'), { enviado: 9 });
    const crearViejo = boton('Crear');
    await toca(boton('No es nuevo'), { enviado: 20 });
    expect(textos().at(-1)).toMatch(/Entonces no creo a nadie\.[\s\S]*¿De qué viaje/);
    expect(ultimosBotones().map(b => b.title)).toEqual(['1. SAN ANDRÉS DIC', '2. BARILOCHE JUL 3-10', 'Viaje nuevo', 'Descartar']);
    await toca(crearViejo, { enviado: 30 });
    expect(textos().at(-1)).toMatch(/^Ese botón es de una pregunta que ya no está abierta/);
    expect(t.contactos).toEqual([]);
  });
});

// ── Bot híbrido (2026-10-06): la prueba de Mauricio de 12:01 a 12:21, de punta a punta ───────────────────────────
// La secuencia de los briefs del 2026-10-05 (respuestas a «me falta» y conversación con memoria), con textos inventados y
// las decisiones contestadas como las contestaría el comercial: con el número, con palabras (que lee el modelo) o con un
// toque. Lo que no es una decisión (las consultas, la memoria del viaje en foco) sigue igual que en main.

describe('bot híbrido (2026-10-06): la prueba de Mauricio de 12:01 a 12:21, de punta a punta', () => {
  function viajeDeDiego() {
    t.contactos.push({ id: 'c-dt', workspace_id: WS, nombre: 'DIEGO TORRES', telefono: '3006661122', email: null, created_at: '2026-01-10T10:00:00Z' });
    t.negocios.push({ ...negocioDePrueba('n-dt', 'D1 26 1', 'SAN ANDRÉS DIC', 'DIEGO TORRES'), contacto_id: 'c-dt' });
    t.negocio_bloques.push({ id: 'b-n-dt', negocio_id: 'n-dt', data: { destino: 'SAN ANDRÉS' }, updated_at: null, bloque_configs: { orden: 1, config_extra: { fields: FIELDS }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } });
  }
  const datosDel = (id: string) => t.negocio_bloques.find(b => b.negocio_id === id)!.data as Fila;
  const CARGA = salidaModelo({ destino: { valor: 'San Andrés', frase: 'San Andrés' }, adultos: { valor: '2', frase: '2 adultos' }, ninos: { valor: '1', frase: 'un niño' } });
  beforeEach(() => { bandeja.procesarEnElActo.activo = true; });

  for (const modo of ['apagado', 'prendido'] as const) {
    for (const como of ['número', 'palabras', 'toque'] as const) {
      it(`${modo}, la lista contestada con ${como}: 12:01 la consulta; 12:15 la lista; 12:17 «me falta» con «sí»; 12:19 las preguntas`, async () => {
        viajeDeDiego();
        const llamadas = { n: 0 };
        const interprete = modo === 'prendido' ? { llamadas } : undefined;
        // 12:01 · una consulta con una tanda abierta de viaje nuevo de un cliente que ya existe: solo lectura.
        await llega('vamos a hacer una cotización nueva para Diego Torres', { enviado: 0, interprete });
        await llega('que viajes están abiertos?', { enviado: 5, interprete });
        expect(textos().at(-1)).toMatch(/^Diego Torres tiene un viaje abierto|^Diego Torres tiene 1 viaje/);
        await llega('cancelar', { enviado: 8 });
        // 12:15 · la tanda sin encabezado y el «listo»: «¿De qué viaje es el mensaje?» con la lista de viajes.
        await llega('quieren ir a San Andrés del 10 al 15 de diciembre, son 2 adultos y un niño', { enviado: 10, reenviado: true });
        await llega('listo', { enviado: 15, interprete });
        expect(textos().at(-1)).toMatch(/¿De qué viaje es el mensaje\?\n1\. SAN ANDRÉS DIC · Diego Torres \(D1 26 1\)/);
        expect(enviados.at(-1)!.lista).toBe(true);
        colaModelo = [CARGA];
        const antesModelo = alModeloDeDecision.length;
        // 12:16 · la respuesta: el número (el código lo lee), unas palabras (las lee el modelo) o el toque de la fila. Con
        // palabras, el modelo reconoce el viaje pero no carga (2026-10-06): lo propone con [Sí, ese] y la lista, y el «sí»
        // escrito solo lo carga.
        if (como === 'número') await llega('1', { enviado: 20, interprete });
        if (como === 'palabras') {
          elige('el de san andrés de don diego', 'v1');
          await llega('el de san andrés de don diego', { enviado: 20, interprete });
          expect(textos().slice(-2)).toEqual(['¿Van en «SAN ANDRÉS DIC · Diego Torres · D1 26 1»? Toca «Sí, ese» o responde «sí». No he cargado nada.', 'Si no es ese, elige en la lista.']);
          expect(enviados.at(-1)!.lista).toBe(true);
          expect(t.wa_bandeja_entendimientos).toEqual([]);
          await llega('sí', { enviado: 22, interprete });
        }
        if (como === 'toque') await toca(boton('1. SAN ANDRÉS DIC'), { enviado: 20, interprete });
        expect(alModeloDeDecision.length - antesModelo).toBe(como === 'palabras' ? 1 : 0);
        expect(textos().slice(-2)).toEqual([
          'Listo, va a SAN ANDRÉS DIC · Diego Torres (D1 26 1). Lo estoy leyendo.',
          expect.stringMatching(/^Cargué en SAN ANDRÉS DIC · Diego Torres \(D1 26 1\): [\s\S]*me falta:/),
        ]);
        // 12:17 · lo que pedía «me falta», escrito: el resumen corto con «Cargar»; el «si» lo carga (exacto, sin el modelo).
        colaModelo = [salidaModelo({ categoria_hotel: { valor: '4', frase: 'lo quieren 4 estrellas' } })];
        await llega('El hotel lo quieren 4 estrellas', { enviado: 30, interprete });
        expect(textos().at(-1)).toBe('Anoto en SAN ANDRÉS DIC · Diego Torres (D1 26 1): «El hotel lo quieren 4 estrellas».');
        const m0 = alModeloDeDecision.length;
        await llega('si', { enviado: 32, interprete });
        expect(alModeloDeDecision.length).toBe(m0);
        expect(datosDel('n-dt')).toMatchObject({ categoria_hotel: '4' });
        // 12:19–12:21 · las preguntas sobre lo que falta: el viaje en foco (no son decisiones: no pasan por el punto).
        await llega('que faltaría para entregarlo completo?', { enviado: 60, interprete });
        expect(textos().at(-1)).toMatch(/^SAN ANDRÉS DIC · Diego Torres \(D1 26 1\) — Mínimo/);
        expect(textos().some(x => /¿De qué viaje\?/.test(x))).toBe(false);
        expect(llamadas.n).toBe(0);
      });
    }
  }

  it('si el modelo no responde cuando la lista se contesta con palabras, el bot no adivina: «No te entendí; toca una opción» y la lista; el toque carga', async () => {
    viajeDeDiego();
    await llega('quieren ir a San Andrés del 10 al 15 de diciembre, son 2 adultos y un niño', { enviado: 10, reenviado: true });
    await llega('listo', { enviado: 15 });
    decide('el de san andrés de don diego', null);
    await llega('el de san andrés de don diego', { enviado: 20 });
    expect(textos().at(-1)).toMatch(/^No te entendí; toca una opción\.\n.*¿De qué viaje son\?$/);
    expect(enviados.at(-1)!.lista).toBe(true);
    expect(t.wa_bandeja_entendimientos).toEqual([]);
    colaModelo = [CARGA];
    await toca(boton('1. SAN ANDRÉS DIC'), { enviado: 25 });
    expect(datosDel('n-dt')).toMatchObject({ adultos: 2 });
  });
});
