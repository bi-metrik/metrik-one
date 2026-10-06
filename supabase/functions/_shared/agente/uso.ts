// ============================================================
// Núcleo conversacional — el contador de uso y el cupo de uso justo (Mauricio, 2026-10-06)
// ------------------------------------------------------------
// El contador sale de las trazas de `wa_conversacion` (una por turno del modelo): la RPC `bot_uso_mes` lo suma en la
// base, por workspace y por mes de Bogotá. El costo sale de `bot_modelo_precios` (USD por millón de tokens, por modelo):
// ningún precio está escrito en el código; un modelo sin precio deja el costo en `null` y queda listado.
// `sumarUso` es la misma cuenta en TypeScript (la usan el arnés y las pruebas de paridad).
//
// Cupo: `bot_conversacional.cupo_turnos_mes` (800 por defecto). Al 80 % y al 100 % se avisa UNA vez por umbral y por
// mes a MéTRIK (no al cliente), por el canal de avisos internos de siempre (`enviarAvisoInterno` a
// WA_ADMIN_NOTIFY_PHONE). Pasar el cupo NO corta el servicio: es una señal para hablar con el cliente.
// ============================================================

import type { Traza } from './tipos.ts';

export interface PrecioModelo {
  modelo: string;
  /** USD por millón de tokens. */
  entrada: number;
  salida: number;
  cache: number | null;
}

export interface UsoMes {
  turnos: number;
  llamados: number;
  entrada: number;
  salida: number;
  razonamiento: number;
  cache: number;
  costo_usd: number | null;
  sin_precio: string[];
  por_modelo: Record<string, { llamados: number; entrada: number; salida: number; razonamiento: number; cache: number; costo_usd: number | null }>;
}

/**
 * Suma las trazas de turnos del modelo. Costo por llamado: (entrada − caché) × precio de entrada + caché × precio de
 * caché (o de entrada si no hay) + (salida + razonamiento) × precio de salida (Gemini cobra el razonamiento como salida).
 * Pura.
 */
export function sumarUso(trazas: ReadonlyArray<Traza | null | undefined>, precios: ReadonlyArray<PrecioModelo>): UsoMes {
  const p = new Map(precios.map((x) => [x.modelo, x]));
  const u: UsoMes = { turnos: 0, llamados: 0, entrada: 0, salida: 0, razonamiento: 0, cache: 0, costo_usd: 0, sin_precio: [], por_modelo: {} };
  for (const t of trazas) {
    if (!t || t.tipo !== 'modelo') continue;
    u.turnos++;
    for (const l of t.uso ?? []) {
      const m = u.por_modelo[l.modelo] ??= { llamados: 0, entrada: 0, salida: 0, razonamiento: 0, cache: 0, costo_usd: 0 };
      m.llamados++; m.entrada += l.entrada; m.salida += l.salida; m.razonamiento += l.razonamiento; m.cache += l.cache;
      u.llamados++; u.entrada += l.entrada; u.salida += l.salida; u.razonamiento += l.razonamiento; u.cache += l.cache;
    }
  }
  for (const [modelo, m] of Object.entries(u.por_modelo)) {
    const pr = p.get(modelo);
    if (!pr) { m.costo_usd = null; u.sin_precio.push(modelo); continue; }
    m.costo_usd = ((m.entrada - m.cache) * pr.entrada + m.cache * (pr.cache ?? pr.entrada) + (m.salida + m.razonamiento) * pr.salida) / 1e6;
  }
  u.costo_usd = u.sin_precio.length ? null : Object.values(u.por_modelo).reduce((a, m) => a + (m.costo_usd ?? 0), 0);
  return u;
}

/** El mes de Bogotá de un instante («2026-10»). Pura. */
export function mesBogota(ms: number): string {
  return new Date(ms - 5 * 3600 * 1000).toISOString().slice(0, 7);
}

export const UMBRALES_CUPO = [80, 100] as const;

export interface PuertosCupo {
  /** Turnos del modelo del workspace en ese mes (`bot_uso_mes`). `null` si no se pudo contar. */
  turnosDelMes(workspaceId: string, mes: string): Promise<number | null>;
  tomarCandado(clave: string, segundos: number): Promise<boolean>;
  avisar(texto: string, variables: Record<string, string>): Promise<void>;
}

export function textoAvisoCupo(p: { workspace: string; mes: string; turnos: number; cupo: number; umbral: number }): string {
  return p.umbral >= 100
    ? `📈 El bot conversacional de ${p.workspace} pasó su cupo de uso justo de ${p.mes}: ${p.turnos} turnos del modelo de ${p.cupo}. No se cortó el servicio: es para hablar con el cliente.`
    : `📈 El bot conversacional de ${p.workspace} va en el ${p.umbral} % de su cupo de uso justo de ${p.mes}: ${p.turnos} turnos del modelo de ${p.cupo}.`;
}

/**
 * Revisa el cupo después de un turno del modelo. Avisa una sola vez por umbral y por mes (el candado vive 40 días).
 * Nunca corta nada. Devuelve los umbrales avisados en esta llamada.
 */
export async function revisarCupo(
  p: PuertosCupo, o: { workspaceId: string; workspaceNombre: string; cupo: number; ahoraMs: number },
): Promise<number[]> {
  const mes = mesBogota(o.ahoraMs);
  const turnos = await p.turnosDelMes(o.workspaceId, mes);
  if (turnos === null) return [];
  const avisados: number[] = [];
  for (const umbral of UMBRALES_CUPO) {
    if (turnos < Math.ceil((o.cupo * umbral) / 100)) continue;
    if (!(await p.tomarCandado(`agente:cupo:${o.workspaceId}:${mes}:${umbral}`, 40 * 24 * 3600))) continue;
    await p.avisar(textoAvisoCupo({ workspace: o.workspaceNombre, mes, turnos, cupo: o.cupo, umbral }), {
      workspace: o.workspaceNombre, mes, turnos: String(turnos), cupo: String(o.cupo), umbral: String(umbral),
    });
    avisados.push(umbral);
  }
  return avisados;
}
