/**
 * Redistribuir una referencia de pago — las reglas, sin tocar la base.
 *
 * El área financiera toma cualquier referencia (de la pasarela o registrada a mano) y
 * reescribe cómo se reparte entre negocios. Es UNA sola operación: repartir, deshacer un
 * reparto, dejar todo en el negocio original y mover la referencia completa a otro
 * negocio son el mismo gesto —editar una lista de líneas— y no cuatro botones distintos.
 *
 * ── Por qué esto existe ─────────────────────────────────────────────────────
 *
 * Antes solo se podía corregir ANTES de que la financiera aceptara el reparto: la única
 * acción disponible exige negocio en `venta` y conciliación sin confirmar. Los errores de
 * plata se descubren tarde, así que en la práctica la corrección terminaba siendo un SQL
 * a mano. Medido el 2026-08-11: de 89 referencias del workspace, 2 están repartidas, y
 * las dos ya estaban fuera del alcance de esa acción (`ejecucion` + conciliadas).
 *
 * ── Las tres reglas que NO son negociables ──────────────────────────────────
 *
 * 1. Lo distribuido no puede superar el pago original. Ese es el control que atrapa el
 *    pago contado dos veces (ver `sobreasignacion.ts`); aquí se aplica al conjunto.
 * 2. De un negocio ya FACTURADO no se quita plata. Si se facturó, reversarlo desarma el
 *    soporte de la factura. Asignarle más sí se puede, y su sobrante también se puede
 *    mover: un sobrante no sustenta la factura.
 * 3. Toda porción de una referencia repartida lleva `split_id`. Una porción sin él la
 *    leen `refDuplicadaNoSplit` y `negocioCongeladoPorDuplicado` como duplicado
 *    accidental, y CONGELAN los dos negocios. Se re-estampa en todas, incluidas las que
 *    ya estaban.
 *
 * Puro: no toca DB ni red.
 */

import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

/** Una porción viva de la referencia, tal como está hoy en la base. */
export interface PorcionActual {
  cobroId: string
  negocioId: string
  /** Para el mensaje de error: el operador piensa en códigos, no en uuid. */
  negocioCodigo: string | null
  monto: number
  /** El negocio de esta porción ya tiene factura emitida. */
  negocioFacturado: boolean
}

/** Una línea de la distribución nueva, tal como la dejó la persona. */
export interface LineaDestino {
  negocioId: string
  negocioCodigo?: string | null
  monto: number
  /** Marca explícita de "esto se le devuelve al cliente", no es de ningún negocio. */
  porDevolver?: boolean
}

export type AccionPorcion =
  /** Existía y sigue con el mismo monto: no se toca. */
  | 'sin_cambio'
  /** Existía y cambia de monto. */
  | 'ajustar'
  /** Existía y ya no está en la distribución nueva: se anula. */
  | 'anular'
  /** No existía: se crea. */
  | 'crear'

export interface CambioPorcion {
  accion: AccionPorcion
  negocioId: string
  negocioCodigo: string | null
  /** Presente salvo en 'crear'. */
  cobroId?: string
  montoAnterior: number
  montoNuevo: number
}

export interface PlanRedistribucion {
  ok: boolean
  /** Vacío si `ok`. Cada uno es texto que se le muestra a la persona. */
  errores: string[]
  cambios: CambioPorcion[]
  /** Negocios cuyo recaudo cambia y hay que recalcular. */
  negociosAfectados: string[]
  /** Suma de lo asignado a negocios (sin lo marcado por devolver). */
  totalAsignado: number
  /** Lo declarado como devolución al cliente. */
  totalPorDevolver: number
  /** Pago original menos todo lo anterior. Positivo = queda plata sin asignar. */
  sinAsignar: number
  /**
   * Cuántas porciones vivas quedan. Con 2 o más, TODAS necesitan `split_id`;
   * con una sola, el reparto dejó de existir y la marca sobra.
   */
  porcionesResultantes: number
}

const MOTIVO_MIN = 10

/**
 * Arma el plan de cambios y dice si es aplicable.
 *
 * No ejecuta nada: quien llama decide qué hacer con el plan. Así la regla se puede probar
 * sin base de datos, que es justo lo que hace falta cuando la regla mueve dinero.
 */
