/**
 * A quién va dirigida la propuesta, con nombre propio (Mauricio, 2026-10-27): el contacto del
 * negocio (`negocios.contacto_id` → `contactos.nombre`) y, si la empresa del negocio es persona
 * jurídica, también la empresa: «Ana Gómez · Viajes XYZ S.A.S.». Los pasajeros no son el
 * destinatario: con contacto, la propuesta habla a él; sin contacto, el documento vuelve a los
 * pasajeros, como antes.
 *
 * Puro: sin base. La acción del PDF trae el contacto en la misma consulta del negocio.
 */

/** Lo que la acción sabe del cliente del negocio. */
export interface ClienteDelNegocio {
  /** `contactos.nombre` del contacto del negocio, tal como está guardado. */
  contacto: string | null
  /** `empresas.nombre` de la empresa del negocio (no la de relleno «Cliente»). */
  empresa: string | null
  /** `empresas.tipo_persona`; todo lo que no sea `natural` es persona jurídica. */
  tipoPersona: string | null
}

export interface Destinatario {
  nombre: string
  /** Solo con persona jurídica. */
  empresa: string | null
}

/** Partículas que van en minúscula dentro de un nombre propio (no al comienzo). */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e'])

const conMayuscula = (s: string) => (s ? s[0].toLocaleUpperCase('es') + s.slice(1) : s)

/**
 * «RICARDO PEÑUELA» → «Ricardo Peñuela»; «maría de la cruz» → «María de la Cruz». Un nombre que
 * ya trae mayúsculas Y minúsculas se respeta tal cual (alguien lo escribió así a propósito:
 * «McAllister», «DeLuca»); solo se limpian los espacios. Las tildes no se tocan.
 */
export function nombrePropio(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? '').replace(/\s+/g, ' ').trim()
  if (!limpio) return null
  const mixto = limpio !== limpio.toLocaleUpperCase('es') && limpio !== limpio.toLocaleLowerCase('es')
  if (mixto) return limpio
  return limpio
    .toLocaleLowerCase('es')
    .split(' ')
    .map((palabra, i) => (i > 0 && PARTICULAS.has(palabra) ? palabra : palabra.split('-').map(conMayuscula).join('-')))
    .join(' ')
}

const llano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** El destinatario de la propuesta; `null` sin contacto (el documento vuelve a los pasajeros). */
export function destinatarioDeLaPropuesta(c: ClienteDelNegocio | null | undefined): Destinatario | null {
  const nombre = nombrePropio(c?.contacto)
  if (!nombre) return null
  const empresa = (c?.empresa ?? '').replace(/\s+/g, ' ').trim()
  const juridica = !!c?.tipoPersona && c.tipoPersona !== 'natural'
  // La empresa va tal como está guardada («S.A.S.» no se toca), y nunca repite el nombre.
  return { nombre, empresa: juridica && empresa && llano(empresa) !== llano(nombre) ? empresa : null }
}

/** «Ana Gómez · Viajes XYZ S.A.S.» o «Ricardo Peñuela». */
export function textoDelDestinatario(d: Destinatario): string {
  return d.empresa ? `${d.nombre} · ${d.empresa}` : d.nombre
}
