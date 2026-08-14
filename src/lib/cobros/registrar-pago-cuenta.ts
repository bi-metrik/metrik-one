/**
 * Reglas puras para registrar el pago de una cuenta de cobro.
 *
 * Viven aparte del server action para poder probarlas sin base de datos: son la
 * parte que decide si la cuenta queda `pagada` o sigue `enviada`, y como se
 * reparte un abono que no cierra ningun cobro entero.
 *
 * El modelo lo fijan tres decisiones ya tomadas (proyectos/metrik/one/decisions.md):
 *
 *   2026-06-22  Una cuenta pasa a `pagada` SOLO cuando todos sus cobros tienen
 *               fecha. El enum `cuenta_cobro_estado` no tiene "parcial", asi que
 *               un pago que cubre parte deja la cuenta en `enviada` y el abono
 *               mas el saldo se documentan en `notas`.
 *   2026-07-08  Un abono que NO cierra ningun cobro entero entra como cobro
 *               manual (`tipo_cobro='pago'`, `plan_cobro_id=null`,
 *               `numero_cuota=null`) y la cuota programada original BAJA al saldo
 *               pendiente. La cuota no se puede partir en dos cobros programados
 *               por el indice unico parcial `idx_cobros_plan_cuota_unique` sobre
 *               `(plan_cobro_id, numero_cuota)`.
 *   2026-06-22  Registrar recaudo exige evidencia del credito entrante. Un
 *               comprobante de transferencia entre cuentas propias NO prueba el
 *               ingreso del cliente.
 */

/** Minimo de caracteres de la evidencia. No es un formato, es un piso: un campo
 *  de una palabra no describe de donde salio la plata. */
export const EVIDENCIA_MIN_CARACTERES = 10

export type CobroDeCuenta = {
  id: string
  monto: number
  /** null = no pagado */
  fecha: string | null
}

export type ResultadoCobrosCompletos =
  | { ok: false; error: string }
  | {
      ok: true
      /** Cobros que se marcan pagados en esta operacion. */
      aMarcar: string[]
      montoPagado: number
      /** true si con esto TODOS los cobros de la cuenta quedan con fecha. */
      cierraLaCuenta: boolean
      /** Lo que sigue debiendo la cuenta despues de esta operacion. */
      saldoPendiente: number
    }

/**
 * Modo "cobros completos": el pago calza con uno o varios cobros enteros.
 *
 * El monto declarado tiene que coincidir con la suma de los cobros elegidos. Si
 * no coincide, el caso es un abono parcial y va por el otro camino: dejar pasar
 * un descuadre aqui marcaria como pagado un cobro que el cliente no cubrio.
 */
export function planearCobrosCompletos(
  cobrosDeLaCuenta: CobroDeCuenta[],
  seleccionIds: string[],
  montoDeclarado: number,
): ResultadoCobrosCompletos {
  if (seleccionIds.length === 0) {
    return { ok: false, error: 'Selecciona al menos un cobro cubierto por el pago.' }
  }

  const porId = new Map(cobrosDeLaCuenta.map(c => [c.id, c]))
  const seleccionados: CobroDeCuenta[] = []

  for (const id of seleccionIds) {
    const c = porId.get(id)
    if (!c) return { ok: false, error: 'Un cobro seleccionado no pertenece a esta cuenta.' }
    if (c.fecha) return { ok: false, error: 'Un cobro seleccionado ya estaba registrado como pagado.' }
    seleccionados.push(c)
  }

  const montoPagado = seleccionados.reduce((s, c) => s + c.monto, 0)
  if (Math.round(montoPagado) !== Math.round(montoDeclarado)) {
    return {
      ok: false,
      error: `El valor recibido no coincide con los cobros seleccionados (suman ${Math.round(montoPagado)}). Si el pago cubre solo una parte, registralo como abono parcial.`,
    }
  }

  const yaPagados = new Set(cobrosDeLaCuenta.filter(c => c.fecha).map(c => c.id))
  for (const id of seleccionIds) yaPagados.add(id)

  const pendientes = cobrosDeLaCuenta.filter(c => !yaPagados.has(c.id))

  return {
    ok: true,
    aMarcar: seleccionIds,
    montoPagado,
    cierraLaCuenta: pendientes.length === 0,
    saldoPendiente: pendientes.reduce((s, c) => s + c.monto, 0),
  }
}

export type ResultadoAbonoParcial =
  | { ok: false; error: string }
  | {
      ok: true
      /** Cobro programado cuyo monto BAJA al saldo pendiente. */
      cobroReducidoId: string
      montoReducido: number
      /** Monto del cobro manual nuevo que representa la porcion pagada. */
      montoAbono: number
    }

/**
 * Modo "abono parcial": el pago no cierra ningun cobro entero.
 *
 * La cuota programada NO se parte en dos cobros programados (lo impide el indice
 * unico parcial): se reduce al saldo y la porcion pagada entra como cobro manual.
 * La suma de los dos es exactamente la cuota original, asi que el total de la
 * cuenta no se mueve.
 */
export function planearAbonoParcial(
  cobrosDeLaCuenta: CobroDeCuenta[],
  cobroId: string,
  montoAbono: number,
): ResultadoAbonoParcial {
  const cobro = cobrosDeLaCuenta.find(c => c.id === cobroId)
  if (!cobro) return { ok: false, error: 'El cobro no pertenece a esta cuenta.' }
  if (cobro.fecha) return { ok: false, error: 'Ese cobro ya estaba registrado como pagado.' }

  if (!Number.isFinite(montoAbono) || montoAbono <= 0) {
    return { ok: false, error: 'El valor del abono tiene que ser mayor que cero.' }
  }
  if (Math.round(montoAbono) >= Math.round(cobro.monto)) {
    return {
      ok: false,
      error: 'El abono cubre el cobro completo. Registralo como cobro cubierto, no como abono parcial.',
    }
  }

  return {
    ok: true,
    cobroReducidoId: cobro.id,
    montoReducido: cobro.monto - montoAbono,
    montoAbono,
  }
}

/** Agrega una linea al historial de `notas` sin pisar lo que ya estaba. */
export function anotar(notasPrevias: string | null, linea: string): string {
  const previo = (notasPrevias ?? '').trim()
  return previo ? `${previo}\n${linea}` : linea
}

export function formatCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

// ── Contrato del server action ────────────────────────────────────
// Viven aqui y no junto al server action porque `cuentas-cobro-actions.ts` es
// un archivo `'use server'`: exportar de ahi algo que no sea una funcion async
// anula TODOS los exports del modulo, y el build es lo unico que lo delata.

export type RegistrarPagoInput = {
  cuentaId: string
  /** Fecha valor del credito entrante, YYYY-MM-DD. */
  fecha: string
  /** Descripcion de la evidencia del credito entrante. Obligatoria. */
  evidencia: string
} & (
  | { modo: 'cobros_completos'; cobrosIds: string[]; monto: number }
  | { modo: 'abono_parcial'; cobroId: string; monto: number }
)

export type RegistrarPagoResult = {
  cuentaCerrada: boolean
  saldoPendiente: number
  mensaje: string
}
