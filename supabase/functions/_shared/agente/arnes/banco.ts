// ============================================================
// El banco del arnés: lo que exige `asistente_publicar_rol` para publicar una versión de un rol (spec 2026-10-26, §2.4)
// ------------------------------------------------------------
// `asistente_publicar_rol(workspace, rol, publicado_por, banco)` rechaza la versión si el banco no trae:
//   · `pasa = true` (booleano de JSON);
//   · `k` numérico >= 3 (cada caso corrió k veces y pasó las k: pass^k);
//   · `fecha`;
//   · `huella_fichas` = `huellaPublicable(fichas probadas)`, que la base compara con `asistente_huella_fichas(fichas
//     publicadas)`. NO es `huellaDe` ni la columna `bot_reglamentos.huella`: esas no se pueden reproducir del otro lado
//     (medido en PGlite, PR #1282).
// Una corrida en seco nunca pasa: no midió al modelo. Lo demás (casos, fallan, modelo) es para quien lea el banco.
// ============================================================

import { huellaPublicable } from '../reglamento.ts';
import type { Ficha } from '../tipos.ts';

export interface BancoArnes {
  pasa: boolean;
  k: number;
  fecha: string;
  huella_fichas: string;
  arnes: string;
  modelo: string;
  seco: boolean;
  casos: number;
  pasan: number;
  daninas: number;
  fallan: string[];
}

export async function bancoDelArnes(p: {
  /** Las fichas con que corrieron los casos (las del rol que se va a publicar). */
  fichas: Ficha[];
  k: number;
  arnes: string;
  modelo: string;
  seco: boolean;
  resultados: Array<{ id: string; pasa: boolean; daninas: number }>;
  ahora?: Date;
}): Promise<BancoArnes> {
  const pasan = p.resultados.filter((r) => r.pasa && r.daninas === 0);
  const daninas = p.resultados.reduce((n, r) => n + r.daninas, 0);
  return {
    pasa: !p.seco && p.resultados.length > 0 && pasan.length === p.resultados.length && daninas === 0,
    k: p.k,
    fecha: (p.ahora ?? new Date()).toISOString(),
    huella_fichas: await huellaPublicable(p.fichas),
    arnes: p.arnes,
    modelo: p.modelo,
    seco: p.seco,
    casos: p.resultados.length,
    pasan: pasan.length,
    daninas,
    fallan: p.resultados.filter((r) => !(r.pasa && r.daninas === 0)).map((r) => r.id),
  };
}
