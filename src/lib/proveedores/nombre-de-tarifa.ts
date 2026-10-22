/**
 * El nombre y lo que incluye una fila del tarifario, como los lee el cliente (prueba del #1229,
 * 2026-10-21, punto 2: la línea quedó «PLAYA BLANCA», sin «con almuerzo» ni lo que incluye). PURO.
 *
 *   · `capitalizacionNormal`: un texto escrito TODO en mayúscula pasa a minúscula normal (los
 *     nombres con mayúscula inicial por palabra y los conectores en minúscula; los planes y lo
 *     que incluye, como oración). Las siglas se quedan. Un texto con minúsculas se respeta tal
 *     cual: alguien lo escribió así.
 *   · `nombreDeServicio`: la actividad, la habitación o la ruta con su plan y su modalidad
 *     («Playa Blanca con almuerzo», «Islas del Rosario · Pasadía (privado)»).
 *   · `incluyeDeFila`: lo que incluye la fila, del plan que la define en el tarifario
 *     (`planes[].incluye`), de la propia fila o de una nota que empieza por «Incluye».
 *   · `mismoServicio`: qué es «el mismo servicio» para la preselección (punto 1): misma
 *     habitación o actividad, mismo plan, misma modalidad y mismo establecimiento.
 */

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const texto = (v: unknown, n = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, n) : null)

