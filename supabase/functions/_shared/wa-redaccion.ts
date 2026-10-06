// ============================================================
// El modelo redacta — el envío (2026-10-05). Reglas y validación en `wa-redaccion-reglas.ts`.
// ------------------------------------------------------------
// `redactar` devuelve el texto que se envía: el del modelo si pasa la validación, o el fijo. Con el
// interruptor apagado (por defecto) no llama al modelo ni lee los turnos: una sola lectura de
// `config_extra` y devuelve el fijo. Nada de lo que hace aquí puede dejar al comercial sin respuesta: un
// error, un timeout o una salida que no pasa → el fijo.
// ============================================================

import type { SupabaseClient } from './types.ts';
import { generacionPara } from './wa-interprete-reglas.ts';
import { llamarGemini, type PedidoModelo, type RespuestaModelo } from './wa-interprete.ts';
import {
  ESQUEMA_REDACCION, INSTRUCCIONES_REDACCION, MAX_TURNOS, entradaRedaccion, leerConfigRedaccion, textoDeLaSalida, validarRedaccion,
} from './wa-redaccion-reglas.ts';
import type { ConfigRedaccion, PedidoRedaccion, Turno } from './wa-redaccion-reglas.ts';

export type { PedidoRedaccion } from './wa-redaccion-reglas.ts';

function envDeDeno(k: string): string | undefined {
  return (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get(k);
}

/** Lo que una prueba puede reemplazar: el modelo y el entorno. */
export const redaccionDeps: {
  llamarModelo: (p: PedidoModelo) => Promise<RespuestaModelo>;
  env: (k: string) => string | undefined;
} = {
  llamarModelo: (p) => llamarGemini(p),
  env: envDeDeno,
};

/** El interruptor del workspace (`config_extra.bot_conversacional.redaccion`). Si no se puede leer: apagado. */
export async function configRedaccion(supabase: SupabaseClient, workspaceId: string): Promise<ConfigRedaccion> {
  const entorno = { interpreteApagado: redaccionDeps.env('WA_INTERPRETE_APAGADO'), redaccionApagada: redaccionDeps.env('WA_REDACCION_APAGADA') };
  try {
    const { data, error } = await supabase.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle();
    if (error) return leerConfigRedaccion(null);
    const ce = (data?.config_extra ?? null) as Record<string, unknown> | null;
    return leerConfigRedaccion(ce?.bot_conversacional ?? null, entorno);
  } catch {
    return leerConfigRedaccion(null);
  }
}

/**
 * Los últimos turnos (30 min): lo que ESCRIBIÓ el comercial (no los reenvíos: son la voz del cliente) y lo que le dijo
 * el bot. Solo contexto de tono para el modelo: la validación nunca los cuenta como fuente de datos.
 */
async function ultimosTurnos(supabase: SupabaseClient, workspaceId: string, phone: string): Promise<Turno[]> {
  const desde = new Date(Date.now() - 30 * 60_000).toISOString();
  const out: Array<Turno & { en: string }> = [];
  try {
    const { data } = await supabase.from('wa_bandeja_mensajes').select('cuerpo, reenviado, recibido_at')
      .eq('workspace_id', workspaceId).eq('remitente_phone', phone).gte('recibido_at', desde).order('recibido_at', { ascending: false }).limit(MAX_TURNOS);
    for (const m of (data ?? []) as Array<Record<string, unknown>>) {
      if (!m.reenviado && String(m.cuerpo ?? '').trim()) out.push({ quien: 'comercial', texto: String(m.cuerpo), en: String(m.recibido_at) });
    }
    const { data: bot } = await supabase.from('wa_envios').select('preview, created_at')
      .eq('phone', phone).gte('created_at', desde).order('created_at', { ascending: false }).limit(3);
    for (const b of (bot ?? []) as Array<Record<string, unknown>>) {
      if (String(b.preview ?? '').trim()) out.push({ quien: 'bot', texto: String(b.preview), en: String(b.created_at) });
    }
  } catch {
    // Sin turnos el modelo igual redacta: son solo tono.
  }
  return out.sort((a, b) => a.en.localeCompare(b.en)).slice(-MAX_TURNOS).map(({ quien, texto }) => ({ quien, texto }));
}

/** Lo que pasó con una redacción (para el log y las pruebas). */
export interface ResultadoRedaccion {
  texto: string;
  /** `modelo`: salió lo del modelo. Lo demás: salió el fijo, y por qué. */
  fuente: 'modelo' | 'apagado' | 'igual' | 'fallo' | 'invalida';
  motivo?: string;
  ms?: number;
}

/**
 * El texto que se envía. Con el interruptor apagado, el fijo (sin llamar al modelo). Prendido: el modelo
 * redacta y, si su texto pasa `validarRedaccion`, sale ese; si no, el fijo.
 */
export async function redactar(
  supabase: SupabaseClient, d: { workspaceId: string; phone: string }, p: PedidoRedaccion,
): Promise<ResultadoRedaccion> {
  const fijo = p.fijo;
  if (!fijo.trim()) return { texto: fijo, fuente: 'apagado' };
  const cfg = await configRedaccion(supabase, d.workspaceId);
  if (!cfg.activo) return { texto: fijo, fuente: 'apagado' };
  const turnos = await ultimosTurnos(supabase, d.workspaceId, d.phone);
  let r: RespuestaModelo;
  try {
    r = await redaccionDeps.llamarModelo({
      modelo: cfg.modelo, sistema: INSTRUCCIONES_REDACCION, usuario: entradaRedaccion(p, turnos),
      generationConfig: generacionPara(cfg.modelo, ESQUEMA_REDACCION), timeoutMs: cfg.timeoutMs,
    });
  } catch (err) {
    r = { ok: false, motivo: 'http', ms: 0, detalle: String(err) };
  }
  let res: ResultadoRedaccion;
  if (!r.ok) {
    res = { texto: fijo, fuente: 'fallo', motivo: r.motivo, ms: r.ms };
  } else {
    const texto = textoDeLaSalida(r.json);
    const v = texto ? validarRedaccion(texto, p) : { ok: false as const, motivo: 'sin_texto', detalle: '' };
    res = !v.ok ? { texto: fijo, fuente: 'invalida', motivo: `${v.motivo}: ${v.detalle}`, ms: r.ms }
      : texto === fijo ? { texto: fijo, fuente: 'igual', ms: r.ms }
      : { texto: texto!, fuente: 'modelo', ms: r.ms };
  }
  // Telemetría en el log de la función: tipo, fuente, motivo y tiempo (nunca el texto, que trae datos del cliente).
  console.log(JSON.stringify({ redaccion: p.tipo, fuente: res.fuente, motivo: res.motivo?.split(':')[0] ?? null, ms: res.ms ?? null, modelo: cfg.modelo }));
  return res;
}

/** Atajo: solo el texto. */
export async function textoRedactado(supabase: SupabaseClient, d: { workspaceId: string; phone: string }, p: PedidoRedaccion): Promise<string> {
  return (await redactar(supabase, d, p)).texto;
}
