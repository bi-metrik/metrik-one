/**
 * Un PDF de Sabor con la programación de funciones → un BORRADOR para el formulario (§4.4 del diseño de la etapa 2;
 * F1 resuelta por Mauricio el 2026-10-21). Del plano del salón no se extrae nada: el mapa salió de la Fase 1
 * (alcance del 2026-10-22).
 *
 * Reglas que este módulo hace cumplir:
 *   1. **Nunca guarda.** No importa ningún cliente de la base: devuelve un borrador y nada más. Lo que se guarda es
 *      lo que la persona confirma con el botón del formulario, por las RPC de la migración 20261022170000.
 *   2. **Todo campo dice de dónde viene**: `pdf` (leído y verificado contra el texto) o `no_leido` (vacío). La
 *      pantalla marca los dos.
 *   3. **No se adivina.** Un valor que el modelo devuelve y que no está en el texto del PDF se descarta y queda
 *      `no_leido`: el nombre de la experiencia, el cupo, las fechas y las horas. Una fecha sin año o un día sin mes, vacía. Una
 *      hora de 1 a 11 sin «a. m.» / «p. m.», vacía (las 7 pueden ser de la mañana o de la noche).
 *   4. **Sin capa de texto, sin modelo.** Un escaneo no se manda a leer: el borrador sale vacío con el aviso y se
 *      llena a mano. Así la verificación siempre tiene contra qué comparar.
 *
 * El modelo entra por parámetro (`ModeloExtraccion`): producción en `extraccion-modelo.ts` (el de documentos de
 * `src/lib/ai/modelo-llm.ts`); las pruebas, un doble que nunca sale a la red.
 */

/** Hoy un solo tipo; queda como parámetro para que otro PDF (precios, por ejemplo) entre sin cambiar la firma. */
export type TipoBorrador = 'funciones'

export interface Campo<T> {
  valor: T | null
  origen: 'pdf' | 'no_leido'
}

export interface InicioBorrador {
  /** YYYY-MM-DD */
  fecha: Campo<string>
  /** HH:MM, 24 horas, hora de Bogotá. */
  hora: Campo<string>
}

export interface BorradorFunciones {
  tipo: 'funciones'
  experiencia: Campo<string>
  cupo: Campo<number>
  inicios: InicioBorrador[]
  avisos: string[]
}

export type Borrador = BorradorFunciones

/** El modelo: recibe la instrucción y el texto del PDF, devuelve el JSON que leyó (o `null` si no pudo). */
export type ModeloExtraccion = (p: { instruccion: string; texto: string; tipo: TipoBorrador }) => Promise<unknown>

export const MAXIMO_CARACTERES_TEXTO = 60_000
const MAXIMO_INICIOS = 60

const vacio = <T>(): Campo<T> => ({ valor: null, origen: 'no_leido' })
const leido = <T>(valor: T): Campo<T> => ({ valor, origen: 'pdf' })

export function borradorVacio(tipo: TipoBorrador, avisos: string[] = []): Borrador {
  return { tipo, experiencia: vacio(), cupo: vacio(), inicios: [], avisos }
}

// ── Normalización y búsqueda en el texto ─────────────────────────────────────

