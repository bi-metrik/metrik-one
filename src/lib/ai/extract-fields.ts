// ============================================================
// Generic AI Field Extractor - Haiku 5.5 por defecto; respaldo Gemini 3.5 Flash-Lite (thinking on)
// Extrae campos configurables de cualquier documento.
// Pattern: parse-ve-docs.ts (inline_data base64, structured output)
// ============================================================
//
// Modelo: los errores observados en SOENA (razón social vs nombre
// comercial, prefijo del número de factura, municipio sustituido por la
// capital, dirección truncada) son de JUICIO SEMÁNTICO, no de legibilidad.
// Se sube de flash-lite (thinking mínimo) a `gemini-2.5-flash` con thinking
// encendido a presupuesto acotado — el razonamiento es la palanca que
// distingue esos casos. A escala SOENA (~cientos de docs/mes) el costo es
// marginal. 2026-11-04: `gemini-2.5-flash` quedó obsoleto (desde el 2026-12-01
// Google lo enruta a `gemini-3.5-flash-lite`), así que el respaldo pide
// 3.5-flash-lite explícito. Familia 3.x → `thinkingLevel` (el `thinkingBudget`
// numérico es sintaxis de la 2.5). El camino por defecto es Haiku
// (`fetchModeloExtraccion`, esfuerzo `medium` fijo).
import { fetchModeloExtraccion } from '@/lib/ai/modelo-llm'
import { normalizarMontoExtraido } from './monto-extraido'
import { revisarLetrasLeidas } from '@/lib/texto/texto-latino'
import { serializarPersonas, type Persona } from '@/lib/documentos/personas'
import { textoDelPdf } from './texto-pdf'
import { verificarContraTexto, type VerificacionTexto } from './verificar-contra-texto'
import { motivoDesdeRespuestaModelo, type MotivoArchivo } from '@/lib/documentos/aviso-archivo'

const GEMINI_MODEL = 'gemini-3.5-flash-lite'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CampoExtraccion {
  slug: string
  label: string
  /**
   * `personas`: una LISTA de personas con nombre y documento (ej. los compradores de una
   * factura). El modelo la devuelve como arreglo y se guarda como texto en la forma
   * canónica de `@/lib/documentos/personas`, para que la pantalla la muestre y la
   * corrija igual que cualquier otro campo.
   */
  tipo: 'texto' | 'numero' | 'currency' | 'fecha' | 'boolean' | 'personas'
  required: boolean
  descripcion_ai: string  // le dice a Gemini qué buscar
  /** Si true, la UI muestra una alerta "Revisar" junto al campo: la IA no es
   *  100% confiable en este dato y debe validarse a mano (ej. ciudad de venta). */
  alerta_revision?: boolean
  /** Normalización determinista aplicada al valor extraído antes de persistir.
   *  - `nit_sin_dv`: deja el NIT base sin el dígito de verificación pegado
   *    (ej. "8600190638" → "860019063"). Lo que se keyea a la DIAN va sin DV;
   *    la Relación de facturas lo reformatea con guion al renderizar.
   *  - `dv_desde_nit`: ignora el DV que leyó la IA y lo RECALCULA por módulo 11
   *    DIAN a partir del NIT base (campo indicado en `normalizar_desde`, o `nit`
   *    por defecto). El DV es una función matemática del NIT, no debe confiarse a
   *    la lectura (Gemini lo lee inestable en las casillas 5/6 del RUT).
   *  - `divipola_desde_nombres`: ignora el código leído y lo RESUELVE del catálogo
   *    DIVIPOLA a partir de los NOMBRES ya extraídos (`pais`, `departamento`,
   *    `municipio`). El código es función del nombre, y el nombre se lee bien: el
   *    código no. Caso que lo motivó (V0263, 2026-08-25): el RUT devolvía
   *    `codigo_departamento = "169"`, que es el código de PAÍS. Si el nombre no
   *    resuelve en el catálogo se conserva el código leído. */
  normalizar?: 'nit_sin_dv' | 'dv_desde_nit' | 'divipola_desde_nombres'
  /** Para `dv_desde_nit`: slug del campo que contiene el NIT/cédula base desde el
   *  cual recalcular el DV. Default `nit`. */
  normalizar_desde?: string
  /**
   * El valor del campo lo calcula el CÓDIGO a partir de otros campos leídos (el modelo lee
   * lo impreso, el código hace la aritmética). Hoy solo `resta: [a, b]` = a − b, y solo
   * cuando b > 0: con b en 0 o vacío se deja lo que leyó el modelo. Caso que lo motivó
   * (SOE-041): la factura del vehículo, valor antes de descuento − descuento. Ver
   * `derivarCampos` en `@/lib/documentos/normalizaciones`.
   */
  derivar?: { resta: [string, string] }
  /**
   * Alerta de coherencia porcentual: el valor del campo dividido por alguna de las bases
   * (`de`) tiene que caer en algún `pct ± tolerancia`. Si no, el campo y la primera base
   * bajan a «Verificar». Solo alerta: no recalcula ni borra. Caso: IVA ↔ valor de la
   * factura (SOE-041). Ver `revisarCoherenciaPct`.
   */
  coherencia_pct?: { de: string[]; pct: number[]; tolerancia?: number }
}

