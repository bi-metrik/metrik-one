/**
 * Clasificación por tier de las fuentes devueltas por Informa/SEIYA
 * (dictamen 2026-08-25, `proyectos/afi/alma/docs/entrada/2026-08-25_dictamen-tier-listas.md`).
 *
 * Qué resuelve: hoy la severidad de una consulta es binaria —hay coincidencia o
 * no— y por eso trata igual un acto del Consejo de Seguridad de la ONU y una
 * nota de El Tiempo. Medido en `alma-afi` el 2026-08-25: 50 coincidencias, cero
 * en lista vinculante, y la mitad son menciones de prensa.
 *
 * Qué NO hace, a propósito: no emite veredicto, no decide bandeja y no toca
 * `DualSeveridad`.
 *
 * Desde el 2026-08-31 la clasificación SÍ se persiste y se mide (concepto de
 * Emilio, bloque A). Sigue sin decidir nada: que el tier tenga efecto sobre una
 * contratación es el bloque B, y exige instrumentos contractuales que hoy no
 * existen. `puedeEmitirVeredicto` y `canalDeExigencia` están acá para que ese
 * día nadie pueda saltarse el gate por descuido.
 *
 * Vive fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async, y porque la regla tiene que poder probarse sin base de datos
 * — mismo criterio que `liberaciones.ts`.
 */

import type { InformaMatch } from '@/lib/actions/compliance-dual';

// ─── Vocabulario ───────────────────────────────────────────────────────────

/**
 * Los cinco resultados del criterio del §1. NO son puntos de una escala: son
 * naturalezas jurídicas distintas, y por eso no se suman (ver `tierMaximo`).
 */
export type Tier = 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4' | 'medios';

/**
 * `sin_clasificar` NO es un tier del catálogo: es la ausencia de fila. Existe
 * solo como resultado de la clasificación, y es el blindaje del §1.4 — una
 * fuente que no está en el catálogo no es "medios" y no es "no dispara".
 */
export type TierResuelto = Tier | 'sin_clasificar';

export type LlaveTipo = 'fuente' | 'lista';

export type FamiliaFuente =
  | 'vinculante'
  | 'pep'
  | 'sanciones_extranjeras'
  | 'judicial'
  | 'contratacion_publica'
  | 'ambiental'
  | 'medios';

export type CatalogoStatus = 'propuesta' | 'validada_tecnica' | 'vigente' | 'historica';

/** Una fila de `compliance_tier_fuentes`. */
export type FuenteCatalogada = {
  llave_tipo: LlaveTipo;
  /** Ya normalizada con `normalizarLlave`. */
  llave: string;
  tier: Tier;
  familia: FamiliaFuente;
  provisional: boolean;
  etiqueta: string;
  sustento: string;
  /** Fuentes que reempaquetan a otras comparten grupo. NULL = no agrupa. */
  grupo_dedup: string | null;
};

export type CatalogoTier = {
  version: number;
  status: CatalogoStatus;
  fuentes: readonly FuenteCatalogada[];
};

// ─── Normalización de la llave ─────────────────────────────────────────────

/**
 * La llave del catálogo, normalizada.
 *
 * Por qué mayúsculas + sin tildes + espacios colapsados: los códigos llegan del
 * proveedor sin garantía de forma, y dos escrituras del mismo código que
 * resuelvan a filas distintas convierten una fuente clasificada en
 * `sin_clasificar`. Eso no rompe nada —`sin_clasificar` dispara— pero ensucia el
 * indicador que mide si el catálogo está completo.
 *
 * NO se quitan guiones ni puntuación: `NSN MEDIOS` y `NSN-MEDIOS` serían códigos
 * distintos del proveedor, no dos escrituras del mismo. Normalizar de más
 * colapsaría fuentes que no son la misma.
 */
export function normalizarLlave(valor: string | null | undefined): string | null {
  const v = (valor ?? '')
    .normalize('NFD')
    // Rango de marcas diacríticas combinantes: quita la tilde y deja la letra.
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return v || null;
}

// ─── Índice del catálogo ───────────────────────────────────────────────────

