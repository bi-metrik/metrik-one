/**
 * La PLANTILLA del post de Instagram de una campaña: qué secciones lleva, en qué orden, cómo se escribe cada una y
 * cuáles se pueden recortar si el texto se pasa del límite. PURA.
 *
 * Está separada a propósito de la lógica (`post-campana.ts`: días y horas de Bogotá, pesos, límite de caracteres y
 * recorte): los textos van a cambiar cuando Mauricio apruebe los de Sabor, y cambiarlos es editar SOLO este archivo.
 *
 * Esquema de hoy (kickoff del 2026-10-22, A7): intro, qué incluye, funciones, precio, si hay preventa, cómo reservar,
 * dónde pagar y dirección. Cómo reservar, dónde pagar y la dirección todavía NO son campos de la ficha (la lista exacta
 * la aprueba Mauricio a partir de los mensajes reales de Sabor): mientras tanto salen como faltantes, nunca inventados.
 */

export interface DatosPost {
  experiencia: { nombre: string; historia: string | null; que_incluye: string | null; edad_minima: number | null }
  campana: {
    precio_persona: number | null
    precio_preventa_persona: number | null
    abono_persona: number | null
    permite_pago_total: boolean
  }
  /** Las funciones vivas de la campaña (las archivadas no se pasan), ya ordenadas por hora. */
  funciones: Array<{ inicia_at: string; es_preventa: boolean }>
}

export type Seccion = 'intro' | 'que_incluye' | 'funciones' | 'precio' | 'preventa' | 'como_reservar' | 'donde_pagar' | 'direccion'

/** Lo que la lógica le presta a la plantilla para escribir. */
export interface Herramientas {
  /** «sábado 24 de octubre, 1:00 p. m.», hora de Bogotá. */
  diaYHora(iso: string): string
  /** «$180.000». */
  pesos(n: number): string
}

export interface SeccionPlantilla {
  seccion: Seccion
  /** El texto de la sección, o `null` si los datos no lo traen (sale «[FALTA: …]»). */
  armar(d: DatosPost, h: Herramientas): string | null
  /** Qué falta, en llano, para el «[FALTA: …]». */
  falta: string
  /** Si va: `false` = la sección no aplica y no se escribe (por ejemplo, la preventa cuando no hay). */
  aplica?(d: DatosPost): boolean
  /** Orden de recorte si el texto se pasa (1 primero). Sin número, nunca se recorta. */
  recorte?: number
}

const lleno = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim().length > 0

export const SEPARADOR_SECCIONES = '\n\n'

export const PLANTILLA_POST: readonly SeccionPlantilla[] = [
  {
    seccion: 'intro',
    falta: 'la historia de la experiencia',
    recorte: 1,
    armar: (d) => (lleno(d.experiencia.historia) ? `${d.experiencia.nombre.trim()}\n${d.experiencia.historia.trim()}` : null),
  },
  {
    seccion: 'que_incluye',
    falta: 'qué incluye',
    recorte: 2,
    armar: (d) => (lleno(d.experiencia.que_incluye) ? `Incluye: ${d.experiencia.que_incluye.trim()}` : null),
  },
  {
    seccion: 'funciones',
    falta: 'las funciones',
    armar: (d, h) =>
      d.funciones.length ? `Funciones:\n${d.funciones.map((f) => `• ${h.diaYHora(f.inicia_at)}${f.es_preventa ? ' (preventa)' : ''}`).join('\n')}` : null,
  },
  {
    seccion: 'precio',
    falta: 'el precio por persona',
    armar: (d, h) => {
      const c = d.campana
      if (c.precio_persona === null) return null
      const lineas = [`Precio: ${h.pesos(c.precio_persona)} por persona.`]
      if (c.abono_persona !== null) lineas.push(`Reservas con ${h.pesos(c.abono_persona)} por persona.`)
      else if (c.permite_pago_total) lineas.push('Reservas con el pago total.')
      return lineas.join('\n')
    },
  },
  {
    seccion: 'preventa',
    falta: 'el precio de preventa',
    aplica: (d) => d.funciones.some((f) => f.es_preventa),
    armar: (d, h) => (d.campana.precio_preventa_persona !== null ? `Preventa: ${h.pesos(d.campana.precio_preventa_persona)} por persona.` : null),
  },
  // Sin campo en la ficha todavía (lo aprueba Mauricio): faltan siempre.
  { seccion: 'como_reservar', falta: 'cómo reservar', armar: () => null },
  { seccion: 'donde_pagar', falta: 'dónde pagar', armar: () => null },
  { seccion: 'direccion', falta: 'la dirección', armar: () => null },
]