/** Marca de edición manual (trazabilidad para auditoría): quién y cuándo tocó
 *  el campo a mano. Se estampa en `actualizarCampoDocumento`. */
export interface CampoEdicion {
  editado_por_id: string      // profile.id del editor
  editado_por_nombre: string  // snapshot del nombre para el render/auditoría
  editado_en: string          // ISO timestamp
}

export interface CampoResultado {
  value: string | null
  confidence: number  // 0.0 - 1.0
  manual: boolean     // true si confidence < 0.70
  edicion?: CampoEdicion  // presente solo si un humano editó el campo a mano
  /**
   * Lo que LEYÓ la IA cuando una normalización determinista lo reemplazó (hoy: el DV
   * del RUT, que se recalcula desde el NIT). Es el testigo: si el DV impreso no valida
   * con el NIT leído, uno de los dos está mal leído, y sin guardarlo esa evidencia se
   * perdía al recalcular. Ver `normalizarNitYDv` y `votos.ts`.
   */
  leido?: string
  /**
   * El valor lo calculó el código (`derivar` en la config del campo), no el modelo.
   * `leido` es lo que había devuelto el modelo para este mismo campo, como testigo.
   */
  derivado?: { formula: string; leido: string | null }
  /**
   * De dónde salió el valor cuando no es lo que leyó la IA. `texto_pdf`: la IA leyó otra
   * cosa (queda en `leido`) y se tomó el valor impreso en la capa de texto del PDF, que
   * estaba a una o dos confusiones de lectura. Ver `verificar-contra-texto.ts`.
   */
  origen?: 'texto_pdf'
  /**
   * Letras de otro alfabeto que quedaron en lo leído y no se pudieron convertir con seguridad
   * (la IA escribió «МЕЛА» por «MEJIA», V0167). El campo va a revisión (`manual`) con el valor
   * a la vista para que la persona lo corrija. Ver `src/lib/texto/texto-latino.ts`.
   */
  letras_no_validas?: string[]
}

// ── Supported MIME types ─────────────────────────────────────────────────────

const SUPPORTED_MIMES: Record<string, string> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
}

// ── JSON repair (copied from parse-ve-docs.ts) ──────────────────────────────

function repairJson(text: string): string {
  let s = text
    .replace(/^\uFEFF/, '')                       // BOM
    .replace(/^```(?:json)?\s*/i, '')             // opening fence
    .replace(/\s*```\s*$/, '')                    // closing fence
    .trim()

  const braceStart = s.indexOf('{')
  const braceEnd = s.lastIndexOf('}')
  if (braceStart >= 0 && braceEnd > braceStart) {
    s = s.slice(braceStart, braceEnd + 1)
  }

  s = s.replace(/\bNone\b/g, 'null')
  s = s.replace(/\bTrue\b/g, '"true"')
  s = s.replace(/\bFalse\b/g, '"false"')

  s = s.replace(/("(?:[^"\\]|\\.)*")/g, (match) =>
    match.replace(/\r?\n/g, ' ').replace(/\t/g, ' ')
  )

  s = s.replace(/,\s*([}\]])/g, '$1')

  return s
}

