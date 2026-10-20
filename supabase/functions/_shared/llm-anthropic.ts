// ============================================================
// El modelo de lenguaje de ONE: Claude Haiku 5.5 detrás de los pedidos que hoy hablan Gemini
// ------------------------------------------------------------
// Mauricio, 2026-10-20: «copiemos el modelo que tenemos hoy con Gemini y lo probemos en casos reales […] apagar
// Gemini y poner Claude Haiku. El 5.5».
//
// Cómo: cada sitio arma HOY un cuerpo de `generateContent` de Gemini y lee una respuesta de Gemini. Para no reescribir
// ni un prompt ni un contrato, los sitios cambian `fetch(urlGemini, init)` por `fetchModelo(urlGemini, init)`. Este
// archivo traduce el cuerpo a la API de Mensajes de Anthropic, llama a `claude-haiku-5-5` y devuelve una `Response`
// con la FORMA de Gemini (candidates/finishReason/usageMetadata). El prompt, el esquema, el manejo de errores y los
// tiempos máximos (el `signal` del init) de cada sitio quedan como estaban.
//
// Es el punto único del modelo para los dos lados: el edge (Deno) lo importa directo y Next lo importa por
// `src/lib/ai/modelo-llm.ts` (mismo patrón que `lectura-gemini.ts`). Sin `Deno` ni `process` a nivel de módulo.
//
// El interruptor (`LLM_PROVEEDOR`):
//   · `anthropic` (por defecto) → Haiku 5.5, si hay `ANTHROPIC_API_KEY`.
//   · `gemini` → el `fetch` de siempre, sin tocar nada. Vuelve a Gemini sin redesplegar código.
//   · Sin `ANTHROPIC_API_KEY` → también Gemini (con un aviso en el log). Así el código puede desplegarse antes que
//     la llave y no cambia nada hasta que la llave exista.
//
// Lo que NO se traduce y sigue en Gemini (aviso en el log): audio y video (Haiku 5.5 no recibe audio; los dos sitios
// de transcripción ni siquiera pasan por aquí), tipos de imagen que la API de Anthropic no acepta (HEIC/HEIF…) e
// imágenes de más de 5 MB (el tope por imagen de la API de Mensajes).
//
// Datos de Haiku 5.5 (doc oficial de Anthropic, verificada por la sesión principal el 2026-10-20, y la tabla de
// capacidades de `@ai-sdk/anthropic` 4.0.82, que cita https://platform.claude.com/docs/en/build-with-claude/structured-outputs):
//   · id `claude-haiku-5-5`; USD 0,10 / MTok de entrada y 0,50 / MTok de salida (prompts ≤ 100 k).
//   · NO acepta parámetros de muestreo (`temperature`, `top_p`, `top_k`): se quitan.
//   · Pensamiento adaptativo con `output_config.effort`; NO acepta `budget_tokens`; sí acepta `thinking: disabled`.
//   · Salida JSON con esquema: `output_config.format = { type: 'json_schema', schema }` (GA, sin cabecera beta).
//   · Herramientas forzadas (`tool_choice` any/tool) sí, pero sin pensamiento: con herramienta forzada se apaga.
// ============================================================

export const MODELO_HAIKU = 'claude-haiku-5-5';
/** USD por millón de tokens (prompts de hasta 100 k tokens). */
export const PRECIO_HAIKU = { entrada: 0.1, salida: 0.5 } as const;
export const URL_ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const VERSION_ANTHROPIC = '2023-06-01';
/** Tope de salida de Haiku 5.5. */
const MAX_SALIDA_HAIKU = 128_000;
/** Cuando el pedido de Gemini no fija tope (Gemini usa el del modelo). */
const SALIDA_POR_DEFECTO = 16_000;
/** Tope por imagen de la API de Mensajes. */
const BYTES_MAX_IMAGEN = 5 * 1024 * 1024;
const IMAGENES_ANTHROPIC = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const FORMATOS_STRING = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);

export type ProveedorLLM = 'anthropic' | 'gemini';
type Entorno = (k: string) => string | undefined;

