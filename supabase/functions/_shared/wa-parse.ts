// ============================================================
// Gemini — NLP Parser (MVP — 8 intents)
// ============================================================

import type { ParseResult, Intent, LastContext } from './types.ts';
import { CONFIDENCE_THRESHOLD, enrichFields, fastPathParse, regexParse } from './wa-parse-reglas.ts';

// Default to Flash-Lite — 3x cheaper input, 6.25x cheaper output.
// Override baseline with GEMINI_PARSE_MODEL for instant rollback.
const GEMINI_MODEL = Deno.env.get('GEMINI_PARSE_MODEL') || 'gemini-2.5-flash-lite';

// El umbral vive en el modulo puro (lo importan los handlers, que asi se pueden
// probar); aqui se re-exporta para no romper a quien lo lea de este modulo.
export { CONFIDENCE_THRESHOLD };

// Compact master prompt — MVP: 4 intents core + 3 consultas + 2 utilitarios = 8 total.
// Lenguaje oficial: "negocio" (unidad de trabajo). Etapas: venta→ejecución→cobro→cierre.
const SYSTEM_PROMPT = `Parser WA colombiano → JSON (schema).

Negocio = unidad de trabajo, atraviesa venta→ejecución→cobro→cierre.

INTENTS:
- GASTO: pagué/gasté/compré + monto. Devolver: amount, descripcion, concept, project_code o entity_hint si menciona negocio/empresa.
- CONTACTO_NUEVO: registrar persona/empresa nueva. Devolver: name, phone si presente.
- ACTIVIDAD: cualquier texto que describe un hecho/observación sobre un negocio (llamada, reunión, visita, correo, nota, comentario). Devolver: activity_text, project_code o entity_hint.
- MIS_NUMEROS: "cómo voy", "resumen del mes", "mis números".
- CARTERA: "quién me debe", "por cobrar", "cartera".
- ESTADO_NEGOCIOS: "qué negocios tengo", con stage_filter venta|ejecucion|cobro|all.
- AYUDA: saludos, ?, menu, "ayuda".
- UNCLEAR: si confidence<0.7 → UNCLEAR + suggested_actions (2-3 labels ≤20 chars).

CAMPOS:
- amount: entero en COP. "1 palo"=1000000, "2 palos"=2000000, "medio palo"=500000, "500 lucas"=500000, "180 mil"=180000
- descripcion: TODO lo que el usuario dijo sobre el gasto, con sus palabras y completo: proveedor, qué se compró, cantidades, referencias, medidas, para qué fue. Quitar SOLO el monto, el código del negocio y la orden de registro ("registrar gasto", "gasto de", "pagué", "gasté", "compré"). No resumir, no recortar, no traducir, no inventar. Si el mensaje solo trae el monto (o "registrar gasto"), descripcion vacía. El proveedor o tienda SIEMPRE se conserva. Ej: "Gasto en MUNDIAL DE TORNILLOS por valor de 1.241.769 CHAZOS 3/8 correspondiente al proyecto B1 26 2" → "MUNDIAL DE TORNILLOS, CHAZOS 3/8"; "14400 para impresión de documentos para abrir la cuenta en bancolombia" → "impresión de documentos para abrir la cuenta en bancolombia"; "18900" → "".
- concept: etiqueta corta de 2-5 palabras para mostrar en el chat (sin verbos ni montos)
- project_code: código literal ("R1 26 1" o "KAE-2") — prioridad sobre entity_hint
- entity_hint: cliente/empresa del negocio
- stage_filter: venta|ejecucion|cobro|all (para ESTADO_NEGOCIOS)
- activity_text: texto descriptivo del hecho registrado
- name, phone: para CONTACTO_NUEVO
- suggested_actions: para UNCLEAR

REGLAS:
1. Si hay monto numérico → GASTO siempre (sin importar otras pistas).
2. ESTADO_NEGOCIOS: "qué negocios activos/abiertos/tengo" → stage_filter=all; "en venta/pipeline/horno" → venta; "en ejecución/haciendo" → ejecucion; "en cobro/por cobrar" → cobro.
3. confidence<0.7 → UNCLEAR + suggested_actions: 2-3 labels ≤20 chars.`;

// Response schema for Gemini structured output (JSON Schema subset)
const INTENT_ENUM: Intent[] = [
  'GASTO',
  'CONTACTO_NUEVO',
  'ACTIVIDAD',
  'MIS_NUMEROS',
  'CARTERA',
  'ESTADO_NEGOCIOS',
  'AYUDA',
  'UNCLEAR',
];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENT_ENUM },
    confidence: { type: 'number' },
    fields: {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        descripcion: { type: 'string' },
        concept: { type: 'string' },
        category_hint: { type: 'string' },
        entity_hint: { type: 'string' },
        project_code: { type: 'string' },
        stage_filter: { type: 'string' },
        activity_text: { type: 'string' },
        name: { type: 'string' },
        phone: { type: 'string' },
        suggested_actions: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['intent', 'confidence', 'fields'],
};

// Track last Gemini failure reason for debugging
let _lastGeminiFail = '';

// Telemetry captured on every parseMessage call.
// Consumed by wa-webhook to persist into wa_message_log.
export interface ParseTelemetry {
  parser_source: 'fast_path' | 'gemini' | 'regex';
  gemini_model?: string;
  gemini_input_tokens?: number;
  gemini_output_tokens?: number;
  gemini_latency_ms?: number;
  confidence: number;
}

let _lastTelemetry: ParseTelemetry = { parser_source: 'regex', confidence: 0 };

export function getLastParseTelemetry(): ParseTelemetry {
  return _lastTelemetry;
}

