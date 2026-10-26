// ============================================================
// Núcleo conversacional — el adaptador nativo de Anthropic (API de Mensajes), sin respaldo
// ------------------------------------------------------------
// Diseño del asistente de Sabor (§1, §4.1): «(recomendado) un adaptador `Modelo` nativo de Anthropic en vez de la
// traducción». Por qué no alcanza el shim `../llm-anthropic.ts` (`fetchModelo`) para el asistente público:
//   · respalda SIEMPRE en Gemini si el pedido trae llave de Gemini, y `LLM_PROVEEDOR=gemini` devuelve TODO a Gemini sin
//     redesplegar: para Sabor no hay modelo de respaldo (D1, Mauricio 2026-10-20) y el interruptor global no puede
//     cambiarle el modelo a un bot público sin pasar el arnés;
//   · un rechazo (`stop_reason: refusal`) llega como «sin llamada (SAFETY)», igual que otras fallas: aquí se distingue,
//     porque ante un rechazo no se reintenta (§4.1) y ante un error sí;
//   · no pone puntos de caché (herramientas → sistema), ni `strict` en las herramientas, ni elige el esfuerzo por
//     workspace (D5).
// Este archivo implementa `Modelo` directo contra `https://api.anthropic.com/v1/messages`. El núcleo no cambia.
//
// Datos de Haiku 5.5 (doc oficial de Anthropic, verificada el 2026-10-20; ver cabecera de `llm-anthropic.ts`):
// sin `temperature`/`top_p`/`top_k`; pensamiento adaptativo con `output_config.effort`; herramienta forzada
// (`tool_choice` any/tool) solo SIN pensamiento: con pensamiento, `tool_choice: auto` y una respuesta sin herramienta
// cuenta como falla («sin llamada»).
// SIN VERIFICAR contra la API viva (no hay llave de pruebas en esta corrida): que `output_config.effort` se acepte con
// `thinking: disabled` (si la API lo rechaza con 400, se reintenta una vez sin `output_config`), el mínimo de tokens
// para que el caché aplique en Haiku 5.5, y `strict: true` con los esquemas del núcleo.
// ============================================================

import { ajustarEsquema, esquemaJsonDesdeGemini, MODELO_HAIKU, URL_ANTHROPIC } from '../llm-anthropic.ts';
import type { Mensaje, Modelo, Parte, PedidoModelo, RespuestaModelo, UsoLlamado } from './tipos.ts';

const VERSION_ANTHROPIC = '2023-06-01';
const REDACTADO = '__redactado__';

export interface OpcionesAnthropic {
  llave: string;
  modelo?: string;
  /** `output_config.effort`. `null` = no se manda. */
  esfuerzo: 'low' | 'medium' | 'high' | null;
  pensamiento: boolean;
  maxSalida: number;
  /** `strict: true` en las herramientas cuyo esquema cabe en los topes de la salida estructurada. */
  estricto: boolean;
  fetch?: typeof fetch;
  ahora?: () => number;
}

type Bloque = Record<string, unknown>;
interface MensajeA { role: 'user' | 'assistant'; content: Bloque[] }

