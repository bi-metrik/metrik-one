// ============================================================
// Gemini — NLP Parser (MVP — 8 intents)
// ============================================================

import type { ParseResult, Intent, LastContext } from './types.ts';

// Default to Flash-Lite — 3x cheaper input, 6.25x cheaper output.
// Override baseline with GEMINI_PARSE_MODEL for instant rollback.
const GEMINI_MODEL = Deno.env.get('GEMINI_PARSE_MODEL') || 'gemini-2.5-flash-lite';

// Unified confidence threshold (Vera mantuvo 0.7 — NO bajar)
export const CONFIDENCE_THRESHOLD = 0.7;

// Compact master prompt — MVP: 4 intents core + 3 consultas + 2 utilitarios = 8 total.
// Lenguaje oficial: "negocio" (unidad de trabajo). Etapas: venta→ejecución→cobro→cierre.
const SYSTEM_PROMPT = `Parser WA colombiano → JSON (schema).

Negocio = unidad de trabajo, atraviesa venta→ejecución→cobro→cierre.

INTENTS:
- GASTO: pagué/gasté/compré + monto. Devolver: amount, concept, project_code o entity_hint si menciona negocio/empresa.
- CONTACTO_NUEVO: registrar persona/empresa nueva. Devolver: name, phone si presente.
- ACTIVIDAD: cualquier texto que describe un hecho/observación sobre un negocio (llamada, reunión, visita, correo, nota, comentario). Devolver: activity_text, project_code o entity_hint.
- MIS_NUMEROS: "cómo voy", "resumen del mes", "mis números".
- CARTERA: "quién me debe", "por cobrar", "cartera".
- ESTADO_NEGOCIOS: "qué negocios tengo", con stage_filter venta|ejecucion|cobro|all.
- AYUDA: saludos, ?, menu, "ayuda".
- UNCLEAR: si confidence<0.7 → UNCLEAR + suggested_actions (2-3 labels ≤20 chars).

CAMPOS:
- amount: entero en COP. "1 palo"=1000000, "2 palos"=2000000, "medio palo"=500000, "500 lucas"=500000, "180 mil"=180000
- concept: 2-5 palabras, sin verbos ni montos
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

/**
 * Defense layer chain: inject project_code, amount fallback, and category_hint
 * from the raw message when the parser missed them.
 */
function enrichFields(result: ParseResult, rawMessage: string): ParseResult {
  let enriched = injectProjectCode(result, rawMessage);
  enriched = injectAmount(enriched, rawMessage);
  enriched = injectCategoryHint(enriched, rawMessage);
  return enriched;
}

/** Fill amount from raw text if parser returned none */
function injectAmount(result: ParseResult, rawMessage: string): ParseResult {
  if (result.fields.amount !== undefined && result.fields.amount !== null) return result;
  const amount = parseAmount(rawMessage);
  if (amount == null) return result;
  return { ...result, fields: { ...result.fields, amount } };
}

/** Keyword → category mapping. Only fires on GASTO intent when category_hint is missing. */
const CATEGORY_KEYWORDS: Array<[RegExp, string]> = [
  [/\b(gasolina|combustible|transporte|taxi|uber|didi|bus|pasaje|peaje|parquead)/i, 'transporte'],
  [/\b(almuerzo|cena|desayuno|tintos?|domicilios?|comida|alimentaci[oó]n|restaurante|mercado)/i, 'alimentacion'],
  [/\b(cemento|materiales?|herramientas?|insumos?|ferreter[ií]a|pintura|madera|arena|ladrillos?)/i, 'materiales'],
  [/\b(software|licencias?|suscripci[oó]n|saas|hosting|dominio|cloud)/i, 'software'],
  [/\barriendo\b/i, 'arriendo'],
  [/\b(internet|celular|luz|agua|servicios|n[oó]mina|tel[eé]fono)\b/i, 'servicios_profesionales'],
  [/\b(honorarios|arquitecto|abogado|contador|consultor[ií]a|asesor[ií]a)\b/i, 'servicios_profesionales'],
  [/\b(marketing|publicidad|ads|anuncios?|campa[ñn]a)\b/i, 'marketing'],
  [/\b(capacitaci[oó]n|curso|entrenamiento|taller|formaci[oó]n)\b/i, 'capacitacion'],
  [/\b(papeler[ií]a|[uú]tiles|oficina)\b/i, 'otros'],
];

/** Infer category_hint from keywords in raw text when the parser left it empty. */
function injectCategoryHint(result: ParseResult, rawMessage: string): ParseResult {
  if (result.fields.category_hint) return result;
  if (result.intent !== 'GASTO') return result;
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(rawMessage)) {
      return { ...result, fields: { ...result.fields, category_hint: cat } };
    }
  }
  return result;
}

/**
 * Defense layer: detect project/negocio codes in the raw message and inject
 * them into fields.project_code even if Gemini/regex missed them.
 */
function injectProjectCode(result: ParseResult, rawMessage: string): ParseResult {
  if (result.fields.project_code) return result;
  const msg = rawMessage;

  // Legacy alphanumeric: KAE-2, FAB-1, INT-3
  let m = msg.match(/\b([A-Za-z]{2,4}-\d{1,3})\b/);
  if (m) {
    return { ...result, fields: { ...result.fields, project_code: m[1].toUpperCase() } };
  }

  // Legacy numeric project: P-12, P12, #12, proyecto 12
  m = msg.match(/(?:\bP-?|#)(\d{1,4})\b/i) || msg.match(/\b(?:proyecto|proy)\s+(\d{1,4})\b/i);
  if (m) {
    return { ...result, fields: { ...result.fields, project_code: `P-${m[1].padStart(3, '0')}` } };
  }

  // Negocio spaced: "R1 26 1"
  m = msg.match(/\b([A-Za-z]\d+)\s+(\d{2})\s+(\d+)\b/);
  if (m) {
    return { ...result, fields: { ...result.fields, project_code: `${m[1].toUpperCase()} ${m[2]} ${m[3]}` } };
  }

  // Negocio compact: "R1261" → "R1 26 1"
  m = msg.match(/\b([A-Za-z]\d)(\d{2})(\d+)\b/);
  if (m) {
    return { ...result, fields: { ...result.fields, project_code: `${m[1].toUpperCase()} ${m[2]} ${m[3]}` } };
  }

  return result;
}

// ============================================================
// Fast Path — deterministic intents without LLM
// ============================================================

function fastPathParse(text: string): ParseResult | null {
  const lower = text.toLowerCase().trim();

  // Pure greetings / help (no amount, no entity)
  if (/^(hola|hey|help|ayuda|menu|menú|\?|qué\s+puedo|que\s+puedo|buenos?\s+d[ií]as?|buenas?\s*(tardes|noches)?)\.?\s*$/i.test(lower)) {
    return { intent: 'AYUDA', confidence: 0.95, fields: {} };
  }

  // Farewells / thanks / small talk — route to AYUDA to break UNCLEAR loops
  if (/^(chao|chau|adi[oó]s|bye|nos\s+vemos|hasta\s+luego|gracias|thanks|ok|vale|nada|nada\s+m[aá]s)\.?\s*$/i.test(lower)) {
    return { intent: 'AYUDA', confidence: 0.95, fields: {} };
  }

  // MIS_NUMEROS — common phrases
  if (/^(c[oó]mo\s+(estoy|vamos?|voy)|mis\s+n[uú]meros|resumen\s+(del\s+)?mes|dame\s+el\s+resumen)\.?\s*$/i.test(lower)) {
    return { intent: 'MIS_NUMEROS', confidence: 0.92, fields: {} };
  }

  // CARTERA
  if (/^(qui[eé]n\s+me\s+debe|cartera|cuentas?\s+por\s+cobrar|me\s+deben)\.?\s*$/i.test(lower)) {
    return { intent: 'CARTERA', confidence: 0.92, fields: {} };
  }

  // ESTADO_NEGOCIOS — stage-aware queries
  if (/^(qu[eé]\s+negocios?\s+(tengo|hay|activos?|abiertos?)|negocios?\s+activos?|mis\s+negocios?)\??\.?\s*$/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.92, fields: { stage_filter: 'all' } };
  }
  if (/^(qu[eé]\s+tengo\s+en\s+el\s+horno|pipeline|oportunidades|prospectos?|mis\s+oportunidades|negocios?\s+en\s+venta|en\s+venta)\??\.?\s*$/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.90, fields: { stage_filter: 'venta' } };
  }
  if (/^(y?\s*(qu[eé]\s+)?negocios?\s+en\s+ejecuci[oó]n|en\s+ejecuci[oó]n|qu[eé]\s+estoy\s+haciendo|qu[eé]\s+proyectos?\s+tengo)\??\.?\s*$/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.90, fields: { stage_filter: 'ejecucion' } };
  }
  if (/^(y?\s*(qu[eé]\s+)?negocios?\s+en\s+cobro|en\s+cobro|por\s+cobrar)\??\.?\s*$/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.90, fields: { stage_filter: 'cobro' } };
  }

  return null;
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

// ============================================================
// Regex Fallback Parser — MVP intents only
// ============================================================

function parseAmount(text: string): number | null {
  let m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:palos?|barras?|millones?)/i);
  if (m) return parseFloat(m[1].replace(',', '.')) * 1_000_000;
  if (/medio\s*palo/i.test(text)) return 500_000;
  m = text.match(/(\d+(?:[.,]\d+)?)\s*lucas?/i);
  if (m) return parseFloat(m[1].replace(',', '.')) * 1_000;
  m = text.match(/(\d+(?:[.,]\d+)?)\s*mil\b/i);
  if (m) return parseFloat(m[1].replace(',', '.')) * 1_000;
  m = text.match(/(\d{1,3}(?:\.\d{3})+)/);
  if (m) return parseInt(m[1].replace(/\./g, ''));
  m = text.match(/\b(\d{4,})\b/);
  if (m) return parseInt(m[1]);
  return null;
}

/** Extract project code or entity hint from text */
function extractProjectRef(text: string): { entity_hint?: string; project_code?: string | number } {
  // Alphanumeric code — "KAE-2", "FAB-1"
  let m = text.match(/\b([A-Z]{2,4}-\d{1,3})\b/);
  if (m) return { project_code: m[1] };
  m = text.match(/(?:P-?|#)(\d{1,4})\b/i);
  if (m) return { project_code: `P-${m[1].padStart(3, '0')}` };
  m = text.match(/(?:proyecto|proy)\s+(\d{1,4})\b/i);
  if (m) return { project_code: `P-${m[1].padStart(3, '0')}` };
  m = text.match(/(?:al|del|en\s+el)\s+(\d{1,4})\b/);
  if (m) return { project_code: `P-${m[1].padStart(3, '0')}` };

  // Negocio spaced: "R1 26 1"
  m = text.match(/\b([A-Z]\d+)\s+(\d{2})\s+(\d+)\b/);
  if (m) return { project_code: `${m[1]} ${m[2]} ${m[3]}` };

  // Negocio compact: "R1261" → "R1 26 1"
  m = text.match(/\b([A-Z]\d)(\d{2})(\d+)\b/);
  if (m) return { project_code: `${m[1]} ${m[2]} ${m[3]}` };

  // Entity hint
  m = text.match(/(?:para\s+(?:lo\s+de|el\s+proyecto\s+)?|de\s+(?:lo\s+de\s+)?)([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/);
  if (m) return { entity_hint: m[1] };
  m = text.match(/lo\s+de\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/);
  if (m) return { entity_hint: m[1] };
  m = text.match(/proyecto\s+(\S+)/i);
  if (m) return { entity_hint: m[1] };
  return {};
}

function regexParse(text: string): ParseResult {
  const lower = text.toLowerCase().trim();
  const projectRef = extractProjectRef(text);

  // AYUDA
  if (/^(hola|hey|help|ayuda|\?|menu|menú|qué puedo|que puedo|buenos?\s*d[ií]as?)$/i.test(lower) ||
      /^(qué\s+haces|que\s+haces|cómo\s+funciona|como\s+funciona)$/i.test(lower)) {
    return { intent: 'AYUDA', confidence: 0.95, fields: {} };
  }

  // MIS_NUMEROS
  if (/c[oó]mo\s+(estoy|vamos?|voy)|mis\s+n[uú]meros|resumen\s+(del\s+)?mes/i.test(lower)) {
    return { intent: 'MIS_NUMEROS', confidence: 0.88, fields: {} };
  }

  // CARTERA
  if (/qui[eé]n\s+me\s+debe|cartera|cuentas?\s+por\s+cobrar|me\s+deben/i.test(lower)) {
    return { intent: 'CARTERA', confidence: 0.90, fields: {} };
  }

  // ESTADO_NEGOCIOS — regex fallback with stage_filter inference
  if (/negocios?\s+en\s+ejecuci[oó]n|en\s+ejecuci[oó]n/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.85, fields: { stage_filter: 'ejecucion' } };
  }
  if (/negocios?\s+en\s+cobro|por\s+cobrar/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.85, fields: { stage_filter: 'cobro' } };
  }
  if (/qu[eé]\s+tengo\s+en\s+el\s+horno|pipeline|oportunidades|prospectos?|negocios?\s+en\s+venta/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.85, fields: { stage_filter: 'venta' } };
  }
  if (/qu[eé]\s+negocios?|negocios?\s+activos?|mis\s+negocios?/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.85, fields: { stage_filter: 'all' } };
  }

  // GASTO — "gasté", "pagué", "compré" + monto. También monto + "en/para"
  if (/gast[eé]|pagu[eé]|compr[eé]|invert[ií]/i.test(lower)) {
    const amount = parseAmount(lower);
    const conceptMatch = lower.match(/(?:en|de)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})(?:\s+(?:para|con|del?|a)\b|$)/i);
    const concept = conceptMatch ? conceptMatch[1].trim() : undefined;
    return {
      intent: 'GASTO',
      confidence: 0.85,
      fields: { amount, concept, ...projectRef, category_hint: concept },
    };
  }

  // Generic amount-based gasto (e.g., "20000 en tintos para proyecto Test")
  if (parseAmount(lower) && /\b(en|para)\b/i.test(lower)) {
    const amount = parseAmount(lower);
    const conceptMatch = lower.match(/(?:en)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})(?:\s+(?:para|con|del?|a)\b|$)/i);
    const concept = conceptMatch ? conceptMatch[1].trim() : undefined;
    const hasProject = projectRef.project_code !== undefined || projectRef.entity_hint !== undefined;
    if (amount && (concept || hasProject)) {
      return { intent: 'GASTO', confidence: 0.75, fields: { amount, concept, ...projectRef } };
    }
  }

  // ACTIVIDAD — "llamé a", "reunión con", "visité a", "envié correo", "nota para"
  if (/llam[eé]\s+a|reuni[oó]n\s+con|visit[eé]|envi[eé]\s+correo|nota\s+(para|de|sobre)/i.test(lower)) {
    const actMatch = text.match(/(?:llam[eé]\s+a|reuni[oó]n\s+con|visit[eé]\s+a?|envi[eé]\s+correo\s+a|nota\s+(?:para|de|sobre))\s+(.+)/i);
    return {
      intent: 'ACTIVIDAD',
      confidence: 0.80,
      fields: { ...projectRef, activity_text: actMatch?.[2]?.trim() || actMatch?.[1]?.trim() || text },
    };
  }

  // CONTACTO_NUEVO — "nuevo contacto", "anota"
  if (/nuevo\s+contacto|anota\s+(a|al)|registra\s+contacto/i.test(lower)) {
    return { intent: 'CONTACTO_NUEVO', confidence: 0.80, fields: {} };
  }

  // Nothing matched
  return { intent: 'UNCLEAR', confidence: 0, fields: {} };
}
