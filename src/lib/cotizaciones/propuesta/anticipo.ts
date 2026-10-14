/**
 * El anticipo para apartar el viaje, asignado A MANO por la asesora en cada cotización
 * (decisión de Mauricio del 2026-10-14, punto 3).
 *
 * - No hay porcentaje fijo: ni el 10 % del prototipo ni otro. La asesora escribe un monto y
 *   una línea de texto («Con esto les bloqueamos los hoteles por 5 días»). Sin monto, la
 *   propuesta no imprime ninguna cifra de anticipo.
 * - Es lo que el PDF le DICE al cliente, no un pago: mostrarlo no registra ningún cobro ni
 *   mueve el negocio de etapa. (Un anticipo mayor que cero registrado como pago sí lo mueve a
 *   Reservas, N4 de Hana; eso pasa solo en «El cliente confirmó», nunca aquí.)
 *
 * ## Dónde vive
 * En `cotizaciones.documento_cliente.anticipo` (jsonb que ya existe, CHECK «es objeto»), sin
 * migración. Se revisó antes el plan de pagos: el de la cotización («Así puedes pagar») se
 * CALCULA con la regla de la línea y no se edita; el editable (`negocio_planes_pago`) nace al
 * confirmar, después de la propuesta. Ninguno sirve de fuente.
 *
 * El texto para el cliente y el anticipo comparten la columna pero no el ciclo de vida: quien
 * guarda o redacta el texto conserva el anticipo que encuentre (`conAnticipo`), y un texto
 * vaciado deja la columna con solo el anticipo. La copia de una cotización NO lo hereda: el
 * monto es de ese precio.
 */

export interface AnticipoPropuesta {
  /** Pesos, entero positivo. */
  monto: number
  /** Una línea para el cliente. `null` = solo la cifra. */
  texto: string | null
}

export const MAX_TEXTO_ANTICIPO = 160
/** Un tope de cordura: el anticipo de un viaje no pasa de mil millones. */
const MAX_MONTO = 1_000_000_000

/** Lo que manda el navegador, limpio. `null` = sin anticipo (borrarlo). Un monto inválido es error. */
export function normalizarAnticipo(raw: unknown): { ok: true; anticipo: AnticipoPropuesta | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, anticipo: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Anticipo inválido.' }
  const r = raw as Record<string, unknown>
  // «$ 5.421.000» desde el campo: solo los dígitos (pesos sin decimales).
  const crudo = typeof r.monto === 'string' ? r.monto.replace(/[^\d]/g, '') : r.monto
  if (crudo === '' || crudo === null || crudo === undefined || crudo === 0) return { ok: true, anticipo: null }
  const n = typeof crudo === 'string' ? Number(crudo) : crudo
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'El anticipo tiene que ser un monto en pesos.' }
  }
  const monto = Math.round(n)
  if (monto > MAX_MONTO) return { ok: false, error: 'Ese anticipo es demasiado alto. Revisa la cifra.' }
  const texto = typeof r.texto === 'string' ? r.texto.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO_ANTICIPO) : ''
  return { ok: true, anticipo: { monto, texto: texto || null } }
}

/** El anticipo guardado en `documento_cliente`, o `null`. Un dato roto se lee como ausente. */
export function leerAnticipo(documentoCliente: unknown): AnticipoPropuesta | null {
  if (!documentoCliente || typeof documentoCliente !== 'object' || Array.isArray(documentoCliente)) return null
  const a = (documentoCliente as Record<string, unknown>).anticipo
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null
  const r = a as Record<string, unknown>
  if (typeof r.monto !== 'number' || !Number.isFinite(r.monto) || r.monto <= 0) return null
  const texto = typeof r.texto === 'string' && r.texto.trim() !== '' ? r.texto.trim() : null
  return { monto: Math.round(r.monto), texto }
}

/**
 * El valor de `documento_cliente` con el anticipo puesto (o quitado). `documento` es lo que el
 * escritor del texto iba a guardar (`null` = sin texto). Sin texto ni anticipo, `null`.
 */
export function conAnticipo<T extends object>(documento: T | null, anticipo: AnticipoPropuesta | null): (T & { anticipo?: AnticipoPropuesta }) | { anticipo: AnticipoPropuesta } | null {
  if (!anticipo) {
    if (!documento) return null
    const { anticipo: _fuera, ...resto } = documento as T & { anticipo?: unknown }
    void _fuera
    return resto as T
  }
  return documento ? { ...documento, anticipo } : { anticipo }
}
