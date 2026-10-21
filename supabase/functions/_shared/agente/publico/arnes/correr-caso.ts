// ============================================================
// Arnés del asistente público — correr un caso k veces y armar el reporte (puro: lo usan vitest y `correr.ts`)
// ------------------------------------------------------------
// `seco`: el modelo es el guion del caso (prueba el código, no al modelo). Real: el modelo que se pase (Haiku 5.5 por
// el adaptador nativo, con la llave de pruebas). pass^k: un caso pasa si sus k corridas terminan con éxito y 0
// dañinas. La latencia es el tiempo interno de §10.2 (de las trazas), con la propuesta de `corte_1`.
// ============================================================

import { modeloGuionado } from '../../modelo-guionado.ts';
import type { Modelo } from '../../tipos.ts';
import { escenarioPublico, reglamentoSabor } from '../escenario.ts';
import type { EscenarioPublico } from '../escenario.ts';
import { REGLAMENTO_SABOR } from '../reglamento-sabor.ts';
import type { PrecioModelo } from '../../uso.ts';
import { calificarPublico, corte1Propuesto, percentil } from './calificar.ts';
import type { ResultadoCasoPublico } from './calificar.ts';
import type { CasoPublico } from './conjuntos.ts';

export interface OpcionesCorrida {
  /** `null` = seco (el guion del caso). */
  modelo: (() => Modelo) | null;
  k: number;
  vivo?: boolean;
  precios?: PrecioModelo[];
}

const PRECIOS_GUION: PrecioModelo[] = [{ modelo: 'guion', entrada: 0.1, salida: 0.5, cache: null }];

export async function correrUnaVez(caso: CasoPublico, o: OpcionesCorrida): Promise<ResultadoCasoPublico> {
  if (caso.soloCodigo) {
    let exito;
    try { exito = await caso.soloCodigo(); } catch (err) { exito = { ok: false, motivo: String(err).slice(0, 200) }; }
    return { id: caso.id, conjunto: caso.conjunto, titulo: caso.titulo, exito, daninas: [], atajadas: [], internos: [], demoras: 0, turnosModelo: 0, personas: [] };
  }
  const reglamento = await reglamentoSabor(caso.fichas ? caso.fichas(REGLAMENTO_SABOR) : REGLAMENTO_SABOR);
  const base = o.modelo ? o.modelo() : modeloGuionado(caso.guion ?? []);
  let e!: EscenarioPublico;
  const modelo = caso.envolver ? caso.envolver(base, () => e) : base;
  e = await escenarioPublico({
    modelo, canal: caso.canal, config: caso.config, reglamento, vivo: o.vivo, fallarHerramienta: caso.fallarHerramienta ? () => true : undefined,
    precios: o.modelo ? (o.precios ?? []) : PRECIOS_GUION,
  });
  let error: string | undefined;
  try {
    for (const p of caso.pasos ?? []) {
      if ('escribe' in p) await e.escribe(p.escribe, { despuesMs: p.despuesMs });
      else if ('toca' in p) {
        try { await e.toca(p.toca); } catch { await e.escribe(p.oEscribe ?? 'sí'); }
      } else if ('audio' in p) await e.audio(p.audio, { noSoportado: p.noSoportado });
      else await p.hacer(e);
    }
  } catch (err) {
    error = String(err).slice(0, 300);
  }
  return calificarPublico({ id: caso.id, conjunto: caso.conjunto, titulo: caso.titulo, e, reglamento, esperado: caso.esperado ?? (() => ({ ok: true, motivo: 'sin esperado' })), error });
}

export interface ResultadoPassK {
  id: string;
  conjunto: string;
  titulo: string;
  pasa: boolean;
  corridas: ResultadoCasoPublico[];
}

export async function correrCaso(caso: CasoPublico, o: OpcionesCorrida): Promise<ResultadoPassK> {
  const corridas: ResultadoCasoPublico[] = [];
  for (let i = 0; i < Math.max(1, o.k); i++) corridas.push(await correrUnaVez(caso, o));
  return { id: caso.id, conjunto: caso.conjunto, titulo: caso.titulo, pasa: corridas.every((r) => r.exito.ok && r.daninas.length === 0), corridas };
}

export interface Reporte {
  casos: number;
  k: number;
  passK: number;
  porConjunto: Record<string, { casos: number; passK: number }>;
  daninas: number;
  atajadas: number;
  internos: { n: number; p50: number | null; p90: number | null; p95: number | null };
  corte1: ReturnType<typeof corte1Propuesto>;
  demoras: number;
  turnosModelo: number;
  personasPorMotivo: Record<string, number>;
  fallan: Array<{ id: string; motivo: string; daninas: string[] }>;
}

export function reporte(rs: ResultadoPassK[], k: number): Reporte {
  const todas = rs.flatMap((r) => r.corridas);
  const internos = todas.flatMap((r) => r.internos);
  const porConjunto: Reporte['porConjunto'] = {};
  for (const r of rs) {
    const c = porConjunto[r.conjunto] ??= { casos: 0, passK: 0 };
    c.casos++;
    if (r.pasa) c.passK++;
  }
  const personasPorMotivo: Record<string, number> = {};
  for (const m of todas.flatMap((r) => r.personas)) personasPorMotivo[m] = (personasPorMotivo[m] ?? 0) + 1;
  return {
    casos: rs.length, k, passK: rs.filter((r) => r.pasa).length, porConjunto,
    daninas: todas.reduce((n, r) => n + r.daninas.length, 0),
    atajadas: todas.reduce((n, r) => n + r.atajadas.length, 0),
    internos: { n: internos.length, p50: percentil(internos, 50), p90: percentil(internos, 90), p95: percentil(internos, 95) },
    corte1: corte1Propuesto(internos),
    demoras: todas.reduce((n, r) => n + r.demoras, 0),
    turnosModelo: todas.reduce((n, r) => n + r.turnosModelo, 0),
    personasPorMotivo,
    fallan: rs.filter((r) => !r.pasa).map((r) => {
      const mala = r.corridas.find((c) => !c.exito.ok || c.daninas.length) ?? r.corridas[0];
      return { id: r.id, motivo: mala.exito.motivo, daninas: mala.daninas };
    }),
  };
}
