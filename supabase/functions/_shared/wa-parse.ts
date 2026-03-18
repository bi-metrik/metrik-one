// ============================================================
// Gemini 2.5 Flash — NLP Parser (Spec §2, D92)
// Single master prompt for all 16 intents
// ============================================================

import type { ParseResult } from './types.ts';

const GEMINI_MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `Eres el parser de MéTRIK ONE, un sistema financiero para independientes colombianos.

Tu trabajo: recibir un mensaje de WhatsApp en español colombiano informal y devolver un JSON estructurado con:
1. La intención del mensaje (una de las categorías listadas)
2. Los campos extraídos del texto

REGLAS:
- Responde SOLO con JSON válido, sin texto adicional
- Si no puedes determinar la intención con confianza >70%, usa "UNCLEAR"
- Extrae montos en formato numérico (sin puntos de miles, sin "$")
- "concept" debe ser un título corto (2-5 palabras) del gasto, sin montos, sin verbos, sin nombres de personas. Ej: "insumos eléctricos", "taxi reunión", "almuerzo equipo"
- Los nombres de personas/empresas van tal cual los escribió el usuario
- Si el mensaje menciona un proyecto/cliente, extráelo como "entity_hint"
- Si el mensaje menciona un código de proyecto como "KAE-2", "FAB-1", "P-12", "#12", extráelo como "project_code" (string tal cual: "KAE-2", "P-12", etc.). Códigos alfanuméricos tipo "XXX-N" tienen prioridad máxima. project_code tiene prioridad sobre entity_hint.
- Fechas: si no se menciona, no incluyas el campo (el sistema usa "hoy")
- Montos en pesos colombianos por defecto

INTENCIONES MVP:

REGISTRO:
- GASTO_DIRECTO: Gasto asociable a proyecto ("Gasté X en Y para Z")
- GASTO_OPERATIVO: Gasto general/fijo ("Pagué el arriendo", "Compré internet")
- HORAS: Registro manual de tiempo ("Trabajé X horas en Y") — SOLO para owners
- TIMER_INICIAR: Iniciar cronómetro ("Iniciar en X", "Empezar X", "Arrancar en X", "Dale a X")
- TIMER_PARAR: Detener cronómetro ("Parar", "Terminé", "Listo", "Ya acabé")
- TIMER_ESTADO: Consultar tiempo transcurrido ("¿Cuánto llevo?", "¿Cuánto tiempo?")
- COBRO: Pago recibido ("Me pagaron X de Y")
- CONTACTO_NUEVO: Crear contacto ("Nuevo contacto: nombre, teléfono")
- SALDO_BANCARIO: El usuario reporta cuánto tiene en el banco ("Mi saldo es X", "Tengo X en el banco")

NOVEDADES:
- NOTA_OPORTUNIDAD: Nota sobre prospecto ("Lo de Torres se enfrió")
- NOTA_PROYECTO: Nota sobre proyecto activo ("Nota para Pérez: cambió el color")

CONSULTAS:
- ESTADO_PROYECTO: "¿Cómo va lo de X?"
- ESTADO_PIPELINE: "¿Qué tengo en el horno?"
- MIS_NUMEROS: "¿Cómo estoy este mes?"
- CARTERA: "¿Quién me debe?"
- INFO_CONTACTO: "¿Cuál es el teléfono de X?"

ACCIONES:
- OPP_GANADA: "X aceptó" / "Ganamos lo de X"
- OPP_PERDIDA: "Lo de X no se dio" / "Perdimos X"
- AYUDA: "¿Qué puedo hacer?" / "help" / "?"

UNCLEAR: No se puede determinar

NOTAS PARA SALDO_BANCARIO:
- TRIGGER: El usuario reporta cuánto tiene en el banco o su saldo actual.
- Saldo = estado actual de la cuenta. No es un movimiento.
- Extraer SOLO monto (obligatorio). No extraer nombre de banco ni fecha.
- CONFUSIÓN FRECUENTE:
  - "Me pagaron 3 millones" → COBRO, NO saldo
  - "Tengo 3 millones en cartera" → CONSULTA (CARTERA), NO saldo
  - "Gasté 500 mil" → GASTO, NO saldo

COLOQUIALISMOS COLOMBIANOS:
- "X palos" = X × 1,000,000
- "X lucas" = X × 1,000
- "X barras" = X × 1,000,000
- "una luca" = 1,000
- "medio palo" = 500,000
- "le metí X horas" = Trabajé X horas
- "me consignaron" = Me pagaron
- "me giraron" = Me pagaron
- "quedó en veremos" = Oportunidad estancada
- "se cayó" = Oportunidad perdida
- "lo de [nombre]" = Proyecto o oportunidad asociada a [nombre]

FORMATO DE RESPUESTA:
{
  "intent": "GASTO_DIRECTO",
  "confidence": 0.92,
  "fields": {
    "amount": 180000,
    "concept": "transporte",
    "entity_hint": "Pérez",
    "category_hint": "transporte"
  }
}`;