/** Lee una variable en Deno o en Node, sin depender de ninguno al importar. */
export function entornoPorDefecto(k: string): string | undefined {
  const g = globalThis as unknown as {
    Deno?: { env?: { get(k: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  try {
    const v = g.Deno?.env?.get(k);
    if (v !== undefined) return v;
  } catch {
    // Deno sin permiso de entorno: se sigue con process.
  }
  return g.process?.env?.[k];
}

/** `LLM_PROVEEDOR`: solo `gemini` explícito vuelve a Gemini; cualquier otro valor (o ninguno) es Anthropic. */
export function proveedorLLM(valor: string | undefined | null): ProveedorLLM {
  return (valor ?? '').trim().toLowerCase() === 'gemini' ? 'gemini' : 'anthropic';
}

export function esUrlGemini(url: string): boolean {
  return /^https:\/\/generativelanguage\.googleapis\.com\/.+:generateContent/.test(url);
}

// ── Esquemas ────────────────────────────────────────────────────────────────

type Esq = Record<string, unknown>;
const RESTRICCIONES = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'multipleOf'];

/**
 * El esquema de Gemini (OpenAPI recortado: tipos en mayúscula, `nullable`, `propertyOrdering`) como JSON Schema que
 * acepta la salida estructurada de Anthropic: tipos en minúscula, `nullable` → `anyOf` con `null`, objetos con
 * `additionalProperties: false`, y las restricciones que no soporta pasan a la descripción (lo mismo que hace
 * `sanitizeJsonSchema` de `@ai-sdk/anthropic`). Pura.
 */
export function esquemaJsonDesdeGemini(e: unknown): unknown {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return e;
  const s = e as Esq;
  const r: Esq = {};
  if (typeof s.description === 'string') r.description = s.description;
  if (typeof s.title === 'string') r.title = s.title;
  if (s.enum !== undefined) r.enum = s.enum;
  if (s.const !== undefined) r.const = s.const;
  let tipo: unknown = s.type;
  if (typeof tipo === 'string') tipo = tipo.toLowerCase();
  else if (Array.isArray(tipo)) tipo = tipo.map((t) => (typeof t === 'string' ? t.toLowerCase() : t));
  if (tipo !== undefined && tipo !== 'type_unspecified') r.type = tipo;
  if (Array.isArray(s.anyOf)) r.anyOf = s.anyOf.map(esquemaJsonDesdeGemini);
  else if (Array.isArray(s.oneOf)) r.anyOf = s.oneOf.map(esquemaJsonDesdeGemini);
  if (s.properties && typeof s.properties === 'object') {
    r.properties = Object.fromEntries(Object.entries(s.properties as Esq).map(([k, v]) => [k, esquemaJsonDesdeGemini(v)]));
  }
  if (r.type === 'object' || r.properties) {
    if (!r.properties) r.properties = {};
    r.additionalProperties = false;
    if (Array.isArray(s.required)) r.required = s.required;
  }
  if (s.items !== undefined) r.items = esquemaJsonDesdeGemini(s.items);
  if (typeof s.format === 'string' && FORMATOS_STRING.has(s.format)) r.format = s.format;
  const notas = RESTRICCIONES.filter((k) => s[k] !== undefined).map((k) => `${k}: ${JSON.stringify(s[k])}`);
  if (typeof s.format === 'string' && !FORMATOS_STRING.has(s.format) && s.format !== 'enum') notas.push(`format: ${s.format}`);
  if (notas.length) r.description = [r.description, `${notas.join('; ')}.`].filter(Boolean).join('\n');
  if (s.nullable === true) {
    const { description, ...sinDesc } = r;
    return { ...(description ? { description } : {}), anyOf: [sinDesc, { type: 'null' }] };
  }
  return r;
}

// ── El pedido ───────────────────────────────────────────────────────────────

interface ParteGemini {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inline_data?: { mime_type?: string; data?: string };
  inlineData?: { mimeType?: string; data?: string };
  file_data?: unknown;
  fileData?: unknown;
  functionCall?: { name: string; args?: unknown; id?: string };
  functionResponse?: { name: string; response?: unknown; id?: string };
}
interface ContenidoGemini { role?: string; parts?: ParteGemini[] }

type Bloque = Record<string, unknown>;
interface MensajeAnthropic { role: 'user' | 'assistant'; content: Bloque[] }

export type Traduccion =
  | { ok: true; cuerpo: Record<string, unknown>; conEsquema: boolean }
  | { ok: false; motivo: string };

function textoDeSistema(c: Record<string, unknown>): string {
  const si = (c.system_instruction ?? c.systemInstruction) as { parts?: ParteGemini[] } | undefined;
  return (si?.parts ?? []).map((p) => p.text ?? '').filter(Boolean).join('\n');
}

function decodificarBase64Texto(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** El esfuerzo de pensamiento de Anthropic desde el `thinkingConfig` de Gemini. `null` = sin pensamiento. */
export function esfuerzoDesdeGemini(tc: unknown): 'low' | 'medium' | 'high' | null {
  if (!tc || typeof tc !== 'object') return null;
  const t = tc as { thinkingBudget?: unknown; thinkingLevel?: unknown; thinking_level?: unknown };
  const nivel = String(t.thinkingLevel ?? t.thinking_level ?? '').toLowerCase();
  if (nivel) return nivel === 'high' ? 'high' : nivel === 'medium' ? 'medium' : 'low';
  if (typeof t.thinkingBudget === 'number') {
    if (t.thinkingBudget === 0) return null;
    if (t.thinkingBudget < 0) return 'medium'; // -1 = dinámico en Gemini
    return t.thinkingBudget <= 2048 ? 'low' : t.thinkingBudget <= 8192 ? 'medium' : 'high';
  }
  return null;
}

/**
 * El cuerpo de Gemini como cuerpo de la API de Mensajes. Pura. `ok:false` cuando el pedido trae algo que Haiku 5.5
 * no recibe (audio, video, imagen de un tipo o tamaño que la API no acepta): ese pedido sigue en Gemini.
 */
export function cuerpoAnthropicDesdeGemini(cuerpo: unknown, modelo: string = MODELO_HAIKU): Traduccion {
  if (!cuerpo || typeof cuerpo !== 'object') return { ok: false, motivo: 'cuerpo vacío' };
  const c = cuerpo as Record<string, unknown>;
  const contenidos = (Array.isArray(c.contents) ? c.contents : []) as ContenidoGemini[];
  const gc = (c.generationConfig ?? {}) as Record<string, unknown>;

  const mensajes: MensajeAnthropic[] = [];
  // Ids de tool_use emitidos y aún sin respuesta, por nombre (Gemini empareja la respuesta por nombre y orden).
  const pendientes = new Map<string, string[]>();
  let n = 0;

  for (const cont of contenidos) {
    const rol: 'user' | 'assistant' = cont.role === 'model' ? 'assistant' : 'user';
    const resultados: Bloque[] = [];
    const bloques: Bloque[] = [];
    for (const p of cont.parts ?? []) {
      if (p.thought) continue; // el razonamiento de Gemini no viaja
      if (p.file_data || p.fileData) return { ok: false, motivo: 'file_data (archivo subido a Google)' };
      const inline = p.inline_data ?? (p.inlineData ? { mime_type: p.inlineData.mimeType, data: p.inlineData.data } : undefined);
      if (inline) {
        const mime = (inline.mime_type ?? '').toLowerCase().split(';')[0].trim();
        const data = inline.data ?? '';
        if (mime.startsWith('audio/') || mime.startsWith('video/')) return { ok: false, motivo: `${mime}: Haiku 5.5 no recibe audio ni video` };
        if (mime === 'application/pdf') {
          bloques.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
        } else if (mime === 'image/jpg' || IMAGENES_ANTHROPIC.has(mime)) {
          if (Math.floor((data.length * 3) / 4) > BYTES_MAX_IMAGEN) return { ok: false, motivo: `imagen de más de 5 MB (${mime})` };
          bloques.push({ type: 'image', source: { type: 'base64', media_type: mime === 'image/jpg' ? 'image/jpeg' : mime, data } });
        } else if (mime.startsWith('text/') || mime === 'application/json') {
          bloques.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: decodificarBase64Texto(data) } });
        } else {
          return { ok: false, motivo: `tipo ${mime || '(vacío)'} no lo recibe la API de Anthropic` };
        }
        continue;
      }
      if (p.functionCall) {
        const id = `toolu_g${++n}`;
        const cola = pendientes.get(p.functionCall.name) ?? [];
        cola.push(id);
        pendientes.set(p.functionCall.name, cola);
        bloques.push({ type: 'tool_use', id, name: p.functionCall.name, input: p.functionCall.args ?? {} });
        continue;
      }
      if (p.functionResponse) {
        const id = pendientes.get(p.functionResponse.name)?.shift();
        const contenido = JSON.stringify(p.functionResponse.response ?? {});
        // Una respuesta sin llamada emparejada no puede ir como tool_result: va como texto.
        if (id) resultados.push({ type: 'tool_result', tool_use_id: id, content: contenido });
        else bloques.push({ type: 'text', text: `[${p.functionResponse.name}] ${contenido}` });
        continue;
      }
      if (typeof p.text === 'string' && p.text.length) bloques.push({ type: 'text', text: p.text });
    }
    // Anthropic exige los tool_result al principio del mensaje del usuario.
    const content = [...resultados, ...bloques];
    if (!content.length) continue;
    const previo = mensajes[mensajes.length - 1];
    if (previo && previo.role === rol) {
      if (rol === 'user' && resultados.length) previo.content = [...resultados, ...previo.content, ...bloques];
      else previo.content.push(...content);
    } else {
      mensajes.push({ role: rol, content });
    }
  }
  if (!mensajes.length) return { ok: false, motivo: 'sin contenido' };

  // Herramientas (el bot conversacional).
  const decl = ((Array.isArray(c.tools) ? c.tools : []) as Array<{ functionDeclarations?: Array<Record<string, unknown>> }>)
    .flatMap((t) => t.functionDeclarations ?? []);
  const fcc = ((c.toolConfig ?? c.tool_config) as { functionCallingConfig?: { mode?: string; allowedFunctionNames?: string[] } } | undefined)
    ?.functionCallingConfig;
  const modo = (fcc?.mode ?? 'AUTO').toUpperCase();
  const permitidas = fcc?.allowedFunctionNames?.length ? new Set(fcc.allowedFunctionNames) : null;
  const herramientas = decl
    .filter((d) => !permitidas || permitidas.has(String(d.name)))
    .map((d) => ({
      name: String(d.name),
      ...(typeof d.description === 'string' ? { description: d.description } : {}),
      input_schema: d.parametersJsonSchema
        ? (d.parametersJsonSchema as Esq)
        : d.parameters ? (esquemaJsonDesdeGemini(d.parameters) as Esq) : { type: 'object', properties: {} },
    }));
  let toolChoice: Record<string, unknown> | null = null;
  if (herramientas.length) {
    if (modo === 'ANY') toolChoice = herramientas.length === 1 ? { type: 'tool', name: herramientas[0].name } : { type: 'any' };
    else if (modo === 'NONE') toolChoice = { type: 'none' };
    else toolChoice = { type: 'auto' };
  }
  const herramientaForzada = toolChoice?.type === 'any' || toolChoice?.type === 'tool';

  // Salida JSON.
  const mime = String(gc.responseMimeType ?? gc.response_mime_type ?? '').toLowerCase();
  const esquemaG = gc.responseJsonSchema ?? gc.response_json_schema ?? gc.responseSchema ?? gc.response_schema;
  const quiereJson = mime === 'application/json';
  // `responseSchema` (OpenAPI de Gemini) y `responseJsonSchema` (JSON Schema) pasan por la misma normalización.
  const esquema = quiereJson && esquemaG ? esquemaJsonDesdeGemini(esquemaG) : null;

  let sistema = textoDeSistema(c);
  // `responseMimeType: application/json` sin esquema: Gemini garantiza JSON; aquí se pide en el sistema.
  if (quiereJson && !esquema) {
    sistema = [sistema, 'Responde únicamente con un objeto JSON válido, sin texto alrededor ni cercas de código.'].filter(Boolean).join('\n\n');
  }

  const maxSalida = typeof gc.maxOutputTokens === 'number' && gc.maxOutputTokens > 0 ? gc.maxOutputTokens : SALIDA_POR_DEFECTO;
  const esfuerzo = herramientaForzada ? null : esfuerzoDesdeGemini(gc.thinkingConfig ?? gc.thinking_config);
  const outputConfig: Record<string, unknown> = {};
  if (esfuerzo) outputConfig.effort = esfuerzo;
  if (esquema) outputConfig.format = { type: 'json_schema', schema: esquema };
  const stop = Array.isArray(gc.stopSequences) ? gc.stopSequences : null;

  const salida: Record<string, unknown> = {
    model: modelo,
    max_tokens: Math.min(Math.round(maxSalida), MAX_SALIDA_HAIKU),
    ...(sistema ? { system: sistema } : {}),
    messages: mensajes,
    thinking: esfuerzo ? { type: 'adaptive' } : { type: 'disabled' },
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    ...(herramientas.length ? { tools: herramientas, tool_choice: toolChoice } : {}),
    ...(stop?.length ? { stop_sequences: stop } : {}),
  };
  return { ok: true, cuerpo: salida, conEsquema: !!esquema };
}

// ── La respuesta ────────────────────────────────────────────────────────────

interface RespuestaAnthropic {
  content?: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  model?: string;
}

export function motivoDeFinDesdeAnthropic(stop: string | null | undefined): string {
  switch (stop) {
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_use':
      return 'STOP';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'MAX_TOKENS';
    case 'refusal':
      return 'SAFETY';
    default:
      return 'OTHER';
  }
}

/** La respuesta de Anthropic con la forma de `generateContent` de Gemini. Pura. */
export function respuestaGeminiDesdeAnthropic(r: RespuestaAnthropic): Record<string, unknown> {
  const partes: ParteGemini[] = [];
  for (const b of r.content ?? []) {
    if (b.type === 'text' && typeof b.text === 'string') partes.push({ text: b.text });
    else if (b.type === 'tool_use' && b.name) partes.push({ functionCall: { name: b.name, args: b.input ?? {} } });
  }
  const u = r.usage ?? {};
  const cacheLeido = u.cache_read_input_tokens ?? 0;
  const entrada = (u.input_tokens ?? 0) + cacheLeido + (u.cache_creation_input_tokens ?? 0);
  const salida = u.output_tokens ?? 0;
  return {
    candidates: [{ content: { role: 'model', parts: partes }, finishReason: motivoDeFinDesdeAnthropic(r.stop_reason), index: 0 }],
    usageMetadata: {
      promptTokenCount: entrada,
      candidatesTokenCount: salida,
      totalTokenCount: entrada + salida,
      ...(cacheLeido ? { cachedContentTokenCount: cacheLeido } : {}),
    },
    modelVersion: r.model ?? MODELO_HAIKU,
  };
}

/** El código HTTP que verán los sitios: el de Anthropic, salvo 529 (saturado) que en Gemini es 503. */
export function estadoParaGemini(estado: number): number {
  return estado === 529 ? 503 : estado;
}

export function costoUsd(tokensEntrada: number, tokensSalida: number): number {
  return (tokensEntrada * PRECIO_HAIKU.entrada + tokensSalida * PRECIO_HAIKU.salida) / 1_000_000;
}

// ── El fetch ────────────────────────────────────────────────────────────────

export interface OpcionesFetchModelo {
  entorno?: Entorno;
  /** El fetch de verdad (por defecto `globalThis.fetch`, leído en cada llamada para que las pruebas lo reemplacen). */
  fetch?: typeof fetch;
  modelo?: string;
  avisar?: (m: string) => void;
}

function respuestaJson(cuerpo: unknown, estado: number): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });
}

