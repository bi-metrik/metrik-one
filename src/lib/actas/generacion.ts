// ============================================================
// Actas — generacion del acta con LLM
//
// Toma el cuerpo ya recortado de la transcripcion (candidata.transcripcion.cuerpo,
// ver alcance.ts para el recorte del preludio) y produce un acta formal: resumen,
// decisiones y compromisos agrupados por responsable.
//
// Modelo y patron copiados de src/lib/ai/extract-fields.ts: gemini-2.5-flash con
// thinking encendido a presupuesto acotado (1024) + responseSchema para forzar
// JSON valido — un prompt de texto libre no es confiable para esto (ver el
// gotcha de CLAUDE.md: "Auto-extraccion AI con reintento... responseSchema
// fuerza JSON valido en Gemini... elimina 'JSON invalido de Gemini'").
//
// IMPORTANTE (mismo criterio que extract-fields.ts): apiKey se recibe por
// parametro desde el caller (server action / route), nunca se lee
// process.env aqui — no esta garantizado disponible en libs en Vercel.
//
// Server-only.
// ============================================================

import type { CandidataActa } from './seleccion'

const GEMINI_MODEL = 'gemini-2.5-flash'

export interface CompromisoActa {
  responsable: string
  tarea: string
  fecha_limite: string | null
}

export interface ActaGenerada {
  resumen: string
  decisiones: string[]
  compromisos: CompromisoActa[]
}

interface RespuestaGemini {
  resumen: string
  decisiones: string[]
  compromisos: { responsable: string; tarea: string; fecha_limite: string | null }[]
}

function repairJson(text: string): string {
  let s = text
    .replace(/^﻿/, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()

  const braceStart = s.indexOf('{')
  const braceEnd = s.lastIndexOf('}')
  if (braceStart >= 0 && braceEnd > braceStart) {
    s = s.slice(braceStart, braceEnd + 1)
  }

  s = s.replace(/,\s*([}\]])/g, '$1')
  return s
}

function buildPrompt(asistentes: string[]): string {
  return `Eres un asistente que redacta actas formales de reuniones de trabajo para MéTRIK.

Recibirás la transcripción completa de una reunión (formato "Hablante: texto", sin marcas de tiempo dentro del cuerpo). Los asistentes conocidos son: ${asistentes.join(', ') || '(no se identificaron nombres)'}.

Tu trabajo es producir:

1. "resumen": un resumen de 3 a 5 líneas de qué se trató la reunión y a qué se llegó. Sin relleno, sin repetir el título.
2. "decisiones": lista de decisiones que se tomaron durante la reunión (frases cortas, una por decisión). Solo decisiones REALES y explícitas — no incluyas cosas que se mencionaron pero no se decidieron.
3. "compromisos": lista de tareas concretas que alguien se comprometió a hacer, AGRUPADAS implícitamente por quién quedó de hacerlas (cada item lleva su responsable). Para cada compromiso:
   - "responsable": el nombre de la persona que quedó de hacer la tarea (usa el nombre tal como aparece en la transcripción, no inventes apellidos)
   - "tarea": qué quedó de hacer, en una frase clara y accionable
   - "fecha_limite": la fecha o plazo mencionado (ej. "viernes", "2026-08-30", "antes de la próxima reunión"), o null si no se mencionó ninguna fecha

REGLAS:
- No inventes decisiones ni compromisos que no estén en el texto. Si no hubo compromisos concretos, "compromisos" puede quedar vacío.
- No incluyas charla informal, temas personales o menciones de terceros ajenos a la reunión.
- Responde SOLO con JSON válido, sin texto adicional, siguiendo exactamente el esquema pedido.`
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    resumen: { type: 'STRING' },
    decisiones: { type: 'ARRAY', items: { type: 'STRING' } },
    compromisos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          responsable: { type: 'STRING' },
          tarea: { type: 'STRING' },
          fecha_limite: { type: 'STRING', nullable: true },
        },
        required: ['responsable', 'tarea'],
      },
    },
  },
  required: ['resumen', 'decisiones', 'compromisos'],
}

/**
 * Genera el acta a partir de la transcripcion de una candidata ya evaluada
 * por seleccionarDelDia/evaluarReunion. Lanza si Gemini no responde JSON
 * valido o si la API rechaza la llamada — el cron atrapa el error por
 * candidata, esto no decide como se recupera.
 */
export async function generarActa(
  candidata: CandidataActa,
  apiKey: string,
): Promise<ActaGenerada> {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no configurada en el servidor')
  }

  const cuerpo = candidata.transcripcion.cuerpo
  if (!cuerpo.trim()) {
    throw new Error('La transcripcion no tiene cuerpo para generar el acta')
  }

  const systemPrompt = buildPrompt(candidata.transcripcion.asistentes)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: cuerpo }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 1024 },
      },
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Error de Gemini (${res.status}): ${errBody.slice(0, 300)}`)
  }

  const data = await res.json()

  const blockReason = data.promptFeedback?.blockReason
  if (blockReason) {
    throw new Error(`Contenido bloqueado por Gemini: ${blockReason}`)
  }

  const candidate = data.candidates?.[0]
  const finishReason = candidate?.finishReason
  const parts = candidate?.content?.parts || []
  const jsonPart =
    parts.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text?.trim().startsWith('{')) ||
    parts.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text) ||
    parts[parts.length - 1]

  const raw: string = jsonPart?.text || ''
  if (!raw) {
    throw new Error(
      finishReason === 'MAX_TOKENS'
        ? 'Gemini agoto el limite de tokens sin devolver JSON (reunion muy larga)'
        : 'Gemini no devolvio respuesta',
    )
  }

  let parsed: RespuestaGemini
  try {
    parsed = JSON.parse(raw)
  } catch {
    try {
      parsed = JSON.parse(repairJson(raw))
    } catch (e2) {
      throw new Error(`JSON invalido de Gemini: ${String(e2).slice(0, 120)}`)
    }
  }

  return {
    resumen: (parsed.resumen ?? '').trim(),
    decisiones: Array.isArray(parsed.decisiones) ? parsed.decisiones.filter(Boolean) : [],
    compromisos: Array.isArray(parsed.compromisos)
      ? parsed.compromisos
          .filter((c) => c && c.responsable && c.tarea)
          .map((c) => ({
            responsable: String(c.responsable).trim(),
            tarea: String(c.tarea).trim(),
            fecha_limite: c.fecha_limite ? String(c.fecha_limite).trim() : null,
          }))
      : [],
  }
}
