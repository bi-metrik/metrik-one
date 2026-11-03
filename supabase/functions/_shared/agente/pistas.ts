// ============================================================
// Pistas para transcribir notas de voz (spec 2026-10-26, §4.6; regla 7 del ADN de los asistentes)
// ------------------------------------------------------------
// Gemini transcribe mejor los nombres y los códigos si sabe cuáles pueden aparecer. Las pistas salen de la base del
// workspace en el momento (lector en `pistas-supabase.ts`) y de las funciones del rol por su gancho `pistas` (el de
// `agente/funciones/tipos.ts`; la composición del turno las entrega con `fuentesDeComposicion`):
//   · nombres del equipo y de los colaboradores;
//   · clientes de los negocios abiertos (la empresa, o el contacto si es persona natural) y el nombre corto del negocio;
//   · el FORMATO de los códigos («I1 26 5») con los prefijos de empresa en uso, nunca la lista de códigos;
//   · lo que aporten las funciones (servicios del portafolio, la experiencia vigente);
//   · los proveedores de los gastos recientes, por la descripción («Supabase», «Vercel Pro», «Resend») y el
//     `vocabulario` fijo de la configuración, para marcas que todavía no están en la base (2026-10-26, caso real:
//     «suscripción a Resend» se transcribió «Recent Pro»).
// Con tope por turno (cantidad y caracteres) para no inflar el prompt.
//
// El riesgo: que la transcripción meta un nombre de la lista que no se dijo. Por eso el bloque dice que se usen solo
// para escribir bien lo que SÍ se oye, y el arnés de audios mide la inserción falsa (`arnes/audios/`). Las pistas solo
// se prenden si mejoran nombres y códigos sin subirla.
//
// Interruptor: `config_extra.bot_conversacional.transcripcion.pistas === true` (apagado por defecto). Apagado no se lee
// la base ni cambia el prompt. Puro: el arnés usa exactamente estas funciones.
// ============================================================

export interface NegocioPista {
  codigo: string | null;
  nombre: string | null;
  /** La empresa del negocio o, si es persona natural, el contacto. */
  cliente: string | null;
}

/** Lo que el lector trae de la base. Nombres crudos: aquí se limpian, se ordenan y se recortan. */
export interface BasePistas {
  equipo: string[];
  colaboradores: string[];
  /** Negocios abiertos, del más reciente al más viejo. */
  negocios: NegocioPista[];
  /** Descripciones de los gastos recientes, del más reciente al más viejo (de ahí sale el proveedor). */
  gastos?: string[];
}

export interface OpcionesPistas {
  /** Máximo de palabras en la lista. */
  tope?: number;
  /** Máximo de caracteres de la lista (sin el encabezado ni la línea de códigos). */
  maxCaracteres?: number;
  /**
   * `false` en el asistente público: quien habla es un cliente, y los nombres de los otros clientes no entran a su
   * transcripción (una inserción falsa pondría el nombre de un tercero en su conversación). Por defecto `true`.
   */
  incluirClientes?: boolean;
  /** Lo que aportan las funciones del rol por su gancho (`pistasDeFunciones`). */
  extras?: string[];
  /** El `vocabulario` fijo de la configuración: va primero. */
  vocabulario?: string[];
}

export const TOPE_PISTAS = 40;
export const MAX_CARACTERES_PISTAS = 900;
const LARGO_MAXIMO_PISTA = 40;
const MAX_PREFIJOS = 12;

export const ENCABEZADO_PISTAS =
  'Palabras que pueden aparecer (nombres del equipo, clientes, obras o servicios de esta empresa). Úsalas solo para escribir bien lo que SÍ se dice en el audio: si una no se oye, no la escribas, y si se oye un nombre que no está en la lista, escríbelo como suena.';

