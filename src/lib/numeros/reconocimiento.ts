// ============================================================
// Reconocimiento de ingreso por COMPLETITUD — espejo TS de la vista v_pyl_mes
// (migración 20260709000001). P3 Ola 3, opt-in por workspace, prospectivo.
// ------------------------------------------------------------
// Regla de Mauricio: un ingreso solo es VENTA efectiva cuando el negocio se
// COMPLETA. El dinero anticipado queda "recaudado, no reconocido"; se cuenta
// como venta al cierre del negocio (closed_at).
//
// La lógica canónica vive en SQL (v_pyl_mes). Este módulo la replica en TS por
// dos razones:
//   1. Documentar la regla en un solo lugar legible/testeable.
//   2. Permitir tests unitarios deterministas del opt-in on/off + cutover sin
//      levantar Postgres.
// Si cambia la vista, cambiar aquí en paralelo (y sus tests). No se importa en
// runtime del tablero (el tablero lee la vista); es la especificación ejecutable.
// ============================================================

export interface WorkspaceReconocimientoConfig {
  /** modules.reconocimiento_completitud === true */
  optInFlag: boolean
  /** config_extra.reconocimiento_completitud_cutover, 'YYYY-MM-DD' o null */
  cutover: string | null
}

export interface CobroLite {
  monto: number
  /** día del cobro, 'YYYY-MM-DD' */
  fecha: string
  /** 'pasante' se excluye SIEMPRE (recaudo a favor de terceros, Ola 1) */
  tipo_cobro: string | null
  negocioId: string | null
}

export interface NegocioLite {
  id: string
  /** 'YYYY-MM-DD' o ISO */
  created_at: string
  /** 'abierto' | 'completado' */
  estado: string
  /** timestamp de cierre (closed_at) o null si no cerrado */
  closed_at: string | null
}

/** Mes 'YYYY-MM' de una fecha 'YYYY-MM-DD' o ISO. */
export function mesDe(fecha: string): string {
  return fecha.slice(0, 7)
}

/** El cobro cuenta para ingreso/recaudo (no es pasante). */
export function esCobroDeIngreso(c: CobroLite): boolean {
  return c.tipo_cobro !== 'pasante'
}

/**
 * ¿El workspace usa base COMPLETITUD? Requiere flag Y cutover válido.
 * Sin cutover válido → false (fail-safe: cae a caja, no reescribe históricos).
 */
export function usaReconocimientoCompletitud(cfg: WorkspaceReconocimientoConfig): boolean {
  return cfg.optInFlag && !!cfg.cutover && /^\d{4}-\d{2}-\d{2}$/.test(cfg.cutover)
}

/**
 * RECAUDO DE CAJA del mes (tesorería). Siempre por cobros.fecha, excluye
 * pasante. No depende del opt-in — es la foto de caja, se preserva para todos.
 */
export function recaudoCajaDelMes(cobros: CobroLite[], mes: string): number {
  return cobros
    .filter((c) => esCobroDeIngreso(c) && mesDe(c.fecha) === mes)
    .reduce((s, c) => s + c.monto, 0)
}

/**
 * INGRESO RECONOCIDO del mes.
 * - Workspace NO opt-in → base CAJA (= recaudo de caja del mes).
 * - Workspace opt-in con cutover c:
 *     (A) cobros de negocios LEGACY (created_at < c) → caja por fecha.
 *     (B) cobros SIN negocio → caja por fecha.
 *     (C) negocios POST-cutover (created_at >= c) COMPLETADOS → su honorario
 *         (suma de cobros no-pasante del negocio) reconocido en el mes de
 *         closed_at. Post-cutover NO completados → 0 (recaudado, no reconocido).
 */
export function ingresoReconocidoDelMes(
  cfg: WorkspaceReconocimientoConfig,
  cobros: CobroLite[],
  negocios: NegocioLite[],
  mes: string,
): number {
  if (!usaReconocimientoCompletitud(cfg)) {
    return recaudoCajaDelMes(cobros, mes)
  }
  const cutover = cfg.cutover as string
  const negocioPorId = new Map(negocios.map((n) => [n.id, n]))
  const esPostCutover = (n: NegocioLite) => n.created_at.slice(0, 10) >= cutover

  // (A)+(B): cobros de negocios legacy o sin negocio → caja por fecha.
  const bolsaCaja = cobros
    .filter((c) => {
      if (!esCobroDeIngreso(c) || mesDe(c.fecha) !== mes) return false
      if (c.negocioId === null) return true // (B)
      const n = negocioPorId.get(c.negocioId)
      if (!n) return true // negocio inexistente → trátalo como caja (no romper)
      return !esPostCutover(n) // (A) legacy
    })
    .reduce((s, c) => s + c.monto, 0)

  // (C): honorario de negocios post-cutover completados en este mes.
  const bolsaCompletados = negocios
    .filter(
      (n) =>
        esPostCutover(n) &&
        n.estado === 'completado' &&
        n.closed_at !== null &&
        mesDe(n.closed_at) === mes,
    )
    .reduce((s, n) => {
      const honorario = cobros
        .filter((c) => c.negocioId === n.id && esCobroDeIngreso(c))
        .reduce((acc, c) => acc + c.monto, 0)
      return s + honorario
    }, 0)

  return bolsaCaja + bolsaCompletados
}
