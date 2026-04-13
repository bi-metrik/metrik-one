// ============================================================
// Gemini — NLP Parser (Spec §2, D92)
// Single master prompt for all 24 intents
// Sprint 3 (Yuto): compact prompt ~260 tokens + responseSchema + fast-path
// ============================================================

import type { ParseResult, Intent, LastContext } from './types.ts';

// Sprint 2 (Yuto): default to Flash-Lite — 3x cheaper input, 6.25x cheaper output.
// Sprint 3 (Yuto): A/B canary via GEMINI_PARSE_MODEL_ALT + GEMINI_PARSE_MODEL_ALT_PCT.
// Override baseline with GEMINI_PARSE_MODEL for instant rollback.
const GEMINI_MODEL = Deno.env.get('GEMINI_PARSE_MODEL') || 'gemini-2.5-flash-lite';
const GEMINI_MODEL_ALT = Deno.env.get('GEMINI_PARSE_MODEL_ALT') || '';
const GEMINI_MODEL_ALT_PCT = parseInt(Deno.env.get('GEMINI_PARSE_MODEL_ALT_PCT') || '0', 10);

// Unified confidence threshold across the whole bot
export const CONFIDENCE_THRESHOLD = 0.7;

// Compact master prompt — all 24 intents, schema-enforced via responseSchema.
// Lenguaje oficial: "negocio" (unidad de trabajo). Etapas: venta→ejecución→cobro→cierre.
const SYSTEM_PROMPT = `Parser WA colombiano → JSON (schema).

Negocio = unidad de trabajo, atraviesa venta→ejecución→cobro→cierre.

INTENTS:
Registro: GASTO_DIRECTO, GASTO_OPERATIVO, EDITAR_GASTO, HORAS, TIMER_INICIAR, TIMER_PARAR, TIMER_ESTADO, COBRO, CONTACTO_NUEVO, SALDO_BANCARIO
Negocio: OPP_NUEVA, OPP_AVANZAR, OPP_GANADA, OPP_PERDIDA, ACTIVIDAD, NOTA_NEGOCIO
Consulta: ESTADO_PROYECTO, ESTADO_NEGOCIOS, MIS_NUMEROS, CARTERA, INFO_CONTACTO
Otros: AYUDA, UNCLEAR

CAMPOS:
- amount: entero en COP. "1 palo"=1000000, "2 palos"=2000000, "medio palo"=500000, "500 lucas"=500000, "180 mil"=180000
- concept: 2-5 palabras, sin verbos ni montos
- project_code: código literal ("R1 26 1" o "KAE-2") — prioridad sobre entity_hint
- entity_hint: cliente/empresa del negocio
- stage_hint: contacto_inicial|discovery_hecha|propuesta_enviada|negociacion
- stage_filter: venta|ejecucion|cobro|cierre|all (para ESTADO_NEGOCIOS)
- activity_text, note, hours

REGLAS:
1. Menciona negocio/código/cliente → GASTO_DIRECTO. Arriendo/luz/agua/internet/celular/nómina sin negocio → GASTO_OPERATIVO
2. "me pagaron/consignaron/giraron/transfirieron/recibí el pago" → COBRO
3. "mi saldo/tengo X en banco/en la cuenta" → SALDO_BANCARIO
4. "llamé/reunión/visité/envié correo" + persona → ACTIVIDAD
5. "mandé propuesta/hice discovery/ya contacté" → OPP_AVANZAR
6. "nuevo negocio/prospecto/me contactó" → OPP_NUEVA
7. "aceptó/ganamos/firmó" → OPP_GANADA; "se cayó/perdimos/no se dio" → OPP_PERDIDA
8. "nota para/sobre el negocio X" → NOTA_NEGOCIO
9. ESTADO_NEGOCIOS: "qué negocios activos/abiertos/tengo" → stage_filter=all; "en venta/pipeline/horno" → venta; "en ejecución/haciendo" → ejecucion; "en cobro/por cobrar" → cobro; "cerrados/terminados" → cierre
10. confidence<0.7 → UNCLEAR + suggested_actions: 2-3 labels ≤20 chars`;

