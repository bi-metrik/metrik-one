// ============================================================
// El canal `wa_one` (el número de Agus, `wa-webhook`): qué dominio y qué reglamento atienden este turno, con roles
// ------------------------------------------------------------
// Puro con puertos, para probarlo sin Supabase (`turno-con-rol.test.ts`); `wa-agente.ts` le pone la base.
//   · `hoy` (el workspace no usa roles, o la migración todavía no está): el dominio ONE recortado al CARGO de quien
//     escribe (`cargos.ts`) y el reglamento de siempre (el publicado con bot `one`, o el del código).
//   · `rol`: el rol fijo de la conversación, su versión publicada (bot `rol:<clave>`) y sus funciones.
//   · `parar`: respuesta fija, sin modelo (nunca el dominio completo).
// ============================================================

import type { Composicion } from '../componer.ts';
import { rolDeCargo, rolFijo, rolParaTraza } from '../roles.ts';
import type { Resolucion, RolResuelto } from '../roles.ts';
import type { FuncionPrendida } from '../funciones/tipos.ts';
import type { Dominio, Reglamento, RolTraza } from '../tipos.ts';
import { componerOne, funcionesDelCargo, reglamentoOneDelTurno } from './cargos.ts';

/** Lo que contesta el canal cuando el workspace usa roles y quien escribe no tiene uno activo. */
export const RF_SIN_ROL = 'Por este chat todavía no tengo nada habilitado para ti. Pídeselo a quien administra ONE en tu empresa.';
/** Lo que contesta si no se pudo leer el rol en un workspace que usa roles. */
export const RF_ROL_NO_LEIDO = 'No pude revisarlo ahora. Escríbeme de nuevo en un rato.';

export interface PuertosTurnoOne {
  /** La resolución de este remitente (`resolverRol`). */
  resolver(): Promise<Resolucion>;
  /** El `traza.rol` más reciente de la conversación (en su ventana), o null. Solo se llama con roles. */
  rolPrevio(): Promise<RolTraza | null>;
  /** La versión publicada de un rol (bot `rol:<clave>`), o null si no se pudo leer. */
  reglamentoDelRol(clave: string, reglamentoId: string): Promise<Reglamento | null>;
  /** El reglamento de hoy (el publicado con bot `one` o el del código). */
  reglamentoDeHoy(): Promise<Reglamento>;
  /** El motor ONE con los permisos de estas funciones. */
  motor(funciones: string[]): Dominio;
  log?(m: string): void;
}

export type TurnoOne =
  | { tipo: 'atender'; dominio: Dominio; reglamento: Reglamento; rol: RolTraza; composicion: Composicion; via: 'cargo' | 'rol' }
  | { tipo: 'parar'; texto: string; motivo: string };

export async function turnoOne(cargo: string, p: PuertosTurnoOne): Promise<TurnoOne> {
  const r = await p.resolver();
  if (r.tipo === 'parar') return { tipo: 'parar', texto: r.motivo === 'lectura_fallo' ? RF_ROL_NO_LEIDO : RF_SIN_ROL, motivo: r.motivo };
  let funciones: Array<string | FuncionPrendida>;
  let base: Reglamento;
  let rol: RolTraza;
  if (r.tipo === 'rol') {
    const fijo: RolResuelto = rolFijo(r.rol, await p.rolPrevio().catch(() => null));
    const leido = await p.reglamentoDelRol(fijo.clave, fijo.reglamento_id!);
    if (!leido) return { tipo: 'parar', texto: RF_ROL_NO_LEIDO, motivo: 'reglamento_del_rol_no_leido' };
    funciones = fijo.funciones;
    base = leido;
    rol = rolParaTraza(fijo);
  } else {
    funciones = funcionesDelCargo(cargo);
    base = await p.reglamentoDeHoy();
    rol = rolDeCargo(cargo, funciones as string[]);
  }
  const claves = funciones.map((f) => (typeof f === 'string' ? f : f.funcion));
  const composicion = componerOne(p.motor(claves), funciones, p.log);
  return {
    tipo: 'atender', dominio: composicion.dominio, reglamento: await reglamentoOneDelTurno(base, composicion), rol, composicion,
    via: r.tipo === 'rol' ? 'rol' : 'cargo',
  };
}