export type CatalogoIndexado = {
  version: number;
  status: CatalogoStatus;
  /**
   * Si este catálogo puede sustentar una decisión en producción.
   *
   * Solo `vigente`, y una versión solo llega a `vigente` con firma jurídica (lo
   * exige un CHECK en la base). La versión 1 nace en `validada_tecnica`: tiene la
   * firma técnica de Lucía y le falta la del representante legal.
   *
   * El clasificador SIGUE clasificando con un catálogo no operable —así se puede
   * medir la cobertura antes de firmar— pero quien emita un veredicto tiene que
   * mirar esta bandera primero.
   */
  opera: boolean;
  porFuente: ReadonlyMap<string, FuenteCatalogada>;
  porLista: ReadonlyMap<string, FuenteCatalogada>;
};

export function indexarCatalogo(catalogo: CatalogoTier): CatalogoIndexado {
  const porFuente = new Map<string, FuenteCatalogada>();
  const porLista = new Map<string, FuenteCatalogada>();

  for (const f of catalogo.fuentes) {
    const llave = normalizarLlave(f.llave);
    if (!llave) continue;
    const destino = f.llave_tipo === 'lista' ? porLista : porFuente;
    destino.set(llave, { ...f, llave });
  }

  return {
    version: catalogo.version,
    status: catalogo.status,
    opera: catalogo.status === 'vigente',
    porFuente,
    porLista,
  };
}

// ─── Clasificación de una coincidencia ─────────────────────────────────────

export type CoincidenciaClasificada = {
  /** Posición en `matches[]`. Es lo que permite señalar el ítem en pantalla. */
  indice: number;
  lista: string | null;
  /** `detalle.fuente`: código estable para todo lo que no es medios. */
  fuente: string | null;
  nombre: string | null;
  tier: TierResuelto;
  familia: FamiliaFuente | null;
  provisional: boolean;
  etiqueta: string;
  sustento: string | null;
  /** Cuál de los dos campos resolvió, o null si no resolvió ninguno. */
  llaveResuelta: { tipo: LlaveTipo; valor: string } | null;
  /** `nit`, `nombrebusqueda`… tal como lo manda el proveedor. */
  coincidencia: string | null;
  /** Llega como texto en el jsonb ("80"); aquí ya es número. */
  porcentaje: number | null;
  identidadPorDocumento: boolean;
  /**
   * Solo para fuentes con `grupo_dedup`. null = esta coincidencia no participa
   * de la deduplicación y nunca se descarta.
   */
  claveDedup: string | null;
};

const ETIQUETA_SIN_CLASIFICAR = 'Fuente no clasificada';

/**
 * Clasifica UNA coincidencia.
 *
 * Orden de resolución: primero `detalle.fuente`, después `lista`. La razón está
 * en el §1.3 y en la advertencia técnica del dictamen: para todo lo que no es
 * medios, `fuente` es un código estable (`OFAC`, `PEPINT`, `CSL`…), mientras que
 * el nombre visible de la lista ya llega con mojibake en producción
 * (`USA WANTED: NARCOTICS REWARDS PROGRAM—MISCELLANEOUS TARGETS`, guion largo
 * UTF-8 leído como latin-1). Si la llave fuera el texto visible, un cambio de
 * codificación aguas arriba silenciaría una lista clasificada.
 *
 * La caída a `lista` es lo que resuelve los dos casos de cardinalidad abierta:
 * medios —donde `fuente` es el nombre del medio, 14 distintos bajo la única lista
 * `NSN MEDIOS`— y la lista PEP del Decreto 830, cuya `fuente` es un texto con
 * fecha adentro en vez de un código.
 *
 * Lo que no resuelve por ninguna de las dos vías es `sin_clasificar`, que
 * DISPARA (§1.4). No se degrada a "medios" ni a "no dispara": es el único
 * blindaje contra un falso negativo por omisión de catálogo.
 */
