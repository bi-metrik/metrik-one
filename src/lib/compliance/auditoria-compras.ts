/**
 * R5 — Auditoría por cruce con la base de compras (control correctivo).
 *
 * Qué resuelve: el módulo ya consulta listas, ya registra qué decidió el oficial
 * (R4) y ya muestra dónde tiene que actuar. Lo que no puede hacer es enterarse
 * de que alguien contrató igual. ONE no es dueño de la orden de compra, así que
 * no puede impedirlo; lo que sí puede es cruzar la base de contrataciones del
 * periodo contra lo que el oficial sabía Y había decidido EN ESA FECHA.
 *
 * Es correctivo, no preventivo. El caso ya se ejecutó. Lo que produce es la
 * evidencia de que el procedimiento se saltó, con nombre y fecha.
 *
 * ── La regla que hace que esto sirva de algo ──────────────────────────────
 *
 * El cruce se evalúa **al momento de la contratación**, nunca contra hoy. Una
 * liberación firmada después de la compra no la justifica: cubre hacia adelante,
 * no hacia atrás. Una consulta hecha después tampoco. Si se evaluara contra hoy,
 * bastaría con liberar a todo el mundo al cierre del periodo para que el informe
 * saliera limpio, y el informe existiría para no encontrar nada.
 *
 * ── Lo que esta versión NO hace, a propósito ──────────────────────────────
 *
 * No guarda la base de compras. Es información financiera de otro sistema y
 * abrir esa superficie de datos personales sin el concepto de Emilio sobre
 * tratamiento (escalamiento abierto en el dictamen de tier) sería adelantarse a
 * una decisión que no es de producto. El cruce corre en memoria y lo que queda
 * es el informe descargable, que es lo que pidió la oficial de cumplimiento.
 *
 * Vive fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async, y porque la regla tiene que poder probarse sin base de datos
 * — mismo criterio que `liberaciones.ts` y `bandeja.ts`.
 */

import {
  coberturaDeContraparte,
  claveContraparte,
  type ComplianceLiberacion,
  type Cobertura,
} from './liberaciones';

// ─── Entrada ───────────────────────────────────────────────────────────────

/** Una fila de la base de compras, ya parseada y validada. */
export type FilaCompra = {
  /** Fila del XLSX (1 = encabezado), para que el oficial sepa qué celda mirar. */
  posicion: number;
  documento_tipo: string;
  documento_numero: string;
  nombre: string | null;
  /** Fecha civil `YYYY-MM-DD` en que se celebró la contratación. */
  fecha: string;
  referencia: string | null;
  comprador: string | null;
  valor: number | null;
};

/** Consulta de listas ya hecha, reducida a lo que el cruce necesita. */
export type ConsultaParaAuditoria = {
  id: string;
  documento_tipo: string | null;
  documento_numero: string | null;
  /** `alto` | `sin_hallazgo` | `error`. */
  severidad: string;
  total_matches: number;
  created_at: string;
  created_by: string | null;
};

// ─── Veredicto ─────────────────────────────────────────────────────────────

/**
 * Los seis resultados posibles de auditar una compra. Ordenados de peor a mejor;
 * `ORDEN_VEREDICTO` fija ese orden para el informe.
 */
export type VeredictoCompra =
  /** Había un rechazo vigente del oficial y se contrató igual. El peor caso. */
  | 'contratada_pese_a_rechazo'
  /** Se sabía que tenía hallazgo y nadie lo había liberado a esa fecha. */
  | 'hallazgo_sin_liberacion'
  /** No se consultó nunca. Se contrató a ciegas. */
  | 'sin_consulta'
  /** Se consultó, pero DESPUÉS de contratar. El orden del procedimiento se invirtió. */
  | 'consultada_despues'
  /** La única evidencia previa es una consulta que falló: no se supo. */
  | 'sin_resultado'
  /** Con hallazgo, pero cubierta por una liberación vigente a esa fecha. */
  | 'cubierta'
  /** Consultada antes y sin hallazgo. */
  | 'sin_hallazgo';

export const ORDEN_VEREDICTO: readonly VeredictoCompra[] = [
  'contratada_pese_a_rechazo',
  'hallazgo_sin_liberacion',
  'sin_consulta',
  'consultada_despues',
  'sin_resultado',
  'cubierta',
  'sin_hallazgo',
];

