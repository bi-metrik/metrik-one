/**
 * Lector de un pantallazo de proveedor contra el contrato de UNA ranura.
 *
 * Paso 3 del motor de cotización de Trappvel (§3.5).
 *
 * ## Por qué no sirve `extraerCampoDesdeImagen`
 *
 * Esa acción devuelve **campos planos y un solo campo destino**: sirve para sacar un
 * radicado de un pantallazo de la DIAN. Una tarifa de hotel con desglose (tarifa +
 * impuestos + resort fee) son varias FILAS, y además hay que poder rechazar la imagen
 * entera. Es el mismo modelo y la misma llamada: lo que cambia es el esquema de salida.
 *
 * ## RX1 va en el PROMPT, no en una validación posterior
 *
 * *«Esto no es una validacion posterior: va en el prompt, como instruccion explicita
 * de negarse ante N opciones.»* El modelo clasifica la imagen ANTES de extraer y su
 * veredicto viaja como primer campo del JSON. Si el rechazo se dedujera después, de
 * los campos ya leídos, el modelo ya habría elegido una fila del listado para
 * llenarlos — y esa elección es justamente la que no puede hacer.
 *
 * ## R-P7: se verifica el MOTIVO de terminación, no solo que haya texto
 *
 * Una respuesta truncada por presupuesto (`MAX_TOKENS`) trae JSON a medias que a veces
 * parsea. El precedente está escrito en el repo: el motor de calidad daba por buena
 * media transcripción y salía con puntaje normal. Aquí cualquier `finishReason`
 * distinto de `STOP` es RX6.
 *
 * ## La imagen NO se persiste
 *
 * Igual que `extraerCampoDesdeImagen`. La captura de COTIZAR es un insumo de trabajo;
 * la de COMPRA sí es evidencia y debe persistir (§4), pero eso depende de A2 y está
 * fuera de este paso.
 */

import type { DefinicionRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import type { LecturaCruda, VeredictoImagen } from '@/lib/cotizaciones/lectura-pantallazo'
import { extraerConReintento, type ResultadoExtraccion } from './reintentar-extraccion'

/**
 * Mismo modelo que el extractor de documentos: `gemini-2.5-flash` con thinking.
 *
 * El juicio que hace falta aquí es semántico, no de legibilidad: distinguir un listado
 * de resultados de un detalle de itinerario, y saber si el número grande de la pantalla
 * es el total o el precio por pasajero. Eso lo resuelve el razonamiento, no el OCR.
 */
const GEMINI_MODEL = 'gemini-2.5-flash'

/**
 * Presupuesto de salida. El thinking se cobra del MISMO `maxOutputTokens` que el JSON.
 *
 * ⚠️ Medido contra el modelo vivo, y por eso el número es grande: la corrida típica
 * gasta ~400-800 tokens de JSON y ~350-800 de pensamiento, o sea nada. Pero **el
 * pensamiento varía entre corridas con la MISMA imagen**: la captura de hotel que en
 * una corrida terminó en `STOP` con 609 tokens, en otra se cortó por `MAX_TOKENS` con
 * el límite en 8.192 — dos intentos seguidos, 64 segundos, y rechazo RX6 sobre una
 * captura impecable. Es el mismo gotcha que el motor de calidad ya pagó (swings
 * medidos de 12k a 46k). El techo alto no cuesta nada cuando no se usa: se cobra lo
 * gastado, no lo reservado.
 */
const MAX_OUTPUT_TOKENS = 24_576
const THINKING_BUDGET = 2048

/**
 * Tope de reloj por intento.
 *
 * ⚠️ Medido: la lectura típica tarda **5 a 12 segundos**, pero una corrida de las
 * cuatro del banco de prueba se pasó de **90 segundos** con la misma imagen que en
 * aislamiento tardó 7,7. El pensamiento del modelo no es determinista y su cola es
 * larga.
 *
 * Esto corre en una server action, y una server action **no puede declarar
 * `maxDuration`** (es configuración de segmento; el gotcha ya está escrito en el
 * repo). Sin tope, una corrida larga la corta la plataforma con un error genérico y
 * quien cotiza se queda mirando el indicador. Con tope: dos intentos de 25 s son 51 s
 * en el peor caso, por debajo de los 60 s del plan, y el mensaje dice qué hacer.
 */
const TIMEOUT_MS = 25_000

const MIMES_SOPORTADOS: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'application/pdf': 'application/pdf',
}