/** Minúsculas, sin tildes, con los espacios colapsados. Pura. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** ¿El texto (ya normalizado) contiene la frase como palabra(s) completa(s)? Pura. */
export function contieneFrase(textoNorm: string, frase: string): boolean {
  const f = normalizar(frase)
  if (!f) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapar(f)}(?![\\p{L}\\p{N}])`, 'u').test(textoNorm)
}

/** ¿El texto (normalizado) contiene el número como cifra suelta? «24» no está en «124» ni en «24.5». Pura. */
export function contieneNumero(textoNorm: string, n: number): boolean {
  return new RegExp(`(?<![\\d.,])${n}(?![\\d]|[.,]\\d)`).test(textoNorm)
}

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
}

/**
 * Las fechas COMPLETAS (día, mes y año) que trae un fragmento: «9 de noviembre de 2026», «9 nov 2026», «09/11/2026»,
 * «2026-11-09». Sin año no hay fecha: el modelo no la completa. Pura.
 */
export function fechasCompletas(fragmento: string): string[] {
  const t = normalizar(fragmento)
  const out = new Set<string>()
  const armar = (a: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return
    const f = new Date(Date.UTC(a, m - 1, d))
    if (f.getUTCMonth() !== m - 1) return
    out.add(`${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  for (const x of t.matchAll(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g)) armar(+x[1], +x[2], +x[3])
  for (const x of t.matchAll(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/g)) armar(+x[3], +x[2], +x[1])
  const nombres = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|')
  const re = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:de\\s+)?(${nombres})\\.?\\s*(?:de\\s+|del\\s+)?(\\d{4})(?!\\d)`, 'g')
  for (const x of t.matchAll(re)) armar(+x[3], MESES[x[2]], +x[1])
  return [...out]
}

/**
 * Las horas SIN ambigüedad que trae un fragmento, en HH:MM de 24 horas: «19:00», «7:00 p. m.», «7 pm», «8:30 a.m.».
 * «a las 7» o «7:00» sin marca no cuentan: pueden ser de la mañana o de la noche. Pura.
 */
export function horasClaras(fragmento: string): string[] {
  const t = normalizar(fragmento)
  const out = new Set<string>()
  const re = /(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*(?:h\b|hrs?\b)?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?![\d:])/g
  for (const x of t.matchAll(re)) {
    const h = +x[1]
    const min = x[2] === undefined ? 0 : +x[2]
    const marca = x[3]?.replace(/[.\s]/g, '')
    if (min > 59 || h > 23) continue
    if (!marca && x[2] === undefined) continue // un número suelto no es una hora
    let h24 = h
    if (marca) {
      if (h < 1 || h > 12) continue
      h24 = marca === 'pm' ? (h % 12) + 12 : h % 12
    } else if (h >= 1 && h <= 11) {
      continue // ambigua
    }
    out.add(`${String(h24).padStart(2, '0')}:${String(min).padStart(2, '0')}`)
  }
  return [...out]
}

// ── Lectura de lo que devuelve el modelo ─────────────────────────────────────

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const cadena = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const entero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d{1,5}\s*$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Un texto que está en el PDF, o vacío y marcado. */
function textoVerificado(v: unknown, textoNorm: string, max: number): Campo<string> {
  const s = cadena(v, max)
  return s && contieneFrase(textoNorm, s) ? leido(s) : vacio()
}

/** La cita del modelo, si de verdad está en el texto. Si no, no sirve de evidencia. */
function citaVerificada(v: unknown, textoNorm: string): string | null {
  const c = cadena(v, 500)
  return c && normalizar(c).length >= 2 && textoNorm.includes(normalizar(c)) ? c : null
}

function borradorFunciones(crudo: Obj, textoNorm: string, avisos: string[]): BorradorFunciones {
  const inicios: InicioBorrador[] = []
  const lista = Array.isArray(crudo.funciones) ? crudo.funciones.slice(0, MAXIMO_INICIOS) : []
  let descartadas = 0
  for (const f of lista) {
    if (!esObj(f)) continue
    const cita = citaVerificada(f.cita, textoNorm)
    const fechaModelo = cadena(f.fecha, 10)
    const horaModelo = cadena(f.hora, 5)
    const fecha: Campo<string> = cita && fechaModelo && fechasCompletas(cita).includes(fechaModelo) ? leido(fechaModelo) : vacio()
    const hora: Campo<string> = cita && horaModelo && horasClaras(cita).includes(horaModelo) ? leido(horaModelo) : vacio()
    if (fecha.origen === 'no_leido' || hora.origen === 'no_leido') descartadas++
    inicios.push({ fecha, hora })
  }
  if (descartadas > 0) {
    avisos.push(`${descartadas} ${descartadas === 1 ? 'función quedó' : 'funciones quedaron'} con fecha u hora sin leer (sin año, sin mes, sin a. m./p. m. o no está en el PDF): complétalas a mano.`)
  }
  const citaCupo = citaVerificada(crudo.cupo_cita, textoNorm)
  const c = entero(crudo.cupo)
  const cupo: Campo<number> = c !== null && citaCupo && contieneNumero(normalizar(citaCupo), c) ? leido(c) : vacio()
  return { tipo: 'funciones', experiencia: textoVerificado(crudo.experiencia, textoNorm, 200), cupo, inicios, avisos }
}

export const INSTRUCCION: Record<TipoBorrador, string> = {
  funciones: `Lees el texto de un PDF con la programación de funciones de una experiencia (fechas y horas).
Devuelve SOLO JSON con: "experiencia" (el nombre de la película o experiencia, si el texto lo dice), "cupo" (cuántas
personas por función, solo si el texto lo dice), "cupo_cita" (el fragmento literal del cupo) y "funciones": una
lista con "fecha" (YYYY-MM-DD), "hora" (HH:MM en 24 horas) y "cita" (el fragmento LITERAL del texto con esa fecha y
esa hora).
Reglas: si el texto no dice el año, el mes o si la hora es de la mañana o de la noche, deja ese campo en null. No
supongas el año. No inventes funciones.`,
}

/**
 * El borrador del PDF. No escribe nada en ningún lado. `leerTexto` es `textoDelPdf` en producción.
 * Nunca lanza: si el modelo falla, el borrador sale vacío con el aviso.
 */
export async function extraerBorrador(p: {
  pdf: Uint8Array
  tipo: TipoBorrador
  modelo: ModeloExtraccion
  leerTexto: (pdf: Uint8Array) => Promise<string | null>
}): Promise<Borrador> {
  const texto = await p.leerTexto(p.pdf)
  if (!texto) {
    return borradorVacio(p.tipo, ['El PDF no trae texto que se pueda leer (¿es un escaneo?). Llena el formulario a mano.'])
  }
  const avisos: string[] = []
  if (texto.length > MAXIMO_CARACTERES_TEXTO) avisos.push('El PDF es largo: solo se leyó el comienzo. Revisa que no falte nada.')
  const recortado = texto.slice(0, MAXIMO_CARACTERES_TEXTO)

  let crudo: unknown
  try {
    crudo = await p.modelo({ instruccion: INSTRUCCION[p.tipo], texto: recortado, tipo: p.tipo })
  } catch (e) {
    console.warn('[funciones/extraccion-pdf] el modelo falló:', String(e).slice(0, 160))
    crudo = null
  }
  if (!esObj(crudo)) {
    return borradorVacio(p.tipo, [...avisos, 'No se pudo leer el PDF. Llena el formulario a mano.'])
  }
  const textoNorm = normalizar(recortado)
  return borradorFunciones(crudo, textoNorm, avisos)
}
