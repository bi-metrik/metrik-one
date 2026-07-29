/**
 * Motor de auditoria de llamadas: dos pasadas en paralelo y un ensamblaje
 * determinista.
 *
 * POR QUE DOS PASADAS
 *
 * Esta medido, no es preferencia de estilo. Con una sola pasada que puntua los
 * 19 items y rastrea las 6 banderas a la vez, C2 se detecta 1 de cada 3 veces:
 * el modelo no sostiene las dos tareas y suelta lo que aparece tarde en la
 * llamada. Con una pasada dedicada solo a cumplimiento salen las seis, 4 de 4,
 * y ademas mas rapido. Perder C2 dos de cada tres veces convertiria el motor en
 * un generador de falsos verdes, que es la peor forma de fallar aqui.
 *
 * Corren en PARALELO sobre la misma transcripcion, asi que el total no sube:
 * lo marca la pasada mas lenta, que es la tecnica.
 *
 * EL ENSAMBLAJE VA EN CODIGO, NO EN EL PROMPT
 *
 * Las dos reglas de abajo son deterministas y criticas, asi que no se le piden
 * al modelo: se aplican aqui. Un paso critico que depende del prompt regresiona
 * en silencio la proxima vez que alguien afine otra cosa.
 */

/** Modelo unico para las dos pasadas. Medido contra 2.5 (lento) y 3.1 Pro (preambulo). */
export const MODELO_AUDITORIA = 'gemini-3.6-flash'

export interface BanderaDetectada {
  codigo: string
  presente: boolean
  cita?: string
  momento?: string
  motivo?: string
}

export interface ItemTecnica {
  nombre: string
  puntaje: number
  maximo: number
  estado?: string
  cita?: string
  momento?: string
  comentario?: string
}

export interface BloqueTecnica {
  codigo?: string
  nombre: string
  puntaje: number
  maximo: number
  comentario?: string
  items?: ItemTecnica[]
}

export interface Auditoria {
  resumen?: string
  tecnica: { puntaje: number; bloques: BloqueTecnica[] }
  cumplimiento: {
    semaforo: 'verde' | 'amarillo' | 'rojo'
    errores_criticos: number
    errores_no_criticos: number
    banderas: BanderaDetectada[]
  }
  conversacion?: Record<string, number>
  cronologia?: { momento: string; evento: string; tipo?: string }[]
  recomendaciones?: { bloque: string; puntos_en_juego?: number; accion: string }[]
  /** Cuanto tardo cada pasada. Util para la barra de progreso y para medir. */
  tiempos: { cumplimientoMs: number; tecnicaMs: number; totalMs: number }
}

/**
 * Los SIETE codigos de bloque permitidos, en el orden de la rubrica.
 *
 * No es decoracion: el modelo alterna entre `objeciones` y `manejo_objeciones`
 * de una corrida a otra. Con `unique(llamada_id, bloque_codigo)` eso significa
 * que la misma llamada auditada dos veces guarda bloques que no se pueden
 * comparar, y el perfil de agente —que promedia por bloque— empieza a mezclar
 * peras con manzanas sin que nadie lo note.
 *
 * El prompt ya los fija, pero un dato que entra a la base desde una respuesta
 * generada no se valida en el prompt: se valida aqui. Y un codigo inesperado
 * FALLA RUIDOSAMENTE en vez de normalizarse en silencio — si el modelo empieza
 * a devolver otra cosa, queremos enterarnos, no acomodarlo.
 */
export const BLOQUES_CANONICOS = [
  'apertura',
  'descubrimiento',
  'escucha',
  'educacion',
  'propuesta',
  'objeciones',
  'cierre',
] as const

export type BloqueCodigo = (typeof BLOQUES_CANONICOS)[number]

/** Nombre legible por codigo. La pantalla no depende de como los titule el modelo. */
export const NOMBRE_BLOQUE: Record<BloqueCodigo, string> = {
  apertura: 'Apertura e identificación',
  descubrimiento: 'Descubrimiento',
  escucha: 'Escucha y control',
  educacion: 'Educación técnica',
  propuesta: 'Propuesta y precio',
  objeciones: 'Manejo de objeciones',
  cierre: 'Cierre y próximos pasos',
}

