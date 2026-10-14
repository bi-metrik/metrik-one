/**
 * ¿Una persona de una lista (un comprador de la factura, un beneficiario) es una ENTIDAD
 * FINANCIERA: un banco, una compañía de financiamiento, una leasing, una fiduciaria?
 *
 * Caso que lo motivó (SOENA, SOE-012, 13-oct): cuando la factura del vehículo sale a
 * nombre de un banco, el carro se compró en leasing y la titularidad del certificado UPME
 * tiene que ser «leasing» (banco co-titular). V0294: `BANCOLOMBIA (8909039388)`.
 *
 * Se decide por el NOMBRE, no por el documento: el NIT de cualquier sociedad empieza por 8
 * o 9 (`esPersonaJuridica`), igual que el de un banco, y hay cédulas de 10 dígitos con esa
 * misma forma. El documento no distingue un banco de una ferretería.
 *
 * Dos clases de señal:
 *   - una PALABRA del oficio (BANCO y sus derivados, LEASING, FIDUCIARIA, FINANCIERA,
 *     FINANCIAMIENTO, la sigla final «C.F.») basta sola: ninguna persona natural se llama
 *     así, y una sociedad que se nombra así es del sector;
 *   - una MARCA de entidad vigilada cuyo nombre no lleva la palabra (DAVIVIENDA, BBVA,
 *     ITAÚ…). Solo marcas que no son una palabra corriente ni un apellido: «TUYA» o «IRIS»
 *     no entran, porque marcarían a una persona.
 *
 * La lista es corta a propósito. Lo que no reconozca, calla (un cruce que no ve un banco
 * no frena a nadie), así que una entidad que falte se agrega aquí sin tocar el motor.
 */

import { esPersonaJuridica, type Persona } from './personas'

/** Mayúsculas, sin tildes, sin puntos, con un solo espacio y bordes de palabra en los extremos. */
function normalizar(s: unknown): string {
  const t = String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/[^A-Z0-9&]+/g, ' ')
    .trim()
  return ` ${t} `
}

/** Palabras del oficio. Se buscan como palabra entera (o como raíz, las que terminan en `*`). */
const PALABRAS_DEL_OFICIO = [
  'BANCO*', // BANCO, BANCOLOMBIA, BANCOOMEVA, BANCOLDEX
  'BANCAMIA',
  'BANK',
  'LEASING',
  'FIDUCIARIA',
  'FIDUCIARIO',
  'FINANCIERA',
  'FINANCIAMIENTO',
  'FINANCIAL',
]

/** Marcas de entidades vigiladas cuyo nombre no trae ninguna palabra del oficio. */
const MARCAS = [
  'DAVIVIENDA',
  'BBVA',
  'ITAU',
  'SCOTIABANK',
  'COLPATRIA',
  'SUDAMERIS',
  'AV VILLAS',
  'SERFINANZA',
  'FINANDINA',
  'COLTEFINANCIERA',
  'GIROS Y FINANZAS',
  'CREDIFINANCIERA',
  'MIBANCO',
]

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const RE_OFICIO = new RegExp(
  ` (${PALABRAS_DEL_OFICIO.map(p => (p.endsWith('*') ? `${escapar(p.slice(0, -1))}[A-Z]*` : escapar(p))).join('|')}) `,
)
const RE_MARCA = new RegExp(` (${MARCAS.map(escapar).join('|')}) `)
/** «… S.A. C.F.», «… COMPAÑÍA DE FINANCIAMIENTO» abreviado: la sigla cierra el nombre. */
const RE_SIGLA_CF = / C ?F $/

/** ¿El NOMBRE es de una entidad financiera? Sin mirar el documento. */
export function nombreDeEntidadFinanciera(nombre: unknown): boolean {
  const n = normalizar(nombre)
  if (n.trim() === '') return false
  if (RE_OFICIO.test(n) || RE_MARCA.test(n)) return true
  // «C.F.» suelto al final solo cuenta si además el nombre es de una sociedad: dos
  // iniciales al cierre de un nombre de persona no dicen nada.
  return RE_SIGLA_CF.test(n) && esPersonaJuridica({ nombre: String(nombre ?? '').replace(/\s*C\.?\s?F\.?\s*$/i, '') })
}

/** ¿Esta persona (nombre + documento) es una entidad financiera? */
export function esEntidadFinanciera(p: Partial<Persona> | null | undefined): boolean {
  return !!p && nombreDeEntidadFinanciera(p.nombre)
}

/** La primera entidad financiera de una lista de personas, o `null`. */
export function entidadFinancieraEn(personas: ReadonlyArray<Partial<Persona>>): Persona | null {
  const p = personas.find(esEntidadFinanciera)
  return p ? { nombre: String(p.nombre ?? ''), documento: String(p.documento ?? '') } : null
}
