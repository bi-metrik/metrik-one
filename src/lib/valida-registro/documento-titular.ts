/**
 * El documento del TITULAR de la tarjeta con que se registra el plan de Valida. Puro y sin imports:
 * lo usan la pantalla (`tarjeta-epayco.tsx`) y el servidor (`metodo-pago.ts`).
 *
 * Es el documento de quien es dueño de la tarjeta, no el NIT de la empresa: el antifraude de ePayco
 * compara el documento y el nombre del cobro con los del medio de pago (transacción 390341460,
 * «Rechazada eControl», 2026-10-19: tarjeta personal mandada con el NIT de la empresa).
 */

/** Los tipos que se aceptan, con el código que espera ePayco (`docType`). */
export const TIPOS_DOCUMENTO_TITULAR = [
  { codigo: 'CC', nombre: 'Cédula de ciudadanía' },
  { codigo: 'CE', nombre: 'Cédula de extranjería' },
  { codigo: 'NIT', nombre: 'NIT' },
  { codigo: 'PP', nombre: 'Pasaporte' },
] as const

export type TipoDocumentoTitular = (typeof TIPOS_DOCUMENTO_TITULAR)[number]['codigo']

export function esTipoDocumentoTitular(v: unknown): v is TipoDocumentoTitular {
  return typeof v === 'string' && TIPOS_DOCUMENTO_TITULAR.some((t) => t.codigo === v)
}

/**
 * El número limpio, o `null` si no tiene la forma de su tipo. CC y CE solo dígitos (3 a 11); NIT 9 o
 * 10 dígitos, sin el dígito de verificación (si viene «-DV», se quita); pasaporte, letras y dígitos.
 */
export function limpiarDocumentoTitular(tipo: TipoDocumentoTitular, v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (tipo === 'PP') {
    const pp = v.replace(/[\s.-]/g, '').toUpperCase()
    return /^[A-Z0-9]{5,20}$/.test(pp) ? pp : null
  }
  let d = v.replace(/[\s.,]/g, '')
  if (tipo === 'NIT') d = d.replace(/-\d$/, '')
  if (!/^\d+$/.test(d)) return null
  const [min, max] = tipo === 'NIT' ? [9, 10] : [3, 11]
  return d.length >= min && d.length <= max ? d : null
}

/**
 * Nombres o apellidos del titular, limpios: sin espacios de más. `null` si no sirven: vacío, de una
 * letra, de más de 50 caracteres (el tope de ePayco por campo) o con números.
 */
export function limpiarNombrePersona(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const n = v.trim().replace(/\s+/g, ' ')
  if (n.length < 2 || n.length > 50 || /\d/.test(n)) return null
  return n
}

/** Lo que va en `card[name]` de ePayco.js: nombres y apellidos, como en la tarjeta. */
export function nombreEnTarjeta(nombres: string, apellidos: string): string {
  return `${nombres} ${apellidos}`.trim().replace(/\s+/g, ' ')
}