const FEW_SHOT_EXAMPLES = [
  { input: 'Gasté 180 mil en transporte para lo de Pérez', output: '{"intent":"GASTO_DIRECTO","confidence":0.91,"fields":{"amount":180000,"concept":"transporte","entity_hint":"Pérez","category_hint":"transporte"}}' },
  { input: 'Pagué el arriendo, 2 palos', output: '{"intent":"GASTO_OPERATIVO","confidence":0.94,"fields":{"amount":2000000,"concept":"arriendo","category_hint":"arriendo"}}' },
  { input: 'Hoy le metí 4 horas a lo de María', output: '{"intent":"HORAS","confidence":0.93,"fields":{"hours":4,"entity_hint":"María","date_hint":"hoy"}}' },
  { input: 'Me consignaron 3 millones del edificio', output: '{"intent":"COBRO","confidence":0.90,"fields":{"amount":3000000,"entity_hint":"edificio"}}' },
  { input: 'Anota: Ana Gómez, 315 555 1234, arquitecta', output: '{"intent":"CONTACTO_NUEVO","confidence":0.95,"fields":{"name":"Ana Gómez","phone":"3155551234","role":"arquitecta"}}' },
  { input: 'Lo de Torres se puso difícil, el gerente viajó', output: '{"intent":"NOTA_OPORTUNIDAD","confidence":0.85,"fields":{"entity_hint":"Torres","note":"se puso difícil, el gerente viajó"}}' },
  { input: '¿Cómo vamos con Pérez?', output: '{"intent":"ESTADO_PROYECTO","confidence":0.88,"fields":{"entity_hint":"Pérez"}}' },
  { input: 'Pérez aceptó la propuesta, ganamos', output: '{"intent":"OPP_GANADA","confidence":0.92,"fields":{"entity_hint":"Pérez"}}' },
  { input: 'Mi saldo es 12 millones', output: '{"intent":"SALDO_BANCARIO","confidence":0.93,"fields":{"amount":12000000}}' },
  { input: 'Tengo 4.800.000 en el banco', output: '{"intent":"SALDO_BANCARIO","confidence":0.91,"fields":{"amount":4800000}}' },
  { input: '¿Cómo estoy este mes?', output: '{"intent":"MIS_NUMEROS","confidence":0.90,"fields":{}}' },
  { input: '¿Quién me debe?', output: '{"intent":"CARTERA","confidence":0.92,"fields":{}}' },
  { input: 'Hola', output: '{"intent":"AYUDA","confidence":0.90,"fields":{}}' },
  { input: 'Iniciar en lo de Pérez', output: '{"intent":"TIMER_INICIAR","confidence":0.93,"fields":{"entity_hint":"Pérez"}}' },
  { input: 'Dale al proyecto Test', output: '{"intent":"TIMER_INICIAR","confidence":0.90,"fields":{"entity_hint":"Test"}}' },
  { input: 'Parar', output: '{"intent":"TIMER_PARAR","confidence":0.95,"fields":{}}' },
  { input: 'Terminé', output: '{"intent":"TIMER_PARAR","confidence":0.92,"fields":{}}' },
  { input: '¿Cuánto llevo?', output: '{"intent":"TIMER_ESTADO","confidence":0.93,"fields":{}}' },
  // Project code examples (alphanumeric and numeric)
  { input: 'Gasté 50 mil en materiales al KAE-2', output: '{"intent":"GASTO_DIRECTO","confidence":0.95,"fields":{"amount":50000,"concept":"materiales","project_code":"KAE-2","category_hint":"materiales"}}' },
  { input: 'Carga al P-12 un gasto de 50 mil en materiales', output: '{"intent":"GASTO_DIRECTO","confidence":0.95,"fields":{"amount":50000,"concept":"materiales","project_code":"P-012","category_hint":"materiales"}}' },
  { input: 'Iniciar timer en FAB-1', output: '{"intent":"TIMER_INICIAR","confidence":0.93,"fields":{"project_code":"FAB-1"}}' },
  { input: 'Me pagaron 2 millones del P-5', output: '{"intent":"COBRO","confidence":0.92,"fields":{"amount":2000000,"project_code":"P-005"}}' },
  { input: 'Gaste 182300 insumos eléctricos al proyecto tráiler KAE-2', output: '{"intent":"GASTO_DIRECTO","confidence":0.95,"fields":{"amount":182300,"concept":"insumos eléctricos","project_code":"KAE-2","category_hint":"materiales"}}' },
  { input: 'Gaste 182300 para compra de insumos eléctricos. Presta Mauricio Moreno. Al proyecto tráiler KAE-2', output: '{"intent":"GASTO_DIRECTO","confidence":0.95,"fields":{"amount":182300,"concept":"insumos eléctricos","project_code":"KAE-2","category_hint":"materiales"}}' },
  { input: 'Pagué 50 mil de taxi para ir a reunión con cliente', output: '{"intent":"GASTO_DIRECTO","confidence":0.88,"fields":{"amount":50000,"concept":"taxi reunión cliente","category_hint":"transporte"}}' },
];

export async function parseMessage(userMessage: string): Promise<ParseResult> {
  // Try Gemini first, fall back to regex if unavailable
  const geminiResult = await tryGemini(userMessage);
  if (geminiResult) return geminiResult;

  // Fallback: regex-based parser for common patterns
  console.log('[wa-parse] Using regex fallback');
  return regexParse(userMessage);
}

// ============================================================
// Gemini NLP Parser
// ============================================================

async function tryGemini(userMessage: string): Promise<ParseResult | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;

  const fewShotParts = FEW_SHOT_EXAMPLES.flatMap((ex) => [
    { role: 'user', parts: [{ text: ex.input }] },
    { role: 'model', parts: [{ text: ex.output }] },
  ]);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          ...fewShotParts,
          { role: 'user', parts: [{ text: userMessage }] },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 256,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[wa-parse] Gemini error: ${res.status} — falling back to regex`);
      return null; // Fall back to regex
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const parsed: ParseResult = JSON.parse(text);
    if (parsed.confidence < 0.6) return { ...parsed, intent: 'UNCLEAR' };
    return parsed;
  } catch (err) {
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