const VEREDICTOS: VeredictoImagen[] = [
  'detalle_unico',
  'varias_opciones',
  'otra_ranura',
  'no_es_pantalla_de_precio',
]

// ── Prompt ───────────────────────────────────────────────────────────────────

export function construirPrompt(ranura: DefinicionRanura): string {
  const campos = ranura.campos
    .map(c => `- ${c.slug} (${c.label}${c.min ? ', OBLIGATORIO' : ''}): ${c.descripcion_ai}`)
    .join('\n')

  return `Eres un lector de pantallas de proveedores de viaje. Lees UNA captura y devuelves JSON.

RANURA DE ESTA CAPTURA: ${ranura.label} (${ranura.slug})
QUE SE ESPERA: ${ranura.queSePide}
QUE NO SIRVE: ${ranura.queNoSirve}

PASO 1 — CLASIFICA LA IMAGEN ANTES DE EXTRAER NADA. Devuelve "veredicto" con uno de:

- "varias_opciones": la imagen muestra MAS DE UNA opcion tarifaria. Un listado de
  resultados, un comparador, una grilla de aerolineas, una lista de habitaciones con
  varios precios, un calendario de precios por dia, o cualquier pantalla donde
  convivan dos o mas precios entre los que habria que ELEGIR.
  ⚠️ REGLA ABSOLUTA: ante varias opciones NO ELIJAS NINGUNA. No tomes la primera, ni
  la mas barata, ni la resaltada. Devuelve este veredicto y deja "campos" vacio. Elegir
  por tu cuenta produce un precio que parece correcto y no lo es; eso cuesta dinero
  real. Negarte es la respuesta correcta, no una falla.
- "otra_ranura": es una pantalla de viaje valida pero de OTRA cosa (un hotel donde se
  pedia un vuelo, un traslado donde se pedia una actividad).
- "no_es_pantalla_de_precio": no es una pantalla de reserva ni de cotizacion (un correo,
  un chat, una foto, un documento, una pantalla sin precio).
- "detalle_unico": es la pantalla de UNA sola opcion ya seleccionada, con su precio.
  Solo en este caso extraes campos.

Si dudas entre "detalle_unico" y "varias_opciones", responde "varias_opciones".

En "observacion" escribe UNA linea diciendo que viste. Si rechazas, es lo que la
persona va a leer para saber que capturar.

PASO 2 — SOLO si el veredicto es "detalle_unico", extrae estos campos:

${campos}

REGLAS DE EXTRACCION:
- Para cada campo: { "value": <texto o null>, "confidence": <0.0 a 1.0> }
- Lo que NO este en la imagen va con value null y confidence 0. NUNCA lo deduzcas del
  contexto del viaje, del destino ni de lo que seria razonable. Un campo vacio es un
  hueco que una persona llena; un campo inventado es un dato falso que nadie revisa.
- confidence refleja certeza de LECTURA (1.0 perfectamente legible, 0.5 borroso pero
  probable, 0.0 no visible).
- Valores monetarios: devuelve SOLO el numero, sin simbolo ni separadores de miles.
  Respeta la convencion de la pantalla: si dice 1.234,56 el valor es 1234.56; si dice
  1,234.56 tambien es 1234.56.
- Fechas en formato AAAA-MM-DD. Si el ano no aparece en la pantalla, devuelve null:
  no lo supongas.
- Booleanos: la cadena "true" o "false". null si la pantalla no lo dice.

PASO 3 — DESGLOSE. En "desglose" devuelve las filas de precio que la pantalla muestre
DESGLOSADAS (tarifa, impuestos y tasas, resort fee, cargo por servicio, equipaje).
- Copia lo que la pantalla lista. NO inventes un desglose que no esta: si solo hay un
  precio total, devuelve desglose vacio.
- Cada fila: { "concepto", "cantidad", "unidad", "valor_unitario", "moneda", "confidence" }
- NO incluyas el total general como una fila mas: seria contar el mismo dinero dos veces.`
}

// ── Esquema de salida ────────────────────────────────────────────────────────