/**
 * Los veredictos que son hallazgo de auditoría. Los otros dos son el curso
 * normal y no se reportan como incumplimiento.
 *
 * `sin_resultado` cuenta como hallazgo: una consulta que falló no es una
 * contraparte limpia. Tratarla como limpia sería el mismo falso negativo de
 * agosto, ahora en el informe que se le entrega a la empresa.
 */
export function esHallazgo(v: VeredictoCompra): boolean {
  return v !== 'cubierta' && v !== 'sin_hallazgo';
}

export const VEREDICTO_LABEL: Readonly<Record<VeredictoCompra, string>> = {
  contratada_pese_a_rechazo: 'Contratada pese al rechazo',
  hallazgo_sin_liberacion: 'Hallazgo sin liberación',
  sin_consulta: 'Sin consulta previa',
  consultada_despues: 'Consultada después de contratar',
  sin_resultado: 'Consulta previa fallida',
  cubierta: 'Cubierta por liberación',
  sin_hallazgo: 'Sin hallazgo',
};

export type ResultadoCompra = {
  compra: FilaCompra;
  clave: string;
  veredicto: VeredictoCompra;
  /** La consulta previa concluyente sobre la que se juzga. */
  consulta_previa: ConsultaParaAuditoria | null;
  /** La primera consulta POSTERIOR, cuando la hubo. */
  consulta_posterior: ConsultaParaAuditoria | null;
  /** Cobertura evaluada al día de la contratación, no a hoy. */
  cobertura_a_la_fecha: Cobertura;
};

// ─── La regla ──────────────────────────────────────────────────────────────

