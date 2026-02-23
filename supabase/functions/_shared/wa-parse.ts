// ============================================================
// Gemini 2.0 Flash — NLP Parser (Spec §2, D92)
// Single master prompt for all 16 intents
// ============================================================

import type { ParseResult } from './types.ts';

const GEMINI_MODEL = 'gemini-2.0-flash';

const SYSTEM_PROMPT = `Eres el parser de MéTRIK ONE, un sistema financiero para independientes colombianos.

Tu trabajo: recibir un mensaje de WhatsApp en español colombiano informal y devolver un JSON estructurado con:
1. La intención del mensaje (una de las categorías listadas)
2. Los campos extraídos del texto

REGLAS:
- Responde SOLO con JSON válido, sin texto adicional
- Si no puedes determinar la intención con confianza >70%, usa "UNCLEAR"
- Extrae montos en formato numérico (sin puntos de miles, sin "$")
- Los nombres de personas/empresas van tal cual los escribió el usuario
- Si el mensaje menciona un proyecto/cliente, extráelo como "entity_hint"
- Fechas: si no se menciona, no incluyas el campo (el sistema usa "hoy")
- Montos en pesos colombianos por defecto

INTENCIONES MVP:

REGISTRO:
- GASTO_DIRECTO: Gasto asociable a proyecto ("Gasté X en Y para Z")
- GASTO_OPERATIVO: Gasto general/fijo ("Pagué el arriendo", "Compré internet")
- HORAS: Registro de tiempo ("Trabajé X horas en Y")
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
  { input: 'Hola', output: '{"intent":"UNCLEAR","confidence":0.3,"fields":{}}' },
];

export async function parseMessage(userMessage: string): Promise<ParseResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    console.error('[wa-parse] GEMINI_API_KEY not set');
    return { intent: 'UNCLEAR', confidence: 0, fields: {} };
  }

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
      console.error(`[wa-parse] Gemini error: ${res.status} ${err}`);
      return { intent: 'UNCLEAR', confidence: 0, fields: {} };
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error('[wa-parse] Empty Gemini response');
      return { intent: 'UNCLEAR', confidence: 0, fields: {} };
    }

    const parsed: ParseResult = JSON.parse(text);

    // Enforce confidence threshold (D96)
    if (parsed.confidence < 0.6) {
      return { ...parsed, intent: 'UNCLEAR' };
    }

    return parsed;
  } catch (err) {
    console.error('[wa-parse] Parse error:', err);
    return { intent: 'UNCLEAR', confidence: 0, fields: {} };
  }
}
