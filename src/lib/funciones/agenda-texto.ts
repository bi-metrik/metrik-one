/**
 * La agenda escrita por Sabor, una función por línea («sábado 24 a la 1», «domingo 25 a las 7»), leída por ONE (P3,
 * agenda estricta, aprobada por Mauricio el 2026-10-22). PURO.
 *
 * Reglas:
 *   · Una hora por línea. «5 y 7», «a las 5, 7» o dos días en una línea: error en rojo, no deja seguir.
 *   · Las horas de 1 a 11 sin «a. m.» se leen como p. m. (Sabor hace funciones de tarde y noche). La lectura completa
 *     (día, fecha, a. m. o p. m.) siempre queda a la vista: no se guarda nada que la persona no haya visto.
 *   · Un día que no cuadra con la fecha («sábado 25» cuando el 25 es domingo): error.
 *   · Sin mes, el día es el próximo con ese número (este mes si todavía no pasa; si no, el siguiente). Sin año, el
 *     próximo.
 *   · Una fecha y hora que ya pasó, o repetida en la lista: error.
 * Todo en hora de Bogotá (UTC−5), sin depender de la zona del proceso.
 */

export type LecturaLinea =
  | { linea: string; ok: true; fecha: string; hora: string; lectura: string; supuestoPm: boolean }
  | { linea: string; ok: false; error: string }

const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const DIA_POR_NOMBRE: Record<string, number> = {
  domingo: 0, dom: 0, lunes: 1, lun: 1, martes: 2, mar: 2, miercoles: 3, mie: 3, jueves: 4, jue: 4, viernes: 5, vie: 5,
  sabado: 6, sab: 6,
}
const MES_POR_NOMBRE: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, abril: 4, abr: 4, mayo: 5, junio: 6, jun: 6, julio: 7, jul: 7,
  agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9, octubre: 10, oct: 10, noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
}

const normalizar = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

const MARCA = String.raw`(a\.?\s?m\.?|p\.?\s?m\.?|de la manana|de la tarde|de la noche)`

