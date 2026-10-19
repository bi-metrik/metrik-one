/**
 * ¿La ficha de un proveedor está completa para cotizar? (Mauricio, 2026-10-19). PURO.
 *
 * Decisión: «una ficha incompleta no se puede usar para cotizar; lo que el motor no logra confirmar
 * lo clasifica el equipo de Trappvel». La definición es CONSERVADORA y la valida Mauricio en el PR:
 *
 *   · tiene ciudad, y no está marcada «Ciudad por confirmar» (la nota que dejó la limpieza de
 *     ciudades del 2026-10-19 en las fichas que no se pudieron confirmar);
 *   · tiene país (código de dos letras);
 *   · en Colombia, la ciudad es un MUNICIPIO y no un departamento («Quindío», «Cundinamarca»).
 *     Un nombre que es a la vez departamento y municipio («Arauca», «Sucre», «Boyacá») se acepta
 *     solo si el departamento de la ficha confirma que el municipio está ahí;
 *   · el tipo no es «Otro» (sin clasificar).
 *
 * Lo que NO entra, a propósito:
 *   · el departamento y el destino: ninguna ficha los tiene todavía (columnas nuevas); exigirlos
 *     mandaría todas las fichas a «por clasificar» el día del merge;
 *   · el tarifario vigente: depende de las FECHAS DEL VIAJE, no de la ficha. Lo vigila el aviso de
 *     vigencia de la tarjeta (`avisoDeTarifario`), que ya existía.
 *
 * ⚠️ Usa el catálogo DIVIPOLA (~80 KB): solo en el SERVIDOR. Al navegador llegan las faltas ya
 * calculadas (texto), no el catálogo.
 */
import { DEPARTAMENTOS_DANE, MUNICIPIOS_POR_DEPTO } from '@/lib/dian/divipola-catalogo.generated'
import { nombreLlano } from '@/lib/fotos/clave'

export const NOTA_CIUDAD_POR_CONFIRMAR = 'Ciudad por confirmar'

export type CampoFalta = 'ciudad' | 'pais' | 'tipo'

export interface FaltaFicha {
  campo: CampoFalta
  /** Qué falta, en llano, para la lista «por clasificar» y la tarjeta. */
  texto: string
}

/** Lo mínimo de la ficha para juzgarla. */
export interface FichaParaCompletitud {
  tipo_proveedor: string
  ciudad: string | null
  pais: string | null
  departamento?: string | null
  notas: string | null
}

/** «ciudad por confirmar» en cualquier lugar de las notas (sin tildes ni mayúsculas). */
export function tieneNotaCiudadPorConfirmar(notas: string | null | undefined): boolean {
  return nombreLlano(notas).includes(nombreLlano(NOTA_CIUDAD_POR_CONFIRMAR))
}

/**
 * Las notas sin la marca «Ciudad por confirmar» (la línea entera si es lo único que dice, o solo
 * la frase). `null` si no queda nada.
 */
export function quitarNotaCiudadPorConfirmar(notas: string | null | undefined): string | null {
  const lineas = (notas ?? '').split('\n')
  const quedan: string[] = []
  for (const linea of lineas) {
    if (!tieneNotaCiudadPorConfirmar(linea)) {
      quedan.push(linea)
      continue
    }
    // La frase con sus signos alrededor («Ciudad por confirmar: …», «[Ciudad por confirmar]»).
    const sin = linea.replace(/[[(«"]?\s*ciudad\s+por\s+confirmar\s*[\])»"]?\s*[:.,;-]?\s*/i, '').trim()
    if (sin) quedan.push(sin)
  }
  const texto = quedan.join('\n').trim()
  return texto || null
}

/** Nombres de departamento como la gente los escribe, además de los del DANE. */
const ALIAS_DEPARTAMENTO: Record<string, string> = {
  'bogota d c': '11',
  'bogota dc': '11',
  'distrito capital': '11',
  'san andres': '88',
  'san andres providencia y santa catalina': '88',
  'san andres y providencia': '88',
  'valle': '76',
  'guajira': '44',
  'norte santander': '54',
}

/** El código DANE de un departamento escrito a mano, o `null`. */
export function codigoDepartamento(texto: string | null | undefined): string | null {
  const n = nombreLlano(texto)
  if (!n) return null
  return DEPARTAMENTOS_DANE[n] ?? ALIAS_DEPARTAMENTO[n] ?? null
}

/** Ciudades que se llaman como un departamento y siempre son la ciudad (Bogotá). */
const SIEMPRE_MUNICIPIO = new Set(['bogota'])

/**
 * ¿La «ciudad» de una ficha colombiana es en realidad un departamento? `true` si el nombre es el de
 * un departamento y la ficha no confirma (con su departamento) que hay un municipio con ese nombre.
 */
export function ciudadEsDepartamento(ciudad: string | null | undefined, departamento?: string | null): boolean {
  const n = nombreLlano(ciudad)
  if (!n || SIEMPRE_MUNICIPIO.has(n)) return false
  const comoDepto = DEPARTAMENTOS_DANE[n] ?? ALIAS_DEPARTAMENTO[n]
  if (!comoDepto) return false
  const codigo = codigoDepartamento(departamento)
  // «Arauca, Arauca», «Caldas, Antioquia»: el departamento dice que el municipio existe ahí.
  return !(codigo && MUNICIPIOS_POR_DEPTO[codigo]?.[n] !== undefined)
}

/** Lo que le falta a la ficha para poder cotizar. Vacío = completa. */
export function faltasDeFicha(f: FichaParaCompletitud): FaltaFicha[] {
  const faltas: FaltaFicha[] = []
  const ciudad = (f.ciudad ?? '').trim()
  const pais = (f.pais ?? '').trim().toUpperCase()
  if (!ciudad) {
    faltas.push({ campo: 'ciudad', texto: 'Falta la ciudad (el municipio donde duerme o se presta el servicio)' })
  } else if (tieneNotaCiudadPorConfirmar(f.notas)) {
    faltas.push({ campo: 'ciudad', texto: 'La ciudad está por confirmar' })
  } else if ((pais === 'CO' || !pais) && ciudadEsDepartamento(ciudad, f.departamento)) {
    faltas.push({ campo: 'ciudad', texto: `«${ciudad}» es un departamento: escribe el municipio` })
  }
  if (!/^[A-Z]{2}$/.test(pais)) faltas.push({ campo: 'pais', texto: 'Falta el país' })
  if (f.tipo_proveedor === 'otro') faltas.push({ campo: 'tipo', texto: 'Falta el tipo (está en «Otro»)' })
  return faltas
}

export function fichaCompleta(f: FichaParaCompletitud): boolean {
  return faltasDeFicha(f).length === 0
}
