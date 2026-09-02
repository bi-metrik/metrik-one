/**
 * Teléfono del contacto para enlaces de llamada y de WhatsApp.
 *
 * `contactos.telefono` es texto libre y llega mucho peor de lo que se supone.
 * Medido sobre los negocios abiertos de SOENA (2026-08-14) había 15 formas
 * conviviendo, y tres no se resuelven quitando lo que no sea dígito:
 *
 *  - `3001234567.0` — el cargue leyó la celda de Excel como NÚMERO. Limpiar
 *    primero lo convierte en once dígitos, un número que no existe: hay que
 *    cortar el decimal ANTES de limpiar.
 *  - `+57 +57 300...` — indicativo duplicado.
 *  - usuarios de Instagram guardados en el campo de teléfono.
 *
 * Es el espejo en TypeScript de `telefono_cliente_negocio` (SQL), que resuelve
 * lo mismo para los avisos al cliente. Aquí solo decide un enlace, así que
 * cuando el valor no es un móvil colombiano devuelve `null` en vez de adivinar:
 * un botón de WhatsApp que abre una conversación con un número inexistente es
 * peor que no ofrecer el botón.
 */

/** Número en formato E.164 sin `+` (ej. `573001234567`), o null si no es un móvil colombiano. */
export function whatsappDesdeTelefono(raw: string | null | undefined): string | null {
  if (!raw) return null

  // 1. Cortar el decimal que dejó Excel ANTES de limpiar.
  const sinDecimal = raw.trim().replace(/[.,]0+$/, '')

  // 2. Quitar todo lo que no sea dígito.
  let digitos = sinDecimal.replace(/\D/g, '')
  if (!digitos) return null

  // 3. Colapsar indicativos repetidos (`57 57 300...`).
  while (digitos.length > 12 && digitos.startsWith('5757')) {
    digitos = digitos.slice(2)
  }

  // 4. Con indicativo: 57 + móvil de 10 dígitos que empieza en 3.
  if (digitos.length === 12 && digitos.startsWith('573')) return digitos

  // 5. Sin indicativo: móvil colombiano de 10 dígitos.
  if (digitos.length === 10 && digitos.startsWith('3')) return `57${digitos}`

  // Un fijo, un número extranjero o un handle de Instagram no abren WhatsApp.
  return null
}

/** Valor para `href="tel:"`. Conserva el `+` cuando el número trae indicativo. */
export function telDesdeTelefono(raw: string | null | undefined): string | null {
  if (!raw) return null
  const sinDecimal = raw.trim().replace(/[.,]0+$/, '')
  const digitos = sinDecimal.replace(/\D/g, '')
  if (!digitos) return null
  const wa = whatsappDesdeTelefono(raw)
  if (wa) return `+${wa}`
  // No es un móvil colombiano, pero puede ser un fijo o un número de otro país:
  // se ofrece igual para LLAMAR (no para WhatsApp). Medido en producción hay
  // dos contactos con número de EE. UU. (`+1313…`, `+1316…`); si se les quita el
  // `+` que traían, el enlace marca un número local que no existe.
  if (digitos.length < 7) return null
  return sinDecimal.trimStart().startsWith('+') ? `+${digitos}` : digitos
}
