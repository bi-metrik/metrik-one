/**
 * Traduccion entre lo que devuelve la API de Valida y el vocabulario de la
 * pantalla de comparativa.
 *
 * Vive aparte del server action a proposito: un archivo `'use server'` solo
 * puede exportar funciones async, asi que las funciones puras que hacen el
 * trabajo real no serian testeables desde ahi. Y son justo las que estaban mal:
 * la UI leia `dual_id`, `count_informa` y `decision` sobre filas que traen `id`,
 * `informa_match_count` y `auditor_decision`, y pintaba `undefined` en cada celda.
 */

export type DualDecisionMapeada =
  | 'valida_correcto'
  | 'valida_falso_negativo'
  | 'valida_falso_positivo'
  | 'informa_falso_negativo'
  | 'informa_falso_positivo'
  | 'inconcluso';

export const DECISIONES_DUAL: DualDecisionMapeada[] = [
  'valida_correcto',
  'valida_falso_negativo',
  'valida_falso_positivo',
  'informa_falso_negativo',
  'informa_falso_positivo',
  'inconcluso',
];

/** Fila cruda de `consultas_dual` tal como la lista la API. */
export type DualRowCruda = {
  id: string;
  fecha: string;
  workspace_origen: string;
  modo: string;
  payload: { identificacion?: string | null; nombre?: string | null; tipo?: string | null } | null;
  informa_match_count: number | null;
  valida_match_count: number | null;
  clasificacion: string;
  auditada: boolean;
  auditor_decision: string | null;
  stub_mode: boolean | null;
};

export type DualItemMapeado = {
  dual_id: string;
  workspace_origen: string;
  fecha: string;
  modo: string;
  tipo: string | null;
  identificacion: string | null;
  nombre: string | null;
  count_informa: number;
  count_valida: number;
  clasificacion: string;
  auditada: boolean;
  decision: DualDecisionMapeada | null;
  stub_mode: boolean;
};

/**
 * `'pendiente'` es el default de la columna en la base, no un veredicto.
 * Tratarlo como decision hacia que una fila sin auditar mostrara "Pendiente"
 * en la columna de decision como si alguien hubiera decidido algo.
 */
export function decisionDeFila(v: string | null | undefined): DualDecisionMapeada | null {
  return !v || v === 'pendiente' ? null : (v as DualDecisionMapeada);
}

export function mapListItem(r: DualRowCruda): DualItemMapeado {
  const p = r.payload ?? {};
  return {
    dual_id: r.id,
    workspace_origen: r.workspace_origen,
    fecha: r.fecha,
    modo: r.modo,
    tipo: p.tipo ?? null,
    identificacion: p.identificacion ?? null,
    nombre: p.nombre ?? null,
    count_informa: r.informa_match_count ?? 0,
    count_valida: r.valida_match_count ?? 0,
    clasificacion: r.clasificacion,
    auditada: r.auditada,
    decision: decisionDeFila(r.auditor_decision),
    stub_mode: r.stub_mode ?? false,
  };
}

export type DualMetricsCrudas = {
  total_consultas?: number;
  stub_excluidas?: number;
  incluye_stub?: boolean;
  contadores_por_clasificacion?: Record<string, number>;
  pct_zero_zero?: number;
  pct_divergencia?: number;
  pendientes_auditoria?: number;
  veredictos?: Record<string, number>;
  por_lista?: Array<{
    lista: string;
    origen: string;
    positivos_auditados: number;
    recall: number | null;
    precision: number | null;
    cumple_umbral: boolean;
  }>;
  metricas?: {
    recall?: number | null;
    precision?: number | null;
    positivos_auditados?: number;
    cumple_umbral_vera?: boolean;
  };
};

/**
 * La API anida recall/precision bajo `metricas` y no completa los veredictos que
 * valen cero. Leerlo plano devolvia `undefined` y el tablero moria en el primer
 * `.toString()`. Cada campo cae a su neutro, nunca a `undefined`.
 */
export function mapMetrics(m: DualMetricsCrudas) {
  const veredictos = DECISIONES_DUAL.reduce(
    (acc, d) => {
      acc[d] = m.veredictos?.[d] ?? 0;
      return acc;
    },
    {} as Record<DualDecisionMapeada, number>
  );

  return {
    total_consultas: m.total_consultas ?? 0,
    stub_excluidas: m.stub_excluidas ?? 0,
    incluye_stub: m.incluye_stub ?? false,
    pct_zero_zero: m.pct_zero_zero ?? 0,
    pct_divergencia: m.pct_divergencia ?? 0,
    pendientes_auditoria: m.pendientes_auditoria ?? 0,
    positivos_auditados: m.metricas?.positivos_auditados ?? 0,
    recall: m.metricas?.recall ?? null,
    precision: m.metricas?.precision ?? null,
    cumple_umbral_vera: m.metricas?.cumple_umbral_vera ?? false,
    veredictos,
    contadores_por_clasificacion: m.contadores_por_clasificacion ?? {},
    por_lista: m.por_lista ?? [],
  };
}