// Response schema for Gemini structured output (JSON Schema subset)
const INTENT_ENUM: Intent[] = [
  'GASTO_DIRECTO', 'GASTO_OPERATIVO', 'EDITAR_GASTO', 'HORAS',
  'TIMER_INICIAR', 'TIMER_PARAR', 'TIMER_ESTADO',
  'COBRO', 'CONTACTO_NUEVO', 'SALDO_BANCARIO',
  'NOTA_NEGOCIO',
  'ESTADO_PROYECTO', 'ESTADO_NEGOCIOS', 'MIS_NUMEROS', 'CARTERA', 'INFO_CONTACTO',
  'OPP_GANADA', 'OPP_PERDIDA', 'OPP_NUEVA', 'OPP_AVANZAR', 'ACTIVIDAD',
  'AYUDA', 'FOLLOWUP', 'UNCLEAR',
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
        hours: { type: 'number' },
        stage_hint: { type: 'string' },
        stage_filter: { type: 'string' },
        activity_text: { type: 'string' },
        note: { type: 'string' },
        suggested_actions: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['intent', 'confidence', 'fields'],
};

// Track last Gemini failure reason for debugging
let _lastGeminiFail = '';

// Sprint 3 (Yuto): telemetry captured on every parseMessage call.
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

/** Stable hash → 0-99 bucket for A/B canary routing. */
function hashBucket(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

/** Choose Gemini model based on canary config. Phone is optional bucket key. */
function pickGeminiModel(bucketKey?: string): string {
  if (!GEMINI_MODEL_ALT || GEMINI_MODEL_ALT_PCT <= 0) return GEMINI_MODEL;
  if (!bucketKey) return GEMINI_MODEL;
  return hashBucket(bucketKey) < GEMINI_MODEL_ALT_PCT ? GEMINI_MODEL_ALT : GEMINI_MODEL;
}

export async function parseMessage(
  userMessage: string,
  bucketKey?: string,
  lastContext?: LastContext | null,
): Promise<ParseResult> {
  // 1. Fast path: deterministic patterns that skip LLM entirely (saves ~50% of calls)
  const fast = fastPathParse(userMessage);
  if (fast) {
    console.log(`[wa-parse] Fast-path hit: ${fast.intent} (${fast.confidence})`);
    _lastTelemetry = { parser_source: 'fast_path', confidence: fast.confidence };
    return enrichFields(fast, userMessage);
  }

  // 2. Gemini NLP parser (with optional conversational context hint)
  const model = pickGeminiModel(bucketKey);
  const geminiResult = await tryGemini(userMessage, model, lastContext);
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
  // Normalize: lowercase + pad with spaces so we can use (^| ) / ( |$) boundaries
  // instead of \b (which breaks on accented chars like "ahí" in default JS regex).
  const padded = ` ${text.toLowerCase()} `;
  const patterns = [
    // Demonstrative pronouns
    /(^|[\s,.;:!?¿¡])(ese|esa|eso|esos|esas|aquel|aquella|aquellos|aquellas)([\s,.;:!?¿¡]|$)/,
    // Locative adverbs (accented — no \b)
    /(^|[\s,.;:!?¿¡])(ah[ií]|all[ií]|all[aá]|aca|acá)([\s,.;:!?¿¡]|$)/,
    // Same / self
    /(el|la|los|las)\s+mism[oa]s?/,
    // Ordinals (masculine + feminine)
    /(el|la)\s+(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa]|[uú]ltim[oa])/,
    // "el que" / "la que"
    /(el|la|los|las)\s+que(\s|$)/,
    // "en/de/para/a + ese/esa/aquel..."
    /(en|de|para|a|con)\s+(ese|esa|eso|esos|esas|aquel|aquella)/,
    // Context-specific: "ese negocio/proyecto/cliente/gasto"
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

  // Pick a representative code from the context to anchor few-shot examples.
  const firstCode = items[0]?.codigo || '';
  const secondCode = items[1]?.codigo || firstCode;

  // Few-shot examples adapt to the context type so the model sees a concrete mapping.
  const examples = lastContext.type === 'negocios_list'
    ? `EJEMPLOS (con este contexto):
- "gasté 50 mil en el primero" → intent=GASTO_DIRECTO, amount=50000, project_code="${firstCode}"
- "cómo va el segundo" → intent=ESTADO_PROYECTO, project_code="${secondCode}"
- "cómo va ese negocio" (sin más info) → intent=ESTADO_PROYECTO, project_code="${firstCode}"
- "pagué 200 mil ahí" → intent=GASTO_DIRECTO, amount=200000, project_code="${firstCode}"
- "el último cuánto vale" → intent=ESTADO_PROYECTO, project_code=<código del último item>
- "los otros" → intent=FOLLOWUP`
    : `EJEMPLO: si el usuario dice "el primero" o "ese", usa el item #1 de la lista arriba.`;

  return `

CONTEXTO PREVIO DE LA CONVERSACIÓN (${lastContext.type}, hace <5 min):
${list}

REGLAS DE RESOLUCIÓN DE ANÁFORA (obligatorio):
1. Si el mensaje contiene "el primero/segundo/tercero/último/ese/esa/ahí/allí/ese negocio/el mismo", DEBES reemplazar la referencia con el project_code del item correspondiente de la lista.
2. Ordinales → índice 1-based (el primero=item 1, el segundo=item 2, el último=último item).
3. "ese/esa/ahí/allí" sin ordinal → si solo hay 1 item usa ese; si hay varios usa el item 1 (el más reciente/prominente).
4. Si la pregunta es sobre el estado o avance de UN negocio específico (ej: "cómo va el segundo"), el intent es ESTADO_PROYECTO y DEBES devolver project_code.
5. Si el mensaje registra un gasto usando anáfora (ej: "gasté X en el primero"), el intent es GASTO_DIRECTO y DEBES devolver project_code además de amount.

${examples}`;
}

/**
 * Defense layer chain: inject project_code, amount fallback, and category_hint
 * from the raw message when the parser missed them. Deterministic, cheap, keeps
 * Gemini tokens low.
 */
function enrichFields(result: ParseResult, rawMessage: string): ParseResult {
  let enriched = injectProjectCode(result, rawMessage);
  enriched = injectAmount(enriched, rawMessage);
  enriched = injectCategoryHint(enriched, rawMessage);
  return enriched;
}

/** Fill amount from raw text if parser returned none (handles "1 palo", "medio palo", "500 lucas", etc.) */
function injectAmount(result: ParseResult, rawMessage: string): ParseResult {
  if (result.fields.amount !== undefined && result.fields.amount !== null) return result;
  const amount = parseAmount(rawMessage);
  if (amount == null) return result;
  return { ...result, fields: { ...result.fields, amount } };
}

/** Keyword → category mapping. Only fires on registro intents when category_hint is missing. */
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

const REGISTRO_INTENTS_WITH_CATEGORY = new Set(['GASTO_DIRECTO', 'GASTO_OPERATIVO', 'EDITAR_GASTO']);

/** Infer category_hint from keywords in raw text when the parser left it empty. */
function injectCategoryHint(result: ParseResult, rawMessage: string): ParseResult {
  if (result.fields.category_hint) return result;
  if (!REGISTRO_INTENTS_WITH_CATEGORY.has(result.intent)) return result;
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(rawMessage)) {
      return { ...result, fields: { ...result.fields, category_hint: cat } };
    }
  }
  return result;
}