/** Los mensajes del núcleo (forma de Gemini) como mensajes de Anthropic. Ids de herramienta reales o emparejados. Pura. */
export function mensajesAnthropic(mensajes: Mensaje[], modelo: string, pensamiento: boolean): MensajeA[] {
  const out: MensajeA[] = [];
  const pendientes = new Map<string, string[]>();
  let n = 0;
  for (const m of mensajes) {
    const rol: MensajeA['role'] = m.role === 'model' ? 'assistant' : 'user';
    const propio = m.role === 'model' && (m.modelo ?? modelo) === modelo;
    const resultados: Bloque[] = [];
    const bloques: Bloque[] = [];
    for (const p of m.parts) {
      if (p.thought) {
        // El razonamiento solo vuelve si es de este modelo y hay pensamiento (la API exige su firma intacta).
        if (propio && pensamiento && p.thoughtSignature) {
          bloques.push(p.text === REDACTADO ? { type: 'redacted_thinking', data: p.thoughtSignature } : { type: 'thinking', thinking: p.text ?? '', signature: p.thoughtSignature });
        }
        continue;
      }
      if (p.functionCall) {
        const id = p.functionCall.id ?? `toolu_n${++n}`;
        const cola = pendientes.get(p.functionCall.name) ?? [];
        cola.push(id);
        pendientes.set(p.functionCall.name, cola);
        bloques.push({ type: 'tool_use', id, name: p.functionCall.name, input: p.functionCall.args ?? {} });
        continue;
      }
      if (p.functionResponse) {
        const cola = pendientes.get(p.functionResponse.name) ?? [];
        const id = p.functionResponse.id && cola.includes(p.functionResponse.id) ? p.functionResponse.id : cola[0];
        if (id) {
          pendientes.set(p.functionResponse.name, cola.filter((x) => x !== id));
          resultados.push({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(p.functionResponse.response ?? {}) });
        } else {
          bloques.push({ type: 'text', text: `[${p.functionResponse.name}] ${JSON.stringify(p.functionResponse.response ?? {})}` });
        }
        continue;
      }
      if (typeof p.text === 'string' && p.text.length) bloques.push({ type: 'text', text: p.text });
    }
    const content = [...resultados, ...bloques];
    if (!content.length) continue;
    const previo = out.at(-1);
    if (previo && previo.role === rol) {
      previo.content = rol === 'user' && resultados.length ? [...resultados, ...previo.content, ...bloques] : [...previo.content, ...content];
    } else {
      out.push({ role: rol, content });
    }
  }
  return out;
}

/** El cuerpo del pedido. Pura (se prueba sin red). */
export function cuerpoAnthropic(p: PedidoModelo, o: Pick<OpcionesAnthropic, 'modelo' | 'esfuerzo' | 'pensamiento' | 'maxSalida' | 'estricto'>, conEsfuerzo = true): Record<string, unknown> {
  const modelo = o.modelo ?? MODELO_HAIKU;
  const permitidas = new Set(p.permitidas);
  // Las herramientas en el orden del núcleo (estable: así el prefijo es el mismo en cada turno y el caché aplica).
  const herramientas = p.herramientas.filter((h) => permitidas.has(h.name)).map((h) => {
    const esquema = esquemaJsonDesdeGemini(h.parameters) as Bloque;
    const ajuste = o.estricto ? ajustarEsquema(esquema) : null;
    const estricto = ajuste?.modo === 'estricto' && !ajuste.promovido;
    return { name: h.name, description: h.description, input_schema: esquema, ...(estricto ? { strict: true } : {}) } as Bloque;
  });
  if (herramientas.length) herramientas[herramientas.length - 1] = { ...herramientas[herramientas.length - 1], cache_control: { type: 'ephemeral' } };
  const toolChoice = !herramientas.length ? null
    : o.pensamiento ? { type: 'auto' }
      : herramientas.length === 1 ? { type: 'tool', name: herramientas[0].name } : { type: 'any' };
  return {
    model: modelo,
    max_tokens: o.maxSalida,
    system: [{ type: 'text', text: p.sistema, cache_control: { type: 'ephemeral' } }],
    messages: mensajesAnthropic(p.mensajes, modelo, o.pensamiento),
    thinking: o.pensamiento ? { type: 'adaptive' } : { type: 'disabled' },
    ...(conEsfuerzo && o.esfuerzo ? { output_config: { effort: o.esfuerzo } } : {}),
    ...(herramientas.length ? { tools: herramientas, tool_choice: toolChoice } : {}),
  };
}

interface RespuestaA {
  content?: Array<{ type: string; text?: string; thinking?: string; signature?: string; data?: string; name?: string; input?: unknown; id?: string }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  model?: string;
}