function construirEsquema(ranura: DefinicionRanura) {
  return {
    type: 'OBJECT',
    properties: {
      veredicto: { type: 'STRING', enum: VEREDICTOS },
      observacion: { type: 'STRING' },
      campos: {
        type: 'OBJECT',
        properties: Object.fromEntries(
          ranura.campos.map(c => [c.slug, {
            type: 'OBJECT',
            properties: { value: { type: 'STRING' }, confidence: { type: 'NUMBER' } },
            required: ['value', 'confidence'],
          }]),
        ),
        required: ranura.campos.map(c => c.slug),
      },
      desglose: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            concepto: { type: 'STRING' },
            cantidad: { type: 'NUMBER' },
            unidad: { type: 'STRING' },
            valor_unitario: { type: 'NUMBER' },
            moneda: { type: 'STRING' },
            confidence: { type: 'NUMBER' },
          },
          required: ['concepto', 'valor_unitario'],
        },
      },
    },
    required: ['veredicto', 'campos', 'desglose'],
  }
}

// ── Normalización de lo que llega ────────────────────────────────────────────

/**
 * Convierte la respuesta del modelo en `LecturaCruda`, sin juzgarla.
 *
 * ⚠️ Un `veredicto` que no esté en la lista se trata como **rechazo**
 * (`no_es_pantalla_de_precio`), nunca como `detalle_unico`. Caer al caso que crea
 * rubros ante una respuesta que no se entiende es exactamente al revés de lo que este
 * frente protege.
 *
 * Exportada para poder probarla sin llamar a Gemini.
 */
export function normalizarRespuesta(raw: unknown): LecturaCruda {
  const obj = (raw ?? {}) as Record<string, unknown>
  const veredictoCrudo = String(obj.veredicto ?? '')
  const veredicto: VeredictoImagen = (VEREDICTOS as string[]).includes(veredictoCrudo)
    ? (veredictoCrudo as VeredictoImagen)
    : 'no_es_pantalla_de_precio'

  const camposCrudos = (obj.campos ?? {}) as Record<string, unknown>
  const campos: LecturaCruda['campos'] = {}
  for (const [slug, v] of Object.entries(camposCrudos)) {
    const f = (v ?? {}) as Record<string, unknown>
    campos[slug] = { value: textoOVacio(f.value), confidence: Number(f.confidence ?? 0) || 0 }
  }

  const desgloseCrudo = Array.isArray(obj.desglose) ? obj.desglose : []
  const desglose = desgloseCrudo.map(f => {
    const fila = (f ?? {}) as Record<string, unknown>
    return {
      concepto: recortar(textoOVacio(fila.concepto), MAX_CONCEPTO),
      cantidad: numeroONulo(fila.cantidad),
      unidad: recortar(soloLaCabeza(textoOVacio(fila.unidad)), MAX_UNIDAD),
      valor_unitario: numeroONulo(fila.valor_unitario),
      moneda: fila.moneda === null || fila.moneda === undefined ? null : String(fila.moneda).trim() || null,
      confidence: Number(fila.confidence ?? 0) || 0,
    }
  })
    // Una fila sin valor no es un costo: se descarta antes de que llegue a proponerse
    // como rubro en cero. R-P2 — cero es un precio, vacío es un hueco.
    .filter(f => f.valor_unitario !== null && f.valor_unitario > 0)

  const observacion = obj.observacion === null || obj.observacion === undefined
    ? null
    : String(obj.observacion).trim() || null

  return { veredicto, observacion, campos, desglose }
}

/**
 * El texto de un campo, o `null` si no se leyó.
 *
 * ⚠️ El `responseSchema` declara `value` como STRING, así que el modelo **no puede
 * devolver un JSON null**: devuelve la cadena `"null"`. Medido contra el modelo vivo
 * sobre el listado de vuelos — los quince campos volvieron con `"value": "null"`.
 * Ahí no mordió porque venían con confianza 0 y el umbral los descarta igual, pero un
 * campo que el modelo declare ausente CON confianza alta se guardaría como el texto
 * «null»: una aerolínea llamada «null» en la cotización que ve el cliente.
 *
 * Se descartan también `"none"` y `"n/a"` por el mismo motivo y con el mismo riesgo.
 */
function textoOVacio(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  if (t === '') return null
  return ['null', 'none', 'n/a', 'na', 'undefined'].includes(t.toLowerCase()) ? null : t
}

/**
 * Topes de longitud de los textos libres del desglose.
 *
 * ⚠️ Medido contra el modelo vivo: en una corrida del hotel, `unidad` volvió con
 * **un párrafo entero** — *«noche(s) (total 720,00 USD para 4 noches, no se incluye
 * como linea separada para evitar duplicidad de datos, …)»*. Eso entra tal cual a
 * `rubros.unidad`, que es una columna de texto sin tope, y se imprime en el desglose
 * de costo que alguien tiene que leer para confirmar.
 *
 * El modelo no siempre distingue el campo del comentario sobre el campo. El tope no
 * es cosmético: una tabla de costos ilegible es una tabla que nadie revisa.
 */
