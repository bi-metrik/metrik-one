/**
 * La DECISIÓN DEL MODELO sobre a dónde va un pantallazo ya leído (cotización por pasos, C5; nota
 * técnica de Max §5.2; criterios V6 y M1–M4 de Vera).
 *
 * ## Dónde corre y cuánto espera
 *
 * Dentro de la LECTURA (ruta `leer-captura`), después de leer y con un corte de 2,5 s, como el
 * bot. El viaje (servicios, lugares y fechas) lo manda el navegador, que ya lo tiene: no se lee la
 * base. Si el modelo no contesta a tiempo, falla o está apagado, devuelve `null` y la frase de la
 * fila sale de las reglas (`destinoDeReglas`) sin esperar. «Aceptar» NUNCA llama al modelo: usa
 * lo que ya dice la fila.
 *
 * ## Lo que NO decide
 *
 * Lo que devuelve pasa por `conDecisionDelModelo` (`destino-por-pasos.ts`), donde viven las
 * guardas: el mismo tipo (M3), ante la duda suma aparte con su razón (M2), y «Completa» solo si el
 * precio que falta existe de verdad. El modelo clasifica; el código solo valida.
 *
 * Es texto, sin imagen: la lectura ya dice lo que se vio.
 */

import type { ComoPorPasos, DecisionDelModelo } from '@/lib/cotizaciones/destino-por-pasos'

/** El modelo de la decisión: rápido y sin pensar, para caber en el corte. */
export const MODELO_DESTINO = 'gemini-2.5-flash-lite'
/** El corte, como el del bot (nota técnica §5.2). */
export const CORTE_DESTINO_MS = 2500

/** Un servicio del viaje, como lo manda el navegador. */
export interface ServicioDelViaje {
  /** El id de la primera opción del servicio: con él responde el modelo. */
  id: string
  tipo: string
  /** «Hotel en Providencia». */
  servicio: string
  /** «POSADA ENILDA · PROVIDENCIA». */
  nombre: string
  /** Lo que identifica la opción: aerolínea, ruta y fechas, u hotel y fechas. */
  detalle: string
}

/** Lo leído, en pocas palabras. */
export interface LecturaParaDecidir {
  tipo: string
  nombre: string
  detalle: string
  ocupacion: string
}

export const PROMPT_DESTINO =
  'Eres el asistente de una agencia de viajes colombiana que arma una cotización. La asesora pegó un ' +
  'pantallazo de un proveedor y ONE ya lo leyó. Decide a dónde va dentro del viaje, con UNA de estas:\n' +
  '- nueva: es un servicio que SUMA, aparte de los que ya están (otro vuelo, otra ruta, otro destino, ' +
  'otras fechas, otra actividad).\n' +
  '- hermana: es OTRA OPCIÓN que COMPITE con un servicio que ya está (otro hotel en el mismo destino y ' +
  'las mismas fechas; otra lancha para la misma excursión). Solo del MISMO tipo.\n' +
  '- habitacion: solo hotel. Es OTRA HABITACIÓN del MISMO hotel en las MISMAS fechas: suma dentro de él.\n' +
  '- completa: es la misma tarifa (misma aerolínea, ruta y fechas) buscada con otros pasajeros, para ' +
  'traer el precio del niño o del infante que le faltaba a una opción.\n\n' +
  'Reglas:\n' +
  '- Ante la duda, nueva, y duda = true: es peor perder un servicio que tener uno de más.\n' +
  '- servicio: el id del servicio con el que compite o al que completa (de la lista). null si es nueva.\n' +
  '- razon: una línea en español llano que diga por qué («Otra isla y otra fecha que el traslado de ' +
  'Providencia»). Siempre que no sea nueva.\n' +
  'Responde solo el JSON.'

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    como: { type: 'STRING', enum: ['nueva', 'hermana', 'habitacion', 'completa'] },
    servicio: { type: 'STRING', nullable: true },
    razon: { type: 'STRING', nullable: true },
    duda: { type: 'BOOLEAN' },
  },
  required: ['como', 'duda'],
  propertyOrdering: ['como', 'servicio', 'duda', 'razon'],
}

const corto = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** El texto que se le manda. Puro. */
export function armarPedido(lectura: LecturaParaDecidir, servicios: readonly ServicioDelViaje[]): string {
  const lista = servicios.length === 0
    ? '(todavía no hay servicios)'
    : servicios.map(s => `- id=${s.id} · ${s.tipo} · ${s.servicio} · ${s.nombre}${s.detalle ? ` · ${s.detalle}` : ''}`).join('\n')
  return `Servicios que ya tiene el viaje:\n${lista}\n\nEl pantallazo nuevo (${lectura.tipo}): ${lectura.nombre}` +
    `${lectura.detalle ? ` · ${lectura.detalle}` : ''}${lectura.ocupacion ? ` · ${lectura.ocupacion}` : ''}\n\n¿A dónde va?`
}

const COMOS = new Set<ComoPorPasos>(['nueva', 'hermana', 'habitacion', 'completa'])

/** De la respuesta cruda a lo que se usa. Un id que no estaba en la lista no vale. Puro. */
export function normalizarDecision(raw: unknown, idsValidos: ReadonlySet<string>): DecisionDelModelo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const como = typeof r.como === 'string' ? r.como.trim().toLowerCase() as ComoPorPasos : null
  if (!como || !COMOS.has(como)) return null
  const servicio = typeof r.servicio === 'string' && idsValidos.has(r.servicio.trim()) ? r.servicio.trim() : null
  const duda = r.duda === true
  if (como !== 'nueva' && !servicio && !duda) return null
  return { como, itemId: como === 'nueva' && !duda ? null : servicio, razon: corto(r.razon, 200) || null, duda }
}

/** Los servicios que manda el navegador, sin confiar en su forma. */
export function leerServiciosDelViaje(raw: unknown): ServicioDelViaje[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 60).flatMap(x => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const id = corto(r.id, 80)
    if (!id) return []
    return [{ id, tipo: corto(r.tipo, 20), servicio: corto(r.servicio, 120), nombre: corto(r.nombre, 160), detalle: corto(r.detalle, 240) }]
  })
}

/**
 * Pregunta al modelo con el corte. Nunca lanza: lento, caído, bloqueado o sin llave = `null`, y la
 * fila se queda con las reglas. `fetchImpl` entra por parámetro para probar el modelo lento y el
 * caído sin red.
 */
export async function decidirDestinoConModelo(
  lectura: LecturaParaDecidir,
  servicios: readonly ServicioDelViaje[],
  apiKey: string,
  opciones: { corteMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<DecisionDelModelo | null> {
  if (!apiKey) return null
  const ids = new Set(servicios.map(s => s.id))
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_DESTINO}:generateContent?key=${apiKey}`
  const corte = new AbortController()
  const reloj = setTimeout(() => corte.abort(), opciones.corteMs ?? CORTE_DESTINO_MS)
  try {
    const res = await (opciones.fetchImpl ?? fetch)(url, {
      method: 'POST',
      signal: corte.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: PROMPT_DESTINO }] },
        contents: [{ parts: [{ text: armarPedido(lectura, servicios) }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 256,
          responseMimeType: 'application/json',
          responseSchema: ESQUEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] }
    const c = data.candidates?.[0]
    if (c?.finishReason && c.finishReason !== 'STOP') return null
    const texto = (c?.content?.parts ?? []).find(p => !p.thought && p.text?.trim().startsWith('{'))?.text
    if (!texto) return null
    return normalizarDecision(JSON.parse(texto), ids)
  } catch {
    return null
  } finally {
    clearTimeout(reloj)
  }
}