/** Sin tildes, en minúscula y con un solo espacio: para comparar, nunca para mostrar. */
export function plano(t: string | null | undefined): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Las palabras que van en minúscula dentro de un nombre («Islas del Rosario»).
const CONECTORES = new Set(['a', 'al', 'con', 'de', 'del', 'e', 'el', 'en', 'la', 'las', 'lo', 'los', 'o', 'para', 'por', 'sin', 'u', 'un', 'una', 'y'])
// Siglas que se quedan en mayúscula aunque tengan vocales (las que no tienen vocales ya se quedan).
const SIGLAS = new Set(['VIP', 'ATV', 'UTV', 'SPA', 'PADI', 'UNESCO', 'USD', 'COP', 'EUR', 'AM', 'PM', 'PAX', 'IVA', 'RNT'])
const ROMANO = /^(?=[IVXLC]+$)C{0,3}(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/
const SEPARADOR = /^(\s+|[-/–·(),])$/

function letras(t: string): string {
  return t.replace(/[^\p{L}]/gu, '')
}

/** ¿El texto está escrito todo en mayúscula (al menos dos letras y ninguna minúscula)? */
export function todoEnMayuscula(t: string): boolean {
  const l = letras(t)
  return l.length >= 2 && l === l.toLocaleUpperCase('es-CO') && l !== l.toLocaleLowerCase('es-CO')
}

function esSigla(p: string): boolean {
  const l = letras(p)
  // Sin vocales («BBQ»), con dígitos («4X4»), romanos («II») o conocidas («VIP»).
  return !!l && (SIGLAS.has(l) || /\d/.test(p) || (l.length >= 2 && !/[AEIOUÁÉÍÓÚÜY]/.test(l)) || (l.length >= 2 && ROMANO.test(l)))
}

const mayusculaInicial = (p: string) => p.replace(/\p{L}/u, (c) => c.toLocaleUpperCase('es-CO'))

function palabra(p: string, primera: boolean, modo: 'titulo' | 'oracion'): string {
  if (esSigla(p)) return p
  const min = p.toLocaleLowerCase('es-CO')
  if (modo === 'oracion') return primera ? mayusculaInicial(min) : min
  if (!primera && CONECTORES.has(letras(min))) return min
  return mayusculaInicial(min)
}

/**
 * Un texto TODO en mayúscula, en minúscula normal. `titulo` (un nombre propio: la actividad, la
 * playa, la habitación): «PLAYA BLANCA» → «Playa Blanca», «ISLAS DEL ROSARIO» → «Islas del
 * Rosario». `oracion` (un plan, lo que incluye): «CON ALMUERZO» → «Con almuerzo». Las siglas se
 * quedan («TOUR 4X4 VIP» → «Tour 4X4 VIP»). Un texto con minúsculas llega igual.
 */
export function capitalizacionNormal(t: string | null | undefined, modo: 'titulo' | 'oracion' = 'titulo'): string {
  const s = (t ?? '').trim()
  if (!todoEnMayuscula(s)) return s
  let primera = true
  return s
    .split(/(\s+|[-/–·(),])/)
    .map((p) => {
      if (!p) return p
      if (SEPARADOR.test(p)) {
        // Tras «·» empieza otra frase; tras un guion o un paréntesis, otra palabra de nombre.
        if (p === '·' || (modo === 'titulo' && (p === '(' || p === '-' || p === '–' || p === '/'))) primera = true
        return p
      }
      const r = palabra(p, primera, modo)
      primera = false
      return r
    })
    .join('')
}

/** Lo mínimo de una fila para nombrarla. */
export interface FilaConNombre {
  categoria: string | null
  plan: string | null
  modalidad?: string | null
}

// Un plan que se lee pegado al nombre («con almuerzo», «sin traslado», «+ cena», «incluye guía»).
const PLAN_PEGADO = /^(con|sin|mas|\+|incluye|incl)\b/

/**
 * El nombre completo del servicio de la fila: categoría, plan y modalidad, sin repetir lo que ya
 * dice la categoría. `null` si la fila no dice nada.
 */
export function nombreDeServicio(o: FilaConNombre): string | null {
  const cat = texto(o.categoria)
  const plan = texto(o.plan)
  const mod = texto(o.modalidad, 40)
  let nombre = cat ? capitalizacionNormal(cat) : null
  if (plan && !(cat && plano(cat).includes(plano(plan)))) {
    const p = capitalizacionNormal(plan, 'oracion')
    if (!nombre) nombre = p
    // «con almuerzo» se lee pegado al nombre; «Pasadía», como su plan.
    else if (PLAN_PEGADO.test(plano(plan))) nombre = `${nombre} ${p.replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLocaleLowerCase('es-CO'))}`
    else nombre = `${nombre} · ${p}`
  }
  if (mod && nombre && !plano(nombre).includes(plano(mod))) nombre = `${nombre} (${mod.toLocaleLowerCase('es-CO')})`
  return nombre
}

/**
 * El plan de la fila con su nombre: si la fila trae el CÓDIGO de un plan del tarifario («CA»), su
 * nombre («con almuerzo»); si no, el plan tal cual.
 */
export function nombreDePlan(plan: string | null, tarifario: Obj | null | undefined): string | null {
  const p = texto(plan)
  if (!p) return null
  for (const x of lista(tarifario?.planes)) {
    if (esObj(x) && plano(texto(x.codigo)) === plano(p)) return texto(x.nombre) ?? p
  }
  return p
}

const MAX_INCLUYE = 12

/**
 * Lo que incluye la fila, en el orden en que lo dice el tarifario y sin repetir: el plan que la
 * define (`planes[]` por código o nombre), la propia fila (`incluye`) y una nota que empieza por
 * «Incluye». Lo demás de la nota NO sale al cliente: son deducciones del motor («derivado»).
 */
export function incluyeDeFila(fila: Obj, tarifario: Obj | null | undefined): string[] {
  const out: string[] = []
  const vistos = new Set<string>()
  const sumar = (v: unknown) => {
    const t = texto(v, 160)
    if (!t || vistos.has(plano(t)) || out.length >= MAX_INCLUYE) return
    vistos.add(plano(t))
    out.push(capitalizacionNormal(t, 'oracion'))
  }
  const plan = plano(texto(fila.plan))
  if (plan) {
    for (const p of lista(tarifario?.planes)) {
      if (!esObj(p)) continue
      if (plano(texto(p.codigo)) !== plan && plano(texto(p.nombre)) !== plan) continue
      for (const x of lista(p.incluye)) sumar(x)
    }
  }
  for (const x of lista(fila.incluye)) sumar(x)
  const nota = texto(fila.nota, 300)
  const m = nota ? /^incluye[:\s]+(.+)$/i.exec(nota) : null
  if (m) for (const x of m[1].split(/[,;]|\s+y\s+/)) sumar(x.trim().replace(/\.$/, ''))
  return out
}

/** «Incluye: almuerzo, transporte y guía.» `''` sin nada. */
export function textoIncluye(cosas: readonly string[]): string {
  if (cosas.length === 0) return ''
  // En la lista van en minúscula (salvo una sigla o un nombre propio que ya venía así).
  const xs = cosas.map((c) => c.replace(/^\p{Lu}(?=\p{Ll})/u, (x) => x.toLocaleLowerCase('es-CO')))
  const unidas = xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
  return `Incluye: ${unidas}.`
}

/** Lo mínimo de una fila para saber si es el mismo servicio que otra. */
export interface FilaDeServicio extends FilaConNombre {
  establecimiento: string | null
  ocupacion: string | null
}

// La ocupación que distingue habitaciones (una doble y una triple no son el mismo servicio).
const OCUPACION_QUE_SEPARA = new Set(['sencilla', 'doble', 'triple', 'cuadruple', 'multiple'])

/**
 * Qué servicio es la fila, sin la ocupación: la misma habitación o actividad, el mismo plan, la
 * misma modalidad y el mismo establecimiento.
 */
export function claveDeServicio(o: FilaDeServicio): string {
  return [plano(o.establecimiento), plano(o.categoria), plano(o.plan), plano(o.modalidad)].join('|')
}

/**
 * ¿Todas las filas son el MISMO servicio? Solo pueden diferir en el tipo de pasajero, la
 * temporada, el canal o el escalón de pax. La ocupación de habitación sí separa (una doble y una
 * triple son dos servicios), pero una fila sin ocupación (el niño, el adulto adicional) va con la
 * habitación de las demás. Vacío = sí.
 */
export function mismoServicio(filas: readonly FilaDeServicio[]): boolean {
  if (filas.length <= 1) return true
  if (new Set(filas.map(claveDeServicio)).size > 1) return false
  return new Set(filas.map((o) => plano(o.ocupacion)).filter((x) => OCUPACION_QUE_SEPARA.has(x))).size <= 1
}
