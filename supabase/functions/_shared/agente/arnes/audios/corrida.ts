// ============================================================
// Arnés de audios — la corrida, sin red ni Deno (spec 2026-10-26, §4.6)
// ------------------------------------------------------------
// Cada nota se transcribe con pistas y sin pistas, `k` veces, con cada modelo. El pedido es el de producción:
//   · notas de Imperviun y Laura (habla el equipo): el de ONE y la bandeja (`wa-agente.ts`): PROMPT_TRANSCRIPCION_LITERAL,
//     temperatura 0.1, 8192 tokens de salida;
//   · notas de Sabor (habla un cliente): el de público (`publico/transcribir.ts`): PROMPT_NOTA_DE_VOZ, sin temperatura,
//     4096 tokens.
// Las pistas, con `textoPistas` (la función de producción) sobre la base inventada del workspace del guion.
// El orden intercala repetición → guion → modelo → con/sin pistas, para que una racha mala de la API no caiga toda en
// un mismo brazo de la comparación.
// ============================================================

import { PROMPT_TRANSCRIPCION_LITERAL, pedidoTranscripcion, promptConPistas } from '../../../transcripcion.ts';
import { PROMPT_NOTA_DE_VOZ } from '../../publico/transcribir.ts';
import { BASES, GUIONES, marcas, nombresBase, pistasDe, referencia } from './guiones.ts';
import type { Guion, Workspace } from './guiones.ts';
import { agregar, candidatasInsercion, medir, tabla } from './metricas.ts';
import type { Agregado, Intento } from './metricas.ts';

export interface Trabajo {
  guion: Guion;
  modelo: string;
  conPistas: boolean;
  repeticion: number;
}

/** Los trabajos de la corrida, intercalados. Pura. */
export function trabajos(guiones: Guion[], modelos: string[], k: number): Trabajo[] {
  const out: Trabajo[] = [];
  for (let r = 1; r <= k; r++) {
    for (const guion of guiones) {
      for (const modelo of modelos) {
        for (const conPistas of r % 2 ? [false, true] : [true, false]) out.push({ guion, modelo, conPistas, repeticion: r });
      }
    }
  }
  return out;
}

/** El prompt de producción para esta nota, con o sin pistas. Pura. */
export function promptDe(t: Trabajo): string {
  const base = BASES[t.guion.workspace].canal === 'publico' ? PROMPT_NOTA_DE_VOZ : PROMPT_TRANSCRIPCION_LITERAL;
  return promptConPistas(base, t.conPistas ? pistasDe(t.guion) : null);
}

/** El pedido a Gemini, igual al de producción según el canal del guion. Pura. */
export function pedidoDe(t: Trabajo, audio: { mime: string; base64: string }, llave: string): { url: string; init: RequestInit } {
  const publico = BASES[t.guion.workspace].canal === 'publico';
  return pedidoTranscripcion({
    modelo: t.modelo, llave, prompt: promptDe(t), mime: audio.mime, base64: audio.base64,
    maxSalida: publico ? 4096 : 8192, temperatura: publico ? null : 0.1,
  });
}

/** El resultado de un trabajo, medido contra su guion. Pura. */
export function intentoDe(t: Trabajo, r: { texto: string | null; error?: string; ms?: number }): Intento {
  const ref = referencia(t.guion);
  return {
    modelo: t.modelo, conPistas: t.conPistas, guion: t.guion.id, repeticion: t.repeticion,
    transcripcion: r.texto, ms: r.ms,
    ...(r.error ? { error: r.error } : {}),
    medida: r.texto === null ? null : medir({
      referencia: ref, marcas: marcas(t.guion), candidatas: candidatasInsercion(nombresBase(t.guion.workspace), ref), transcripcion: r.texto,
    }),
  };
}

async function enPiscina<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (i < xs.length) { const j = i++; out[j] = await f(xs[j]); }
  }));
  return out;
}

export interface Resultado {
  intentos: Intento[];
  agregados: Agregado[];
  porWorkspace: Record<Workspace, Agregado[]>;
}

export async function correr(o: {
  guiones?: Guion[];
  modelos: string[];
  k: number;
  paralelo?: number;
  transcribir: (t: Trabajo) => Promise<{ texto: string | null; error?: string; ms?: number }>;
  alAvanzar?: (hechos: number, total: number) => void;
}): Promise<Resultado> {
  const ts = trabajos(o.guiones ?? GUIONES, o.modelos, o.k);
  let hechos = 0;
  const intentos = await enPiscina(ts, o.paralelo ?? 1, async (t) => {
    let r: { texto: string | null; error?: string; ms?: number };
    try { r = await o.transcribir(t); } catch (e) { r = { texto: null, error: `EXCEPCION: ${String(e).slice(0, 200)}` }; }
    o.alAvanzar?.(++hechos, ts.length);
    return intentoDe(t, r);
  });
  const ws: Workspace[] = ['imperviun', 'laura', 'sabor'];
  const deWs = (w: Workspace) => new Set(GUIONES.filter((g) => g.workspace === w).map((g) => g.id));
  return {
    intentos,
    agregados: agregar(intentos),
    porWorkspace: Object.fromEntries(ws.map((w) => [w, agregar(intentos.filter((i) => deWs(w).has(i.guion)))])) as Record<Workspace, Agregado[]>,
  };
}

/** El reporte en texto: la tabla general y una por workspace. Pura. */
export function reporte(r: Resultado, encabezado: string): string {
  const partes = [encabezado, '', '== Todas las notas ==', tabla(r.agregados)];
  for (const [w, a] of Object.entries(r.porWorkspace)) if (a.length) partes.push('', `== ${w} ==`, tabla(a));
  const fallados = new Map<string, number>();
  for (const i of r.intentos) {
    for (const f of [...(i.medida?.nombres.fallados ?? []), ...(i.medida?.codigos.fallados ?? [])]) {
      const k = `${i.modelo} · ${i.conPistas ? 'con' : 'sin'} · ${i.guion} · ${f}`;
      fallados.set(k, (fallados.get(k) ?? 0) + 1);
    }
  }
  if (fallados.size) partes.push('', '== Nombres y códigos fallados (veces) ==', ...[...fallados].sort().map(([k, n]) => `${k}: ${n}`));
  const ins = r.intentos.filter((i) => i.medida?.inserciones.length);
  if (ins.length) partes.push('', '== Inserciones falsas ==', ...ins.map((i) => `${i.modelo} · ${i.conPistas ? 'con' : 'sin'} · ${i.guion} #${i.repeticion}: ${i.medida!.inserciones.join(', ')}`));
  return partes.join('\n');
}
