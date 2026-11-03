/**
 * Datos de la obra en el negocio: el nombre corto que va en los botones de WhatsApp (C21) y las
 * condiciones del contrato (C18): anticipo, forma de pago y plazo de pago.
 */

/** Un botón de WhatsApp muestra hasta 20 caracteres. */
export const MAX_NOMBRE_CORTO = 20

export interface CondicionesObra {
  nombre_corto: string | null
  anticipo_pct: number | null
  forma_pago: string | null
  plazo_pago_dias: number | null
}

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string }

const vacio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

export function validarCondiciones(entrada: unknown): Resultado<CondicionesObra> {
  const e = (entrada ?? {}) as Record<string, unknown>

  let nombre_corto: string | null = null
  if (!vacio(e.nombre_corto)) {
    if (typeof e.nombre_corto !== 'string') return { ok: false, error: 'El nombre corto no es válido.' }
    const t = e.nombre_corto.trim().replace(/\s+/g, ' ')
    if (t.length > MAX_NOMBRE_CORTO) return { ok: false, error: `El nombre corto tiene máximo ${MAX_NOMBRE_CORTO} caracteres.` }
    nombre_corto = t
  }

  let anticipo_pct: number | null = null
  if (!vacio(e.anticipo_pct)) {
    const v = Number(e.anticipo_pct)
    if (!Number.isFinite(v) || v < 0 || v > 100) return { ok: false, error: 'El anticipo es un porcentaje entre 0 y 100.' }
    anticipo_pct = Math.round(v * 100) / 100
  }

  let forma_pago: string | null = null
  if (!vacio(e.forma_pago)) {
    if (typeof e.forma_pago !== 'string') return { ok: false, error: 'La forma de pago no es válida.' }
    const t = e.forma_pago.trim()
    if (t.length > 300) return { ok: false, error: 'La forma de pago tiene máximo 300 caracteres.' }
    forma_pago = t
  }

  let plazo_pago_dias: number | null = null
  if (!vacio(e.plazo_pago_dias)) {
    const v = Number(e.plazo_pago_dias)
    if (!Number.isInteger(v) || v < 0 || v > 365) return { ok: false, error: 'El plazo de pago es un número de días entre 0 y 365.' }
    plazo_pago_dias = v
  }

  return { ok: true, datos: { nombre_corto, anticipo_pct, forma_pago, plazo_pago_dias } }
}
