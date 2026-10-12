// ============================================================
// El nombre automático de un viaje (o de cualquier negocio): una plantilla de la LÍNEA sobre campos estructurados
// ------------------------------------------------------------
// Mauricio, 2026-10-12: «El nombre del viaje debería ser automático pero tener unos parámetros claros de cómo
// nombrarlo». Hasta hoy el nombre se ponía al crear y no cambiaba («MIAMI 7N» quedó con 6 noches).
//
// La regla vive en `lineas_negocio.config_extra.nombre_automatico` (no en el código), por línea:
//   { "plantilla": "{destino} {noches}N {mes}",       ← obligatoria; sin ella la línea no tiene nombre automático
//     "sin_datos": "Viaje de {cliente}",               ← mientras falte lo que `requiere`
//     "requiere": ["destino"],                         ← sin estos datos, va `sin_datos`
//     "max_destino": 18,                               ← el destino largo se abrevia
//     "campos": { "destino": "destino", "salida": "fecha_salida", "regreso": "fecha_regreso" } }
// Marcadores: {destino} (en mayúscula y abreviado), {noches} (de las fechas de salida y regreso), {dias} (noches + 1),
// {mes} (el de la salida, en tres letras), {anio} (dos cifras de la salida), {cliente}. Cada palabra de la plantilla que
// lleva un marcador sin dato se omite entera («{noches}N» sin fechas no deja una «N» suelta): «MIAMI» solo.
//
// Arma el nombre con campos que ya están en el viaje: no lee texto del comercial. Se recalcula cuando cambian esos
// campos (el bot, «Pegar conversación», la ficha) y SOLO si el nombre sigue siendo el automático
// (`negocios.metadata.nombre_auto` igual al nombre): si una persona lo renombró, no se pisa.
// ============================================================

import { nombrePropio } from './wa-entendimiento-reglas.ts';

export interface PlantillaNombre {
  plantilla: string;
  sinDatos: string;
  requiere: string[];
  maxDestino: number;
  campos: { destino: string; salida: string; regreso: string };
}

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const MARCADORES = ['destino', 'noches', 'dias', 'mes', 'anio', 'cliente'] as const;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const texto = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);

/** La regla de la línea (`config_extra` de `lineas_negocio`). `null`: la línea no tiene nombre automático. Pura. */
export function leerPlantillaNombre(configExtraLinea: unknown): PlantillaNombre | null {
  const n = obj(obj(configExtraLinea)?.nombre_automatico);
  const plantilla = typeof n?.plantilla === 'string' ? n.plantilla.trim() : '';
  if (!n || !plantilla) return null;
  const c = obj(n.campos) ?? {};
  const max = Number(n.max_destino);
  return {
    plantilla,
    sinDatos: texto(n.sin_datos, 'Viaje de {cliente}'),
    requiere: Array.isArray(n.requiere) ? n.requiere.filter((x): x is string => typeof x === 'string') : ['destino'],
    maxDestino: Number.isInteger(max) && max >= 4 ? max : 18,
    campos: { destino: texto(c.destino, 'destino'), salida: texto(c.salida, 'fecha_salida'), regreso: texto(c.regreso, 'fecha_regreso') },
  };
}

function fecha(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/**
 * El destino en mayúscula y, si pasa de `max`, abreviado: primero los lugares que quepan («San Andrés y Providencia» →
 * «SAN ANDRÉS»), y si el primero tampoco cabe, las palabras que quepan. Formatea el valor del campo; no lo interpreta.
 */
export function destinoCorto(destino: string, max: number): string {
  const t = destino.replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-CO');
  if (t.length <= max) return t;
  const lugares = t.split(/\s*[,;/]\s*|\s+-\s+|\s+[YE]\s+/u).filter(Boolean);
  let out = '';
  for (const l of lugares) {
    const junto = out ? `${out} - ${l}` : l;
    if (junto.length > max) break;
    out = junto;
  }
  if (out) return out;
  const palabras = lugares[0].split(' ');
  for (const w of palabras) {
    const junto = out ? `${out} ${w}` : w;
    if (junto.length > max) break;
    out = junto;
  }
  return out || lugares[0].slice(0, max);
}

/** Los valores de los marcadores, de los campos del viaje. Vacío = no hay dato. Pura. */
function marcadores(p: PlantillaNombre, valores: Obj, cliente: string | null): Record<(typeof MARCADORES)[number], string> {
  const destino = typeof valores[p.campos.destino] === 'string' ? String(valores[p.campos.destino]).trim() : '';
  const salida = fecha(valores[p.campos.salida]);
  const regreso = fecha(valores[p.campos.regreso]);
  const noches = salida && regreso ? Math.round((Date.parse(`${regreso}T12:00:00Z`) - Date.parse(`${salida}T12:00:00Z`)) / 86_400_000) : 0;
  return {
    destino: destino ? destinoCorto(destino, p.maxDestino) : '',
    noches: noches > 0 ? String(noches) : '',
    dias: noches > 0 ? String(noches + 1) : '',
    mes: salida ? MESES[Number(salida.slice(5, 7)) - 1] : '',
    anio: salida ? salida.slice(2, 4) : '',
    cliente: nombrePropio(cliente ?? '').trim(),
  };
}

/**
 * Rellena una plantilla: la palabra con un marcador sin dato se omite entera. `todo`: si algún marcador no tiene dato,
 * nada (el provisional «Viaje de {cliente}» sin cliente no queda en «Viaje de»). Pura.
 */
function rellenar(plantilla: string, m: Record<string, string>, todo = false): string {
  if (todo && [...plantilla.matchAll(/\{(\w+)\}/g)].some((x) => !m[x[1]])) return '';
  return plantilla.split(/\s+/).map((palabra) => {
    let falta = false;
    const out = palabra.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = m[k] ?? '';
      if (!v) falta = true;
      return v;
    });
    return falta ? '' : out;
  }).filter(Boolean).join(' ');
}