const avisados = new Set<string>();
function avisarUnaVez(avisar: (m: string) => void, m: string) {
  if (avisados.has(m)) return;
  avisados.add(m);
  avisar(m);
}

/**
 * Un `fetch` que entiende pedidos de Gemini. Si el proveedor es Anthropic y hay llave, un `generateContent` va a
 * Haiku 5.5 y vuelve con la forma de Gemini; todo lo demás (otro proveedor, sin llave, otra URL, lo que no se puede
 * traducir) va al `fetch` de siempre sin cambios.
 */
export function crearFetchModelo(o: OpcionesFetchModelo = {}): typeof fetch {
  const entorno = o.entorno ?? entornoPorDefecto;
  const avisar = o.avisar ?? ((m: string) => console.warn(m));
  const modelo = o.modelo ?? MODELO_HAIKU;
  const fetchModelo = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const real = o.fetch ?? globalThis.fetch;
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (!esUrlGemini(url) || proveedorLLM(entorno('LLM_PROVEEDOR')) === 'gemini') return real(entrada, init);
    const llave = (entorno('ANTHROPIC_API_KEY') ?? '').trim();
    if (!llave) {
      avisarUnaVez(avisar, '[llm] LLM_PROVEEDOR=anthropic pero falta ANTHROPIC_API_KEY: sigue en Gemini');
      return real(entrada, init);
    }
    let cuerpoGemini: unknown;
    try {
      cuerpoGemini = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    } catch {
      cuerpoGemini = null;
    }
    const t = cuerpoAnthropicDesdeGemini(cuerpoGemini, modelo);
    if (!t.ok) {
      avisar(`[llm] pedido sin traducir a Anthropic (${t.motivo}): sigue en Gemini`);
      return real(entrada, init);
    }
    const llamar = (cuerpo: Record<string, unknown>) =>
      real(URL_ANTHROPIC, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': llave, 'anthropic-version': VERSION_ANTHROPIC },
        body: JSON.stringify(cuerpo),
        signal: init?.signal ?? undefined,
      });
    let res = await llamar(t.cuerpo);
    if (res.status === 400 && t.conEsquema) {
      // El esquema puede pasarse de lo que acepta la salida estructurada (complejidad, uniones). Se reintenta una
      // vez sin `format`, con el esquema dicho en el sistema: el sitio igual valida el JSON como siempre.
      const detalle = await res.clone().text();
      if (/schema|output_config|format/i.test(detalle)) {
        const { output_config, ...resto } = t.cuerpo as { output_config?: Record<string, unknown> } & Record<string, unknown>;
        const esquema = (output_config?.format as { schema?: unknown } | undefined)?.schema;
        const oc = output_config?.effort ? { output_config: { effort: output_config.effort } } : {};
        const sistema = [resto.system, `Responde únicamente con un objeto JSON válido que cumpla este JSON Schema, sin texto alrededor ni cercas de código:\n${JSON.stringify(esquema)}`]
          .filter(Boolean).join('\n\n');
        avisar(`[llm] la salida estructurada rechazó el esquema; reintento con el esquema en el sistema: ${detalle.slice(0, 200)}`);
        res = await llamar({ ...resto, ...oc, system: sistema });
      }
    }
    const texto = await res.text();
    if (!res.ok) {
      let mensaje = texto.slice(0, 500);
      try {
        mensaje = (JSON.parse(texto) as { error?: { message?: string } }).error?.message ?? mensaje;
      } catch {
        // texto plano
      }
      const estado = estadoParaGemini(res.status);
      return respuestaJson({ error: { code: estado, message: `anthropic ${res.status}: ${mensaje}`, status: 'ANTHROPIC_ERROR' } }, estado);
    }
    let datos: RespuestaAnthropic;
    try {
      datos = JSON.parse(texto) as RespuestaAnthropic;
    } catch {
      return respuestaJson({ error: { code: 502, message: 'anthropic: respuesta que no es JSON', status: 'ANTHROPIC_ERROR' } }, 502);
    }
    return respuestaJson(respuestaGeminiDesdeAnthropic(datos), 200);
  };
  return fetchModelo as typeof fetch;
}

/** El fetch del modelo con el entorno del runtime (Deno o Node). */
export const fetchModelo: typeof fetch = crearFetchModelo();