export function clasificarCoincidencia(
  match: InformaMatch,
  indice: number,
  catalogo: CatalogoIndexado,
): CoincidenciaClasificada {
  const fuenteCruda = match.detalle?.fuente ?? null;
  const listaCruda = match.lista ?? null;

  const fuenteNorm = normalizarLlave(fuenteCruda);
  const listaNorm = normalizarLlave(listaCruda);

  let fila: FuenteCatalogada | undefined;
  let llaveResuelta: { tipo: LlaveTipo; valor: string } | null = null;

  if (fuenteNorm) {
    fila = catalogo.porFuente.get(fuenteNorm);
    if (fila) llaveResuelta = { tipo: 'fuente', valor: fuenteNorm };
  }
  if (!fila && listaNorm) {
    fila = catalogo.porLista.get(listaNorm);
    if (fila) llaveResuelta = { tipo: 'lista', valor: listaNorm };
  }

  const coincidencia = match.detalle?.coincidencia ?? null;
  const base = {
    indice,
    lista: listaCruda,
    fuente: fuenteCruda,
    nombre: match.nombre ?? null,
    coincidencia,
    porcentaje: porcentajeNumerico(match.detalle?.porcentajeDeCoincidencia),
    identidadPorDocumento: esIdentidadPorDocumento(coincidencia),
  };

  if (!fila) {
    return {
      ...base,
      tier: 'sin_clasificar',
      familia: null,
      provisional: false,
      etiqueta: ETIQUETA_SIN_CLASIFICAR,
      sustento: null,
      llaveResuelta: null,
      claveDedup: null,
    };
  }

  return {
    ...base,
    tier: fila.tier,
    familia: fila.familia,
    provisional: fila.provisional,
    etiqueta: fila.etiqueta,
    sustento: fila.sustento,
    llaveResuelta,
    claveDedup: claveDedup(fila, match),
  };
}

/**
 * El porcentaje viaja como texto en el jsonb (`"80"`), no como número. Se parsea
 * aquí y no en cada consumidor para que la comparación numérica no dependa de
 * quién se acordó de convertirlo.
 */
