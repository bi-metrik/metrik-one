/**
 * Confirmaciones del tablero de servicios (QA Trappvel 2026-10-29). Puro: lo usan la pantalla (el
 * `confirm`, con la misma forma de «¿Estás seguro?» de #1351) y el servidor (el rastro en la
 * actividad del negocio).
 *
 *   · N9-9 / H9-3: «Sacar del viaje» pedía cero confirmación, y la plata del servicio sacado pasaba
 *     a margen en silencio: el precio que aceptó el cliente, su plan de pagos y el PDF no cambian
 *     solos. Ahora se pregunta antes, con el efecto en pesos, y queda escrito en la actividad.
 *   · H9-4: el localizador de una fila se podía sobrescribir sin aviso. Cambiar uno ya guardado se
 *     confirma y deja rastro (el anterior y el nuevo).
 */

const pesos = (n: number) => '$' + Math.round(Math.abs(n)).toLocaleString('es-CO').replace(/,/g, '.')

export interface EntradaSacar {
  nombre: string
  /** Lo cotizado del servicio: lo que va dentro del precio que aceptó el cliente. */
  costoCotizado: number
  /** Lo ya pagado al proveedor por este servicio. */
  pagadoProveedor: number
}

/** El texto del `confirm` antes de sacar un servicio del viaje. */
export function confirmacionSacarDelViaje(e: EntradaSacar): string {
  const nombre = e.nombre.trim() || 'este servicio'
  const cotizado = Math.round(Number(e.costoCotizado) || 0)
  const pagado = Math.round(Number(e.pagadoProveedor) || 0)
  const partes = [`¿Estás seguro? Vas a sacar «${nombre}» del viaje.`]
  if (cotizado > 0) {
    partes.push(
      `Va en el precio que aceptó el cliente con un costo de ${pesos(cotizado)}: el precio y el plan de pagos no cambian solos, y esa plata queda como margen hasta que se decida si se le devuelve al cliente.`,
    )
  }
  if (pagado > 0) partes.push(`Al proveedor ya se le pagaron ${pesos(pagado)}: pide la devolución o queda como costo del viaje.`)
  return partes.join(' ')
}

/** Lo que queda en la actividad del negocio al sacar (o devolver) un servicio. Máx. 280. */
export function rastroSacarDelViaje(e: EntradaSacar & { vuelve: boolean }): string {
  const nombre = e.nombre.trim() || 'Un servicio'
  if (e.vuelve) return `Volvió al viaje: ${nombre}.`.slice(0, 280)
  const cotizado = Math.round(Number(e.costoCotizado) || 0)
  const pagado = Math.round(Number(e.pagadoProveedor) || 0)
  const partes = [`Sacado del viaje: ${nombre} (cotizado ${pesos(cotizado)}${pagado > 0 ? `, pagado al proveedor ${pesos(pagado)}` : ''}).`]
  if (cotizado > 0) partes.push(`El precio y el plan de pagos no cambiaron: esos ${pesos(cotizado)} quedan en el margen hasta decidir si se devuelven al cliente.`)
  return partes.join(' ').slice(0, 280)
}

/** `confirm` al cambiar un localizador ya guardado; `null` si no había ninguno o no cambia. */
export function confirmacionCambioLocalizador(anterior: string | null | undefined, nuevo: string): string | null {
  const a = (anterior ?? '').trim()
  const n = nuevo.trim()
  if (!a || a === n) return null
  return n
    ? `¿Estás seguro? Este servicio ya tiene el localizador ${a}: lo vas a cambiar por ${n}.`
    : `¿Estás seguro? Vas a borrar el localizador ${a} de este servicio.`
}

/** El rastro del cambio de un localizador ya guardado. `null` si no había uno. */
export function rastroCambioLocalizador(nombre: string, anterior: string | null | undefined, nuevo: string | null): string | null {
  const a = (anterior ?? '').trim()
  const n = (nuevo ?? '').trim()
  if (!a || a === n) return null
  return (n ? `${nombre}: localizador ${a} cambiado por ${n}.` : `${nombre}: se borró el localizador ${a}.`).slice(0, 280)
}
