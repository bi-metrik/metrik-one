/**
 * Liberación de contrapartes por el oficial de cumplimiento (R4).
 *
 * Tipos y reglas puras, compartidos entre server actions, PDF y cliente. Vive
 * fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async.
 *
 * Qué resuelve: hoy el workspace consulta listas y muestra hallazgos, pero no
 * registra QUÉ DECIDIÓ el oficial sobre ellos. La liberación es esa decisión, y
 * es la evidencia de la debida diligencia.
 *
 * NO confundir con `registrarVeredicto()` / `DualDecision` de
 * `compliance-dual.ts`: eso es la auditoría interna de MéTRIK sobre la calidad
 * comparada de Informa contra Valida, invisible para el cliente. Son dos
 * bitácoras con propósitos y audiencias distintas.
 */

import { ROLES_OFICIAL_CUMPLIMIENTO } from './segmentos';

export { ROLES_OFICIAL_CUMPLIMIENTO };

export type LiberacionDecision = 'liberada' | 'rechazada';

export const LIBERACION_DECISIONES: readonly LiberacionDecision[] = ['liberada', 'rechazada'];

export function esLiberacionDecision(v: unknown): v is LiberacionDecision {
  return typeof v === 'string' && (LIBERACION_DECISIONES as readonly string[]).includes(v);
}

/**
 * Fila de la bitácora. Es append-only: revocar o cambiar una liberación es una
 * fila nueva, nunca un UPDATE (lo impide un trigger en la base).
 *
 * `vigente_desde` / `vigente_hasta` son fechas civiles (`YYYY-MM-DD`, DATE en la
 * base), no timestamps: la vigencia se cuenta en días calendario de Bogotá.
 */
export type ComplianceLiberacion = {
  id: string;
  consulta_id: string;
  documento_tipo: string;
  documento_numero: string;
  nombre: string | null;
  decision: LiberacionDecision;
  justificacion: string;
  vigente_desde: string;
  /** null solo cuando `decision='rechazada'` — un rechazo no tiene vigencia. */
  vigente_hasta: string | null;
  control_id: string | null;
  liberada_por: string | null;
  created_at: string;
};

/** La misma fila con lo que hay que resolver contra otras tablas para mostrarla. */
export type LiberacionConNombres = ComplianceLiberacion & {
  liberada_por_nombre: string | null;
  control_referencia: string | null;
  control_nombre: string | null;
};

// ─── Permisos ──────────────────────────────────────────────────────────────

/**
 * Quién libera: el oficial de cumplimiento (owner/admin), la misma regla que el
 * catálogo de segmentos de R1. La pantalla es SOLO suya — el equipo que consulta
 * listas ve hallazgos, pero no decide sobre ellos. Lo que viaja al resto de la
 * organización es el PDF de autorización, no la pantalla.
 */
export function puedeLiberarContrapartes(role: string | null | undefined): boolean {
  return !!role && ROLES_OFICIAL_CUMPLIMIENTO.includes(role);
}

// ─── Identidad de la contraparte ───────────────────────────────────────────

/**
 * ONE todavía no tiene entidad "contraparte": la identidad se denormaliza en cada
 * liberación y ESTA es la llave por la que se busca la vigencia.
 *
 * La clave normaliza para que "NIT" / "nit " / "Nit" y un número con puntos o
 * guiones ("900.123.456-7") resuelvan a la misma contraparte. Sin esto, dos
 * escrituras distintas del mismo NIT serían dos contrapartes y una liberación
 * dejaría de cubrir a la otra en silencio — que es exactamente la falla que no
 * puede tener una bitácora de cumplimiento.
 */
export function claveContraparte(
  documentoTipo: string | null | undefined,
  documentoNumero: string | null | undefined,
): string | null {
  const tipo = (documentoTipo ?? '').trim().toUpperCase();
  const numero = (documentoNumero ?? '').replace(/[\s.\-_]/g, '').trim().toUpperCase();
  if (!tipo || !numero) return null;
  return `${tipo}:${numero}`;
}

// ─── Regla de cobertura ────────────────────────────────────────────────────

export type MotivoCobertura =
  /** La contraparte nunca pasó por el oficial. */
  | 'sin_registro'
  /** Liberada y la vigencia todavía corre. */
  | 'vigente'
  /** Liberada, pero `vigente_hasta` ya pasó: dejó de cubrir sola, sin que nadie tocara nada. */
  | 'vencida'
  /** La decisión más reciente es un rechazo: revoca cualquier liberación anterior. */
  | 'rechazada';