/** Fecha civil de un timestamp ISO. Basta con recortar: `YYYY-MM-DD` va primero. */
function diaDe(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * ¿Estaba cubierta esta contraparte EL DÍA de la contratación?
 *
 * Dos filtros, no uno:
 *   1. Solo cuentan las decisiones tomadas **hasta ese día** (`created_at`). Una
 *      liberación firmada después no cubre hacia atrás.
 *   2. Sobre esas, la regla de siempre (`coberturaDeContraparte`) evaluada con
 *      esa fecha como "hoy", para que una liberación que ya había vencido ese
 *      día tampoco cubra.
 *
 * Sin el filtro 1 el informe se puede limpiar liberando a todos al cierre del
 * periodo. Sin el filtro 2 una liberación vieja cubriría para siempre.
 */
export function coberturaAlMomento(
  liberaciones: readonly ComplianceLiberacion[],
  fechaISO: string,
): Cobertura {
  const previas = liberaciones.filter((l) => diaDe(l.created_at) <= fechaISO);
  return coberturaDeContraparte(previas, fechaISO);
}

/**
 * Audita UNA contratación contra todo lo que se sabía de esa contraparte.
 *
 * `consultas` y `liberaciones` son las de esa contraparte, en cualquier orden.
 */
export function auditarCompra(
  compra: FilaCompra,
  consultas: readonly ConsultaParaAuditoria[],
  liberaciones: readonly ComplianceLiberacion[],
): ResultadoCompra {
  const clave = claveContraparte(compra.documento_tipo, compra.documento_numero) ?? '';
  const cobertura = coberturaAlMomento(liberaciones, compra.fecha);

  // Una consulta hecha el MISMO día de la contratación cuenta como previa: la
  // fecha de compra que trae la base es civil, sin hora, y exigir orden dentro
  // del día castigaría un procedimiento correcto por falta de precisión del
  // dato. El sesgo se elige a favor del auditado, y queda dicho.
  const previas = consultas
    .filter((c) => diaDe(c.created_at) <= compra.fecha)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const posteriores = consultas
    .filter((c) => diaDe(c.created_at) > compra.fecha)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const previaConcluyente = previas.find(
    (c) => c.severidad === 'alto' || c.severidad === 'sin_hallazgo',
  ) ?? null;

  const base = {
    compra,
    clave,
    consulta_previa: previaConcluyente,
    consulta_posterior: posteriores[0] ?? null,
    cobertura_a_la_fecha: cobertura,
  };

  // Un rechazo vigente al día de la compra manda sobre todo lo demás: es la
  // única decisión humana explícita de NO contratar.
  if (cobertura.motivo === 'rechazada') {
    return { ...base, veredicto: 'contratada_pese_a_rechazo' };
  }

  if (!previaConcluyente) {
    // Sin consulta concluyente previa. Se distingue si además hubo un intento
    // fallido, o si la consulta llegó tarde: los tres son incumplimiento, pero
    // no son el mismo hecho y el informe no puede aplanarlos.
    if (posteriores.length > 0) return { ...base, veredicto: 'consultada_despues' };
    if (previas.length > 0) return { ...base, veredicto: 'sin_resultado' };
    return { ...base, veredicto: 'sin_consulta' };
  }

  if (previaConcluyente.severidad !== 'alto') {
    return { ...base, veredicto: 'sin_hallazgo' };
  }

  return {
    ...base,
    veredicto: cobertura.cubierta ? 'cubierta' : 'hallazgo_sin_liberacion',
  };
}

// ─── Informe ───────────────────────────────────────────────────────────────

export type ResumenAuditoria = {
  total_filas: number;
  /** Filas del XLSX que no se pudieron leer. Se reportan, no se descartan. */
  filas_invalidas: number;
  hallazgos: number;
  por_veredicto: Record<VeredictoCompra, number>;
  /** Rango efectivo de las contrataciones auditadas. */
  periodo_desde: string | null;
  periodo_hasta: string | null;
};

export function resumirAuditoria(
  resultados: readonly ResultadoCompra[],
  filasInvalidas: number,
): ResumenAuditoria {
  const por = Object.fromEntries(
    ORDEN_VEREDICTO.map((v) => [v, 0]),
  ) as Record<VeredictoCompra, number>;

  let desde: string | null = null;
  let hasta: string | null = null;

  for (const r of resultados) {
    por[r.veredicto]++;
    if (desde === null || r.compra.fecha < desde) desde = r.compra.fecha;
    if (hasta === null || r.compra.fecha > hasta) hasta = r.compra.fecha;
  }

  return {
    total_filas: resultados.length + filasInvalidas,
    filas_invalidas: filasInvalidas,
    hallazgos: resultados.filter((r) => esHallazgo(r.veredicto)).length,
    por_veredicto: por,
    periodo_desde: desde,
    periodo_hasta: hasta,
  };
}

/** Los hallazgos primero, de peor a mejor, y dentro de cada grupo por fecha. */
export function ordenarResultados(
  resultados: readonly ResultadoCompra[],
): ResultadoCompra[] {
  const peso = new Map(ORDEN_VEREDICTO.map((v, i) => [v, i]));
  return [...resultados].sort((a, b) => {
    const d = (peso.get(a.veredicto) ?? 99) - (peso.get(b.veredicto) ?? 99);
    if (d !== 0) return d;
    return a.compra.fecha.localeCompare(b.compra.fecha);
  });
}

// ─── Parseo de fechas de la base de compras ────────────────────────────────

export const FORMATO_FECHA_ESPERADO = 'AAAA-MM-DD o DD/MM/AAAA';

/**
 * Convierte la celda de fecha a `YYYY-MM-DD`, o devuelve null si no se puede
 * leer SIN ADIVINAR.
 *
 * Se aceptan dos formatos y ninguno más: ISO (`2026-08-31`) y el colombiano
 * (`31/08/2026`). Un `03/04/2026` se lee como 3 de abril, que es la convención
 * declarada en la plantilla.
 *
 * Por qué no se intenta nada más inteligente: en una auditoría la fecha decide
 * el veredicto. Adivinar mal el orden de día y mes convierte una contratación
 * correcta en un incumplimiento reportado a la empresa, o al revés. Una fila que
 * no se puede leer se reporta como fila inválida, con su número, y alguien la
 * corrige. Eso siempre es mejor que un veredicto inventado.
 */
export function parsearFechaCompra(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) return fechaValida(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  return null;
}

function fechaValida(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > diasDelMes(anio, mes)) return null;
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function diasDelMes(anio: number, mes: number): number {
  if (mes === 2) {
    const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
    return bisiesto ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}