/**
 * El valor sin espacios, o null si viene vacío o es texto de relleno. Haiku 5.5, con la salida estructurada que exige
 * un texto, devolvía la palabra «null» para lo que no encontraba (SOE-038).
 */
export function sinRelleno(v: string): string | null {
  const t = v.trim()
  return !t || /^(null|none|n\/?a|undefined)$/i.test(t) ? null : t
}

// ── Build dynamic prompt ─────────────────────────────────────────────────────

function buildPrompt(campos: CampoExtraccion[]): string {
  const fieldList = campos
    .map((c, i) => `${i + 1}. ${c.slug} (${c.label}): ${c.descripcion_ai}`)
    .join('\n')

  return `Eres un extractor de datos de documentos.

Tu trabajo: recibir un documento y extraer campos específicos en JSON.

CAMPOS A EXTRAER:

${fieldList}

REGLAS:
- Responde SOLO con JSON válido, sin texto adicional
- Para cada campo devuelve { "value": <valor>, "confidence": <0.0 a 1.0> }
- Si un campo no está en el documento, usa { "value": null, "confidence": 0.0 }
- NO dejes en null un campo que SÍ aparece en el documento. Búscalo en todo el documento (encabezado, pie, tablas, sellos, otra página) y aunque la etiqueta no sea exactamente la del campo (ej. "Fecha de expedición" puede venir como "Expedido el", "Fecha de emisión" o junto al lugar de expedición). Si se lee con dificultad, devuélvelo con confidence baja; null es solo para lo que de verdad no está
- confidence refleja certeza de lectura (1.0 = perfectamente legible, 0.5 = borroso pero probable, 0.0 = no visible). Es un número con DOS decimales como máximo (0.95, nunca 0.9533…)
- Un valor con confidence menor a 0.70 se DESCARTA y una persona lo tiene que digitar a mano. Si el campo pide elegir o deducir siguiendo sus instrucciones (qué ciudad, qué línea, qué valor descontar) y encontraste la evidencia que piden, eso es certeza alta (0.85 o más), aunque el documento muestre también otras ciudades u otros valores. Si tienes un valor probable pero dudas, devuélvelo con 0.70 a 0.85 para que la persona lo revise; deja vacío solo lo que de verdad no está o no se puede leer
- "value" nunca es la palabra "null", "N/A" ni un texto de relleno: si no hay dato, value es null
- Limpia valores: sin espacios al inicio/final
- NIT: devuélvelo SIN el dígito de verificación (DV), salvo que el campo diga explícitamente "completo" o "con DV". El DV es el dígito que va después del guion ("860.047.657-1" → "860047657") o el que la DIAN pone aparte en su propia casilla; si el documento lo muestra pegado al final sin guion, igual quítalo. Cuando el DV tiene su propia casilla junto a la del NIT (el RUT: casillas 5 y 6), los dígitos se ven seguidos: el NIT termina en la última casilla ANTES de la del DV, y ese dígito NO va ni en el NIT ni en el número de identificación de la misma persona. La cédula de una persona natural no tiene DV: va completa
- Números de identificación de personas o empresas (NIT, cédula): solo dígitos, sin puntos, guiones ni espacios. NO apliques esta regla a números de factura, radicados u otros códigos que legítimamente incluyen un prefijo o serie con letras: esos se devuelven COMPLETOS, con su prefijo y tal como aparecen (ej. si el documento muestra "FVM 3903", devuelve "FVM 3903", NUNCA solo "3903")
- MONEDA COLOMBIANA (campos tipo currency): los valores monetarios están en pesos colombianos (COP). El separador de miles es el punto (.) y el separador decimal es la coma (,). Ejemplo: $1.500.000 = un millón quinientos mil. Devuelve SOLO el valor numérico entero sin puntos, comas ni símbolo $. Ejemplo: si ves "$1.500.000" o "1.500.000,00", devuelve "1500000"
- Campos tipo numero (no currency): devuelve el número tal cual, sin formato de moneda
- Campos tipo personas: "value" es una LISTA de objetos { "nombre": ..., "documento": ... }, una entrada por persona, en el orden en que aparecen. El documento va solo con dígitos. Si no hay ninguna persona, devuelve la lista vacía []

FORMATO DE RESPUESTA (JSON con los slugs como keys):
{
${campos.map(c => c.tipo === 'personas'
    ? `  "${c.slug}": { "value": [{ "nombre": "...", "documento": "..." }], "confidence": 0.95 }`
    : `  "${c.slug}": { "value": "...", "confidence": 0.95 }`).join(',\n')}
}`
}

