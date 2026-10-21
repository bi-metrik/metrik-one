// ============================================================
// Asistente público — el reintento con aviso (§4.1, Mauricio 2026-10-20)
// ------------------------------------------------------------
//   0 s                 empieza el intento 1 (después de la ráfaga).
//   `corte_1` sin nada  el código manda `rf.demora` SIN pasar por el modelo y arranca el intento 2 EN PARALELO, sin
//                       matar el 1. Se publica el primero que termine (uno solo); el otro se descarta.
//   `corte_total`       ninguno terminó: respuesta fija y `pasar_a_persona(falla)`.
//   error del modelo    (no demora) un reintento inmediato; si vuelve a fallar, respuesta fija y persona.
//   `refusal`           sin reintento: respuesta fija y persona (reenviar casi siempre da otro rechazo).
// El aviso sale como máximo una vez por turno y no cuenta como respuesta para el verificador.
// Los tiempos llegan por configuración (`corte_1_ms`, `corte_total_ms`). Sin estado: el que llama publica.
// ============================================================

import type { SalidaTurno } from '../nucleo.ts';

export type Desenlace =
  | { tipo: 'respuesta'; r: SalidaTurno; ganador: number }
  | { tipo: 'rechazo'; r: SalidaTurno }
  | { tipo: 'falla'; motivo: string; ultimo: SalidaTurno | null };

export interface Intento { n: number; ms: number; ok: boolean; motivo?: string; ganador?: boolean }

/** ¿El turno terminó por una falla del modelo (no por una respuesta, ni por la respuesta fija del verificador)? Pura. */
export function fallaDelModelo(r: SalidaTurno): string | null {
  const e = r.traza.error ?? '';
  if (e.startsWith('modelo:')) return e.slice(7).trim();
  // El tope de llamados no es una falla del modelo: el turno ya terminó con la respuesta fija de «no pude».
  if (e === 'tope de tiempo del turno' || e === 'el modelo no llamó ninguna herramienta') return e;
  return null;
}

export const esRechazo = (r: SalidaTurno) => fallaDelModelo(r) === 'refusal';

/**
 * Corre el turno con el reintento con aviso. `intentar(n, presupuestoMs)` corre un turno del modelo completo (cada
 * intento con su contexto propio). `avisar()` publica `rf.demora` (lo llama una sola vez, sin esperar). `reloj` en ms.
 */
export async function turnoConReintento(p: {
  intentar: (n: number, presupuestoMs: number) => Promise<SalidaTurno>;
  avisar: () => Promise<void>;
  corte1Ms: number;
  corteTotalMs: number;
  reloj: () => number;
  dormir?: (ms: number) => Promise<void>;
}): Promise<{ desenlace: Desenlace; intentos: Intento[]; demora: boolean }> {
  const t0 = p.reloj();
  const intentos: Intento[] = [];
  let demora = false;
  const espera = (ms: number) => new Promise<'tiempo'>((r) => {
    if (p.dormir) void p.dormir(Math.max(0, ms)).then(() => r('tiempo'));
    else setTimeout(() => r('tiempo'), Math.max(0, ms));
  });
  const correr = (n: number, presupuesto: number) => {
    const ti = p.reloj();
    return p.intentar(n, presupuesto).then((r) => {
      const motivo = fallaDelModelo(r);
      intentos.push({ n, ms: Math.round(p.reloj() - ti), ok: !motivo, ...(motivo ? { motivo } : {}) });
      return { n, r, motivo };
    });
  };
  const resta = () => p.corteTotalMs - (p.reloj() - t0);
  const ganar = (x: { n: number; r: SalidaTurno }): Desenlace => {
    const i = intentos.find((y) => y.n === x.n);
    if (i) i.ganador = true;
    return { tipo: 'respuesta', r: x.r, ganador: x.n };
  };

  const uno = correr(1, p.corteTotalMs);
  const antes = await Promise.race([uno, espera(p.corte1Ms)]);
  if (antes !== 'tiempo') {
    if (!antes.motivo) return { desenlace: ganar(antes), intentos, demora };
    if (antes.motivo === 'refusal') return { desenlace: { tipo: 'rechazo', r: antes.r }, intentos, demora };
    // Error (no demora): un reintento inmediato con lo que quede.
    // Sin tiempo para otro intento (menos de 500 ms, o del 20 % del corte total si es más corto): falla.
    if (resta() < Math.min(500, p.corteTotalMs * 0.2)) return { desenlace: { tipo: 'falla', motivo: antes.motivo, ultimo: antes.r }, intentos, demora };
    const dos = await Promise.race([correr(2, resta()), espera(resta())]);
    if (dos === 'tiempo') return { desenlace: { tipo: 'falla', motivo: 'corte_total', ultimo: antes.r }, intentos, demora };
    if (!dos.motivo) return { desenlace: ganar(dos), intentos, demora };
    if (dos.motivo === 'refusal') return { desenlace: { tipo: 'rechazo', r: dos.r }, intentos, demora };
    return { desenlace: { tipo: 'falla', motivo: dos.motivo, ultimo: dos.r }, intentos, demora };
  }

  // Llegó `corte_1`: el aviso fijo (una vez) y el intento 2 en paralelo; el 1 sigue.
  demora = true;
  void p.avisar().catch(() => {});
  const dos = correr(2, Math.max(500, resta()));
  const desenlace = await new Promise<Desenlace>((resolver) => {
    let pendientes = 2;
    let ultimo: { r: SalidaTurno; motivo: string | null } | null = null;
    let listo = false;
    const fin = (d: Desenlace) => { if (!listo) { listo = true; resolver(d); } };
    const llega = (x: { n: number; r: SalidaTurno; motivo: string | null }) => {
      pendientes--;
      if (!x.motivo) return fin(ganar(x));
      if (x.motivo === 'refusal') return fin({ tipo: 'rechazo', r: x.r });
      ultimo = x;
      if (!pendientes) fin({ tipo: 'falla', motivo: x.motivo, ultimo: x.r });
    };
    uno.then(llega);
    dos.then(llega);
    void espera(resta()).then(() => fin({ tipo: 'falla', motivo: 'corte_total', ultimo: ultimo?.r ?? null }));
  });
  return { desenlace, intentos, demora };
}