/** Fecha de Bogotá de hoy (y, m, d) a partir de un instante. Pura. */
export function hoyBogota(ahoraMs: number): { y: number; m: number; d: number } {
  const d = new Date(ahoraMs - 5 * 3_600_000)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

const diasDelMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const diaSemana = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay()
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** «sáb 24 oct · 1:00 p. m.». Pura. */
export function lecturaCorta(fecha: string, hora: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  const [h, min] = hora.split(':').map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${DIAS_CORTOS[diaSemana(y, m, d)]} ${d} ${MESES_CORTOS[m - 1]} · ${h12}:${String(min).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

/** Una línea de la agenda. `ahoraMs` es el instante de referencia (hoy y «ya pasó»). Pura. */
export function leerLineaAgenda(linea: string, ahoraMs: number): LecturaLinea {
  const original = linea.trim()
  const error = (e: string): LecturaLinea => ({ linea: original, ok: false, error: e })
  let s = normalizar(original).replace(/(\d{1,2})\s*y\s*media\b/g, '$1:30').replace(/(\d{1,2})\s*y\s*cuarto\b/g, '$1:15')

  // La hora: «a la 1», «a las 7:30 pm», «19:00», «7pm».
  const patrones = [
    new RegExp(String.raw`\ba\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*${MARCA}?`),
    new RegExp(String.raw`\b(\d{1,2}):(\d{2})\s*${MARCA}?`),
    // El grupo vacío deja la marca en el tercer lugar, como en los otros dos patrones.
    new RegExp(String.raw`\b(\d{1,2})()\s*(am|pm|a\.\s?m\.|p\.\s?m\.)`),
  ]
  let m: RegExpMatchArray | null = null
  for (const p of patrones) {
    m = s.match(p)
    if (m) break
  }
  if (!m) return error('Falta la hora: escribe, por ejemplo, «a las 7».')
  // Una hora por línea: «a las 5 y 7», «a las 5, 7», «a las 5 o a las 7», o una segunda hora en otra parte.
  const resto = s.slice((m.index ?? 0) + m[0].length)
  const otraHora = /^\s*(?:y|,|\/|o)\s*(?:a\s+las?\s+)?\d{1,2}\b/.test(resto)
    || patrones.some((p) => p.test(s.slice(0, m!.index) + ' ' + resto))
  if (otraHora) return error('Una hora por línea: escribe cada función en su propia línea.')
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const marca = (m[3] ?? '').replace(/[.\s]/g, '')
  if (min > 59 || h > 23) return error('Esa hora no existe.')
  let supuestoPm = false
  if (marca === 'am' || marca === 'delamanana') {
    if (h < 1 || h > 12) return error('Esa hora no existe.')
    h = h % 12
  } else if (marca === 'pm' || marca === 'delatarde' || marca === 'delanoche') {
    if (h < 1 || h > 12) return error('Esa hora no existe.')
    h = h === 12 ? 12 : h + 12
  } else if (h >= 1 && h <= 11) {
    h += 12
    supuestoPm = true
  } else if (h === 0) {
    return error('Esa hora no existe.')
  }
  s = (s.slice(0, m.index) + ' ' + s.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, ' ').trim()

  // El día de la semana (opcional), el día del mes (obligatorio), el mes y el año (opcionales).
  const palabras = s.replace(/[.,]/g, ' ').split(' ').filter(Boolean)
  let diaNombre: number | null = null
  let mes: number | null = null
  let anio: number | null = null
  const numeros: number[] = []
  for (const p of palabras) {
    if (p in DIA_POR_NOMBRE && diaNombre === null) {
      diaNombre = DIA_POR_NOMBRE[p]
      continue
    }
    if (p in MES_POR_NOMBRE) {
      mes = MES_POR_NOMBRE[p]
      continue
    }
    const fechaNum = p.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
    if (fechaNum) {
      numeros.push(Number(fechaNum[1]))
      mes = Number(fechaNum[2])
      if (fechaNum[3]) anio = fechaNum[3].length === 2 ? 2000 + Number(fechaNum[3]) : Number(fechaNum[3])
      continue
    }
    if (/^\d{4}$/.test(p)) {
      anio = Number(p)
      continue
    }
    if (/^\d{1,2}$/.test(p)) numeros.push(Number(p))
  }
  if (numeros.length === 0) return error('Falta el día: escribe, por ejemplo, «sábado 24».')
  if (numeros.length > 1) return error('Un día por línea: escribe cada función en su propia línea.')
  const dia = numeros[0]
  if (mes !== null && (mes < 1 || mes > 12)) return error('Ese mes no existe.')

  const hoy = hoyBogota(ahoraMs)
  let y = anio ?? hoy.y
  let mm = mes ?? hoy.m
  if (mes === null) {
    if (dia < hoy.d) {
      mm = hoy.m === 12 ? 1 : hoy.m + 1
      y = hoy.m === 12 ? hoy.y + 1 : hoy.y
    }
  } else if (anio === null && (mes < hoy.m || (mes === hoy.m && dia < hoy.d))) {
    y = hoy.y + 1
  }
  if (dia < 1 || dia > diasDelMes(y, mm)) return error(`El ${dia} de ${MESES[mm - 1]} no existe.`)
  const real = diaSemana(y, mm, dia)
  if (diaNombre !== null && diaNombre !== real) {
    return error(`«${DIAS_LARGOS[diaNombre]} ${dia}» no cuadra: el ${dia} de ${MESES[mm - 1]} es ${DIAS_LARGOS[real]}.`)
  }
  const fecha = iso(y, mm, dia)
  const hora = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  if (Date.parse(`${fecha}T${hora}:00-05:00`) <= ahoraMs) return error('Esa fecha y hora ya pasó.')
  return { linea: original, ok: true, fecha, hora, lectura: lecturaCorta(fecha, hora), supuestoPm }
}

/** Toda la agenda: una lectura por línea con texto (las vacías no cuentan). Marca las repetidas. Pura. */
export function leerAgenda(texto: string, ahoraMs: number): LecturaLinea[] {
  const vistas = new Set<string>()
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const r = leerLineaAgenda(l, ahoraMs)
      if (!r.ok) return r
      const llave = `${r.fecha} ${r.hora}`
      if (vistas.has(llave)) return { linea: r.linea, ok: false, error: `Repetida: ${r.lectura} ya está en la lista.` }
      vistas.add(llave)
      return r
    })
}

const PALABRAS_VACIAS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'the', 'a', 'en', 'un', 'una'])

/** «Harry Potter octubre»: la experiencia y el mes de la primera función. Pura. */
export function nombreCampana(experiencia: string, primeraFecha: string): string {
  const m = Number(primeraFecha.slice(5, 7))
  return `${experiencia.trim()} ${MESES[m - 1]}`.slice(0, 200)
}

/** «HP-OCT26»: las iniciales de la experiencia (hasta 4), el mes y el año de la primera función. Pura. */
export function codigoCampana(experiencia: string, primeraFecha: string): string {
  const iniciales = normalizar(experiencia)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter((p) => p && !PALABRAS_VACIAS.has(p))
    .map((p) => p[0].toUpperCase())
    .join('')
    .slice(0, 4) || 'C'
  const m = Number(primeraFecha.slice(5, 7))
  return `${iniciales}-${MESES_CORTOS[m - 1].toUpperCase()}${primeraFecha.slice(2, 4)}`
}
