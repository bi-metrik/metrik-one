// ============================================================
// Núcleo conversacional — el adaptador de Gemini (`generateContent`)
// ------------------------------------------------------------
// Diseño §3.7: `generateContent` con el historial en nuestra base (no Interactions, que guarda 55 días en Google).
// Otro proveedor es otro archivo que implementa `Modelo`; el núcleo no cambia.
//
// · Modo ANY con `allowedFunctionNames`: el modelo siempre devuelve una llamada (termina con `responder` o `proponer`).
// · Firmas de razonamiento: se devuelven TAL CUAL (sin firma, HTTP 400). Si el llamado va a otro modelo (el respaldo),
//   las firmas de un modelo distinto se reemplazan por el valor de relleno que documenta Google para historial que no
//   salió de ese modelo (`skip_thought_signature_validator`). Sin verificar contra la API viva: lo mide el arnés.
// · Respaldo por llamado (Yuto, 2026-10-06): si el principal no responde en `corteMs` (2,5 s) o falla, ese llamado va
//   al respaldo con lo que quede del turno. Los dos usos quedan en la traza.
// ============================================================

import type { ConfigModelo } from './config.ts';
import type { Mensaje, Modelo, Parte, PedidoModelo, RespuestaModelo, UsoLlamado } from './tipos.ts';

export const FIRMA_DE_RELLENO = 'skip_thought_signature_validator';
const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface OpcionesGemini {
  llave: string;
  principal: ConfigModelo;
  respaldo: ConfigModelo | null;
  corteMs: number;
  /** Reemplazable en pruebas. */
  fetch?: typeof fetch;
  ahora?: () => number;
}

/** El historial para un modelo dado: firmas de otro modelo → relleno. Pura. */
export function historialPara(mensajes: Mensaje[], modelo: string): Array<{ role: string; parts: Parte[] }> {
  return mensajes.map((m) => {
    const ajeno = m.role === 'model' && m.modelo && m.modelo !== modelo;
    return {
      role: m.role,
      parts: m.parts.map((p) => (ajeno && p.thoughtSignature ? { ...p, thoughtSignature: FIRMA_DE_RELLENO } : p)),
    };
  });
}

/** El cuerpo del pedido. Pura (se prueba sin red). */
export function cuerpoGemini(p: PedidoModelo, c: ConfigModelo): Record<string, unknown> {
  return {
    system_instruction: { parts: [{ text: p.sistema }] },
    contents: historialPara(p.mensajes, c.modelo),
    tools: [{ functionDeclarations: p.herramientas }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: p.permitidas } },
    generationConfig: {
      maxOutputTokens: c.maxSalida,
      ...(c.razonamiento ? { thinkingConfig: { thinkingLevel: c.razonamiento } } : {}),
      ...(c.temperatura !== null ? { temperature: c.temperatura } : {}),
    },
  };
}

type Intento = { ok: true; mensaje: Mensaje; uso: UsoLlamado } | { ok: false; motivo: string; uso: UsoLlamado };

async function intentar(p: PedidoModelo, c: ConfigModelo, timeoutMs: number, o: OpcionesGemini): Promise<Intento> {
  const ahora = o.ahora ?? (() => performance.now());
  const f = o.fetch ?? fetch;
  const t0 = ahora();
  const uso = (ok: boolean, extra: Partial<UsoLlamado> = {}): UsoLlamado => ({
    modelo: c.modelo, entrada: 0, salida: 0, razonamiento: 0, cache: 0, ms: Math.round(ahora() - t0), ok, ...extra,
  });
  try {
    const res = await f(`${URL_BASE}/${c.modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.llave },
      body: JSON.stringify(cuerpoGemini(p, c)),
      signal: AbortSignal.timeout(Math.max(200, Math.round(timeoutMs))),
    });
    if (res.status !== 200) {
      const detalle = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
      return { ok: false, motivo: `http ${res.status}`, uso: uso(false, { motivo: `http ${res.status}: ${detalle}` }) };
    }
    const d = await res.json();
    const u = d?.usageMetadata ?? {};
    const tokens = {
      entrada: Number(u.promptTokenCount ?? 0), salida: Number(u.candidatesTokenCount ?? 0),
      razonamiento: Number(u.thoughtsTokenCount ?? 0), cache: Number(u.cachedContentTokenCount ?? 0),
    };
    const cand = d?.candidates?.[0];
    const partes = (cand?.content?.parts ?? []) as Parte[];
    if (!partes.some((x) => x.functionCall)) {
      const motivo = `sin llamada (${cand?.finishReason ?? 'vacío'})`;
      return { ok: false, motivo, uso: uso(false, { ...tokens, motivo }) };
    }
    return { ok: true, mensaje: { role: 'model', parts: partes, modelo: c.modelo }, uso: uso(true, tokens) };
  } catch (e) {
    const nombre = (e as Error)?.name;
    const motivo = nombre === 'TimeoutError' || nombre === 'AbortError' ? 'corte' : `red: ${String(e).slice(0, 80)}`;
    return { ok: false, motivo, uso: uso(false, { motivo }) };
  }
}

export function modeloGemini(o: OpcionesGemini): Modelo {
  return {
    async llamar(p: PedidoModelo): Promise<RespuestaModelo> {
      const ahora = o.ahora ?? (() => performance.now());
      const t0 = ahora();
      const primero = await intentar(p, o.principal, o.respaldo ? Math.min(o.corteMs, p.timeoutMs) : p.timeoutMs, o);
      if (primero.ok) return { ok: true, mensaje: primero.mensaje, usos: [primero.uso] };
      const resta = p.timeoutMs - (ahora() - t0);
      if (!o.respaldo || resta < 300) return { ok: false, motivo: primero.motivo, usos: [primero.uso] };
      const segundo = await intentar(p, o.respaldo, resta, o);
      if (segundo.ok) return { ok: true, mensaje: segundo.mensaje, usos: [primero.uso, segundo.uso] };
      return { ok: false, motivo: `${primero.motivo}; respaldo: ${segundo.motivo}`, usos: [primero.uso, segundo.uso] };
    },
  };
}
