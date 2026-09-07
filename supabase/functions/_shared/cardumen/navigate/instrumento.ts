// Navigate (Cardumen x Reframeit) — instrumento CONGELADO para la muestra a Grupo Progreso.
//
// Capa A: copia LITERAL de `proyectos/metrik/cardumen/navigate-demo/data/meta.json`
// (clave `instrumento`), tildes incluidas. Cambiar una palabra aqui es
// cambiar el instrumento: si hace falta otra redaccion, primero se cambia meta.json y
// despues se copia. La prueba `instrumento.test.ts` fija cada literal.
//
// Las dos preguntas de apertura (Capa B) salen de la seccion 01 de la muestra
// (`navigate-progreso.html`): son las que el cliente ve en pantalla.
//
// Las tablas de mapeo (intensidad -> composicion, ancla -> valor) son las PRE-REGISTRADAS
// de `elicitacion-resolucion-yuto.md` §3.1 y `elicitacion-diadas-yuto.md` §4.1. No se
// negocian en vivo ni se exponen a la persona.

export type TriadaId = "T1_fuente" | "T2_tiempo" | "T3_enjuego";
export type DiadaId = "D1_novedad" | "D2_afecto" | "D3_agencia";
export type DimensionId = TriadaId | DiadaId;
export type Poblacion = "ciudadano" | "experto";

export interface TriadaNav {
  id: TriadaId;
  pregunta: string;          // literal de meta.json (puede traer una anotacion entre parentesis)
  polos: [string, string, string];
}
export interface DiadaNav {
  id: DiadaId;
  izq: string;
  der: string;
}

export const TRIADAS: Record<TriadaId, TriadaNav> = {
  T1_fuente: {
    id: "T1_fuente",
    pregunta: "De dónde nace lo que observó",
    polos: [
      "La gente común, la vida de a pie",
      "Quienes tienen poder, dinero o influencia",
      "Fuerzas que nadie controla del todo",
    ],
  },
  T2_tiempo: {
    id: "T2_tiempo",
    pregunta: "En el fondo, qué se siente que es",
    polos: [
      "Algo que se está acabando",
      "Algo que apenas comienza",
      "Algo que se repite una y otra vez",
    ],
  },
  T3_enjuego: {
    id: "T3_enjuego",
    pregunta: "Qué está realmente en juego (solo expertos)",
    polos: [
      "Lo que nos conviene",
      "Lo que es justo",
      "Lo que nos mantiene unidos",
    ],
  },
};

export const DIADAS: Record<DiadaId, DiadaNav> = {
  D1_novedad: { id: "D1_novedad", izq: "Esto ya venía pasando", der: "Esto es completamente nuevo" },
  D2_afecto: { id: "D2_afecto", izq: "Me preocupa profundamente", der: "Me da esperanza" },
  D3_agencia: { id: "D3_agencia", izq: "Me deja sin saber qué hacer", der: "Tengo claro qué habría que hacer" },
};

/**
 * La anotacion "(solo expertos)" de T3 es metadato de poblacion, no redaccion de la
 * pregunta: a un experto no se le muestra. El literal completo sigue en TRIADAS.
 */
export function preguntaMostrada(t: TriadaNav): string {
  return t.pregunta.replace(/\s*\([^)]*\)\s*$/, "");
}

/** Orden de las dimensiones por poblacion. Los expertos responden las cuatro del panel
 *  ciudadano MAS T3 y D3 (en la data simulada de la muestra, 76 de 76 expertos traen
 *  D1 y D3, y 71 D2 — el resto es `both_intense`). Las diadas se intercalan entre las
 *  triadas para no repetir tres veces seguidas la misma mecanica de "ordena dos". */
export const SECUENCIA: Record<Poblacion, DimensionId[]> = {
  ciudadano: ["T1_fuente", "T2_tiempo", "D1_novedad", "D2_afecto"],
  experto: ["T1_fuente", "T2_tiempo", "D1_novedad", "D2_afecto", "T3_enjuego", "D3_agencia"],
};

export function esTriada(id: DimensionId): id is TriadaId {
  return id in TRIADAS;
}

/** Pregunta de apertura (Capa B) por poblacion. Literal de la seccion 01 de la muestra. */
export const APERTURA: Record<Poblacion, string> = {
  ciudadano:
    "Cuéntenos algo que haya visto, oído o vivido últimamente que le haya hecho pensar. Algo que podría estar anunciando un cambio, para bien o para mal.",
  experto:
    "Desde su ángulo particular, ¿qué ha estado observando que pocos están viendo todavía? ¿Qué señal débil le llama la atención?",
};

/**
 * Lista cerrada de sectores (los 12 del brief, en este orden). El `slug` es lo que se
 * GUARDA en `payload.sector` y coincide con los datos de la muestra (`respuestas.json`,
 * sin tildes); la `etiqueta` es lo que se MUESTRA en WhatsApp. Un solo sitio para las dos.
 */