/**
 * Defense layer: detect project/negocio codes in the raw message and inject
 * them into fields.project_code even if Gemini/regex missed them. Handles:
 *   - "R1 26 1" / "s1 26 3" (spaced)
 *   - "R1261" / "s1261" (compact)
 *   - "KAE-2", "FAB-1", "P-12" (legacy project codes)
 * Case-insensitive. Normalizes to uppercase.
 */
function injectProjectCode(result: ParseResult, rawMessage: string): ParseResult {
  if (result.fields.project_code) return result; // already set
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

  // Negocio spaced: "R1 26 1", "S1 26 3"
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
// Only patterns with very high signal. Conservative by design.
// ============================================================

function fastPathParse(text: string): ParseResult | null {
  const lower = text.toLowerCase().trim();

  // FOLLOWUP — anaphoric continuations of a previous query
  // Only matches short, clearly-referential phrases. The handler validates
  // that there is fresh last_context before acting.
  if (/^(y?\s*)?(cu[aá]les?\s+son\s+(los|las)\s+(otros?|otras?|dem[aá]s|restantes?)(\s+\d+)?|(los|las)\s+(otros?|otras?|dem[aá]s|restantes?)|(y\s+)?(los|las)\s+\d+\s+m[aá]s|qu[eé]\s+m[aá]s|ver\s+m[aá]s|mostrar\s+m[aá]s|m[aá]s\s+detalles?|dime\s+m[aá]s|cu[eé]ntame\s+m[aá]s|el\s+resto|todos|t[oó]dalas|muestra(me)?\s+(el|los|las)\s+resto)\??\.?\s*$/i.test(lower)) {
    return { intent: 'FOLLOWUP', confidence: 0.95, fields: {} };
  }

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
  // "qué negocios tengo/hay" → all active
  if (/^(qu[eé]\s+negocios?\s+(tengo|hay|activos?|abiertos?)|negocios?\s+activos?|mis\s+negocios?)\??\.?\s*$/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.92, fields: { stage_filter: 'all' } };
  }
  // "en venta", "pipeline", "qué tengo en el horno", "oportunidades"
  if (/^(qu[eé]\s+tengo\s+en\s+el\s+horno|pipeline|oportunidades|prospectos?|mis\s+oportunidades|negocios?\s+en\s+venta|en\s+venta)\??\.?\s*$/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.90, fields: { stage_filter: 'venta' } };
  }
  // "en ejecución"
  if (/^(y?\s*(qu[eé]\s+)?negocios?\s+en\s+ejecuci[oó]n|en\s+ejecuci[oó]n|qu[eé]\s+estoy\s+haciendo|qu[eé]\s+proyectos?\s+tengo)\??\.?\s*$/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.90, fields: { stage_filter: 'ejecucion' } };
  }
  // "en cobro"
  if (/^(y?\s*(qu[eé]\s+)?negocios?\s+en\s+cobro|en\s+cobro|por\s+cobrar)\??\.?\s*$/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.90, fields: { stage_filter: 'cobro' } };
  }
  // "cerrados"
  if (/^(y?\s*(qu[eé]\s+)?negocios?\s+(cerrados?|terminados?|en\s+cierre)|cerrados?|terminados?)\??\.?\s*$/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.90, fields: { stage_filter: 'cierre' } };
  }

  // TIMER_PARAR — only very explicit, no gasto verbs
  if (/^(parar|par[oó]|detener|termin[eé]|listo|acab[eé]|ya\s+acab[eé])\.?\s*$/i.test(lower)) {
    return { intent: 'TIMER_PARAR', confidence: 0.92, fields: {} };
  }

  // TIMER_ESTADO
  if (/^(cu[aá]nto\s+llevo|cu[aá]nto\s+tiempo|timer|cron[oó]metro)\??\.?\s*$/i.test(lower)) {
    return { intent: 'TIMER_ESTADO', confidence: 0.92, fields: {} };
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

  // Inject conversational context only if there's a recent last_context AND
  // the message contains an anaphoric signal. Otherwise skip to save tokens.
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

    // Capture telemetry even on low confidence
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
// Regex Fallback Parser — handles common Colombian patterns
// ============================================================

function parseAmount(text: string): number | null {
  // "2 palos" / "3 barras" → millions
  let m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:palos?|barras?|millones?)/i);
  if (m) return parseFloat(m[1].replace(',', '.')) * 1_000_000;
  // "medio palo"
  if (/medio\s*palo/i.test(text)) return 500_000;
  // "500 lucas" / "200 lucas"
  m = text.match(/(\d+(?:[.,]\d+)?)\s*lucas?/i);
  if (m) return parseFloat(m[1].replace(',', '.')) * 1_000;
  // "180 mil" / "180mil"
  m = text.match(/(\d+(?:[.,]\d+)?)\s*mil\b/i);
  if (m) return parseFloat(m[1].replace(',', '.')) * 1_000;
  // "4.800.000" / "4800000"
  m = text.match(/(\d{1,3}(?:\.\d{3})+)/);
  if (m) return parseInt(m[1].replace(/\./g, ''));
  // Plain number "20000" / "180000"
  m = text.match(/\b(\d{4,})\b/);
  if (m) return parseInt(m[1]);
  return null;
}

