/**
 * La ASESORA de la cotización en el documento del cliente (brief del 2026-10-29, punto 5).
 *
 * Hasta hoy el pie y la firma de la propuesta de Trappvel eran los de la configuración del espacio
 * (`documento_viaje.pie` y `.firma`): la línea de Edgar en todas las cotizaciones. El cliente debe
 * ver a quién le escribe: nombre, cargo, correo y celular de la asesora que la armó.
 *
 * ## Quién es la asesora
 * La responsable comercial del negocio (`negocios.responsable_id`); si el negocio no tiene, quien
 * genera el documento. `cotizaciones` no guarda quién la creó, así que «quien la creó» no existe
 * como dato: lo más cercano es quien genera.
 *
 * ## Lo que falte no se inventa
 * Sin correo o sin celular en su ficha, va lo que haya. Sin nombre, el documento sale como antes.
 *
 * Puro: la lectura de la ficha vive en `cotizacion-pdf-actions.ts`.
 */

export interface AsesoraDeLaCotizacion {
  nombre: string
  cargo: string | null
  correo: string | null
  /** Tal como está en la ficha (`staff.phone_whatsapp`, «+573001234567»). */
  celular: string | null
}

/** «+573132211090» → «313 221 1090». Lo que no es un celular colombiano queda como está. */
export function celularLegible(telefono: string | null | undefined): string | null {
  const t = (telefono ?? '').trim()
  if (!t) return null
  const digitos = t.replace(/\D/g, '')
  const local = digitos.length === 12 && digitos.startsWith('57') ? digitos.slice(2) : digitos
  if (local.length === 10 && local.startsWith('3')) return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
  return t
}

/** «Alejandra · Asesora de viajes · correo · 313 221 1090»: solo lo que hay. */
export function lineaDeLaAsesora(a: AsesoraDeLaCotizacion): string {
  return [a.nombre, a.cargo, a.correo, celularLegible(a.celular)].filter((x): x is string => !!x && x.trim() !== '').join(' · ')
}

/** El sitio web del pie configurado («www.trappvel.com · …» → «www.trappvel.com»), si lo trae. */
function sitioDelPie(pie: string | null): string | null {
  const primero = (pie ?? '').split(/\s+·\s+/)[0]?.trim() ?? ''
  return /^(https?:\/\/|www\.)\S+$/i.test(primero) ? primero : null
}

/**
 * El pie de cada hoja: los datos de la asesora y el sitio web de la agencia. Sin asesora, el pie
 * configurado de siempre.
 */
export function pieConLaAsesora(pieConfigurado: string | null, a: AsesoraDeLaCotizacion | null): string | null {
  if (!a) return pieConfigurado
  return [lineaDeLaAsesora(a), sitioDelPie(pieConfigurado)].filter(Boolean).join(' · ')
}

/** La firma al final: la asesora, con su correo y su celular. Sin asesora, la configurada. */
export function firmaConLaAsesora<F extends { nombre: string; cargo: string | null; contacto: string | null }>(
  firmaConfigurada: F | null,
  a: AsesoraDeLaCotizacion | null,
): { nombre: string; cargo: string | null; contacto: string | null } | null {
  if (!a) return firmaConfigurada
  const contacto = [a.correo, celularLegible(a.celular)].filter(Boolean).join(' · ')
  return { nombre: a.nombre, cargo: a.cargo, contacto: contacto || null }
}
