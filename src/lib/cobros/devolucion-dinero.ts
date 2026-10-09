/**
 * Devolución de dinero a un cliente (SOE-007). Reglas PURAS: las comparten el formulario de
 * Tesorería (para avisar antes de guardar) y la server action (que las vuelve a correr). La
 * base las aplica una tercera vez dentro de `registrar_devolucion_dinero`, con el negocio
 * bloqueado: esta capa es ayuda y primer filtro, no el control.
 *
 * Una devolución NO es una anulación. `anularCobro` deja el cobro en 0 y borra un ingreso que
 * sí entró; la devolución es una SALIDA propia en la fecha en que ocurrió, y el cobro original
 * queda intacto. En los tableros resta del recaudo neto del MES de la devolución
 * (`v_recaudo_neto_valor`), sin mover los meses anteriores.
 *
 * Sin IO.
 */

import { RAZONES_PERDIDA_NEGOCIO } from '@/lib/negocios/constants'

/** Mínimo de caracteres del motivo. Mismo listón que la anulación de un cobro. */
export const MOTIVO_DEVOLUCION_MIN = 10

/**
 * Razones con las que se puede cerrar el caso desde una devolución: las de pérdida de venta,
 * menos la que solo pone el sistema al agotar las pausas.
 */
export const RAZONES_CIERRE_DEVOLUCION = RAZONES_PERDIDA_NEGOCIO.filter(
  (r) => r.value !== 'no_conversion_post_pausa',
)

export function etiquetaRazonCierre(valor: string): string | null {
  return RAZONES_CIERRE_DEVOLUCION.find((r) => r.value === valor)?.label ?? null
}

export interface EntradaDevolucion {
  negocio_id: string
  monto: number
  /** 'YYYY-MM-DD', día en que salió el dinero. */
  fecha: string
  motivo: string
  cerrar_caso: boolean
  /** Obligatoria solo si se cierra un caso que sigue abierto. */
  razon_cierre?: string
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * Primer error de la entrada, o `null` si pasa. `hoy` es la fecha de Bogotá (`YYYY-MM-DD`).
 * `neto` (lo cobrado menos lo ya devuelto) y `abierto` son opcionales: los conoce la pantalla,
 * no el servidor antes de bloquear el negocio.
 */
export function validarDevolucion(
  e: EntradaDevolucion,
  hoy: string,
  contexto: { neto?: number; abierto?: boolean } = {},
): string | null {
  if (!(e.negocio_id ?? '').trim()) return 'Elige el negocio al que se le devolvió el dinero'
  const monto = Number(e.monto)
  if (!Number.isFinite(monto) || monto <= 0) return 'El valor devuelto debe ser mayor a cero'
  const fecha = (e.fecha ?? '').trim()
  if (!FECHA_ISO.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) {
    return 'Indica la fecha en que se devolvió el dinero'
  }
  if (fecha > hoy) return 'La fecha de la devolución no puede ser futura'
  if ((e.motivo ?? '').trim().length < MOTIVO_DEVOLUCION_MIN) {
    return `Escribe el motivo de la devolución (mínimo ${MOTIVO_DEVOLUCION_MIN} caracteres)`
  }
  if (typeof contexto.neto === 'number' && monto > contexto.neto) {
    return `No se puede devolver más de lo recaudado neto del negocio (${cop(contexto.neto)})`
  }
  // Una razón escrita tiene que ser de la lista, se use o no.
  if (e.cerrar_caso && e.razon_cierre && !etiquetaRazonCierre(e.razon_cierre)) {
    return 'Elige la razón con la que se cierra el caso'
  }
  // Falta de razón: solo se sabe si el caso sigue abierto. El servidor no lo sabe antes de
  // bloquear el negocio, así que ahí lo decide la base (`razon_requerida`); un caso ya cerrado
  // no se vuelve a cerrar y no necesita razón.
  if (e.cerrar_caso && contexto.abierto === true && !e.razon_cierre) {
    return 'Elige la razón con la que se cierra el caso'
  }
  return null
}

/** Lo que la función de la base responde. */
export type RespuestaRegistro =
  | {
      ok: true
      devolucion_id: string
      cerro_caso: boolean
      ya_cerrado: boolean
      neto_antes: number
      neto_despues: number
    }
  | {
      ok: false
      codigo:
        | 'monto_invalido'
        | 'fecha_futura'
        | 'motivo_requerido'
        | 'negocio_no_encontrado'
        | 'razon_requerida'
        | 'supera_neto'
      neto?: number
    }

/** El código de rechazo de la base, en palabras para la financiera. */
export function mensajeDeRechazo(r: Extract<RespuestaRegistro, { ok: false }>): string {
  switch (r.codigo) {
    case 'monto_invalido':
      return 'El valor devuelto debe ser mayor a cero'
    case 'fecha_futura':
      return 'La fecha de la devolución no puede ser futura'
    case 'motivo_requerido':
      return `Escribe el motivo de la devolución (mínimo ${MOTIVO_DEVOLUCION_MIN} caracteres)`
    case 'negocio_no_encontrado':
      return 'Negocio no encontrado'
    case 'razon_requerida':
      return 'Elige la razón con la que se cierra el caso'
    case 'supera_neto':
      return `No se puede devolver más de lo recaudado neto del negocio (${cop(Number(r.neto ?? 0))})`
    default:
      return 'No se pudo registrar la devolución'
  }
}

/** Una devolución tal como la pinta la ficha del negocio. */
export interface DevolucionDelNegocio {
  id: string
  fecha: string
  monto: number
  motivo: string
  cerro_caso: boolean
  soporte_url: string | null
  soporte_nombre: string | null
  autor: string | null
}

/**
 * Lo cobrado de un negocio, con el mismo criterio que la función de la base: los cobros que ya
 * entraron (con fecha; un anulado ya vale 0), menos los remanentes por devolver
 * (`devolucion_pendiente`).
 */
export function cobradoDelNegocio(
  cobros: Array<{ monto: number | null; tipo_cobro: string | null; fecha: string | null }>,
): number {
  return cobros
    // Sin fecha es una cuota programada que todavía no se paga.
    .filter((c) => !!c.fecha && c.tipo_cobro !== 'devolucion_pendiente')
    .reduce((s, c) => s + Number(c.monto ?? 0), 0)
}

/** Neto por negocio: lo cobrado menos lo devuelto. */
export function recaudadoNeto(cobrado: number, devuelto: number): number {
  return Math.round((Number(cobrado || 0) - Number(devuelto || 0)) * 100) / 100
}

export function cop(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0)
}