/** Sin tildes, minúsculas, espacios simples: la llave para no repetir una pista. Pura. */
export function llavePista(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Una pista limpia: una línea, sin comillas ni separadores de la lista, hasta 40 caracteres cortando en palabra. Pura. */
export function limpiarPista(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.replace(/[\r\n\t;«»"“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > LARGO_MAXIMO_PISTA) {
    const corte = s.slice(0, LARGO_MAXIMO_PISTA + 1);
    const i = corte.lastIndexOf(' ');
    s = (i >= 12 ? corte.slice(0, i) : s.slice(0, LARGO_MAXIMO_PISTA)).trim();
  }
  return s.length >= 2 ? s : null;
}

/**
 * El nombre corto de un negocio u obra: lo de antes de « - », «(», «:», «|» o «/», y como mucho 5 palabras.
 * «Cubierta Alameda - impermeabilización total» → «Cubierta Alameda». Pura.
 */
export function nombreCorto(nombre: string | null | undefined): string | null {
  if (!nombre) return null;
  const base = nombre.split(/\s[-–—]\s|[(:|/]/)[0] ?? '';
  return limpiarPista(base.trim().split(/\s+/).slice(0, 5).join(' '));
}

/**
 * El proveedor de un gasto por su descripción: lo de antes de « — », «(», «,», «;», «:» o «$», desde la primera palabra
 * con mayúscula y como mucho 4 palabras. «suscripción a Resend» → «Resend»; «Vercel Pro (infra MeTRIK…) — agosto» →
 * «Vercel Pro». Sin mayúscula no hay nombre propio: `null` («invitacion café cierre»). Pura.
 */
export function proveedorDeGasto(descripcion: string | null | undefined): string | null {
  if (!descripcion) return null;
  const base = descripcion.split(/\s[-–—]\s|[(,;:|$]/)[0] ?? '';
  const palabras = base.trim().split(/\s+/);
  const i = palabras.findIndex((w) => /^\p{Lu}/u.test(w));
  if (i < 0) return null;
  return limpiarPista(palabras.slice(i, i + 4).join(' '));
}

const RE_CODIGO = /^([A-ZÑ]+\d*) (\d{2}) (\d+)$/;

/**
 * La línea del formato de los códigos de negocio, sin la lista: los prefijos de empresa en uso y un ejemplo armado con
 * el primero, el año más reciente y el consecutivo 1. `null` si no hay códigos con el formato. Pura.
 */
export function formatoDeCodigos(codigos: Array<string | null | undefined>): string | null {
  const prefijos: string[] = [];
  let anio = '';
  for (const c of codigos) {
    const m = RE_CODIGO.exec(String(c ?? '').trim().toUpperCase());
    if (!m) continue;
    if (!prefijos.includes(m[1]) && prefijos.length < MAX_PREFIJOS) prefijos.push(m[1]);
    if (m[2] > anio) anio = m[2];
  }
  if (!prefijos.length) return null;
  return `Los códigos de negocio son el código de la empresa (letra y número), el año en dos dígitos y un consecutivo, separados por espacios, como «${prefijos[0]} ${anio} 1». Si dictan uno, escríbelo en esa forma. Códigos de empresa en uso: ${prefijos.join(', ')}.`;
}

/**
 * La lista ordenada, sin repetidos y con el tope: vocabulario, equipo, colaboradores, funciones, clientes, negocios y
 * proveedores. Pura.
 */
export function listaDePistas(base: BasePistas, o: OpcionesPistas = {}): string[] {
  const tope = Math.max(0, Math.floor(o.tope ?? TOPE_PISTAS));
  const maxCar = o.maxCaracteres ?? MAX_CARACTERES_PISTAS;
  const incluirClientes = o.incluirClientes !== false;
  const candidatas: unknown[] = [
    ...(o.vocabulario ?? []),
    ...base.equipo,
    ...base.colaboradores,
    ...(o.extras ?? []),
    ...(incluirClientes ? base.negocios.map((n) => n.cliente) : []),
    ...(incluirClientes ? base.negocios.map((n) => nombreCorto(n.nombre)) : []),
    ...(base.gastos ?? []).map(proveedorDeGasto),
  ];
  const vistas = new Set<string>();
  const out: string[] = [];
  let largo = 0;
  for (const c of candidatas) {
    if (out.length >= tope) break;
    const p = limpiarPista(c);
    if (!p) continue;
    const k = llavePista(p);
    if (vistas.has(k)) continue;
    if (largo + p.length + 2 > maxCar) break;
    vistas.add(k);
    out.push(p);
    largo += p.length + 2;
  }
  return out;
}

/**
 * El bloque que se pega al prompt (`promptConPistas`, `_shared/transcripcion.ts`). `null` si no hay nada que decir.
 * En el asistente público (`incluirClientes: false`) tampoco va el formato de los códigos: un cliente no los dicta. Pura.
 */
export function textoPistas(base: BasePistas, o: OpcionesPistas = {}): string | null {
  const lista = listaDePistas(base, o);
  const formato = o.incluirClientes === false ? null : formatoDeCodigos(base.negocios.map((n) => n.codigo));
  if (!lista.length && !formato) return null;
  const lineas = [ENCABEZADO_PISTAS];
  if (lista.length) lineas.push(lista.join('; '));
  if (formato) lineas.push(formato);
  return lineas.join('\n');
}

// ── El interruptor ───────────────────────────────────────────────────────────

export interface ConfigTranscripcion {
  pistas: boolean;
  tope: number;
  /** Palabras fijas de la empresa (marcas, proveedores): `transcripcion.vocabulario`, hasta 40. */
  vocabulario: string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);

/**
 * Lee `bot_conversacional.transcripcion`. Solo `pistas: true` literal las prende; el tope va de 5 a 80; del
 * `vocabulario` solo las cadenas, hasta 40. Pura.
 */
export function leerConfigTranscripcion(botConversacional: unknown): ConfigTranscripcion {
  const t = obj(obj(botConversacional)?.transcripcion);
  const tope = t?.tope;
  const vocabulario = Array.isArray(t?.vocabulario) ? (t!.vocabulario as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 40) : [];
  return {
    pistas: t?.pistas === true,
    tope: typeof tope === 'number' && Number.isFinite(tope) ? Math.min(80, Math.max(5, Math.floor(tope))) : TOPE_PISTAS,
    vocabulario,
  };
}

/**
 * Las pistas de este turno, o `null`. Apagado: `null` sin llamar a `leer` (ni una consulta más que hoy). Si leer la
 * base falla, `null`: la nota se transcribe como siempre. Nunca lanza.
 */
export async function pistasSiEncendidas(
  config: ConfigTranscripcion,
  leer: () => Promise<{ base: BasePistas; extras?: string[] } | null>,
  o: Pick<OpcionesPistas, 'incluirClientes'> = {},
): Promise<string | null> {
  if (!config.pistas) return null;
  try {
    const r = await leer();
    if (!r) return null;
    return textoPistas(r.base, { ...o, tope: config.tope, extras: r.extras, vocabulario: config.vocabulario });
  } catch (e) {
    console.error('[pistas] no se pudieron armar las pistas, se transcribe sin ellas:', e);
    return null;
  }
}

// ── El gancho de las funciones (componedor) ────────────────────────────────────────

/**
 * La forma del gancho que declara una función del componedor (`Funcion.pistas`, `agente/funciones/tipos.ts`).
 * Estructural: una `Funcion` encaja aquí tal cual (lo comprueba `pistas.test.ts`).
 */
export interface FuenteDePistas {
  pistas?(ctx: { workspaceId: string; parametros: Record<string, unknown> }): Promise<string[]>;
}

/** Una función del turno con los parámetros con que la empresa la prendió. */
export interface FuentePistaDelTurno {
  funcion: FuenteDePistas;
  parametros: Record<string, unknown>;
}

/**
 * Las fuentes de pistas de una composición (`componerDominio`, `componer.ts`): cada función que quedó en el turno
 * (comunes incluidas), con sus parámetros. Las que el componedor dejó fuera (sin motor, sin lo que requieren) no
 * aportan. Estructural, para no importar el componedor. Pura.
 */
export function fuentesDeComposicion(c: {
  funciones: Array<FuenteDePistas & { clave: string }>;
  parametros: Record<string, Record<string, unknown>>;
}): FuentePistaDelTurno[] {
  return c.funciones.map((funcion) => ({ funcion, parametros: c.parametros[funcion.clave] ?? {} }));
}

/** Junta lo que aportan las funciones del rol. La que falla o no tiene gancho no aporta; nunca lanza. */
export async function pistasDeFunciones(
  funciones: FuentePistaDelTurno[],
  workspaceId: string,
): Promise<string[]> {
  const partes = await Promise.all(funciones.map(async ({ funcion, parametros }) => {
    if (!funcion.pistas) return [];
    try {
      const r = await funcion.pistas({ workspaceId, parametros });
      return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : [];
    } catch (e) {
      console.error('[pistas] una función no pudo dar sus pistas:', e);
      return [];
    }
  }));
  return partes.flat();
}