export type Cobertura = {
  cubierta: boolean;
  motivo: MotivoCobertura;
  /** La fila que decidió — null solo en `sin_registro`. */
  liberacion: ComplianceLiberacion | null;
};

const SIN_REGISTRO: Cobertura = { cubierta: false, motivo: 'sin_registro', liberacion: null };

/**
 * ¿Esta contraparte está cubierta por una liberación vigente?
 *
 * La regla, y el motivo de que sea una función pura con pruebas propias:
 *
 *   1. De todas las filas de la contraparte se toma **la más reciente** por
 *      `created_at`. Solo esa decide. Las anteriores son historia.
 *   2. Está cubierta si y solo si esa fila es `liberada` Y `vigente_hasta >= hoy`.
 *   3. Cualquier otra combinación NO cubre.
 *
 * Las dos consecuencias que hacen que esto funcione sin mantenimiento:
 *   - una fila `rechazada` posterior **revoca** la liberación anterior sin
 *     borrar nada (la bitácora es append-only);
 *   - una liberación **vencida deja de cubrir sola**, sin cron ni proceso que
 *     tenga que pasar a marcarla.
 *
 * `hoyISO` se recibe, no se calcula: la fecha civil de Bogotá la resuelve
 * `todayBogotaISO()` en el llamador (Vercel corre en UTC), y así los tests
 * pueden fijar el día sin tocar el reloj.
 *
 * Comparación lexicográfica de `YYYY-MM-DD`: para ese formato coincide con la
 * cronológica, así que no hay que construir Dates ni arrastrar zona horaria.
 */
export function coberturaDeContraparte(
  filas: readonly ComplianceLiberacion[],
  hoyISO: string,
): Cobertura {
  if (filas.length === 0) return SIN_REGISTRO;

  const masReciente = filas.reduce((mejor, fila) => {
    if (fila.created_at > mejor.created_at) return fila;
    // Empate exacto de `created_at`: gana la decisión más restrictiva. Es
    // prácticamente inalcanzable (timestamptz tiene microsegundos), pero el
    // desempate no puede quedar a merced del orden en que llegó el arreglo:
    // un resultado no determinista en la regla que autoriza contratar es peor
    // que una regla conservadora.
    if (fila.created_at === mejor.created_at && fila.decision === 'rechazada') return fila;
    return mejor;
  });

  if (masReciente.decision === 'rechazada') {
    return { cubierta: false, motivo: 'rechazada', liberacion: masReciente };
  }

  // Liberada sin `vigente_hasta` no debería existir (lo impide un CHECK en la
  // base), pero si existiera NO puede cubrir para siempre por omisión.
  if (!masReciente.vigente_hasta) {
    return { cubierta: false, motivo: 'vencida', liberacion: masReciente };
  }

  if (masReciente.vigente_hasta >= hoyISO) {
    return { cubierta: true, motivo: 'vigente', liberacion: masReciente };
  }
  return { cubierta: false, motivo: 'vencida', liberacion: masReciente };
}

/**
 * Cobertura de muchas contrapartes de una sola pasada.
 *
 * Agrupa por `claveContraparte` y aplica la regla a cada grupo. Las filas pueden
 * venir en cualquier orden: quién es "la más reciente" lo decide
 * `coberturaDeContraparte`, no el ORDER BY de quien consultó.
 */
export function indexarCoberturas(
  filas: readonly ComplianceLiberacion[],
  hoyISO: string,
): Map<string, Cobertura> {
  const porClave = new Map<string, ComplianceLiberacion[]>();
  for (const fila of filas) {
    const clave = claveContraparte(fila.documento_tipo, fila.documento_numero);
    if (!clave) continue;
    const acc = porClave.get(clave);
    if (acc) acc.push(fila);
    else porClave.set(clave, [fila]);
  }

  const out = new Map<string, Cobertura>();
  for (const [clave, grupo] of porClave) {
    out.set(clave, coberturaDeContraparte(grupo, hoyISO));
  }
  return out;
}

// ─── Vigencias ─────────────────────────────────────────────────────────────

