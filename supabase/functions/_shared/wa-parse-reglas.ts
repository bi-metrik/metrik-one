// ============================================================
// Reglas deterministas del parser del bot de WhatsApp — modulo PURO
//
// Todo lo que NO es la llamada a Gemini: el fast path, el parser de respaldo
// por regex y las capas de defensa que completan campos que el modelo omitio.
// Vive aparte de `wa-parse.ts` porque ese modulo lee `Deno.env` al cargarse y
// vitest no lo puede importar; asi estas reglas si quedan probadas.
// ⚠️ NO usar `\b` de JavaScript con texto que lleve tildes (es ASCII).
// ============================================================

import type { ParseResult } from './types.ts';
import { conDescripcion } from './wa-gasto-descripcion.ts';

// Unified confidence threshold (Vera mantuvo 0.7 — NO bajar)
export const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Defense layer chain: inject project_code, amount fallback, and category_hint
 * from the raw message when the parser missed them.
 */
export function enrichFields(result: ParseResult, rawMessage: string): ParseResult {
  let enriched = injectProjectCode(result, rawMessage);
  enriched = injectAmount(enriched, rawMessage);
  enriched = injectCategoryHint(enriched, rawMessage);
  enriched = conDescripcion(enriched, rawMessage);
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
  // `campaña` exige la eñe: con `campa[ñn]a` "la campana" (una ferretería real, 2026-05-23)
  // caía en marketing.
  [/\b(marketing|publicidad|ads|anuncios?)\b|campañas?/i, 'marketing'],
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

export function fastPathParse(text: string): ParseResult | null {
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
// Regex Fallback Parser — MVP intents only
// ============================================================

export function parseAmount(text: string): number | null {
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

export function regexParse(text: string): ParseResult {
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

  // GASTO — "gasté", "gasto(s)", "pagué", "compré" + monto. También monto + "en/para".
  // "gasto(s)" entra porque los mensajes reales del flujo empiezan asi ("GASTOS DE
  // PINTURA POR 810.000...", "Gasto en DEWALT..."), y solo con `gast[eé]` el
  // respaldo los dejaba en UNCLEAR cuando Gemini no respondia.
  if (/gast[eéo]|pagu[eé]|compr[eé]|invert[ií]/i.test(lower)) {
    // `?? undefined`: parseAmount devuelve null cuando no encuentra monto, y en
    // ParsedFields "sin monto" se representa con el campo AUSENTE, no con null.
    // Sin esto el objeto se arma con amount: null, que es lo que obligo al guard
    // `!== null` de injectAmount y lo que dejaba sesiones persistidas con null.
    const amount = parseAmount(lower) ?? undefined;
    const conceptMatch = lower.match(/(?:en|de)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})(?:\s+(?:para|con|del?|a)\b|$)/i);
    const concept = conceptMatch ? conceptMatch[1].trim() : undefined;
    return {
      intent: 'GASTO',
      confidence: 0.85,
      // Sin `category_hint: concept`: el concepto es texto libre ("tintos") y no una
      // categoria valida del CHECK de gastos; el insert fallaba. La categoria la
      // infiere `injectCategoryHint` por palabras clave.
      fields: { amount, concept, ...projectRef },
    };
  }

  // Mensaje que es SOLO un monto ("18900", "$ 295.000", "50 mil"): es la respuesta
  // del flujo guiado a "¿Cuánto fue el gasto?". Misma regla que el prompt de
  // Gemini: si hay monto, es gasto.
  if (/^\$?\s*\d[\d.,]*\s*(mil|lucas?|palos?|millones?)?$/i.test(lower)) {
    const amount = parseAmount(lower) ?? undefined;
    if (amount) return { intent: 'GASTO', confidence: 0.8, fields: { amount } };
  }

  // Monto al inicio seguido de texto ("10700 invitacion cafe cierre T1261",
  // "14400 para impresion de documentos"): tambien es gasto.
  if (/^\$?\s*\d[\d.,]*\s*(mil|lucas?|palos?|millones?)?\s+\p{L}/iu.test(lower)) {
    const amount = parseAmount(lower) ?? undefined;
    if (amount) return { intent: 'GASTO', confidence: 0.75, fields: { amount, ...projectRef } };
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
