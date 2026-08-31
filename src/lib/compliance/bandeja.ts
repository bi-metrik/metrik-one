/**
 * Las cinco etiquetas de la bandeja del oficial de cumplimiento
 * (dictamen Lucía 2026-08-24, `proyectos/afi/alma/docs/entrada/2026-08-18_requerimientos-cierre.md`,
 * seccion "Etiquetas finales y acople al flujo").
 *
 * Qué resuelve: hoy el tablero parte las contrapartes con hallazgo en dos
 * —cubiertas y no cubiertas— y ese corte mete en el mismo cajón tres
 * situaciones que no se parecen en nada:
 *
 *   - la que nunca pasó por el oficial (trabajo represado),
 *   - la que el oficial liberó y se le venció el permiso mientras seguía
 *     operando (la empresa expuesta sin que nadie lo decidiera así),
 *   - la que el oficial rechazó (caso cerrado).
 *
 * Mezclarlas le permite al oficial creer que decidió algo que no decidió. Es
 * literalmente la regla 2 de interfaz del dictamen.
 *
 * NO son estados nuevos ni columnas nuevas: son la lectura cruzada de dos cosas
 * que ya están en producción — si la última consulta trajo hallazgo, y qué
 * devuelve `coberturaDeContraparte()` (R4). Los estados se derivan, no se
 * guardan; esa regla la fijó R4 y aquí se respeta.
 *
 * ⚠️ Ninguna etiqueta puede rotularse como "exigido por norma". La exigencia se
 * predica de la LISTA (tier), no de la población: un delta en ONU y uno en OFAC
 * no obligan a lo mismo. Dictamen Lucía 2026-08-24 + `cerebro/reglas/cautela-afirmacion-marco-normativo.md`.
 *
 * Vive fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async, y porque la regla tiene que poder probarse sin base de datos
 * — mismo criterio que `liberaciones.ts` y `tier-fuentes.ts`.
 */

import type { MotivoCobertura } from './liberaciones';

// ─── Vocabulario ───────────────────────────────────────────────────────────

export type EtiquetaBandeja =
  | 'vigilancia_continua'
  | 'excepciones_vigentes'
  | 'hallazgos_sin_decidir'
  | 'sin_cobertura_vigente'
  | 'rechazadas';

/**
 * Qué le pide cada etiqueta al oficial. Es lo que decide dónde va en la
 * pantalla: tres poblaciones están en reposo y no piden nada, una es cola de
 * trabajo y una es alarma. El oficial no necesita entender el modelo — necesita
 * saber en cuáles de las cinco tiene que actuar, y son dos.
 */
export type NaturalezaBandeja = 'reposo' | 'cola' | 'alarma';

export type DefinicionEtiqueta = {
  etiqueta: EtiquetaBandeja;
  /** El rótulo que ve el oficial. Ratificado por Lucía; no cambiar sin ella. */
  titulo: string;
  naturaleza: NaturalezaBandeja;
  /** Orden en pantalla: la alarma primero, la lista fría de última. */
  orden: number;
  descripcion: string;
};

/**
 * Los rótulos son del dictamen, no de quien programa. Cada uno reemplaza a una
 * propuesta que Lucía rechazó por inducir una lectura equivocada:
 *
 *   "monitoreo ordinario" -> Vigilancia continua   ("ordinario" sugiere menos importante)
 *   "cuarentena"          -> Excepciones vigentes  (no están aisladas: están OPERANDO)
 *   "vetada"              -> Rechazadas            ("veto" sugiere lista negra propia)
 *   "liberación vencida"  -> Sin cobertura vigente (describía el papel, no el riesgo)
 */
export const ETIQUETAS: Readonly<Record<EtiquetaBandeja, DefinicionEtiqueta>> = {
  sin_cobertura_vigente: {
    etiqueta: 'sin_cobertura_vigente',
    titulo: 'Sin cobertura vigente',
    naturaleza: 'alarma',
    orden: 0,
    descripcion:
      'Tiene hallazgo, sigue operando y el permiso caducó. Es el único estado donde la '
      + 'empresa está expuesta y nadie lo decidió así. Se apaga decidiendo, no consultando.',
  },
  hallazgos_sin_decidir: {
    etiqueta: 'hallazgos_sin_decidir',
    titulo: 'Hallazgos sin decidir',
    naturaleza: 'cola',
    orden: 1,
    descripcion:
      'Con hallazgo y sin decisión del oficial. No es monitoreo: es trabajo represado. '
      + 'Se ordena por antigüedad porque lo que se mide es cuánto lleva la empresa '
      + 'sabiendo algo sin haber decidido nada.',
  },
  excepciones_vigentes: {
    etiqueta: 'excepciones_vigentes',
    titulo: 'Excepciones vigentes',
    naturaleza: 'reposo',
    orden: 2,
    descripcion:
      'Con hallazgo y operando porque hay una liberación vigente que las cubre. Cada '
      + 'fila es una excepción que alguien firmó, con nombre y fecha de vencimiento.',
  },
  vigilancia_continua: {
    etiqueta: 'vigilancia_continua',
    titulo: 'Vigilancia continua',
    naturaleza: 'reposo',
    orden: 3,
    descripcion:
      'Consultadas y sin hallazgo. Es un contador, no una lista: nadie necesita ver '
      + 'los nombres de las que están bien.',
  },
  rechazadas: {
    etiqueta: 'rechazadas',
    titulo: 'Rechazadas',
    naturaleza: 'reposo',
    orden: 4,
    descripcion:
      'El oficial decidió no contratar. Lista fría, consultable, fuera del flujo diario.',
  },
};

