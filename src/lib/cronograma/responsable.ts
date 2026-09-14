/**
 * El responsable de un paso del cronograma: una persona del equipo O un texto libre.
 *
 * Son dos cosas distintas a propósito. La persona (`responsable_id`, un `staff.id`) es
 * alguien a quien la plataforma puede ubicar: sale en su nombre aunque lo cambie, y
 * más adelante puede recibir avisos. El texto libre (`responsable_texto`) cubre lo que
 * no es del equipo: un contratista, el cliente, «Compras». Nunca van los dos: si un
 * paso tuviera persona y texto, el documento no sabría a quién nombrar.
 */

export interface MiembroEquipo {
  id: string
  full_name: string | null
}

export interface Responsable {
  responsable_id: string | null
  responsable_texto: string | null
}

export const MAX_RESPONSABLE_TEXTO = 80

/** Minúsculas y sin tildes: «jose» encuentra a «José». */
export const plegar = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/**
 * Deja un responsable válido: la persona gana sobre el texto, el texto va recortado y
 * uno vacío es ausencia de responsable, no un responsable llamado «».
 */
export function normalizarResponsable(r: Partial<Responsable>): Responsable {
  const id = r.responsable_id?.trim() || null
  if (id) return { responsable_id: id, responsable_texto: null }
  const texto = r.responsable_texto?.replace(/\s+/g, ' ').trim() ?? ''
  return { responsable_id: null, responsable_texto: texto ? texto.slice(0, MAX_RESPONSABLE_TEXTO) : null }
}

/**
 * Lo que se está buscando después de una «@» al final de lo escrito, o null si no hay
 * mención abierta. «@lau» → «lau»; «Laura y @» → «»; «correo@empresa» → null, porque
 * la arroba pegada a una palabra no es una mención.
 */
export function consultaMencion(texto: string): string | null {
  const m = /(?:^|\s)@([^@]*)$/.exec(texto)
  return m ? m[1] : null
}

/** Personas cuyo nombre tiene una palabra que arranca con lo buscado. */
export function filtrarEquipo(equipo: MiembroEquipo[], consulta: string, max = 6): MiembroEquipo[] {
  const q = plegar(consulta)
  const conNombre = equipo.filter(m => m.full_name?.trim())
  if (!q) return conNombre.slice(0, max)
  return conNombre
    .filter(m => {
      const nombre = plegar(m.full_name!)
      return nombre.startsWith(q) || nombre.split(/\s+/).some(p => p.startsWith(q))
    })
    .slice(0, max)
}

/**
 * Quien escribe «@Laura Gómez» completo y guarda sin elegir de la lista quiso a la
 * persona, no el texto con arroba. Si el nombre coincide con uno solo del equipo, se
 * resuelve a esa persona; si no, queda como texto.
 */
export function resolverMencionEscrita(texto: string | null, equipo: MiembroEquipo[]): Responsable {
  const limpio = texto?.trim() ?? ''
  if (limpio.startsWith('@')) {
    const buscado = plegar(limpio.slice(1))
    const coincidencias = equipo.filter(m => m.full_name && plegar(m.full_name) === buscado)
    if (buscado && coincidencias.length === 1) return { responsable_id: coincidencias[0].id, responsable_texto: null }
  }
  return normalizarResponsable({ responsable_texto: limpio })
}

/** El nombre que se muestra: el de la persona si está en el equipo, si no el texto. */
export function nombreResponsable(r: Partial<Responsable>, equipo: MiembroEquipo[] | Map<string, string>): string | null {
  if (r.responsable_id) {
    const nombre = equipo instanceof Map
      ? equipo.get(r.responsable_id)
      : equipo.find(m => m.id === r.responsable_id)?.full_name
    if (nombre?.trim()) return nombre.trim()
  }
  return r.responsable_texto?.trim() || null
}