const MAX_CONCEPTO = 60
const MAX_UNIDAD = 24

/** Lo que va antes del primer paréntesis: la unidad, sin el comentario del modelo. */
function soloLaCabeza(t: string | null): string | null {
  if (t === null) return null
  const corte = t.indexOf('(')
  const cabeza = (corte > 0 ? t.slice(0, corte) : t).trim()
  return cabeza === '' ? null : cabeza
}

function recortar(t: string | null, max: number): string | null {
  if (t === null) return null
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

function numeroONulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── La llamada ───────────────────────────────────────────────────────────────

/**
 * Lee un pantallazo con el contrato de una ranura. Reintenta una vez ante fallo
 * transitorio, con la MISMA política que el extractor de documentos.
 *
 * `error` distinto de nulo con `data` nulo es RX6 para el llamador: la llamada no
 * terminó bien y no hay lectura que juzgar.
 */
export async function extraerRanuraDesdeImagen(
  buffer: Buffer,
  mimeType: string,
  ranura: DefinicionRanura,
  apiKey: string,
): Promise<ResultadoExtraccion<LecturaCruda>> {
  return extraerConReintento(
    () => unaLlamada(buffer, mimeType, ranura, apiKey),
    `ranura:${ranura.slug}`,
  )
}

async function unaLlamada(
  buffer: Buffer,
  mimeType: string,
  ranura: DefinicionRanura,
  apiKey: string,
): Promise<ResultadoExtraccion<LecturaCruda>> {
  if (!apiKey) return { data: null, error: 'GEMINI_API_KEY no configurada en el servidor' }

  const mime = MIMES_SOPORTADOS[mimeType.toLowerCase()]
  if (!mime) return { data: null, error: `Tipo de imagen no soportado: ${mimeType}` }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: construirPrompt(ranura) }] },
        contents: [{
          parts: [
            { text: 'Clasifica y lee la siguiente captura.' },
            { inline_data: { mime_type: mime, data: buffer.toString('base64') } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
          responseSchema: construirEsquema(ranura),
          thinkingConfig: { thinkingBudget: THINKING_BUDGET },
        },
      }),
    })

    if (!res.ok) {
      const cuerpo = await res.text()
      console.error(`[extraer-ranura] Gemini HTTP ${res.status} — ${cuerpo.slice(0, 400)}`)
      return { data: null, error: `Error de Gemini (${res.status})` }
    }

    const data = await res.json()

    const bloqueo = data.promptFeedback?.blockReason
    if (bloqueo) return { data: null, error: `Contenido bloqueado por Gemini: ${bloqueo}` }

    const candidato = data.candidates?.[0]
    const finishReason = candidato?.finishReason

    // R-P7. El motivo de terminación se verifica ANTES de mirar el texto: una respuesta
    // truncada por presupuesto puede traer JSON que parsea y valores a medias. Ahí el
    // fallo es mudo — se ve igual que una lectura buena.
    if (finishReason && finishReason !== 'STOP') {
      return {
        data: null,
        error: finishReason === 'MAX_TOKENS'
          ? 'La lectura se cortó por límite de tokens'
          : `La lectura terminó con motivo ${finishReason}`,
      }
    }

    const partes = candidato?.content?.parts ?? []
    const parteJson =
      partes.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text?.trim().startsWith('{'))
      ?? partes.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text)
    const texto: string = parteJson?.text ?? ''
    if (!texto) return { data: null, error: 'Gemini no devolvió respuesta' }

    let raw: unknown
    try {
      raw = JSON.parse(texto)
    } catch (e) {
      console.error('[extraer-ranura] JSON inválido:', texto.slice(0, 400))
      return { data: null, error: `JSON inválido de Gemini: ${String(e).slice(0, 80)}` }
    }

    return { data: normalizarRespuesta(raw) }
  } catch (err) {
    // Un corte por reloj se nombra: «error leyendo la captura» manda a revisar la
    // imagen, que está bien, y lo que pasó fue que el modelo se demoró.
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { data: null, error: 'La lectura tardó demasiado' }
    }
    console.error('[extraer-ranura] Excepción:', err)
    return { data: null, error: `Error leyendo la captura: ${String(err).slice(0, 120)}` }
  }
}