/**
 * Vigencias que ofrece la pantalla. Son el cuadro que dictó la oficial de
 * cumplimiento en la reunión (3 / 6 / 12 meses) y coinciden con
 * `frec_alto_meses` / `frec_medio_meses` / `frec_bajo_meses` de la segmentación
 * SARLAFT. NO se leen de esa configuración a propósito: aquí son un atajo de la
 * UI, y el oficial puede escribir cualquier fecha. Cablearlas contra la config
 * de segmentación ataría la decisión del oficial a una metodología que hoy
 * ningún workspace tiene cargada.
 */
export const VIGENCIAS_SUGERIDAS: readonly { meses: number; label: string }[] = [
  { meses: 3, label: '3 meses' },
  { meses: 6, label: '6 meses' },
  { meses: 12, label: '12 meses' },
];

/**
 * Suma meses a una fecha civil `YYYY-MM-DD` sin pasar por `Date`.
 *
 * Con `Date` esto se hace en UTC y en Bogotá (UTC-5) el resultado se corre un
 * día — el mismo error que documenta `src/lib/dates/bogota.ts`. Como son fechas
 * civiles puras, la aritmética es de calendario y no de instantes.
 *
 * Desborde de día: 31 de enero + 1 mes = 28/29 de febrero (se topa al último día
 * del mes destino), que es la convención de vigencias contractuales.
 */
export function sumarMesesISO(fechaISO: string, meses: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO);
  if (!m) throw new Error(`fecha_invalida: ${fechaISO}`);
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);

  const totalMeses = anio * 12 + (mes - 1) + meses;
  const anioDestino = Math.floor(totalMeses / 12);
  const mesDestino = (totalMeses % 12) + 1;
  const diaDestino = Math.min(dia, diasDelMes(anioDestino, mesDestino));

  return `${String(anioDestino).padStart(4, '0')}-${String(mesDestino).padStart(2, '0')}-${String(diaDestino).padStart(2, '0')}`;
}

function diasDelMes(anio: number, mes: number): number {
  if (mes === 2) {
    const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
    return bisiesto ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

export const FECHA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Validación del formulario ─────────────────────────────────────────────

export type LiberacionInput = {
  consulta_id: string;
  decision: LiberacionDecision;
  justificacion: string;
  /** Obligatoria cuando `decision='liberada'`. Se ignora en un rechazo. */
  vigente_hasta?: string | null;
  control_id?: string | null;
};

export const JUSTIFICACION_MAX = 4000;

/**
 * Valida el input ANTES de tocar la base. Devuelve el código de error o null.
 *
 * `justificacion` no vacía SIEMPRE, incluido el rechazo: la bitácora existe para
 * responder "por qué se decidió esto", y un rechazo sin motivo es tan inútil
 * como una liberación sin motivo. No se exige longitud mínima: quién juzga si
 * el texto sustenta la decisión es el revisor, no el software.
 */
export function validarLiberacion(
  input: LiberacionInput,
  hoyISO: string,
): string | null {
  if (!input.consulta_id?.trim()) return 'consulta_requerida';
  if (!esLiberacionDecision(input.decision)) {
    return 'decision_invalida (esperado: liberada | rechazada)';
  }

  const justificacion = input.justificacion?.trim() ?? '';
  if (!justificacion) return 'justificacion_requerida';
  if (justificacion.length > JUSTIFICACION_MAX) {
    return `justificacion_muy_larga (máximo ${JUSTIFICACION_MAX} caracteres)`;
  }

  if (input.decision === 'rechazada') return null;

  const hasta = input.vigente_hasta?.trim() ?? '';
  if (!hasta) return 'vigencia_requerida (una liberación sin fecha de fin no vence nunca)';
  if (!FECHA_ISO_RE.test(hasta)) return 'vigencia_formato_invalido (esperado: YYYY-MM-DD)';
  if (hasta < hoyISO) return 'vigencia_en_el_pasado (la liberación nacería vencida)';

  return null;
}

// ─── Etiquetas de pantalla ─────────────────────────────────────────────────

export const MOTIVO_LABEL: Record<MotivoCobertura, string> = {
  sin_registro: 'Pendiente de decisión',
  vigente: 'Liberada',
  vencida: 'Liberación vencida',
  rechazada: 'Rechazada',
};

export const DECISION_LABEL: Record<LiberacionDecision, string> = {
  liberada: 'Liberada',
  rechazada: 'Rechazada',
};
