/**
 * El texto del post de Instagram de una campaña (kickoff del 2026-10-22, A7). PURO. La LÓGICA: días y horas de Bogotá,
 * pesos, límite de caracteres y recorte. QUÉ dice el post vive en `post-campana-plantilla.ts`.
 *
 * Reglas:
 *   · Cada función con día y hora completos («sábado 24 de octubre, 1:00 p. m.»): escrito «5 y 7» la gente no lo
 *     entendía.
 *   · Lo que no está en los datos NO se inventa: la sección sale como «[FALTA: …]» y va en `faltantes`.
 *   · Instagram limita el texto a 2.200 caracteres. Si se pasa, NO se corta a ciegas: se devuelve el exceso y qué
 *     secciones se recortarían, en el orden de la plantilla, para que la persona decida. Es un dato para la pantalla;
 *     no publica nada.
 *   · Las horas son de Bogotá (sin horario de verano: UTC−5), sin depender de la zona del proceso.
 */
import { PLANTILLA_POST, SEPARADOR_SECCIONES, type DatosPost, type Herramientas, type Seccion, type SeccionPlantilla } from './post-campana-plantilla'

export type { DatosPost, Seccion } from './post-campana-plantilla'

export const LIMITE_INSTAGRAM = 2200

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

const HERRAMIENTAS: Herramientas = { diaYHora, pesos }
const largo = (s: string) => [...s].length

export function generarPostCampana(
  experiencia: DatosPost['experiencia'],
  campana: DatosPost['campana'],
  funciones: DatosPost['funciones'],
  plantilla: readonly SeccionPlantilla[] = PLANTILLA_POST,
): PostCampana {
  const datos: DatosPost = {
    experiencia,
    campana,
    funciones: [...funciones].sort((a, b) => Date.parse(a.inicia_at) - Date.parse(b.inicia_at)),
  }
  const faltantes: Seccion[] = []
  const bloques: Array<{ s: SeccionPlantilla; texto: string; falta: boolean }> = []
  for (const s of plantilla) {
    if (s.aplica && !s.aplica(datos)) continue
    const texto = s.armar(datos, HERRAMIENTAS)
    if (texto === null) faltantes.push(s.seccion)
    bloques.push({ s, texto: texto ?? `[FALTA: ${s.falta}]`, falta: texto === null })
  }

  const texto = bloques.map((b) => b.texto).join(SEPARADOR_SECCIONES)
  const caracteres = largo(texto)
  const exceso = Math.max(caracteres - LIMITE_INSTAGRAM, 0)

  const recortaria: PostCampana['recortaria'] = []
  let sobra = exceso
  const recortables = bloques.filter((b) => b.s.recorte !== undefined && !b.falta).sort((a, b) => a.s.recorte! - b.s.recorte!)
  for (const b of recortables) {
    if (sobra <= 0) break
    const caracteresBloque = largo(b.texto) + largo(SEPARADOR_SECCIONES)
    recortaria.push({ seccion: b.s.seccion, caracteres: caracteresBloque })
    sobra -= caracteresBloque
  }

  return { texto, caracteres, limite: LIMITE_INSTAGRAM, exceso, recortaria, cabe_recortando: sobra <= 0, faltantes }
}