// ── Verificación contra la capa de texto ─────────────────────────────────────

/**
 * Pasa lo leído por `verificarContraTexto` si el PDF trae capa de texto. Exportada para
 * probarla sin Gemini; nunca lanza (sin texto legible no hace nada).
 */
export async function verificarConCapaDeTexto(
  buffer: Buffer,
  campos: CampoExtraccion[],
  result: Record<string, CampoResultado>,
): Promise<VerificacionTexto[]> {
  const texto = await textoDelPdf(buffer)
  if (!texto) return []
  const verificaciones = verificarContraTexto(campos, result, texto)
  for (const v of verificaciones) {
    if (v.estado === 'corregido') {
      console.warn(`[extract-fields] ${v.slug}: la IA leyó "${v.leido}", el texto del PDF dice "${v.valor}"`)
    }
  }
  return verificaciones
}

// ── Main extractor ───────────────────────────────────────────────────────────

/**
 * Extract configurable fields from a document using Gemini 2.5 Flash.
 *
 * IMPORTANT: apiKey must be passed from the server action caller
 * (process.env is not reliably available in library files on Vercel).
 */
export async function extractFieldsFromDocument(
  buffer: Buffer,
  mimeType: string,
  campos: CampoExtraccion[],
  apiKey: string,
): Promise<{ data: Record<string, CampoResultado> | null; error?: string; archivo?: MotivoArchivo }> {
  if (!apiKey) {
    return { data: null, error: 'GEMINI_API_KEY no configurada en el servidor' }
  }

  if (campos.length === 0) {
    return { data: null, error: 'No se proporcionaron campos para extraer' }
  }

  const normalizedMime = SUPPORTED_MIMES[mimeType.toLowerCase()]
  if (!normalizedMime) {
    return { data: null, error: `Tipo MIME no soportado: ${mimeType}`, archivo: 'formato' }
  }

  const base64 = buffer.toString('base64')
  const systemPrompt = buildPrompt(campos)

  // Forzar JSON estructurado válido vía responseSchema (evita que Gemini devuelva
  // JSON malformado — comas faltantes, comillas sin escapar, etc. que rompían el parser).
  const responseSchema = {
    type: 'OBJECT',
    properties: Object.fromEntries(campos.map(c => [c.slug, {
      type: 'OBJECT',
      properties: {
        value: c.tipo === 'personas'
          ? {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { nombre: { type: 'STRING' }, documento: { type: 'STRING' } },
                required: ['nombre', 'documento'],
              },
            }
          : { type: 'STRING' },
        confidence: { type: 'NUMBER' },
      },
      required: ['value', 'confidence'],
    }])),
    required: campos.map(c => c.slug),
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  let debugRaw = ''
  try {
    const res = await fetchModeloExtraccion(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            parts: [
              { text: 'Extrae los datos del siguiente documento.' },
              { inline_data: { mime_type: normalizedMime, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          // Thinking ENCENDIDO a presupuesto acotado (1024) para el juicio
          // semántico de la extracción (razón social vs comercial, prefijo de
          // factura, municipio correcto). El thinking consume maxOutputTokens
          // aparte del JSON; por eso el límite se sube a 8192 (thinking ~1024 +
          // JSON del RUT de 20+ campos) para no reincidir en el MAX_TOKENS que
          // truncaba la respuesta cuando el presupuesto era compartido.
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error(`[extract-fields] Gemini HTTP error: ${res.status} — ${errBody.slice(0, 500)}`)
      // Un PDF sin páginas o dañado no es una falla del modelo: lo dice el `archivo`, y la pantalla
      // pide reemplazarlo en vez de reintentar (ver `@/lib/documentos/aviso-archivo`).
      const archivo = motivoDesdeRespuestaModelo(res.status, errBody)
      return { data: null, error: `Error de Gemini (${res.status})`, ...(archivo ? { archivo } : {}) }
    }

    const data = await res.json()

    const blockReason = data.promptFeedback?.blockReason
    if (blockReason) {
      return { data: null, error: `Contenido bloqueado por Gemini: ${blockReason}` }
    }

    const candidate = data.candidates?.[0]
    const finishReason = candidate?.finishReason
    const parts = candidate?.content?.parts || []
    // Preferir la parte de texto que parezca JSON (empieza con '{'); evita caer en
    // una parte de "thought"/prosa si el modelo emitiera ambas.
    const jsonPart =
      parts.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text?.trim().startsWith('{'))
      || parts.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text)
      || parts[parts.length - 1]

    debugRaw = jsonPart?.text || ''
    if (!debugRaw) {
      return {
        data: null,
        error: finishReason === 'MAX_TOKENS'
          ? 'Gemini agotó el límite de tokens sin devolver JSON (documento muy grande)'
          : 'Gemini no devolvió respuesta',
      }
    }

    // Parse JSON with repair fallback
    let raw: Record<string, { value: unknown; confidence: number }>
    try {
      raw = JSON.parse(debugRaw)
    } catch {
      console.warn('[extract-fields] Direct parse failed, attempting repair...')
      const repaired = repairJson(debugRaw)
      try {
        raw = JSON.parse(repaired)
      } catch (e2) {
        console.error('[extract-fields] Repair also failed. Raw:', debugRaw.slice(0, 600))
        throw new Error(`JSON inválido de Gemini: ${String(e2).slice(0, 80)}`)
      }
    }

    // Build result with confidence tiers
    const result: Record<string, CampoResultado> = {}
    for (const campo of campos) {
      const field = raw[campo.slug]
      if (!field || field.value === undefined) {
        result[campo.slug] = { value: null, confidence: 0, manual: true }
        continue
      }

      // Una lista de personas se guarda como texto canónico (ver `personas.ts`). Si el
      // modelo igual devolvió texto, se respeta tal cual: la lectura es tolerante.
      let value = campo.tipo === 'personas' && Array.isArray(field.value)
        ? serializarPersonas(field.value as Array<Partial<Persona>>) || null
        : field.value !== null ? sinRelleno(String(field.value)) : null
      const confidence = field.confidence ?? 0

      // Campos currency: pesos enteros como texto. La regla (y por qué los miles con
      // coma se leen como miles) vive en `normalizarMontoExtraido`.
      if (value && campo.tipo === 'currency') {
        value = normalizarMontoExtraido(value)
      }

      // Letras de otro alfabeto (la IA leyó «В» cirílica por «B», V0121): los dobles exactos se
      // convierten; si queda alguna que no se puede convertir, el campo va a revisión con el
      // valor a la vista. Así el error aparece en el cargue y no al generar el formulario.
      const letras = value ? revisarLetrasLeidas(value) : null
      if (letras) value = letras.valor

      // Confidence < 0.70 → manual required, value forced to null
      if (confidence < 0.70) {
        result[campo.slug] = { value: null, confidence, manual: true }
      } else if (letras && letras.noValidas.length > 0) {
        result[campo.slug] = { value, confidence, manual: true, letras_no_validas: letras.noValidas }
      } else {
        result[campo.slug] = { value, confidence, manual: false }
      }
    }

    // Lo leído contra la capa de texto del PDF (si la trae): la IA confunde «rn» con
    // «m» mirando la imagen, el texto no. Un escaneo no trae capa y no cambia nada.
    if (normalizedMime === 'application/pdf') {
      await verificarConCapaDeTexto(buffer, campos, result)
    }

    return { data: result }
  } catch (err) {
    console.error('[extract-fields] Exception:', err, '\n[extract-fields] Raw:', debugRaw.slice(0, 800))
    return { data: null, error: `Error procesando documento: ${String(err).slice(0, 120)}` }
  }
}