/** La respuesta de Anthropic como mensaje del núcleo. `refusal` es su propio motivo (no se reintenta). Pura. */
export function leerRespuestaAnthropic(d: RespuestaA, modelo: string): { ok: true; mensaje: Mensaje; tokens: Omit<UsoLlamado, 'modelo' | 'ms' | 'ok'> } | { ok: false; motivo: string; tokens: Omit<UsoLlamado, 'modelo' | 'ms' | 'ok'> } {
  const u = d.usage ?? {};
  const cache = u.cache_read_input_tokens ?? 0;
  const tokens = { entrada: (u.input_tokens ?? 0) + cache + (u.cache_creation_input_tokens ?? 0), salida: u.output_tokens ?? 0, razonamiento: 0, cache };
  if (d.stop_reason === 'refusal') return { ok: false, motivo: 'refusal', tokens };
  const partes: Parte[] = [];
  for (const b of d.content ?? []) {
    if (b.type === 'thinking') partes.push({ thought: true, text: b.thinking ?? '', thoughtSignature: b.signature });
    else if (b.type === 'redacted_thinking') partes.push({ thought: true, text: REDACTADO, thoughtSignature: b.data });
    else if (b.type === 'tool_use' && b.name) partes.push({ functionCall: { name: b.name, args: (b.input ?? {}) as Record<string, unknown>, ...(b.id ? { id: b.id } : {}) } });
    else if (b.type === 'text' && b.text) partes.push({ text: b.text });
  }
  if (!partes.some((x) => x.functionCall)) return { ok: false, motivo: `sin llamada (${d.stop_reason ?? 'vacío'})`, tokens };
  return { ok: true, mensaje: { role: 'model', parts: partes, modelo: d.model ?? modelo }, tokens };
}

export function modeloAnthropic(o: OpcionesAnthropic): Modelo {
  const modelo = o.modelo ?? MODELO_HAIKU;
  return {
    async llamar(p: PedidoModelo): Promise<RespuestaModelo> {
      const ahora = o.ahora ?? (() => performance.now());
      const f = o.fetch ?? ((u: RequestInfo | URL, i?: RequestInit) => globalThis.fetch(u, i));
      const t0 = ahora();
      const uso = (ok: boolean, extra: Partial<UsoLlamado> = {}): UsoLlamado => ({ modelo, entrada: 0, salida: 0, razonamiento: 0, cache: 0, ms: Math.round(ahora() - t0), ok, ...extra });
      const signal = AbortSignal.timeout(Math.max(200, Math.round(p.timeoutMs)));
      const llamar = (conEsfuerzo: boolean) => f(URL_ANTHROPIC, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': o.llave, 'anthropic-version': VERSION_ANTHROPIC },
        body: JSON.stringify(cuerpoAnthropic(p, { ...o, modelo }, conEsfuerzo)),
        signal,
      });
      try {
        let res = await llamar(true);
        if (res.status === 400 && o.esfuerzo) {
          const detalle = await res.clone().text();
          if (/effort|output_config/i.test(detalle)) res = await llamar(false);
        }
        const texto = await res.text();
        if (!res.ok) {
          const motivo = `http ${res.status}`;
          return { ok: false, motivo, usos: [uso(false, { motivo: `${motivo}: ${texto.slice(0, 200).replace(/\s+/g, ' ')}` })] };
        }
        let d: RespuestaA;
        try {
          d = JSON.parse(texto) as RespuestaA;
        } catch {
          return { ok: false, motivo: 'respuesta que no es JSON', usos: [uso(false, { motivo: 'respuesta que no es JSON' })] };
        }
        const r = leerRespuestaAnthropic(d, modelo);
        if (!r.ok) return { ok: false, motivo: r.motivo, usos: [uso(false, { ...r.tokens, motivo: r.motivo })] };
        return { ok: true, mensaje: r.mensaje, usos: [uso(true, r.tokens)] };
      } catch (e) {
        const nombre = (e as Error)?.name;
        const motivo = nombre === 'TimeoutError' || nombre === 'AbortError' ? 'corte' : `red: ${String(e).slice(0, 80)}`;
        return { ok: false, motivo, usos: [uso(false, { motivo })] };
      }
    },
  };
}