/**
 * El nombre del viaje con la regla de su línea y lo que el viaje tiene. Sin lo que `requiere`, el de `sin_datos`
 * («Viaje de Martin Mora», `provisional`); si tampoco sale nada, `null` (se deja el que tiene). Pura.
 */
export function nombreSegunPlantilla(p: PlantillaNombre, valores: Obj, cliente: string | null): { nombre: string; provisional: boolean } | null {
  const m = marcadores(p, valores, cliente);
  const provisional = p.requiere.some((k) => (MARCADORES as readonly string[]).includes(k) && !m[k as keyof typeof m]);
  const nombre = (provisional ? rellenar(p.sinDatos, m, true) : rellenar(p.plantilla, m).toLocaleUpperCase('es-CO')).trim();
  return nombre ? { nombre, provisional } : null;
}

// ── En la base ───────────────────────────────────────────────────────────────

/** El cliente de Supabase del bot (Deno) o de la app (Next): solo se usa `from(...)`. */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

const relUno = (v: unknown): Obj | null => (Array.isArray(v) ? (v[0] as Obj | undefined) ?? null : obj(v));

/** La regla de la línea de un negocio. `null` si la línea no tiene nombre automático o no se pudo leer. */
export async function plantillaDeLinea(db: Db, lineaId: string | null | undefined): Promise<PlantillaNombre | null> {
  if (!lineaId) return null;
  try {
    const { data, error } = await db.from('lineas_negocio').select('config_extra').eq('id', lineaId).maybeSingle();
    if (error || !data) return null;
    return leerPlantillaNombre((data as Obj).config_extra);
  } catch {
    // Sin la regla, la convención de siempre: un nombre no frena la creación ni la carga.
    return null;
  }
}

/** Los valores de los bloques de datos del negocio, como los ve la ficha (`aplanarBloques` en orden). */
async function valoresDelNegocio(db: Db, negocioId: string): Promise<Obj | null> {
  const { data, error } = await db.from('negocio_bloques')
    .select('data, bloque_configs(orden, bloque_definitions(tipo), etapas_negocio(orden))').eq('negocio_id', negocioId);
  if (error) return null;
  const filas = ((data ?? []) as Obj[]).map((b) => {
    const bc = relUno(b.bloque_configs) ?? {};
    return { data: obj(b.data) ?? {}, tipo: relUno(bc.bloque_definitions)?.tipo, etapa: Number(relUno(bc.etapas_negocio)?.orden ?? 0), orden: Number(bc.orden ?? 0) };
  }).filter((b) => b.tipo === 'datos').sort((a, b) => a.etapa - b.etapa || a.orden - b.orden);
  const valores: Obj = {};
  for (const b of filas) {
    for (const [k, v] of Object.entries(b.data)) {
      const vacio = valores[k] === undefined || valores[k] === null || valores[k] === '';
      if (vacio) valores[k] = v;
    }
  }
  return valores;
}

/**
 * Rehace el nombre de un negocio con la regla de su línea, si el nombre sigue siendo el automático. Devuelve el nombre
 * que quedó (o `null` si no hizo nada). Nunca lanza: un nombre que no se pudo rehacer no frena la escritura que lo pidió.
 * `cambiados`: los campos que acaban de cambiar; si se dan y ninguno es de la plantilla, no consulta nada más.
 */
export async function renombrarSegunPlantilla(db: Db, negocioId: string, cambiados?: ReadonlyArray<string>): Promise<string | null> {
  try {
    const { data: neg, error } = await db.from('negocios').select('id, nombre, metadata, linea_id, contactos(nombre)').eq('id', negocioId).maybeSingle();
    if (error || !neg) return null;
    const n = neg as Obj;
    const actual = typeof n.nombre === 'string' ? n.nombre : '';
    const meta = obj(n.metadata) ?? {};
    // Un nombre que una persona escribió o cambió no se pisa.
    if (!actual || meta.nombre_auto !== actual) return null;
    const p = await plantillaDeLinea(db, n.linea_id as string | null);
    if (!p) return null;
    if (cambiados && !cambiados.some((k) => k === p.campos.destino || k === p.campos.salida || k === p.campos.regreso)) return null;
    const valores = await valoresDelNegocio(db, negocioId);
    if (!valores) return null;
    const r = nombreSegunPlantilla(p, valores, (relUno(n.contactos)?.nombre as string | undefined) ?? null);
    if (!r || r.nombre === actual) return null;
    const nuevo = r.nombre;
    // Solo si el nombre sigue siendo ese en este instante (una edición a mano entre tanto gana).
    const { data: hecho, error: e2 } = await db.from('negocios')
      .update({ nombre: nuevo, metadata: { ...meta, nombre_auto: nuevo, nombre_provisional: r.provisional } })
      .eq('id', negocioId).eq('nombre', actual).select('id');
    if (e2 || !(hecho ?? []).length) {
      if (e2) console.error(`[nombre-viaje] no se pudo renombrar ${negocioId}:`, (e2 as { message?: string }).message);
      return null;
    }
    return nuevo;
  } catch (e) {
    console.error(`[nombre-viaje] ${negocioId}:`, String(e).slice(0, 120));
    return null;
  }
}
