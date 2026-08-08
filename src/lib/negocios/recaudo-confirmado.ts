/**
 * Recaudo CONFIRMADO — qué plata puede sostener una decisión de avance.
 *
 * Regla (aprobada por Mauricio, 2026-08-06):
 *
 *     La plata que todavía no confirmó el área financiera NO suma al saldo.
 *
 * El caso que la originó (SOENA, 2026-08-05): el comercial repartió una referencia de
 * $701.812 en dos mitades entre V0277 y V0287 y dejó la nota "pendiente de confirmar por
 * el área financiera". Nadie confirmó. Esa mitad igual contó como saldo, cerró sola el
 * gate de anticipo de V0287 (`autocompletarGatesAnticipoPorSaldo`) y el negocio avanzó a
 * Documentación con plata que no era suya. Si la conciliación se la quitaba, quedaba dos
 * etapas adelante con el anticipo sin pagar.
 *
 * NO se creó un gate nuevo, a propósito. Un gate extra deja el saldo inflado circulando
 * por el P&L, `/numeros` y el tablero de bonos, y solo pone una barrera al final: corrige
 * dónde se nota el error, no el error. Sacando esa plata del saldo, los gates de saldo que
 * YA existen hacen el trabajo con el número correcto, y el efecto es proporcional — el
 * negocio con plata propia suficiente avanza sin fricción.
 *
 * ── Por qué no hay columna nueva ni migración ────────────────────────────────
 *
 * El estado ya existía, repartido en dos señales que este módulo cruza:
 *
 *   1. `cobros.split_json.origen === 'comercial'` — la porción es una PROPUESTA del
 *      comercial. Lo escribe `repartirPagoCore` (conciliacion-actions.ts), que ya declara
 *      en su comentario que el check "lo pone SIEMPRE la financiera (control de dos
 *      personas)".
 *   2. `negocio_conciliacion.conciliado` — la financiera validó. Lo escribe
 *      `aceptarRepartoComercial`, que NO borra la marca de origen: por eso hay que cruzar
 *      las dos y no basta con mirar una.
 *
 * Esto hace el cambio seguro por construcción: un cobro normal (una referencia, un
 * negocio) nunca lleva `origen='comercial'`, así que siempre cuenta. Medido contra
 * producción SOENA el 2026-08-06 antes de escribir el código: de 75 cobros del workspace,
 * **0 quedarían excluidos hoy**. Actúa sobre repartos futuros, no sobre lo ya recaudado.
 *
 * Un reparto hecho por la financiera (`repartirPago`, sin `origen`) tampoco se toca: ella
 * es quien confirma, no necesita confirmarse a sí misma. Es el caso del reparto de julio
 * (ref 375720883, V0043/V0064), que sigue contando igual que antes.
 *
 * Puro: no toca DB ni red.
 */

/**
 * ⚠️ DEUDA DETECTADA (2026-08-06): `src/types/database.ts` NO declara `split_json` en
 * `cobros` — solo en `gastos`. La columna existe en la base desde que se construyó el
 * reparto de pagos, así que los tipos están stale. Por eso los llamadores consultan esa
 * columna vía el helper `db()` (que devuelve `any`) en lugar del cliente tipado. Al
 * regenerar los tipos (`npx supabase gen types`, recordando re-agregar los ~26 alias del
 * final del archivo) esos `db()` pueden volver a ser `supabase` tipado.
 */

/** Fila mínima de un cobro para decidir si su plata está confirmada. */
export interface CobroParaRecaudo {
  monto: number | null
  /** `split_json` del cobro. La llave que importa es `origen`. */
  split_json?: { origen?: string } | null
  tipo_cobro?: string | null
}

/**
 * ¿Esta porción es un reparto PROPUESTO por el comercial, a la espera del área financiera?
 *
 * Solo `origen === 'comercial'`. Un reparto de la financiera no trae `origen`, y la
 * corrección administrativa del 2026-08-06 quedó con `origen='correccion_2026_08_06'`:
 * ninguno de los dos es una propuesta pendiente.
 */
export function esPorcionRepartoPropuesto(cobro: CobroParaRecaudo | null | undefined): boolean {
  return cobro?.split_json?.origen === 'comercial'
}

/** Opciones de suma para los llamadores que ya excluían algún tipo de cobro. */
export interface OpcionesRecaudo {
  /**
   * `tipo_cobro` que no son recaudo entrante y ya se excluían antes de este cambio
   * (ej. `devolucion_pendiente` en el gate `saldo:handoff`). Se conserva ese
   * comportamiento tal cual: este módulo agrega un criterio, no reemplaza los que había.
   */
  excluirTipos?: string[]
}

/**
 * Suma el recaudo que PUEDE sostener una decisión de avance.
 *
 * @param cobros            cobros del negocio.
 * @param negocioConciliado `negocio_conciliacion.conciliado` del negocio. Si la financiera
 *                          ya dio el check, TODAS sus porciones cuentan: el control de dos
 *                          personas se cumplió y seguir descontándolas dejaría el negocio
 *                          varado justo después de que alguien resolvió el pendiente.
 * @param opts              tipos a excluir que el llamador ya excluía.
 */
export function sumarRecaudoConfirmado(
  cobros: CobroParaRecaudo[] | null | undefined,
  negocioConciliado: boolean,
  opts?: OpcionesRecaudo,
): number {
  const excluir = new Set(opts?.excluirTipos ?? [])
  return (cobros ?? []).reduce((suma, c) => {
    if (!c) return suma
    if (c.tipo_cobro && excluir.has(c.tipo_cobro)) return suma
    if (!negocioConciliado && esPorcionRepartoPropuesto(c)) return suma
    const monto = Number(c.monto ?? 0)
    return Number.isFinite(monto) ? suma + monto : suma
  }, 0)
}

/**
 * Porción del recaudo que está a la espera del área financiera. Es lo que
 * `sumarRecaudoConfirmado` dejó por fuera, y sirve para NOMBRAR el bloqueo en pantalla:
 * "faltan $X, hay $Y sin confirmar" es accionable; "faltan $X" a secas manda a buscar
 * plata que ya está registrada.
 */
export function recaudoPendienteDeConfirmar(
  cobros: CobroParaRecaudo[] | null | undefined,
  negocioConciliado: boolean,
  opts?: OpcionesRecaudo,
): number {
  if (negocioConciliado) return 0
  const excluir = new Set(opts?.excluirTipos ?? [])
  return (cobros ?? []).reduce((suma, c) => {
    if (!c) return suma
    if (c.tipo_cobro && excluir.has(c.tipo_cobro)) return suma
    if (!esPorcionRepartoPropuesto(c)) return suma
    const monto = Number(c.monto ?? 0)
    return Number.isFinite(monto) ? suma + monto : suma
  }, 0)
}
