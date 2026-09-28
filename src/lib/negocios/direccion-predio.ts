/**
 * ¿Dos direcciones colombianas señalan el mismo predio? El modo `direccion` de los cruces.
 *
 * Se escribió midiendo el certificado UPME contra el RUT en los 315 casos abiertos de
 * SOENA (2026-09-28). 283 eran iguales letra por letra; de los 32 restantes, 19 decían lo
 * mismo escrito de otra forma, y eso es lo que este modo tiene que dejar pasar:
 *
 * - Abreviaturas de la vía y de la unidad: «Calle»/«CL»/«CLL», «CRA»/«CR»/«KR»,
 *   «APTO»/«AP», «INT»/«IN», «Transversal»/«TV».
 * - Signos y rellenos: «# 16 - 75», «N°», «No», «numero», «47A» contra «47 A», «09» contra «9».
 * - Lo que un lado trae y el otro no: el barrio, el edificio, el conjunto, la ciudad al final.
 * - Letras de otro alfabeto que la lectura del PDF mete por las latinas («ΤΟ 2 ΑΡ 704»
 *   con la T, la O, la A y la P griegas; «70 В» con la B cirílica).
 *
 * Lo que identifica el predio, y por tanto lo que se compara:
 *
 * 1. **La placa**: los números de la vía en su orden, con su letra pegada («CR 14 B 50 20»
 *    → 14B 50 20). Tienen que ser idénticos. «CL 142 C» contra «CL 124 C» es otra casa.
 * 2. **El tipo de vía** del primer número (calle, carrera, diagonal…), si los dos lo
 *    traen. «Avenida» sola no se compara: una avenida puede ser calle o carrera.
 * 3. **La unidad** (apartamento, torre, interior, casa, bloque…): solo las que traen los
 *    dos lados. Un lado sin apartamento no contradice al que lo trae; dos apartamentos
 *    distintos, sí.
 *
 * No se comparan barrio, edificio ni conjunto: son nombres que cada quien escribe como
 * quiere y no cambian el predio. «Sur», «Norte», «Este» y «Bis» tampoco: medido, el que
 * falta es casi siempre una omisión de quien escribió, no otra dirección.
 *
 * Una dirección rural sin placa («FCA EL LAUREL VDA ALTAMIRA») se compara por sus palabras:
 * coincide si las de una están todas en la otra. Una con placa y otra sin placa no
 * coinciden: son dos maneras distintas de decir dónde vive alguien.
 */

/** Letras griegas y cirílicas que se ven iguales a una latina (lectura de PDF). */
const HOMOGLIFOS: Record<string, string> = {
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  α: 'a', ι: 'i', κ: 'k', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', м: 'm', т: 't',
}

const VIAS: Record<string, string> = {}
const UNIDADES: Record<string, string> = {}
const NOMBRES = new Set<string>()
function registrar(tabla: Record<string, string>, canon: string, formas: string) {
  for (const f of formas.split(' ')) tabla[f] = canon
}
// «AC» (avenida calle) y «AK» (avenida carrera) son una calle y una carrera.
registrar(VIAS, 'cl', 'calle cl cll call clle ac')
registrar(VIAS, 'kr', 'carrera cra cr kr kra carr crr ak')
registrar(VIAS, 'dg', 'diagonal dg diag')
registrar(VIAS, 'tv', 'transversal tv tr trans transv trv')
registrar(VIAS, 'av', 'avenida av avda')
registrar(VIAS, 'cq', 'circular cir circ cq')
registrar(VIAS, 'km', 'kilometro km')
registrar(VIAS, 'au', 'autopista au')
registrar(UNIDADES, 'ap', 'apartamento apto apt ap')
registrar(UNIDADES, 'to', 'torre to')
registrar(UNIDADES, 'in', 'interior int in')
registrar(UNIDADES, 'bl', 'bloque bl blq bloq')
registrar(UNIDADES, 'ca', 'casa ca cs')
registrar(UNIDADES, 'pi', 'piso pi ps')
registrar(UNIDADES, 'of', 'oficina of ofi')
registrar(UNIDADES, 'lc', 'local lc loc')
registrar(UNIDADES, 'mz', 'manzana mz mza')
registrar(UNIDADES, 'lt', 'lote lt')
registrar(UNIDADES, 'et', 'etapa et')
for (const n of ('barrio brr bario ed edif edificio conj conjunto cj urb urbanizacion vda vereda sector sec ' +
  'fca finca hda hacienda parcelacion parc cond condominio residencial ciudadela').split(' ')) NOMBRES.add(n)

