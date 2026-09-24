// Telemetria de Cardumen: cuantos mensajes manda cada estudio y cuantos tokens gasta.
//
// Por que existe: Cardumen corre sobre el mismo numero de WhatsApp que el bot de ONE, y desde
// el 2026-10-01 Meta cobra las respuestas de servicio pasadas 1.000 al mes por numero. Hasta
// este modulo los envios de Cardumen caian en `wa_envios` con `origen='bot'` e `intent` nulo,
// indistinguibles de los de ONE, y el motor no dejaba rastro de los tokens que gastaba.
//
// Las dos marcas:
//   - `wa_envios`: `origen='bot'` (el CHECK de la tabla no admite 'cardumen'; cambiarlo es
//     una migracion) e `intent='cardumen:<estudio>'`. El prefijo es lo que separa Cardumen
//     de ONE en la consulta de medicion (`docs/sql/cardumen-medicion-mensual.sql`).
//   - `wa_message_log`: una fila por llamada al modelo, con modelo, tokens, latencia y el
//     mismo `intent`. SIN telefono y SIN texto, a proposito:
//       · texto: hay estudios con familias y posiblemente adolescentes (Fundacion Cometa), y
//         el encuadre promete confidencialidad. La bitacora no necesita lo que dijeron.
//       · telefono: `checkInboundLimit` cuenta las filas 'inbound' por telefono. Con el
//         telefono puesto, cada turno de Cardumen le restaria cupo al bot de ONE a esa persona.
//     Las conversaciones se cuentan en `wa_envios`, que si lleva el telefono.
//
// Regla heredada de `wa-envios.ts`: registrar es telemetria y NUNCA puede tumbar un turno.
//
// Modulo puro (sin imports de Deno) para que vitest lo pruebe; el cliente de Supabase y el
// `enBackground` los pone quien llama.

import type { EnvioCtx } from "../wa-envios.ts";
import type { ModelAdapter, ModelCallOpts, ModelResult } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Supa = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Marca comun de `wa_envios.intent` y `wa_message_log.intent` para todo lo de Cardumen. */
export const PREFIJO_INTENT = "cardumen:";

/** `cardumen:<estudio>`. Sin estudio conocido queda `cardumen:desconocido`, no nulo: nulo es ONE. */
export function intentCardumen(estudio?: string | null): string {
  const e = (estudio ?? "").trim();
  return `${PREFIJO_INTENT}${e || "desconocido"}`;
}

/**
 * Contexto de envio para `wa-respond`. El `preview` reemplaza el texto real en `wa_envios`:
 * lo que dice el entrevistador puede parafrasear lo que conto la persona, asi que tampoco
 * se guarda. Queda el largo, que sirve para ver chunks sin exponer el contenido.
 */
export function ctxCardumen(estudio: string | null | undefined, texto?: string): EnvioCtx {
  const intent = intentCardumen(estudio);
  const largo = texto === undefined ? "" : ` ${texto.length} car.`;
  return { origen: "bot", intent, preview: `[${intent}]${largo}` };
}

/** Lo que se sabe de una llamada al modelo terminada. */
export interface UsoModelo {
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
  latenciaMs: number;
}

/**
 * Envuelve un adaptador para que cada llamada EXITOSA reporte su uso. Una llamada que falla
 * (tras los reintentos del adaptador) no trae `usage` y no se reporta: el error sigue subiendo
 * igual. `onUso` no se espera y sus errores se tragan: la telemetria no frena el turno.
 */
export function conTelemetria(
  adapter: ModelAdapter,
  onUso: (uso: UsoModelo) => void,
  ahora: () => number = () => Date.now(),
): ModelAdapter {
  return {
    id: adapter.id,
    pricing: adapter.pricing,
    async call(opts: ModelCallOpts): Promise<ModelResult> {
      const t0 = ahora();
      const r = await adapter.call(opts);
      try {
        onUso({
          modelo: adapter.id,
          tokensEntrada: r.usage?.in ?? 0,
          tokensSalida: r.usage?.out ?? 0,
          latenciaMs: Math.max(0, Math.round(ahora() - t0)),
        });
      } catch (e) {
        console.error("[cardumen-telemetria] onUso fallo:", e);
      }
      return r;
    },
  };
}

/** Fila de `wa_message_log` para una llamada al modelo. Sin telefono ni texto (ver arriba). */
export function filaLlamadaModelo(estudio: string | null | undefined, uso: UsoModelo) {
  return {
    workspace_id: null,
    phone: null,
    direction: "inbound" as const,
    intent: intentCardumen(estudio),
    message_preview: null,
    gemini_model: uso.modelo,
    gemini_input_tokens: uso.tokensEntrada,
    gemini_output_tokens: uso.tokensSalida,
    gemini_latency_ms: uso.latenciaMs,
  };
}

/** Escribe la fila. Nunca lanza: si la base falla, queda en consola y el turno sigue. */
export async function registrarLlamadaModelo(
  supabase: Supa,
  estudio: string | null | undefined,
  uso: UsoModelo,
): Promise<void> {
  try {
    const { error } = await supabase.from("wa_message_log").insert(filaLlamadaModelo(estudio, uso));
    if (error) console.error("[cardumen-telemetria] no se pudo registrar la llamada:", error.message);
  } catch (e) {
    console.error("[cardumen-telemetria] no se pudo registrar la llamada:", e);
  }
}