export const SECTORES_CATALOGO: ReadonlyArray<{ slug: string; etiqueta: string }> = [
  { slug: "Infraestructura y construccion", etiqueta: "Infraestructura y construcción" },
  { slug: "Comercio y retail", etiqueta: "Comercio y retail" },
  { slug: "Agroindustria", etiqueta: "Agroindustria" },
  { slug: "Manufactura", etiqueta: "Manufactura" },
  { slug: "Transporte y logistica", etiqueta: "Transporte y logística" },
  { slug: "Energia y servicios publicos", etiqueta: "Energía y servicios públicos" },
  { slug: "Turismo y hoteleria", etiqueta: "Turismo y hotelería" },
  { slug: "Servicios financieros", etiqueta: "Servicios financieros" },
  { slug: "Salud", etiqueta: "Salud" },
  { slug: "Educacion", etiqueta: "Educación" },
  { slug: "Tecnologia", etiqueta: "Tecnología" },
  { slug: "Sector publico", etiqueta: "Sector público" },
];

/** Los slugs, en el orden del catalogo: es lo que lee `leerSector` y lo que se persiste. */
export const SECTORES: readonly string[] = SECTORES_CATALOGO.map((s) => s.slug);

/** Etiqueta con tildes para mostrar un slug guardado. Un slug desconocido se muestra tal cual. */
export function etiquetaSector(slug: string): string {
  return SECTORES_CATALOGO.find((s) => s.slug === slug)?.etiqueta ?? slug;
}

// ---- Triadas: etiquetas de peso y composicion pre-registrada (§3.1) ----------------

export type IntensityLabel = "casi_parejos" | "uno_manda_otro_cuenta" | "claramente_el_primero" | "solo_uno";

export interface Intensidad {
  label: IntensityLabel;
  texto: string;                          // como se le dice a la persona (y como se le devuelve)
  reparto: [number, number, number];      // [dominante, segundo, residual]
}

/** Las tres etiquetas que se ofrecen en el turno de intensidad. En este orden. */
export const INTENSIDADES: readonly Intensidad[] = [
  { label: "casi_parejos", texto: "casi parejos", reparto: [0.5, 0.45, 0.05] },
  { label: "uno_manda_otro_cuenta", texto: "uno mandaba pero el otro contaba", reparto: [0.65, 0.3, 0.05] },
  { label: "claramente_el_primero", texto: "fue claramente el primero", reparto: [0.85, 0.1, 0.05] },
];

/** "Fue solo X": 0.90 al dominante y 0.10 residual. La tabla no dice como se parte el
 *  residual entre los dos polos que la persona dejo fuera; aqui se parte en mitades. */
export const REPARTO_SOLO_UNO: [number, number, number] = [0.9, 0.05, 0.05];

/** Composicion en el orden de los polos del instrumento, a partir del reparto. */
export function composicion(
  dominante: number,
  segundo: number | null,
  reparto: [number, number, number] | null,
): [number, number, number] | null {
  if (reparto === null) {
    // Resolucion gruesa: dominante = 1, resto = 0 (tabla §3.1, ultima fila).
    const c: [number, number, number] = [0, 0, 0];
    c[dominante] = 1;
    return c;
  }
  const c: [number, number, number] = [0, 0, 0];
  if (segundo === null) {
    c[dominante] = reparto[0];
    const otros = [0, 1, 2].filter((i) => i !== dominante);
    c[otros[0]] = reparto[1];
    c[otros[1]] = reparto[2];
    return c;
  }
  c[dominante] = reparto[0];
  c[segundo] = reparto[1];
  const residual = [0, 1, 2].find((i) => i !== dominante && i !== segundo)!;
  c[residual] = reparto[2];
  return c;
}

// ---- Diadas: cinco anclas y valor pre-registrado (§4.1) ------------------------------

export type AnchorLabel = "extremo_izq" | "intermedio_izq" | "medio" | "intermedio_der" | "extremo_der";
export type SpecialCase = "middle" | "both_intense" | "not_applicable" | "dont_know";

export interface Ancla {
  posicion: 1 | 2 | 3 | 4 | 5;
  label: AnchorLabel;
  texto: string;
  value: number;
  special_case: SpecialCase | null;
}

/**
 * Cinco anclas por diada. Los extremos son los polos LITERALES; las intermedias son
 * genericas a proposito: las anclas definitivas de Navigate las redacta Yuto cuando Saga
 * avale el esquema (pendiente en `elicitacion-diadas-yuto.md` §9), y hasta entonces no
 * se inventa redaccion de instrumento.
 */
export function anclasDe(d: DiadaNav): Ancla[] {
  return [
    { posicion: 1, label: "extremo_izq", texto: d.izq, value: 0, special_case: null },
    { posicion: 2, label: "intermedio_izq", texto: `más cerca de "${d.izq}", con matices`, value: 0.25, special_case: null },
    { posicion: 3, label: "medio", texto: "un poco de las dos", value: 0.5, special_case: "middle" },
    { posicion: 4, label: "intermedio_der", texto: `más cerca de "${d.der}", con matices`, value: 0.75, special_case: null },
    { posicion: 5, label: "extremo_der", texto: d.der, value: 1, special_case: null },
  ];
}

/** Salidas que no caen en el eje (§3 de la spec de diadas). */
export const ESPECIALES_FUERA_DEL_EJE: Record<Exclude<SpecialCase, "middle">, string> = {
  both_intense: "las dos cosas a la vez, con fuerza",
  not_applicable: "no aplica a lo que contó",
  dont_know: "no sabría decir",
};