/** Extract project code (KAE-2, FAB-1, P-12, #12) or entity hint from text */
function extractProjectRef(text: string): { entity_hint?: string; project_code?: string | number } {
  // Priority 0: Alphanumeric code — "KAE-2", "FAB-1", "INT-3" (3 uppercase letters + dash + number)
  let m = text.match(/\b([A-Z]{2,4}-\d{1,3})\b/);
  if (m) return { project_code: m[1] };
  // Priority 1: Project code — "P-12", "P12", "#12"
  m = text.match(/(?:P-?|#)(\d{1,4})\b/i);
  if (m) return { project_code: `P-${m[1].padStart(3, '0')}` };
  // "proyecto 12" / "el proyecto 12" (only if followed by a number)
  m = text.match(/(?:proyecto|proy)\s+(\d{1,4})\b/i);
  if (m) return { project_code: `P-${m[1].padStart(3, '0')}` };
  // "al 12" / "del 12" / "en el 12" (short numeric reference after preposition)
  m = text.match(/(?:al|del|en\s+el)\s+(\d{1,4})\b/);
  if (m) return { project_code: `P-${m[1].padStart(3, '0')}` };

  // Priority 0.5: Negocio code with spaces — "R1 26 1", "S1 26 3", "M1 26 1"
  m = text.match(/\b([A-Z]\d+)\s+(\d{2})\s+(\d+)\b/);
  if (m) return { project_code: `${m[1]} ${m[2]} ${m[3]}` };

  // Priority 0.6: Negocio code compact — "R1261" → "R1 26 1"
  m = text.match(/\b([A-Z]\d)(\d{2})(\d+)\b/);
  if (m) return { project_code: `${m[1]} ${m[2]} ${m[3]}` };

  // Priority 2: Entity hint (fuzzy name) — existing logic
  // "para (lo de|el proyecto) X"
  m = text.match(/(?:para\s+(?:lo\s+de|el\s+proyecto\s+)?|de\s+(?:lo\s+de\s+)?)([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/);
  if (m) return { entity_hint: m[1] };
  // "lo de X"
  m = text.match(/lo\s+de\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/);
  if (m) return { entity_hint: m[1] };
  // "proyecto X" (non-numeric)
  m = text.match(/proyecto\s+(\S+)/i);
  if (m) return { entity_hint: m[1] };
  return {};
}

function regexParse(text: string): ParseResult {
  const lower = text.toLowerCase().trim();

  // Extract project reference once — used across multiple intents
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
  if (/negocios?\s+(cerrados?|terminados?|en\s+cierre)/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.85, fields: { stage_filter: 'cierre' } };
  }
  if (/qu[eé]\s+tengo\s+en\s+el\s+horno|pipeline|oportunidades|prospectos?|negocios?\s+en\s+venta/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.85, fields: { stage_filter: 'venta' } };
  }
  if (/qu[eé]\s+negocios?|negocios?\s+activos?|mis\s+negocios?/i.test(lower)) {
    return { intent: 'ESTADO_NEGOCIOS', confidence: 0.85, fields: { stage_filter: 'all' } };
  }

  // SALDO_BANCARIO — "mi saldo es X", "tengo X en el banco"
  if (/(?:mi\s+saldo|tengo\s+\d.*(?:en\s+el\s+banco|en\s+cuenta))/i.test(lower)) {
    const amount = parseAmount(lower);
    if (amount) return { intent: 'SALDO_BANCARIO', confidence: 0.90, fields: { amount } };
  }

  // COBRO — "me pagaron", "me consignaron", "me giraron"
  if (/me\s+(pagaron|consignaron|giraron|transfirieron)/i.test(lower)) {
    const amount = parseAmount(lower);
    return { intent: 'COBRO', confidence: 0.88, fields: { amount, ...projectRef } };
  }

  // GASTO — "gasté", "pagué", "compré" + monto
  if (/gast[eé]|pagu[eé]|compr[eé]|invert[ií]/i.test(lower)) {
    const amount = parseAmount(lower);
    // Extract concept — stop before "con", "para", "del", "de" (prepositions)
    const conceptMatch = lower.match(/(?:en|de)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})(?:\s+(?:para|con|del?|a)\b|$)/i);
    const concept = conceptMatch ? conceptMatch[1].trim() : undefined;

    // Determine if it's project-related (GASTO_DIRECTO) or operational (GASTO_OPERATIVO)
    // IMPORTANT: \b word boundaries prevent "gas" from matching inside "gasté"
    const isOperativo = /\b(arriendo|internet|celular|luz|agua|gas|oficina|servicios|n[oó]mina)\b/i.test(lower);
    // If there's a project reference (code or entity_hint), it's always a direct expense
    const hasProject = projectRef.project_code !== undefined || projectRef.entity_hint !== undefined;
    const intent = (isOperativo && !hasProject) ? 'GASTO_OPERATIVO' : 'GASTO_DIRECTO';
    return {
      intent,
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
      return { intent: 'GASTO_DIRECTO', confidence: 0.75, fields: { amount, concept, ...projectRef } };
    }
  }

  // TIMER_PARAR — "parar", "terminé", "listo", "ya acabé"
  if (/\b(parar|detener|par[oó]|termin[eé]|listo|acab[eé]|ya\s+acab[eé])\b/i.test(lower) &&
      !/gast[eé]|pagu[eé]|compr[eé]/i.test(lower)) {
    return { intent: 'TIMER_PARAR', confidence: 0.92, fields: {} };
  }

  // TIMER_ESTADO — "cuánto llevo", "cuánto tiempo", "timer", "cronómetro"
  if (/cu[aá]nto\s+llevo|cu[aá]nto\s+tiempo|timer\b|cron[oó]metro/i.test(lower)) {
    return { intent: 'TIMER_ESTADO', confidence: 0.90, fields: {} };
  }

  // TIMER_INICIAR — "iniciar", "empezar", "arrancar", "dale a"
  if (/\b(iniciar|empezar|arrancar|comenzar)\b|dale\s+a/i.test(lower)) {
    return { intent: 'TIMER_INICIAR', confidence: 0.90, fields: { ...projectRef } };
  }

  // HORAS — "trabajé X horas", "le metí X horas" (manual — solo owners)
  if (/(?:trabaj[eé]|le\s+met[ií]|dediqu[eé])\s+(\d+(?:[.,]\d+)?)\s*horas?/i.test(lower)) {
    const hoursMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*horas?/i);
    const hours = hoursMatch ? parseFloat(hoursMatch[1].replace(',', '.')) : undefined;
    return { intent: 'HORAS', confidence: 0.88, fields: { hours, ...projectRef } };
  }

  // ESTADO_PROYECTO — "cómo va lo de X"
  if (/c[oó]mo\s+va|estado\s+de|avance\s+de/i.test(lower)) {
    return { intent: 'ESTADO_PROYECTO', confidence: 0.85, fields: { ...projectRef } };
  }

  // OPP_GANADA — "aceptó", "ganamos"
  if (/acept[oó]|ganamos|cerr[eé]|firm[oó]/i.test(lower)) {
    return { intent: 'OPP_GANADA', confidence: 0.80, fields: { entity_hint: projectRef.entity_hint } };
  }

  // OPP_PERDIDA — "se cayó", "no se dio", "perdimos"
  if (/se\s+cay[oó]|no\s+se\s+dio|perdimos|descart[oó]/i.test(lower)) {
    return { intent: 'OPP_PERDIDA', confidence: 0.80, fields: { entity_hint: projectRef.entity_hint } };
  }

  // OPP_NUEVA — "nuevo prospecto", "nueva oportunidad", "me contactó"
  if (/nuev[oa]\s+(prospecto|oportunidad|lead)|me\s+contact[oó]/i.test(lower)) {
    return { intent: 'OPP_NUEVA', confidence: 0.80, fields: { entity_hint: projectRef.entity_hint } };
  }

  // OPP_AVANZAR — "mandé propuesta", "hice discovery", "contacté a"
  if (/mand[eé]\s+(la\s+)?propuesta|hice\s+discovery|ya\s+contact[eé]/i.test(lower)) {
    const stageMap: Record<string, string> = {
      'propuesta': 'propuesta_enviada',
      'discovery': 'discovery_hecha',
      'contact': 'contacto_inicial',
    };
    let stage = 'contacto_inicial';
    for (const [kw, s] of Object.entries(stageMap)) {
      if (lower.includes(kw)) { stage = s; break; }
    }
    return { intent: 'OPP_AVANZAR', confidence: 0.80, fields: { entity_hint: projectRef.entity_hint, stage_hint: stage } };
  }

  // ACTIVIDAD — "llamé a", "reunión con", "visité a", "envié correo"
  if (/llam[eé]\s+a|reuni[oó]n\s+con|visit[eé]|envi[eé]\s+correo/i.test(lower)) {
    const actMatch = text.match(/(?:llam[eé]\s+a|reuni[oó]n\s+con|visit[eé]\s+a?|envi[eé]\s+correo\s+a)\s+(.+)/i);
    return { intent: 'ACTIVIDAD', confidence: 0.80, fields: { entity_hint: projectRef.entity_hint, activity_text: actMatch?.[1]?.trim() || text } };
  }

  // NOTA_NEGOCIO
  if (/nota\s+(para|de|sobre)/i.test(lower)) {
    const noteMatch = text.match(/nota\s+(?:para|de|sobre)\s+\S+[:\s]+(.+)/i);
    return { intent: 'NOTA_NEGOCIO', confidence: 0.80, fields: { ...projectRef, note: noteMatch?.[1] } };
  }

  // CONTACTO_NUEVO — "nuevo contacto", "anota"
  if (/nuevo\s+contacto|anota|anotar|registra\s+contacto/i.test(lower)) {
    return { intent: 'CONTACTO_NUEVO', confidence: 0.80, fields: {} };
  }

  // INFO_CONTACTO — "teléfono de", "datos de"
  if (/tel[eé]fono\s+de|datos?\s+de|info\s+de|contacto\s+de/i.test(lower)) {
    return { intent: 'INFO_CONTACTO', confidence: 0.85, fields: { entity_hint: projectRef.entity_hint } };
  }

  // Nothing matched
  return { intent: 'UNCLEAR', confidence: 0, fields: {} };
}
