/**
 * El texto del post de Instagram de una campaña, en el formato de Sabor (kickoff del 2026-10-22, A7). PURO.
 *
 * Esquema (el mismo de todos sus mensajes): intro, qué incluye, funciones, precio, si hay preventa, cómo reservar,
 * dónde pagar y dirección. Cada función con día y hora completos («sábado 24 de octubre, 1:00 p. m.»): escrito «5 y 7»
 * la gente no lo entendía.
 *
 * Reglas:
 *   · Lo que no está en los datos NO se inventa: la sección sale como «[FALTA: …]» y va en `faltantes`.
 *   · Instagram limita el texto a 2.200 caracteres. Si se pasa, NO se corta a ciegas: se devuelve el exceso y qué
 *     secciones se recortarían, en orden, para que la persona decida. Es un dato para la pantalla; no publica nada.
 *   · Las horas son de Bogotá (sin horario de verano: UTC−5), sin depender de la zona del proceso.
 */

export const LIMITE_INSTAGRAM = 2200

export interface DatosPost {
  experiencia: { nombre: string; historia: string | null; que_incluye: string | null; edad_minima: number | null }
  campana: {
    precio_persona: number | null
    precio_preventa_persona: number | null
    abono_persona: number | null
    permite_pago_total: boolean
  }
  /** Las funciones vivas de la campaña (las archivadas no se pasan). */
  funciones: Array<{ inicia_at: string; es_preventa: boolean }>
  /** Lo que vive en las fichas del reglamento, no en la campaña. */
  contacto?: { como_reservar?: string | null; donde_pagar?: string | null; direccion?: string | null }
}

export type Seccion = 'intro' | 'que_incluye' | 'funciones' | 'precio' | 'preventa' | 'como_reservar' | 'donde_pagar' | 'direccion'

export interface PostCampana {
  texto: string
  caracteres: number
  limite: number
  /** Caracteres de más (0 si cabe). */
  exceso: number
  /** Si se pasa: las secciones que se recortarían, en orden, hasta caber (o hasta quedarse sin qué recortar). */
  recortaria: Array<{ seccion: Seccion; caracteres: number }>
  /** Si recortando lo de `recortaria` cabe. */
  cabe_recortando: boolean
  /** Las secciones sin dato: van en el texto como «[FALTA: …]». */
  faltantes: Seccion[]
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const BOGOTA_MS = -5 * 3_600_000

/** «sábado 24 de octubre, 1:00 p. m.», en hora de Bogotá. Pura. */
export function diaYHora(iso: string): string {
  const d = new Date(Date.parse(iso) + BOGOTA_MS)
  const h = d.getUTCHours()
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}, ${h12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

/** «$180.000». Pura. */
export function pesos(n: number): string {
  return `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

const lleno = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim().length > 0
const falta = (que: string) => `[FALTA: ${que}]`

export function generarPostCampana(
  experiencia: DatosPost['experiencia'],
  campana: DatosPost['campana'],
  funciones: DatosPost['funciones'],
  contacto: DatosPost['contacto'] = {},
): PostCampana {
  const faltantes: Seccion[] = []
  const bloques: Array<{ seccion: Seccion; texto: string }> = []
  const poner = (seccion: Seccion, texto: string | null, queFalta: string) => {
    if (texto === null) faltantes.push(seccion)
    bloques.push({ seccion, texto: texto ?? falta(queFalta) })
  }

  const nombre = experiencia.nombre.trim()
  poner('intro', lleno(experiencia.historia) ? `${nombre}\n${experiencia.historia.trim()}` : null, `la historia de ${nombre}`)
  poner('que_incluye', lleno(experiencia.que_incluye) ? `Incluye: ${experiencia.que_incluye.trim()}` : null, 'qué incluye')

  const vivas = [...funciones].sort((a, b) => Date.parse(a.inicia_at) - Date.parse(b.inicia_at))
  poner(
    'funciones',
    vivas.length ? `Funciones:\n${vivas.map((f) => `• ${diaYHora(f.inicia_at)}${f.es_preventa ? ' (preventa)' : ''}`).join('\n')}` : null,
    'las funciones',
  )

  const precio = campana.precio_persona
  const pago: string[] = []
  if (precio !== null) pago.push(`Precio: ${pesos(precio)} por persona.`)
  if (campana.abono_persona !== null) pago.push(`Reservas con ${pesos(campana.abono_persona)} por persona.`)
  else if (campana.permite_pago_total) pago.push('Reservas con el pago total.')
  poner('precio', precio !== null ? pago.join('\n') : null, 'el precio por persona')

  const hayPreventa = vivas.some((f) => f.es_preventa)
  if (hayPreventa) {
    poner('preventa', campana.precio_preventa_persona !== null ? `Preventa: ${pesos(campana.precio_preventa_persona)} por persona.` : null, 'el precio de preventa')
  }

  poner('como_reservar', lleno(contacto.como_reservar) ? `Cómo reservar: ${contacto.como_reservar.trim()}` : null, 'cómo reservar')
  poner('donde_pagar', lleno(contacto.donde_pagar) ? `Dónde pagar: ${contacto.donde_pagar.trim()}` : null, 'dónde pagar')
  poner('direccion', lleno(contacto.direccion) ? `Dirección: ${contacto.direccion.trim()}` : null, 'la dirección')

  const texto = bloques.map((b) => b.texto).join('\n\n')
  const caracteres = [...texto].length
  const exceso = Math.max(caracteres - LIMITE_INSTAGRAM, 0)

  // Si se pasa: primero la historia y después qué incluye (lo que Sabor deja para cuando preguntan), nunca las
  // funciones, el precio, cómo reservar, dónde pagar ni la dirección.
  const recortaria: PostCampana['recortaria'] = []
  let sobra = exceso
  for (const seccion of ['intro', 'que_incluye'] as const) {
    if (sobra <= 0) break
    const b = bloques.find((x) => x.seccion === seccion && !faltantes.includes(seccion))
    if (!b) continue
    const largo = [...b.texto].length + 2
    recortaria.push({ seccion, caracteres: largo })
    sobra -= largo
  }

  return { texto, caracteres, limite: LIMITE_INSTAGRAM, exceso, recortaria, cabe_recortando: sobra <= 0, faltantes }
}
