// ============================================================
// Arnés — todo el modelo por Haiku 5.5, sin Gemini en ningún punto (2026-10-29)
// ------------------------------------------------------------
// Mauricio, 2026-10-29: «No depende de Gemini. Corre con haiku». El arnés de la bandeja (`correr.ts`) arma pedidos con la
// forma de Gemini (el agente, el comercial simulado, la extracción y los lectores de archivos) y en producción esos
// pedidos van a Haiku por `fetchModelo` (`../../llm-anthropic.ts`). Aquí se arma un `fetch` igual al de producción, pero:
//   · el entorno es fijo (proveedor `anthropic` y la llave de Anthropic que se le pasa): ni `LLM_PROVEEDOR=gemini` ni un
//     interruptor de familia (`LLM_PROVEEDOR_SOPORTES`) en la terminal lo devuelven a Gemini;
//   · el `fetch` de verdad solo deja salir a `api.anthropic.com`: lo que `fetchModelo` mandaría a Gemini (respaldo,
//     pedido que no se traduce) se corta con un error que lo dice. Así una corrida «con Haiku» no gasta en Google sin
//     que se note;
//   · sin llave de Gemini en ningún pedido (no hay respaldo).
// Precios (USD por millón de tokens) de la página oficial de Anthropic, leída el 2026-10-29
// (https://platform.claude.com/docs/en/about-claude/pricing): Claude Haiku 5.5, prompts de hasta 100.000 tokens,
// entrada 0,10, salida 0,50, lectura de caché 0,01. Escribir caché cuesta 0,125 (5 min) y aquí se cuenta como entrada
// (0,10): el gasto puede quedar un poco por debajo si hay escrituras de caché. Prompts de más de 100.000 tokens pagan
// más (0,50 / 2,50) y aquí no se distinguen: los turnos del arnés están muy por debajo.
// ============================================================

import { crearFetchModelo, MODELO_HAIKU, URL_ANTHROPIC } from '../../llm-anthropic.ts';
import type { PrecioModelo } from '../uso.ts';

export { MODELO_HAIKU };

export const PRECIOS_HAIKU: PrecioModelo[] = [
  { modelo: MODELO_HAIKU, entrada: 0.10, salida: 0.50, cache: 0.01 },
];

/** El único destino permitido. */
const HOST_ANTHROPIC = new URL(URL_ANTHROPIC).host;

/** Un `fetch` que solo deja salir a la API de Anthropic; cualquier otro destino lanza (y lo cuenta). */
export function fetchSoloAnthropic(real: typeof fetch = (u, i) => globalThis.fetch(u, i), bloqueados: string[] = []): typeof fetch {
  return ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    let host = '';
    try { host = new URL(url).host; } catch { /* url rara: se bloquea */ }
    if (host !== HOST_ANTHROPIC) {
      bloqueados.push(host || url.slice(0, 60));
      return Promise.reject(new Error(`arnés con Haiku: pedido bloqueado a ${host || 'una url rara'} (sin Gemini)`));
    }
    return real(entrada, init);
  }) as typeof fetch;
}

/** El entorno fijo del arnés con Haiku: proveedor `anthropic` y la llave dada; nada más (ningún interruptor de la terminal). */
export function entornoHaiku(llave: string): (k: string) => string | undefined {
  return (k) => (k === 'ANTHROPIC_API_KEY' ? llave : k === 'LLM_PROVEEDOR' ? 'anthropic' : undefined);
}

export interface ProveedorHaiku {
  /** El `fetch` para pedidos con forma de Gemini: los traduce a Haiku 5.5 y solo sale a Anthropic. */
  fetch: typeof fetch;
  /** Para los lectores (`crearLector`): mismo `fetch` de verdad y mismo entorno. */
  lector: { llaveGemini: ''; fetch: typeof fetch; entorno: (k: string) => string | undefined };
  /** Destinos que se intentaron y se bloquearon (tiene que quedar vacío). */
  bloqueados: string[];
}

/** Todo lo del arnés por Haiku, con la llave de Anthropic. `real`: reemplazable en pruebas. */
export function proveedorHaiku(llave: string, real?: typeof fetch, avisar: (m: string) => void = (m) => console.warn(m)): ProveedorHaiku {
  const bloqueados: string[] = [];
  const soloAnthropic = fetchSoloAnthropic(real, bloqueados);
  const entorno = entornoHaiku(llave);
  return {
    fetch: crearFetchModelo({ entorno, fetch: soloAnthropic, avisar }),
    lector: { llaveGemini: '', fetch: soloAnthropic, entorno },
    bloqueados,
  };
}

/** El pedido de humo: UNA llamada mínima con la forma de Gemini (la que el arnés manda), sin pensamiento. Pura. */
export function pedidoHumo(): { url: string; init: RequestInit } {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_HAIKU}:generateContent`,
    init: {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responde solo: ok' }] }], generationConfig: { maxOutputTokens: 16 } }),
    },
  };
}

/** UNA llamada mínima a Haiku por el `fetch` del arnés. `cuota`: 429 o sin crédito (hay que parar). */
export async function humoHaiku(f: typeof fetch): Promise<{ status: number; ms: number; uso: string; modelo: string; cuota: boolean }> {
  const t0 = performance.now();
  const { url, init } = pedidoHumo();
  let status = 0;
  let cuerpo = '';
  try {
    const res = await f(url, { ...init, signal: AbortSignal.timeout(30_000) });
    status = res.status;
    cuerpo = await res.text();
  } catch (e) {
    cuerpo = String(e);
  }
  let uso = '';
  let modelo = '';
  try {
    const d = JSON.parse(cuerpo);
    const u = d.usageMetadata ?? {};
    uso = `entrada ${u.promptTokenCount ?? 0}, salida ${u.candidatesTokenCount ?? 0}`;
    modelo = String(d.modelVersion ?? '');
  } catch { /* sin json */ }
  return { status, ms: Math.round(performance.now() - t0), uso, modelo, cuota: status === 429 || /credit balance|rate.?limit|quota/i.test(cuerpo) };
}
