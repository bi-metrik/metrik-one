// ============================================================
// Gemini 2.5 Flash — NLP Parser (Spec §2, D92)
// Single master prompt for all 16 intents
// ============================================================

import type { ParseResult } from './types.ts';

const GEMINI_MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `Parser de MéTRIK ONE. Recibe mensaje de WhatsApp en español colombiano y devuelve JSON.

RESPONDE SOLO JSON. Sin texto adicional. Sin markdown.

INTENCIONES:
GASTO_DIRECTO: gasto con proyecto/cliente ("Gasté X en Y para Z")
GASTO_OPERATIVO: gasto empresa sin proyecto ("Pagué arriendo")
HORAS: registro tiempo ("Trabajé X horas en Y")
TIMER_INICIAR/TIMER_PARAR/TIMER_ESTADO: cronómetro
COBRO: pago recibido ("Me pagaron X de Y")
CONTACTO_NUEVO: crear contacto
SALDO_BANCARIO: reporte saldo banco (NO cobro, NO gasto)
NOTA_OPORTUNIDAD/NOTA_PROYECTO: notas
ESTADO_PROYECTO/ESTADO_PIPELINE/MIS_NUMEROS/CARTERA/INFO_CONTACTO: consultas
OPP_GANADA/OPP_PERDIDA: resultado oportunidad
AYUDA: saludo o help
UNCLEAR: no determinable

CAMPOS GASTOS (obligatorios amount, concept, category_hint):
- amount: número sin puntos ni $
- concept: título corto 2-5 palabras, sin montos ni verbos
- category_hint: materiales|transporte|alimentacion|servicios_profesionales|software|arriendo|marketing|capacitacion|otros
- entity_hint: nombre persona/empresa mencionada
- project_code: código "KAE-2","FAB-1","P-12" tal cual (prioridad sobre entity_hint)

CATEGORÍAS:
materiales = compras físicas: insumos, herramientas, ferretería, cables, pintura, cemento, repuestos
transporte = movilidad: taxi, uber, gasolina, peaje, montacarga, grúa, flete
alimentacion = comida laboral: almuerzo, tinto, restaurante
servicios_profesionales = pagos a personas: soldador, contador, abogado, diseñador, freelancer
software = digital: licencias, suscripciones, hosting, apps
arriendo = fijo oficina: arriendo, luz, agua, gas, internet (casi siempre GASTO_OPERATIVO)
marketing = promoción: pauta, publicidad, ads (casi siempre GASTO_OPERATIVO)
capacitacion = formación: cursos, libros (casi siempre GASTO_OPERATIVO)
otros = solo si nada aplica

REGLAS:
- Menciona proyecto/código/cliente → GASTO_DIRECTO
- arriendo/marketing/capacitacion sin proyecto → GASTO_OPERATIVO
- Ambiguo sin proyecto → GASTO_OPERATIVO
- "X palos/barras" = X×1000000, "X lucas" = X×1000, "medio palo" = 500000
- "me consignaron/giraron" = COBRO
- confidence < 0.7 → UNCLEAR

FORMATO: {"intent":"...","confidence":0.9,"fields":{...}}`;

// Track last Gemini failure reason for debugging
let _lastGeminiFail = '';

export async function parseMessage(userMessage: string): Promise<ParseResult> {
  // Try Gemini first, fall back to regex if unavailable
  const geminiResult = await tryGemini(userMessage);
  if (geminiResult) return geminiResult;

  // Fallback: regex-based parser for common patterns
  console.log('[wa-parse] Using regex fallback, reason:', _lastGeminiFail);
  return regexParse(userMessage);
}

// ============================================================
// Gemini NLP Parser
// ============================================================

async function tryGemini(userMessage: string): Promise<ParseResult | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) { _lastGeminiFail = 'no_api_key'; return null; }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          { role: 'user', parts: [{ text: userMessage }] },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
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
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      _lastGeminiFail = `no_text: finish=${data.candidates?.[0]?.finishReason || 'unknown'}`;
      return null;
    }

    const parsed: ParseResult = JSON.parse(text);
    _lastGeminiFail = '';
    if (parsed.confidence < 0.6) return { ...parsed, intent: 'UNCLEAR' };
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

  // ESTADO_PIPELINE
  if (/qu[eé]\s+tengo\s+en\s+el\s+horno|pipeline|oportunidades|prospectos?/i.test(lower)) {
    return { intent: 'ESTADO_PIPELINE', confidence: 0.85, fields: {} };
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

  // NOTA_OPORTUNIDAD / NOTA_PROYECTO
  if (/nota\s+(para|de|sobre)/i.test(lower)) {
    const noteMatch = text.match(/nota\s+(?:para|de|sobre)\s+\S+[:\s]+(.+)/i);
    return { intent: 'NOTA_PROYECTO', confidence: 0.80, fields: { ...projectRef, note: noteMatch?.[1] } };
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