export function planearRedistribucion(input: {
  /** Valor real del pago que llegó. */
  pagoOriginal: number
  actuales: PorcionActual[]
  destino: LineaDestino[]
  motivo: string
}): PlanRedistribucion {
  const errores: string[] = []
  const { pagoOriginal, actuales, destino } = input

  const motivo = (input.motivo ?? '').trim()
  if (motivo.length < MOTIVO_MIN) {
    errores.push(`Escribe por qué se redistribuye (mínimo ${MOTIVO_MIN} caracteres).`)
  }

  // Una línea sin negocio o sin plata no es una línea: es un renglón a medio llenar.
  const lineasValidas = destino.filter(l => l.negocioId && Number.isFinite(l.monto))
  if (lineasValidas.some(l => l.monto <= 0)) {
    errores.push('Ninguna línea puede quedar en cero o en negativo. Para quitar un negocio, elimina su línea.')
  }

  // Un mismo negocio dos veces produce dos cobros bajo la misma referencia, que es
  // exactamente la forma que tiene un duplicado accidental.
  const vistos = new Set<string>()
  for (const l of lineasValidas) {
    if (vistos.has(l.negocioId)) {
      errores.push(`${l.negocioCodigo ?? 'Un negocio'} aparece dos veces. Súmalo en una sola línea.`)
      break
    }
    vistos.add(l.negocioId)
  }

  const totalAsignado = lineasValidas
    .filter(l => !l.porDevolver)
    .reduce((s, l) => s + l.monto, 0)
  const totalPorDevolver = lineasValidas
    .filter(l => l.porDevolver)
    .reduce((s, l) => s + l.monto, 0)
  const sinAsignar = pagoOriginal - totalAsignado - totalPorDevolver

  // La regla que atrapa el pago contado dos veces, aplicada al conjunto.
  if (sinAsignar < -TOLERANCIA_SALDO_COP) {
    errores.push(
      `Estás repartiendo ${fmt(totalAsignado + totalPorDevolver)} de un pago de ${fmt(pagoOriginal)}. ` +
      `Sobran ${fmt(Math.abs(sinAsignar))}.`,
    )
  }

  // ── Plan de cambios ──
  const porNegocio = new Map(actuales.map(a => [a.negocioId, a]))
  const cambios: CambioPorcion[] = []

  for (const l of lineasValidas) {
    const previo = porNegocio.get(l.negocioId)
    if (!previo) {
      cambios.push({
        accion: 'crear',
        negocioId: l.negocioId,
        negocioCodigo: l.negocioCodigo ?? null,
        montoAnterior: 0,
        montoNuevo: l.monto,
      })
      continue
    }
    const igual = Math.abs(previo.monto - l.monto) <= TOLERANCIA_SALDO_COP
    cambios.push({
      accion: igual ? 'sin_cambio' : 'ajustar',
      negocioId: l.negocioId,
      negocioCodigo: previo.negocioCodigo ?? l.negocioCodigo ?? null,
      cobroId: previo.cobroId,
      montoAnterior: previo.monto,
      montoNuevo: l.monto,
    })
  }

  const enDestino = new Set(lineasValidas.map(l => l.negocioId))
  for (const a of actuales) {
    if (enDestino.has(a.negocioId)) continue
    cambios.push({
      accion: 'anular',
      negocioId: a.negocioId,
      negocioCodigo: a.negocioCodigo,
      cobroId: a.cobroId,
      montoAnterior: a.monto,
      montoNuevo: 0,
    })
  }

  // ── Gate de factura: solo a la BAJA ──
  // Se evalúa sobre el plan y no sobre las líneas, porque quitar una línea entera y
  // bajarle el monto son el mismo daño para el soporte de una factura ya emitida.
  for (const c of cambios) {
    const previo = porNegocio.get(c.negocioId)
    if (!previo?.negocioFacturado) continue
    if (c.montoNuevo < c.montoAnterior - TOLERANCIA_SALDO_COP) {
      errores.push(
        `${c.negocioCodigo ?? 'Ese negocio'} ya tiene factura emitida: no se le puede quitar plata. ` +
        `Anula la factura primero, o deja su parte como está.`,
      )
    }
  }

  const negociosAfectados = [...new Set(
    cambios.filter(c => c.accion !== 'sin_cambio').map(c => c.negocioId),
  )]

  const porcionesResultantes = cambios.filter(
    c => c.accion === 'crear' || c.accion === 'ajustar' || c.accion === 'sin_cambio',
  ).length

  if (porcionesResultantes === 0) {
    errores.push('La referencia quedaría sin ningún negocio. Deja al menos una línea.')
  }

  return {
    ok: errores.length === 0,
    errores,
    cambios,
    negociosAfectados,
    totalAsignado,
    totalPorDevolver,
    sinAsignar,
    porcionesResultantes,
  }
}

/**
 * ¿Las porciones que quedan vivas necesitan `split_id`?
 *
 * Con dos o más, sí, y en TODAS: una sin la marca la lee el resto del sistema como un
 * duplicado accidental y congela los negocios. Con una sola, el reparto dejó de existir.
 */
export function requiereSplitId(porcionesResultantes: number): boolean {
  return porcionesResultantes >= 2
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}