/** Relleno que no dice nada del predio: el «número», los puntos cardinales y los artículos. */
const RELLENO = new Set('n no nro numero num sur norte este oeste bis de del la el los las y'.split(' '))

export interface DireccionPredio {
  /** Números de la vía, en orden y con su letra: `['13a', '89', '38']`. */
  placa: string[]
  /** Tipo de la vía del primer número (`cl`, `kr`…), o `null` si no se reconoce. */
  via: string | null
  /** Unidades por tipo: `{ ap: ['1003'], to: ['b'] }`. */
  unidades: Record<string, string[]>
  /** Palabras que no son ni vía ni unidad (para la dirección rural sin placa). */
  palabras: string[]
}

function tokens(v: unknown): string[] {
  const texto = [...String(v ?? '')].map(ch => HOMOGLIFOS[ch] ?? ch).join('')
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .split(/\s+/)
    .filter(t => t && !RELLENO.has(t))
}

/** Lo que identifica el predio en una dirección. Puro: sin catálogos ni red. */
export function leerDireccion(v: unknown): DireccionPredio {
  const r: DireccionPredio = { placa: [], via: null, unidades: {}, palabras: [] }
  let estado: 'inicio' | 'placa' | 'unidad' | 'nombre' | 'otro' = 'inicio'
  let via: string | null = null
  let unidad: string[] | null = null
  let anteriorNumero = false

  for (const t of tokens(v)) {
    const esNumero = /^\d+$/.test(t)
    if (VIAS[t]) {
      estado = 'placa'
      via = VIAS[t]
    } else if (UNIDADES[t]) {
      estado = 'unidad'
      unidad = r.unidades[UNIDADES[t]] ??= []
    } else if (NOMBRES.has(t)) {
      estado = 'nombre'
    } else if (esNumero) {
      const n = t.replace(/^0+(?=\d)/, '')
      if (estado === 'inicio' || estado === 'placa') {
        if (r.placa.length === 0) r.via = via
        r.placa.push(n)
        estado = 'placa'
      } else if (estado === 'unidad' && unidad) {
        unidad.push(n)
      }
    } else if (t.length === 1) {
      // Una letra pega con el número de antes («13 A» → 13A); sola, es el nombre de una
      // unidad («TORRE B»).
      if (estado === 'placa' && anteriorNumero) r.placa[r.placa.length - 1] += t
      else if (estado === 'unidad' && unidad) {
        if (anteriorNumero && unidad.length > 0) unidad[unidad.length - 1] += t
        else unidad.push(t)
      }
    } else {
      r.palabras.push(t)
      // Una palabra cualquiera después de la placa o de la unidad cierra ese tramo
      // («KM 4 VIA LA MESA»). Antes del primer número no: puede ser el tipo de vía mal
      // escrito («Trasnvsersal 73»).
      if (estado !== 'inicio') estado = 'otro'
    }
    anteriorNumero = esNumero
  }
  return r
}

/** ¿El mismo predio? `false` también cuando falta uno de los dos: quien llama decide si calla. */
export function direccionesCoinciden(a: unknown, b: unknown): boolean {
  const x = leerDireccion(a)
  const y = leerDireccion(b)

  if (x.placa.length > 0 || y.placa.length > 0) {
    if (x.placa.join(' ') !== y.placa.join(' ')) return false
    if (x.via && y.via && x.via !== y.via && x.via !== 'av' && y.via !== 'av') return false
  } else {
    // Sin placa en ninguno de los dos (rural): las palabras de uno, todas en el otro.
    const px = new Set(x.palabras)
    const py = new Set(y.palabras)
    if (px.size === 0 || py.size === 0) return false
    if (![...px].every(p => py.has(p)) && ![...py].every(p => px.has(p))) return false
  }

  for (const [tipo, valores] of Object.entries(x.unidades)) {
    const otros = y.unidades[tipo]
    if (valores.length === 0 || !otros || otros.length === 0) continue
    if (valores.join(' ') !== otros.join(' ')) return false
  }
  return true
}
