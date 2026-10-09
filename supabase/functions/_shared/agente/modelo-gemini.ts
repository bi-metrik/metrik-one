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
// · Respaldo por llamado (Yuto, 2026-10-06): si el principal falla, ese llamado va al respaldo con lo que quede del
//   turno. Si a los `corteMs` todavía no responde, el respaldo arranca EN PARALELO y el principal sigue: gana el primero
//   que responda bien y el otro se cancela (2026-10-09). Antes el principal se cortaba ahí: medido en vivo, 13 de 68
//   llamados de 3.8 llegaron al corte y cada uno botó los 2,5-4 s que ya llevaba; ahora, si el principal llega poco
//   después del corte, contesta él. Los usos de los dos quedan en la traza (el que pierde, con su motivo).
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

async function intentar(p: PedidoModelo, c: ConfigModelo, timeoutMs: number, o: OpcionesGemini, cancelar?: AbortSignal): Promise<Intento> {
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
      signal: cancelar ? AbortSignal.any([AbortSignal.timeout(Math.max(200, Math.round(timeoutMs))), cancelar]) : AbortSignal.timeout(Math.max(200, Math.round(timeoutMs))),
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
    const motivo = cancelar?.aborted ? String(cancelar.reason ?? 'cancelado')
      : nombre === 'TimeoutError' || nombre === 'AbortError' ? 'corte' : `red: ${String(e).slice(0, 80)}`;
    return { ok: false, motivo, uso: uso(false, { motivo }) };
  }
}

/** Espera `ms` o hasta que alguien la suelte; siempre limpia su temporizador. */
function espera(ms: number): { hecho: Promise<void>; soltar: () => void } {
  let soltar: () => void = () => {};
  const hecho = new Promise<void>((r) => {
    const t = setTimeout(r, Math.max(0, ms));
    soltar = () => { clearTimeout(t); r(); };
  });
  return { hecho, soltar };
}

export function modeloGemini(o: OpcionesGemini): Modelo {
  return {
    async llamar(p: PedidoModelo): Promise<RespuestaModelo> {
      const ahora = o.ahora ?? (() => performance.now());
      const t0 = ahora();
      const resta = () => p.timeoutMs - (ahora() - t0);
      if (!o.respaldo) {
        const solo = await intentar(p, o.principal, p.timeoutMs, o);
        return solo.ok ? { ok: true, mensaje: solo.mensaje, usos: [solo.uso] } : { ok: false, motivo: solo.motivo, usos: [solo.uso] };
      }
      const respaldo = o.respaldo;
      const cancelarPrincipal = new AbortController();
      const principal = intentar(p, o.principal, p.timeoutMs, o, cancelarPrincipal.signal);
      const corte = espera(Math.min(o.corteMs, p.timeoutMs));
      const antes = await Promise.race([principal, corte.hecho.then(() => null)]);
      corte.soltar();
      if (antes?.ok) return { ok: true, mensaje: antes.mensaje, usos: [antes.uso] };
      if (antes) {
        // Falló antes del corte (429, 5xx, red): al respaldo con lo que quede, como siempre.
        if (resta() < 300) return { ok: false, motivo: antes.motivo, usos: [antes.uso] };
        const r = await intentar(p, respaldo, resta(), o);
        return r.ok
          ? { ok: true, mensaje: r.mensaje, usos: [antes.uso, r.uso] }
          : { ok: false, motivo: `${antes.motivo}; respaldo: ${r.motivo}`, usos: [antes.uso, r.uso] };
      }
      // Llegó el corte sin respuesta: el respaldo arranca y el principal sigue. Gana el primero que responda bien.
      if (resta() < 300) {
        cancelarPrincipal.abort('corte');
        const p1 = await principal;
        return p1.ok ? { ok: true, mensaje: p1.mensaje, usos: [p1.uso] } : { ok: false, motivo: p1.motivo, usos: [p1.uso] };
      }
      const cancelarRespaldo = new AbortController();
      const segundo = intentar(p, respaldo, resta(), o, cancelarRespaldo.signal);
      const ganador = await new Promise<'principal' | 'respaldo' | null>((resolver) => {
        let pendientes = 2;
        const fin = (quien: 'principal' | 'respaldo') => (r: Intento) => {
          pendientes--;
          if (r.ok) resolver(quien);
          else if (!pendientes) resolver(null);
        };
        principal.then(fin('principal'));
        segundo.then(fin('respaldo'));
      });
      if (ganador === 'principal') cancelarRespaldo.abort('cancelado: respondió el principal');
      if (ganador === 'respaldo') cancelarPrincipal.abort('corte');
      const [p1, p2] = await Promise.all([principal, segundo]);
      const usos = [p1.uso, p2.uso];
      const elegido = ganador === 'principal' ? p1 : ganador === 'respaldo' ? p2 : null;
      if (elegido?.ok) return { ok: true, mensaje: elegido.mensaje, usos };
      const motivo = (x: Intento) => (x.ok ? 'ok' : x.motivo);
      return { ok: false, motivo: `${motivo(p1)}; respaldo: ${motivo(p2)}`, usos };
    },
  };
}
