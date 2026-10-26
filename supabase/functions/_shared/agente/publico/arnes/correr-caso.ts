// ============================================================
// Arnés del asistente público — correr un caso k veces y armar el reporte (puro: lo usan vitest y `correr.ts`)
// ------------------------------------------------------------
// `seco`: el modelo es el guion del caso (prueba el código, no al modelo). Real: el modelo que se pase (Haiku 5.5 por
// el adaptador nativo, con la llave de pruebas). pass^k: un caso pasa si sus k corridas terminan con éxito y 0
// dañinas. La latencia es el tiempo interno de §10.2 (de las trazas), con la propuesta de `corte_1`.
// ============================================================

import { modeloGuionado } from '../../modelo-guionado.ts';
import type { Ficha, Modelo } from '../../tipos.ts';
import type { DepsPublico } from '../cola.ts';
import { escenarioPublico, reglamentoSabor } from '../escenario.ts';
import type { EscenarioPublico } from '../escenario.ts';
import { REGLAMENTO_SABOR } from '../reglamento-sabor.ts';
import type { PrecioModelo } from '../../uso.ts';
import type { ConfigPublico } from '../config.ts';
import { calificarPublico, corte1Propuesto, percentil } from './calificar.ts';
import type { ResultadoCasoPublico } from './calificar.ts';
import type { CasoPublico } from './conjuntos.ts';

export interface OpcionesCorrida {
  /** `null` = seco (el guion del caso). */
  modelo: (() => Modelo) | null;
  k: number;
  vivo?: boolean;
  precios?: PrecioModelo[];
  /** Configuración base del escenario (antes de la del caso): la corrida por CLI agranda los cortes. */
  configBase?: Partial<ConfigPublico>;
  /** Multiplica los cortes que fija el propio caso (operación). */
  escala?: number;
  /**
   * Corre el caso sobre un ROL compuesto (spec 2026-10-26): las funciones del rol y el catálogo que las define. Sin
   * esto, sobre el dominio público entero.
   */
  rol?: { funciones: NonNullable<DepsPublico['funciones']>; catalogo?: DepsPublico['catalogo'] };
  /**
   * Las fichas base del reglamento (las del rol que se va a publicar). Sin esto, `REGLAMENTO_SABOR`. Los casos que
   * cambian fichas (`caso.fichas`) las cambian sobre estas.
   */
  fichasBase?: Ficha[];
}

const PRECIOS_GUION: PrecioModelo[] = [{ modelo: 'guion', entrada: 0.1, salida: 0.5, cache: null }];

function escalar(c: Partial<ConfigPublico> | undefined, x: number): Partial<ConfigPublico> {
  if (!c) return {};
  return { ...c, ...(c.corte1Ms ? { corte1Ms: c.corte1Ms * x } : {}), ...(c.corteTotalMs ? { corteTotalMs: c.corteTotalMs * x } : {}) };
}

export async function correrUnaVez(caso: CasoPublico, o: OpcionesCorrida): Promise<ResultadoCasoPublico> {
  if (caso.soloCodigo) {
    let exito;
    try { exito = await caso.soloCodigo(); } catch (err) { exito = { ok: false, motivo: String(err).slice(0, 200) }; }
    return { id: caso.id, conjunto: caso.conjunto, titulo: caso.titulo, exito, daninas: [], atajadas: [], internos: [], demoras: 0, turnosModelo: 0, personas: [], transcripcion: [] };
  }
  const baseFichas = o.fichasBase ?? REGLAMENTO_SABOR;
  const reglamento = await reglamentoSabor(caso.fichas ? caso.fichas(baseFichas) : baseFichas);
  const base = o.modelo ? o.modelo() : modeloGuionado(caso.guion ?? []);
  // El envoltorio necesita el escenario, que se arma con el modelo ya envuelto: se lo pasa por referencia.
  const ref: { e?: EscenarioPublico } = {};
  const modelo = caso.envolver ? caso.envolver(base, () => ref.e!) : base;
  const e = ref.e = await escenarioPublico({
    modelo, canal: caso.canal, config: { ...o.configBase, ...escalar(caso.config, o.escala ?? 1) }, reglamento, vivo: o.vivo, fallarHerramienta: caso.fallarHerramienta ? () => true : undefined,
    precios: o.modelo ? (o.precios ?? []) : PRECIOS_GUION,
    ...(o.rol ? { funciones: o.rol.funciones, ...(o.rol.catalogo ? { catalogo: o.rol.catalogo } : {}) } : {}),
  });
  let error: string | undefined;
  try {
    for (const p of caso.pasos ?? []) {
      if ('escribe' in p) await e.escribe(p.escribe, { despuesMs: p.despuesMs });
      else if ('toca' in p) {
        try { await e.toca(p.toca); } catch { await e.escribe(p.oEscribe ?? 'sí'); }
      } else if ('audio' in p) await e.audio(p.audio, { noSoportado: p.noSoportado });
      else if ('hastaAutorizacion' in p) {
        for (const t of p.hastaAutorizacion) {
          const ultimo = e.chatwoot.publicados.at(-1)?.salida;
          if (ultimo && 'opciones' in ultimo && ultimo.opciones.some((x) => x.id.startsWith('ag|a|general|'))) break;
          await e.escribe(t);
        }
      }
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
  porConjunto: Record<string, { casos: number; passK: number; daninas: number }>;
  daninas: number;
  atajadas: number;
  internos: { n: number; p50: number | null; p90: number | null; p95: number | null };
  corte1: ReturnType<typeof corte1Propuesto>;
  demoras: number;
  turnosModelo: number;
  personasPorMotivo: Record<string, number>;
  fallan: Array<{ id: string; conjunto: string; titulo: string; corridasMal: number; motivo: string; daninas: string[]; transcripcion: string[] }>;
}

export function reporte(rs: ResultadoPassK[], k: number): Reporte {
  const todas = rs.flatMap((r) => r.corridas);
  const internos = todas.flatMap((r) => r.internos);
  const porConjunto: Reporte['porConjunto'] = {};
  for (const r of rs) {
    const c = porConjunto[r.conjunto] ??= { casos: 0, passK: 0, daninas: 0 };
    c.casos++;
    c.daninas += r.corridas.reduce((n, x) => n + x.daninas.length, 0);
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
      return { id: r.id, conjunto: r.conjunto, titulo: r.titulo, corridasMal: r.corridas.filter((c) => !c.exito.ok || c.daninas.length).length, motivo: mala.exito.motivo, daninas: mala.daninas, transcripcion: mala.transcripcion };
    }),
  };
}