export const ETIQUETAS_ORDENADAS: readonly DefinicionEtiqueta[] =
  Object.values(ETIQUETAS).sort((a, b) => a.orden - b.orden);

// ─── La regla ──────────────────────────────────────────────────────────────

/**
 * La tabla completa del dictamen. Cinco etiquetas de dos entradas:
 *
 *   | ¿hallazgo? | cobertura      | etiqueta               |
 *   |------------|----------------|------------------------|
 *   | no         | cualquiera     | Vigilancia continua    |
 *   | sí         | `vigente`      | Excepciones vigentes   |
 *   | sí         | `rechazada`    | Rechazadas             |
 *   | sí         | `sin_registro` | Hallazgos sin decidir  |
 *   | sí         | `vencida`      | Sin cobertura vigente  |
 *
 * Sin hallazgo la cobertura no se mira: una contraparte limpia que alguna vez
 * fue liberada sigue estando limpia, y meterla en "excepciones" inflaría la
 * lista de riesgo asumido con casos que ya no lo son.
 */
export function etiquetaDeContraparte(
  tieneHallazgo: boolean,
  motivo: MotivoCobertura,
): EtiquetaBandeja {
  if (!tieneHallazgo) return 'vigilancia_continua';
  switch (motivo) {
    case 'vigente':
      return 'excepciones_vigentes';
    case 'rechazada':
      return 'rechazadas';
    case 'vencida':
      return 'sin_cobertura_vigente';
    case 'sin_registro':
      return 'hallazgos_sin_decidir';
  }
}

/** Las dos que piden acción humana. Las otras tres son reposo. */
export function exigeAccion(etiqueta: EtiquetaBandeja): boolean {
  return ETIQUETAS[etiqueta].naturaleza !== 'reposo';
}

/**
 * Las que NO se re-consultan cuando llegue el motor de monitoreo (R3).
 *
 * Es la regla que protege la cuenta del cliente: re-consultar a quien ya sabemos
 * que tiene hallazgo no agrega información —el que tiene que moverse es el
 * oficial— y una alarma no se apaga consultando. Consecuencia: un
 * represamiento del oficial no se traduce en factura.
 *
 * Vive acá y no en el cron para que la regla se pruebe sin motor, y para que el
 * día que se escriba el barrido no haya que redescubrirla.
 */
export function consumeCuotaDeReconsulta(etiqueta: EtiquetaBandeja): boolean {
  return !exigeAccion(etiqueta);
}

// ─── Antigüedad ────────────────────────────────────────────────────────────

/**
 * Días completos entre dos fechas civiles `YYYY-MM-DD`.
 *
 * Sin `Date`: en Bogotá (UTC-5) construir un `Date` desde `YYYY-MM-DD` lo ancla
 * en UTC y el resultado se corre un día — el mismo error que documenta
 * `src/lib/dates/bogota.ts`. Se cuentan días de calendario, no instantes.
 */
export function diasEntreISO(desdeISO: string, hastaISO: string): number {
  return diaJuliano(hastaISO) - diaJuliano(desdeISO);
}

function diaJuliano(fechaISO: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaISO);
  if (!m) throw new Error(`fecha_invalida: ${fechaISO}`);
  const a = Number(m[1]);
  const mes = Number(m[2]);
  const d = Number(m[3]);
  // Fliegel & Van Flandern: días desde una época fija, aritmética entera pura.
  //
  // `trunc`, NO `floor`: la fórmula original está escrita en división entera de
  // C, que trunca hacia cero. Con `floor`, todo mes de marzo a diciembre da
  // x = -1 en vez de 0 y el día queda corrido — se ve al cruzar febrero de un
  // año bisiesto, que es el caso que lo destapó.
  const x = Math.trunc((mes - 14) / 12);
  return (
    Math.floor((1461 * (a + 4800 + x)) / 4)
    + Math.floor((367 * (mes - 2 - 12 * x)) / 12)
    - Math.floor((3 * Math.floor((a + 4900 + x) / 100)) / 4)
    + d
    - 32075
  );
}

// ─── Indicadores (Lucía) ───────────────────────────────────────────────────

/**
 * Los dos indicadores que un supervisor pide primero, y que hoy no existen en
 * ninguna pantalla.
 *
 * El tercero del dictamen —cobertura del barrido: consultadas sobre obligadas—
 * no se puede calcular todavía: mide si el motor está cumpliendo, y el motor es
 * R3. No se aproxima con otra cosa: un indicador de cumplimiento que mide algo
 * distinto de lo que dice medir es peor que no tenerlo.
 */
export type IndicadoresBandeja = {
  /** Cuánto lleva el hallazgo más viejo esperando decisión. Mide el represamiento. */
  antiguedad_max_sin_decidir_dias: number | null;
  /** Contrapartes operando sin cobertura vigente. El objetivo es cero. */
  sin_cobertura_vigente: number;
};

export function calcularIndicadores(
  sinDecidirFechas: readonly string[],
  sinCoberturaVigente: number,
  hoyISO: string,
): IndicadoresBandeja {
  let max: number | null = null;
  for (const fecha of sinDecidirFechas) {
    const dias = diasEntreISO(fecha.slice(0, 10), hoyISO);
    if (max === null || dias > max) max = dias;
  }
  return {
    antiguedad_max_sin_decidir_dias: max,
    sin_cobertura_vigente: sinCoberturaVigente,
  };
}
