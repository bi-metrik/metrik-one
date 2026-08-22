import { soloDigitos } from '@/lib/busqueda/telefono'

/**
 * De donde sale el telefono de un evento de FunnelChat, y a quien pertenece.
 *
 * Las dos mitades de esta pieza existen por la misma razon: **no controlamos el
 * otro lado**. Ni como se llama el campo que trae el numero, ni si ese numero
 * identifica a una sola persona en ONE.
 */

/**
 * Nombres de campo que se aceptan como portadores del telefono.
 *
 * ⚠️ Es una lista y no un nombre unico porque las variables las escribe quien
 * arma el flujo en FunnelChat, no nosotros. Si el campo se llamara `phone` y
 * aqui solo miraramos `telefono`, el evento quedaria como "sin telefono" —
 * indistinguible de un evento que de verdad no lo trae. Ese es exactamente el
 * fallo que ya nos costo cuatro dias con la cabecera `authorization`.
 */
export const CLAVES_TELEFONO = [
  'telefono',
  'teléfono',
  'phone',
  'celular',
  'whatsapp',
  'numero',
  'número',
  'msisdn',
  'from',
  'contact_phone',
  'phone_number',
] as const

/** Minimo de digitos para tratar un valor como telefono. Un `312` suelto no lo es. */
const MIN_DIGITOS = 7

/**
 * Digitos nacionales de un telefono colombiano, con los MISMOS tres pasos y en el
 * mismo orden que `public.telefono_movil_co` en la base.
 *
 * ⚠️ No se usa `numeroNacional` de `@/lib/busqueda/telefono` aunque se le parezca:
 * ese recorta a los ultimos 10 digitos, que es lo correcto para una BUSQUEDA
 * parcial y lo incorrecto aqui. Sobre `3001234567.0` — el cargue leyo la celda de
 * Excel como numero, y hay 4 asi en SOENA — devuelve `0012345670`, un numero que
 * no existe, y la conversacion se quedaria sin dueno sin que nadie lo note.
 *
 * Este valor es el que se compara contra la base, asi que las dos reglas TIENEN
 * que coincidir. Si una cambia, cambia la otra.
 */
export function movilNacional(crudo: string): string {
  const sinDecimal = crudo.split('.')[0]
  return soloDigitos(sinDecimal).replace(/^(57)+/, '')
}

export type TelefonoDelEvento = { clave: string; crudo: string; nacional: string }

/**
 * Busca el telefono en el cuerpo del evento. Mira las claves de primer nivel y
 * las de un solo nivel de anidamiento (`contacto.telefono`, `data.phone`), que
 * es como suelen venir estos cuerpos. Devuelve tambien DE DONDE lo saco: sin eso
 * no se puede depurar una configuracion ajena sin adivinar.
 */
export function extraerTelefono(payload: Record<string, unknown>): TelefonoDelEvento | null {
  const aceptadas = new Set<string>(CLAVES_TELEFONO)

  const intentar = (clave: string, valor: unknown, prefijo = ''): TelefonoDelEvento | null => {
    if (!aceptadas.has(clave.toLowerCase().trim())) return null
    if (typeof valor !== 'string' && typeof valor !== 'number') return null
    const crudo = String(valor)
    if (soloDigitos(crudo).length < MIN_DIGITOS) return null
    return { clave: prefijo + clave, crudo, nacional: movilNacional(crudo) }
  }

  for (const [k, v] of Object.entries(payload)) {
    const hit = intentar(k, v)
    if (hit) return hit
  }
  for (const [k, v] of Object.entries(payload)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
      const hit = intentar(k2, v2, `${k}.`)
      if (hit) return hit
    }
  }
  return null
}

export type Candidato = {
  id: string
  nombre: string | null
  telefono: string | null
  /** Segmento actual. Lo necesita el sincronizador para no retroceder. */
  segmento: string | null
}

export type Resolucion =
  | { estado: 'sin_telefono'; claves_del_cuerpo: string[] }
  | { estado: 'sin_contacto'; clave: string; nacional: string }
  | { estado: 'unico'; clave: string; nacional: string; contacto: Candidato }
  | { estado: 'ambiguo'; clave: string; nacional: string; candidatos: Candidato[] }

/**
 * Decide el veredicto a partir de los candidatos que devolvio la base.
 *
 * ⚠️ Con dos o mas candidatos NO se elige. Medido en SOENA el 2026-08-22: 33
 * numeros repetidos abarcan 73 contactos, y entre ellos hay personas
 * genuinamente distintas compartiendo linea (una persona y su empresa, dos
 * familiares) mezcladas con duplicados del mismo nombre. Quedarse con el primero
 * le colgaria a alguien una conversacion que puede no ser suya, y como nada
 * fallaria, nadie se enteraria nunca.
 */
export function resolver(
  telefono: TelefonoDelEvento | null,
  candidatos: Candidato[],
  clavesDelCuerpo: string[],
): Resolucion {
  if (!telefono) return { estado: 'sin_telefono', claves_del_cuerpo: clavesDelCuerpo }
  const { clave, nacional } = telefono
  if (candidatos.length === 0) return { estado: 'sin_contacto', clave, nacional }
  if (candidatos.length === 1) return { estado: 'unico', clave, nacional, contacto: candidatos[0] }
  return { estado: 'ambiguo', clave, nacional, candidatos }
}

/** El contacto solo se fija cuando la resolucion fue unica. */
export const contactoDeLaResolucion = (r: Resolucion): string | null =>
  r.estado === 'unico' ? r.contacto.id : null