/**
 * Valida los codigos de bloque de una auditoria antes de que toquen la base.
 * Lanza con el detalle de lo que llego, para que el error se pueda leer.
 */
export function validarBloques(bloques: BloqueTecnica[]): asserts bloques is (BloqueTecnica & { codigo: BloqueCodigo })[] {
  const permitidos = new Set<string>(BLOQUES_CANONICOS)
  const llegaron = bloques.map((b) => b.codigo ?? '(sin codigo)')

  const invalidos = llegaron.filter((c) => !permitidos.has(c))
  if (invalidos.length > 0) {
    throw new Error(
      `Codigos de bloque no reconocidos: ${invalidos.join(', ')}. ` +
        `Permitidos: ${BLOQUES_CANONICOS.join(', ')}. Llegaron: ${llegaron.join(', ')}.`,
    )
  }
  const faltan = BLOQUES_CANONICOS.filter((c) => !llegaron.includes(c))
  if (faltan.length > 0) {
    throw new Error(`Faltan bloques en la auditoria: ${faltan.join(', ')}.`)
  }
  const repetidos = llegaron.filter((c, i) => llegaron.indexOf(c) !== i)
  if (repetidos.length > 0) {
    throw new Error(`Bloques repetidos en la auditoria: ${[...new Set(repetidos)].join(', ')}.`)
  }
}

/** Severidad por codigo. La fuente es la rubrica, no lo que devuelva el modelo. */
export const SEVERIDAD_BANDERA: Record<string, 'critica' | 'alta' | 'media'> = {
  C1: 'critica',
  C2: 'critica',
  C3: 'alta',
  C4: 'alta',
  C5: 'media',
  C6: 'media',
}

/** Titulo estable por codigo. El modelo describe el hecho; el titulo no lo inventa. */
export const TITULO_BANDERA: Record<string, string> = {
  C1: 'Código de seguridad pedido en llamada grabada',
  C2: 'Afirmación de resultado sobre el puntaje',
  C3: 'Apertura no veraz sobre el motivo del contacto',
  C4: 'Plan de pago cerrado antes del contrato',
  C5: 'Urgencia o promoción fabricada',
  C6: 'Dato sensible expuesto en la verificación',
}

/**
 * Items tecnicos que NO se juzgan por su cuenta: se derivan de una bandera.
 *
 * "Alcance realista, sin garantizar resultados" pregunta exactamente lo mismo
 * que C2. Cuando la pasada B lo juzgaba aparte, ese bloque solo concentraba
 * TODA la dispersion del puntaje (rango de 8 puntos mientras cinco de siete
 * bloques quedaban identicos). Dos juicios independientes sobre el mismo hecho
 * son dos oportunidades de contradecirse, y ya sabemos cual de los dos es el
 * estable.
 *
 * Principio general, por si aparece otro: si un item tecnico y una bandera
 * preguntan lo mismo, la bandera es la fuente y el item la consecuencia.
 */
const ITEMS_DERIVADOS: { patron: RegExp; bandera: string }[] = [
  { patron: /alcance\s+realista|garantizar\s+resultados/i, bandera: 'C2' },
]

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * Aplica la regla de derivacion y recalcula los totales.
 *
 * Recalcular no es cosmetico: si se fuerza el item a 0 y no se recalcula, el
 * bloque y el total quedan diciendo un numero que ya no es la suma de sus
 * partes, que es justo la incoherencia que este motor existe para no producir.
 */
function derivarItemsDeBanderas(
  tecnica: { puntaje: number; bloques: BloqueTecnica[] },
  banderas: BanderaDetectada[],
): { puntaje: number; bloques: BloqueTecnica[] } {
  const presentes = new Map(banderas.filter((b) => b.presente).map((b) => [b.codigo, b]))

  const bloques = tecnica.bloques.map((bloque) => {
    if (!bloque.items?.length) return bloque

    const items = bloque.items.map((item) => {
      const regla = ITEMS_DERIVADOS.find((r) => r.patron.test(sinAcentos(item.nombre)))
      if (!regla) return item

      const bandera = presentes.get(regla.bandera)
      if (!bandera) return item

      return {
        ...item,
        puntaje: 0,
        estado: 'no cumple',
        cita: bandera.cita ?? item.cita,
        momento: bandera.momento ?? item.momento,
        comentario:
          `Se deriva de ${regla.bandera}, que la auditoría de cumplimiento encontró` +
          (bandera.momento ? ` en ${bandera.momento}` : '') +
          '. Este ítem no se evalúa aparte: la bandera es la fuente.',
      }
    })

    const puntaje = items.reduce((a, i) => a + i.puntaje, 0)
    return { ...bloque, items, puntaje }
  })

  return { puntaje: bloques.reduce((a, b) => a + b.puntaje, 0), bloques }
}