function porcentajeNumerico(valor: string | number | null | undefined): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;
  const n = Number(valor.trim().replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Identidad confirmada por documento.
 *
 * Se define por exclusión —cualquier cosa que NO sea búsqueda por nombre— y no
 * por lista blanca de tipos de documento. Si el proveedor agrega mañana un tipo
 * nuevo (`cedula`, `pasaporte`), la lista blanca lo trataría como identidad débil
 * y le bajaría el escrutinio; por exclusión queda del lado que exige más. En una
 * duda sobre identidad, el lado que exige más es el correcto.
 *
 * Medido el 2026-08-25: solo 4 de 50 coincidencias son por documento.
 */
function esIdentidadPorDocumento(coincidencia: string | null): boolean {
  const c = (coincidencia ?? '').trim().toLowerCase();
  if (!c) return false;
  return c !== 'nombrebusqueda';
}

/**
 * Clave de deduplicación entre fuentes que reempaquetan a otras.
 *
 * El caso concreto: la Consolidated Screening List agrega OFAC, así que la misma
 * entidad puede llegar por las dos. Es un hallazgo, no dos.
 *
 * Dos decisiones que acotan el alcance:
 *
 *   - Solo deduplica lo que el catálogo agrupó explícitamente (`grupo_dedup`).
 *     Una fuente sin grupo NUNCA se descarta: si dedupliáramos por llave, las 25
 *     menciones de prensa de una misma persona colapsarían en una y destruiríamos
 *     el conteo de concentración de medios, que es justo la cifra que sustenta el
 *     diseño ante ALMA.
 *   - La identidad del grupo es el NOMBRE ENCONTRADO, no el documento. El
 *     documento que devuelve el proveedor no sirve para esto: en producción trae
 *     valores como `MALE` y `NOREGISTRA` en el mismo campo. El nombre sí coincide
 *     entre OFAC y CSL porque CSL reempaqueta el registro de OFAC.
 */
function claveDedup(fila: FuenteCatalogada, match: InformaMatch): string | null {
  if (!fila.grupo_dedup) return null;
  const nombre =
    normalizarLlave(match.detalle?.nombreEncontrado) ?? normalizarLlave(match.nombre) ?? '';
  return `${fila.grupo_dedup}|${nombre}`;
}

// ─── Tier de la consulta ───────────────────────────────────────────────────

/**
 * Precedencia para "el tier máximo presente". NO es una escala que se sume: es
 * un orden de lectura entre naturalezas jurídicas distintas (§5). Cinco menciones
 * de prensa no igualan un OFAC, con ningún número.
 *
 * `sin_clasificar` va debajo de Tier 3 a propósito. Los dos disparan, pero si una
 * consulta cruzó OFAC y además trajo una fuente nueva, el tier máximo que se
 * reporta tiene que ser el hallazgo conocido — decir "sin clasificar" escondería
 * el OFAC detrás de una etiqueta de catálogo incompleto. Que `sin_clasificar`
 * dispara se lee en `haySinClasificar`, no en la posición del orden.
 */
const PRECEDENCIA: readonly TierResuelto[] = [
  'tier_1',
  'tier_3',
  'sin_clasificar',
  'tier_2',
  'tier_4',
  'medios',
];

const RANGO: ReadonlyMap<TierResuelto, number> = new Map(
  PRECEDENCIA.map((t, i) => [t, i] as const),
);

/** El más alto de dos tiers. Sin suma, sin promedio: gana uno de los dos. */
export function tierMasAlto(a: TierResuelto, b: TierResuelto): TierResuelto {
  return (RANGO.get(a) ?? PRECEDENCIA.length) <= (RANGO.get(b) ?? PRECEDENCIA.length) ? a : b;
}

export type ConsultaClasificada = {
  catalogoVersion: number;
  /** Ver `CatalogoIndexado.opera`. Quien emita un veredicto lo mira primero. */
  opera: boolean;
  /** null cuando la consulta no trajo coincidencias. */
  tierMaximo: TierResuelto | null;
  /** Los tiers presentes, en orden de precedencia. Para la composición de bandeja. */
  tiersPresentes: TierResuelto[];
  /** Coincidencias ya deduplicadas. Es lo que se cuenta como hallazgo. */
  hallazgos: CoincidenciaClasificada[];
  /** Las que colapsaron contra otra del mismo grupo. Se conservan: no desaparece nada. */
  duplicados: CoincidenciaClasificada[];
  /** Fuentes que el catálogo no resolvió. Alimenta el indicador central del §6.A. */
  fuentesSinClasificar: string[];
  haySinClasificar: boolean;
  /** Alguna clasificación no es firme (hoy: NSNLAT). */
  hayProvisional: boolean;
  hayIdentidadPorDocumento: boolean;
};

/**
 * Clasifica una consulta completa.
 *
 * El tier de la consulta es el MÁXIMO presente, nunca la suma ni el conteo
 * (§5). Dentro de un mismo tier el número de coincidencias no cambia nada: solo
 * ordena. Medios y Tier 4 no escalan por acumulación con ningún número.
 */
export function clasificarConsulta(
  matches: readonly InformaMatch[] | null | undefined,
  catalogo: CatalogoIndexado,
): ConsultaClasificada {
  const hallazgos: CoincidenciaClasificada[] = [];
  const duplicados: CoincidenciaClasificada[] = [];
  const vistas = new Set<string>();
  const sinClasificar = new Set<string>();

  let tierMaximo: TierResuelto | null = null;
  const presentes = new Set<TierResuelto>();
  let hayProvisional = false;
  let hayIdentidadPorDocumento = false;

  (matches ?? []).forEach((match, i) => {
    const c = clasificarCoincidencia(match, i, catalogo);

    if (c.claveDedup) {
      if (vistas.has(c.claveDedup)) {
        // Se descarta como hallazgo pero NO se pierde: queda en `duplicados`
        // para poder mostrar por qué dos filas del proveedor son un solo caso.
        duplicados.push(c);
        return;
      }
      vistas.add(c.claveDedup);
    }

    hallazgos.push(c);
    presentes.add(c.tier);
    tierMaximo = tierMaximo === null ? c.tier : tierMasAlto(tierMaximo, c.tier);
    if (c.provisional) hayProvisional = true;
    if (c.identidadPorDocumento) hayIdentidadPorDocumento = true;
    if (c.tier === 'sin_clasificar') {
      // La fuente cruda, no la normalizada: quien vaya a clasificarla necesita
      // verla tal como la manda el proveedor.
      sinClasificar.add(c.fuente ?? c.lista ?? '(sin fuente ni lista)');
    }
  });

  return {
    catalogoVersion: catalogo.version,
    opera: catalogo.opera,
    tierMaximo,
    tiersPresentes: PRECEDENCIA.filter((t) => presentes.has(t)),
    hallazgos,
    duplicados,
    fuentesSinClasificar: [...sinClasificar],
    haySinClasificar: presentes.has('sin_clasificar'),
    hayProvisional,
    hayIdentidadPorDocumento,
  };
}

// ─── Etiquetas de pantalla ─────────────────────────────────────────────────

export const TIER_LABEL: Record<TierResuelto, string> = {
  tier_1: 'Lista vinculante',
  tier_2: 'PEP',
  tier_3: 'Sanción no vinculante',
  tier_4: 'Fuera del perímetro SARLAFT',
  medios: 'Mención en medios',
  sin_clasificar: ETIQUETA_SIN_CLASIFICAR,
};

// ─── Gate de veredicto (C2 del concepto de Emilio, 2026-08-31) ─────────────

/**
 * ¿Este catálogo puede sustentar un veredicto sobre una contratación?
 *
 * Solo si está `vigente`, que es el estado que exige firma jurídica del
 * representante legal (lo garantiza un CHECK en la base). Hoy la versión 1 está
 * en `validada_tecnica`: tiene la firma técnica de Lucía y le falta la otra, así
 * que esta función devuelve false y todo tiene que ir al canal de mayor
 * exigencia.
 *
 * Existe HOY, antes de que exista función alguna de veredicto, precisamente para
 * que el día que se escriba no haya que acordarse de poner el gate. Un catálogo
 * sin firma clasificando en pantalla es medición; decidiendo sobre una
 * contratación sería MéTRIK afirmando derecho sin que nadie lo respalde.
 */
export function puedeEmitirVeredicto(catalogo: {
  opera: boolean;
} | null | undefined): boolean {
  return catalogo?.opera === true;
}

/**
 * Canal al que va una consulta clasificada.
 *
 * `maxima` es el canal que exige revisión del oficial sin excepción. Se llega
 * por tres caminos distintos, y los tres tienen la misma consecuencia:
 *
 *   1. El catálogo no está firmado (C2). No sabemos con qué autoridad clasificar.
 *   2. Alguna fuente no está catalogada (C4). No sabemos qué es.
 *   3. Hay Tier 1, que es la obligación misma.
 *
 * Cualquier otra cosa va a `ordinario`, que NO significa "no mirar": significa
 * que el orden lo fija el tier. La supresión no existe en ningún camino: las dos
 * bandejas juntas contienen el cien por ciento de lo devuelto (C3).
 */
export type CanalExigencia = 'maxima' | 'ordinario';

export function canalDeExigencia(clasificada: {
  opera: boolean;
  tierMaximo: TierResuelto | null;
  haySinClasificar: boolean;
}): CanalExigencia {
  if (!clasificada.opera) return 'maxima';
  if (clasificada.haySinClasificar) return 'maxima';
  if (clasificada.tierMaximo === 'tier_1') return 'maxima';
  return 'ordinario';
}

// ─── Cero supresión (C3) ───────────────────────────────────────────────────

/**
 * Verifica que la clasificación no perdió ni una coincidencia.
 *
 * La igualdad que tiene que cumplirse siempre:
 *
 *     hallazgos + duplicados === coincidencias devueltas por el proveedor
 *
 * Es un invariante de `clasificarConsulta` por construcción (cada match cae en
 * uno de los dos arreglos y en ninguno más), y por eso mismo vale comprobarlo:
 * un invariante que nadie verifica es una suposición. Si alguna vez esto es
 * falso, la clasificación está escondiendo un hallazgo, que es exactamente lo
 * que el dictamen prohíbe.
 *
 * El llamador decide qué hacer cuando falla. En la persistencia se guarda la
 * consulta SIN clasificación y marcada como sin clasificar: se cae al canal de
 * mayor exigencia y nunca se pierde la consulta, que ya se pagó.
 */
export function verificarCeroSupresion(
  clasificada: { hallazgos: readonly unknown[]; duplicados: readonly unknown[] },
  totalDevueltoPorLaFuente: number,
): boolean {
  return clasificada.hallazgos.length + clasificada.duplicados.length === totalDevueltoPorLaFuente;
}