export async function parseMessage(
  userMessage: string,
  _bucketKey?: string,
  lastContext?: LastContext | null,
): Promise<ParseResult> {
  // 1. Fast path: deterministic patterns that skip LLM entirely
  const fast = fastPathParse(userMessage);
  if (fast) {
    console.log(`[wa-parse] Fast-path hit: ${fast.intent} (${fast.confidence})`);
    _lastTelemetry = { parser_source: 'fast_path', confidence: fast.confidence };
    return enrichFields(fast, userMessage);
  }

  // 2. Gemini NLP parser (with optional conversational context hint)
  const geminiResult = await tryGemini(userMessage, GEMINI_MODEL, lastContext);
  if (geminiResult) return enrichFields(geminiResult, userMessage);

  // 3. Fallback: regex parser for common patterns when LLM fails
  console.log('[wa-parse] Using regex fallback, reason:', _lastGeminiFail);
  const regexResult = regexParse(userMessage);
  _lastTelemetry = { parser_source: 'regex', confidence: regexResult.confidence };
  return enrichFields(regexResult, userMessage);
}

/**
 * Detect anaphoric signals in user text (pronouns, ordinals, "el mismo", etc.)
 * Only when these appear AND there is a recent last_context do we inject the
 * context hint into Gemini's system prompt. Keeps token cost low.
 */
function hasAnaphoricSignal(text: string): boolean {
  const padded = ` ${text.toLowerCase()} `;
  const patterns = [
    /(^|[\s,.;:!?¿¡])(ese|esa|eso|esos|esas|aquel|aquella|aquellos|aquellas)([\s,.;:!?¿¡]|$)/,
    /(^|[\s,.;:!?¿¡])(ah[ií]|all[ií]|all[aá]|aca|acá)([\s,.;:!?¿¡]|$)/,
    /(el|la|los|las)\s+mism[oa]s?/,
    /(el|la)\s+(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa]|[uú]ltim[oa])/,
    /(el|la|los|las)\s+que(\s|$)/,
    /(en|de|para|a|con)\s+(ese|esa|eso|esos|esas|aquel|aquella)/,
    /(ese|esa|ese\s+mismo)\s+(negocio|proyecto|cliente|gasto|contacto)/,
  ];
  return patterns.some((re) => re.test(padded));
}

/** Build a compact context hint for Gemini — directive rules + few-shot examples. */
function buildContextHint(lastContext: LastContext): string {
  const items = lastContext.items.slice(0, 5);
  const list = items.map((n, i) => {
    const cod = n.codigo ? ` [${n.codigo}]` : '';
    return `  ${i + 1}. ${n.nombre}${cod}`;
  }).join('\n');

  const firstCode = items[0]?.codigo || '';

  const examples = `EJEMPLOS (con este contexto):
- "gasté 50 mil en el primero" → intent=GASTO, amount=50000, project_code="${firstCode}"
- "pagué 200 mil ahí" → intent=GASTO, amount=200000, project_code="${firstCode}"
- "llamé a ese cliente" → intent=ACTIVIDAD, project_code="${firstCode}"`;

  return `

CONTEXTO PREVIO DE LA CONVERSACIÓN (${lastContext.type}, hace <5 min):
${list}

REGLAS DE RESOLUCIÓN DE ANÁFORA (obligatorio):
1. Si el mensaje contiene "el primero/segundo/tercero/último/ese/esa/ahí/allí/ese negocio/el mismo", DEBES reemplazar la referencia con el project_code del item correspondiente.
2. Ordinales → índice 1-based.
3. "ese/esa/ahí/allí" sin ordinal → si solo hay 1 item usa ese; si hay varios usa el item 1 (el más reciente).

${examples}`;
}

// ============================================================
// Gemini NLP Parser
// ============================================================

async function tryGemini(
  userMessage: string,
  model: string,
  lastContext?: LastContext | null,
): Promise<ParseResult | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) { _lastGeminiFail = 'no_api_key'; return null; }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const t0 = Date.now();

  const shouldInjectContext = lastContext && lastContext.items.length > 0 && hasAnaphoricSignal(userMessage);
  const systemPrompt = shouldInjectContext
    ? SYSTEM_PROMPT + buildContextHint(lastContext!)
    : SYSTEM_PROMPT;
  if (shouldInjectContext) {
    console.log(`[wa-parse] Context hint injected (${lastContext!.items.length} items, type=${lastContext!.type})`);
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
          { role: 'user', parts: [{ text: userMessage }] },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      _lastGeminiFail = `http_${res.status}: ${errBody.slice(0, 500)}`;
      console.error(`[wa-parse] Gemini error: ${res.status} — ${errBody.slice(0, 300)}`);
      return null;
    }

    const data = await res.json();
    const latencyMs = Date.now() - t0;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      _lastGeminiFail = `no_text: finish=${data.candidates?.[0]?.finishReason || 'unknown'}`;
      return null;
    }

    const parsed: ParseResult = JSON.parse(text);
    _lastGeminiFail = '';

    _lastTelemetry = {
      parser_source: 'gemini',
      gemini_model: model,
      gemini_input_tokens: data.usageMetadata?.promptTokenCount,
      gemini_output_tokens: data.usageMetadata?.candidatesTokenCount,
      gemini_latency_ms: latencyMs,
      confidence: parsed.confidence,
    };

    if (parsed.confidence < CONFIDENCE_THRESHOLD) {
      return {
        ...parsed,
        intent: 'UNCLEAR',
        fields: {
          ...parsed.fields,
          suggested_actions: parsed.fields.suggested_actions || [],
        },
      };
    }
    return parsed;
  } catch (err) {
    _lastGeminiFail = `exception: ${String(err).slice(0, 100)}`;
    console.error('[wa-parse] Gemini exception:', err);
    return null;
  }
}