/**
 * Semaforo desde las banderas, nunca desde la tecnica.
 *
 * El cumplimiento manda: una llamada puede estar bien ejecutada y aun asi ser
 * roja. Es el hallazgo mas importante que este sistema produce, y por eso el
 * semaforo se calcula aqui y no se le pregunta a ninguna de las dos pasadas.
 */
export function semaforoDesdeBanderas(banderas: BanderaDetectada[]) {
  const presentes = banderas.filter((b) => b.presente)
  const criticas = presentes.filter((b) => SEVERIDAD_BANDERA[b.codigo] === 'critica')
  const semaforo: 'verde' | 'amarillo' | 'rojo' =
    criticas.length > 0 ? 'rojo' : presentes.length > 0 ? 'amarillo' : 'verde'
  return {
    semaforo,
    errores_criticos: criticas.length,
    errores_no_criticos: presentes.length - criticas.length,
  }
}

async function llamarGemini(prompt: string, apiKey: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_AUDITORIA}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32768,
          responseMimeType: 'application/json',
        },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  }
  const c = j.candidates?.[0]
  const texto = c?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!texto) throw new Error(`Respuesta vacía (finishReason: ${c?.finishReason ?? '?'})`)
  return texto
}

export interface PromptsAuditoria {
  cumplimiento: string
  tecnica: string
}

/**
 * Audita una transcripcion. Las dos pasadas van en paralelo.
 */
export async function auditarTranscripcion(
  transcripcion: string,
  prompts: PromptsAuditoria,
  apiKey: string,
): Promise<Auditoria> {
  const t0 = Date.now()

  const tA = Date.now()
  const pA = llamarGemini(`${prompts.cumplimiento}\n\n---\n\nTranscripción:\n\n${transcripcion}`, apiKey)
    .then((t) => ({ texto: t, ms: Date.now() - tA }))

  const tB = Date.now()
  const pB = llamarGemini(
    `${prompts.tecnica}\n\n---\n\n` +
      'IMPORTANTE PARA ESTA CORRIDA: NO evalúes el eje de cumplimiento. Omite por completo la ' +
      'búsqueda de banderas y el objeto "cumplimiento" de la salida. Tu única tarea es el eje ' +
      'TÉCNICA: los 7 bloques con sus ítems.\n\n' +
      `Transcripción:\n\n${transcripcion}`,
    apiKey,
  ).then((t) => ({ texto: t, ms: Date.now() - tB }))

  const [a, b] = await Promise.all([pA, pB])

  const cumplimiento = JSON.parse(a.texto) as { banderas: BanderaDetectada[] }
  const tecnicaCruda = JSON.parse(b.texto) as {
    resumen?: string
    tecnica: { puntaje: number; bloques: BloqueTecnica[] }
    conversacion?: Record<string, number>
    cronologia?: { momento: string; evento: string; tipo?: string }[]
    recomendaciones?: { bloque: string; puntos_en_juego?: number; accion: string }[]
  }

  const banderas = cumplimiento.banderas ?? []

  // Antes de cualquier otra cosa: que los siete bloques sean los siete bloques.
  validarBloques(tecnicaCruda.tecnica.bloques)

  const tecnica = derivarItemsDeBanderas(tecnicaCruda.tecnica, banderas)

  return {
    resumen: tecnicaCruda.resumen,
    tecnica,
    cumplimiento: { ...semaforoDesdeBanderas(banderas), banderas },
    conversacion: tecnicaCruda.conversacion,
    cronologia: tecnicaCruda.cronologia,
    recomendaciones: tecnicaCruda.recomendaciones,
    tiempos: { cumplimientoMs: a.ms, tecnicaMs: b.ms, totalMs: Date.now() - t0 },
  }
}
