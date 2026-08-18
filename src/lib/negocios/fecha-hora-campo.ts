/**
 * Reglas del campo `fecha_hora` de un bloque `datos`.
 *
 * Un `fecha_hora` guarda tiempo CIVIL de Bogotá en el formato que produce un
 * `<input type="datetime-local">`: 'YYYY-MM-DDTHH:mm'. No es un instante UTC y no
 * lleva zona: es "el 26 de septiembre a las 9:30 en la DIAN". Por eso las
 * comparaciones de aquí son entre cadenas civiles y el "ahora" se proyecta a
 * Bogotá con `bogotaParts` — leerlo en UTC correría la validación cinco horas y
 * rechazaría citas válidas de la tarde.
 *
 * ⚠️ POR QUÉ EXISTE
 *
 * El campo nació como `fecha` (solo día) y la operación necesita la hora: el
 * cliente debe enviar los documentos el día de la cita a la hora asignada, y así
 * lo dice la plantilla del correo que se le manda. Medido en SOENA el 2026-08-18:
 * V0115 avanzó de Cita a Notificación con una cita del 14 de agosto ya vencida,
 * porque el motor solo mira si la casilla tiene valor, no si ese valor ya pasó.
 */

import { bogotaParts } from '@/lib/dates/bogota'

/** 'YYYY-MM-DD' — un valor heredado de cuando el campo era solo día. */
const SOLO_DIA = /^\d{4}-\d{2}-\d{2}$/
/** 'YYYY-MM-DDTHH:mm' (los segundos son opcionales: algunos navegadores los emiten). */
const CON_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/**
 * ¿El valor viene de la época en que el campo era `fecha` (solo día)?
 *
 * Los 62 valores que SOENA ya tenía guardados están así. No se migran: rellenarles
 * una hora inventada sería peor que declararla ausente.
 */
export function sinHoraRegistrada(value: unknown): boolean {
  return typeof value === 'string' && SOLO_DIA.test(value.trim())
}

/**
 * Valor listo para pintar en un `<input type="datetime-local">`.
 *
 * El input ignora en silencio cualquier cadena que no sea 'YYYY-MM-DDTHH:mm': un
 * valor de solo día se pintaría VACÍO y la pantalla diría que no hay cita cuando
 * sí la hay. Se le añade 'T00:00' para que se vea; que esa medianoche no es una
 * hora real lo avisa la pantalla aparte, con `sinHoraRegistrada`.
 */
export function paraInputFechaHora(value: unknown): string {
  if (typeof value !== 'string') return ''
  const v = value.trim()
  if (SOLO_DIA.test(v)) return `${v}T00:00`
  if (CON_HORA.test(v)) return v.slice(0, 16)
  return ''
}

/** Instante actual como cadena civil de Bogotá: 'YYYY-MM-DDTHH:mm'. */
export function ahoraBogotaCivil(d?: Date): string {
  const p = bogotaParts(d)
  const dd = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${dd(p.month)}-${dd(p.day)}T${dd(p.hour)}:${dd(p.minute)}`
}

/**
 * ¿El valor queda antes de este momento en Bogotá?
 *
 * Ambas cadenas son civiles, con cada componente de ancho fijo y de mayor a menor,
 * así que el orden alfabético ES el orden cronológico. Un valor de solo día se
 * compara como su medianoche, que es lo que representa.
 *
 * Devuelve `false` para lo que no es una fecha reconocible: un valor a medio
 * escribir no es una cita en el pasado, es un campo sin terminar.
 */
export function esFechaHoraPasada(value: unknown, ahora?: Date): boolean {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!SOLO_DIA.test(v) && !CON_HORA.test(v)) return false
  return v.slice(0, 16) < ahoraBogotaCivil(ahora)
}

/**
 * Mensaje de rechazo para una cita que se intenta registrar en el pasado, o `null`
 * si el valor es aceptable.
 *
 * ⚠️ SOLO PARA VALORES NUEVOS. La operación tiene decenas de casos cerrados con
 * citas ya cumplidas: si esta regla se aplicara sobre lo YA guardado, esos casos
 * quedarían trabados sin poder avanzar. Se valida lo que alguien escribe ahora,
 * no lo que la historia dejó escrito.
 */
export function rechazoPorFechaPasada(value: unknown): string | null {
  if (!esFechaHoraPasada(value)) return null
  return 'La cita no puede quedar en el pasado. Registra la fecha y hora que asignó la DIAN.'
}

const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * "26 de septiembre de 2026, 9:30 a. m." para el cliente. Sin hora guardada, cae a
 * "26 de septiembre de 2026" y no inventa una medianoche.
 *
 * ⚠️ Se lee componente a componente, SIN construir un `Date`. La versión anterior
 * hacía `new Date(iso + 'T00:00:00')`, que con un valor que ya trae hora produce
 * '...T09:30T00:00:00': fecha inválida, y la Guía salía con la cita en blanco sin
 * avisar. Cadena civil adentro, cadena civil afuera.
 */
export function fechaHoraEnLetras(value: unknown): string {
  if (typeof value !== 'string') return ''
  const v = value.trim()
  const soloDia = SOLO_DIA.test(v)
  if (!soloDia && !CON_HORA.test(v)) return ''
  const [y, mes, dia] = [Number(v.slice(0, 4)), Number(v.slice(5, 7)), Number(v.slice(8, 10))]
  if (mes < 1 || mes > 12) return ''
  const fecha = `${dia} de ${MESES_ES[mes - 1]} de ${y}`
  if (soloDia) return fecha
  const h24 = Number(v.slice(11, 13))
  const min = v.slice(14, 16)
  const meridiano = h24 < 12 ? 'a. m.' : 'p. m.'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${fecha}, ${h12}:${min} ${meridiano}`
}
