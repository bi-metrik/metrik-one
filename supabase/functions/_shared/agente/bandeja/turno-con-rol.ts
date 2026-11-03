// ============================================================
// La bandeja de VIAJES (Trappvel, Agus) con roles (spec 2026-10-26 asistentes-roles-y-funciones; roles del 2026-10-29)
// ------------------------------------------------------------
// Puro con puertos, para probarlo sin Supabase; `../../wa-agente.ts` (`atenderConAgente`) le pone la base. Igual que
// `../one/turno-con-rol.ts`, con tres salidas:
//   · `hoy`     el workspace no usa roles en `wa_one` (o la migración no está, o la lectura falló sin saberse): el camino
//               de HOY, byte a byte (el reglamento `bandeja-solicitudes` y el dominio de la bandeja entero, sin componer).
//   · `atender` el rol fijo de la conversación con su versión publicada (bot `rol:<clave>`): el componedor arma el
//               dominio con el motor `viajes`, el motor `one` si el rol trae funciones de ONE (la mano derecha: gastos,
//               ingresos, actividades, consultas) y el motor `persona` (el paso a una persona, `comun.persona`).
//   · `parar`   usa roles y quien escribe no tiene uno activo (`RF_SIN_ROL`), o no se pudo leer (`RF_ROL_NO_LEIDO`).
// Dos motores en un turno (viajes + one): el principal es `viajes` (sus reenvíos son la tanda, como hoy); las propuestas
// de ONE vencen con cualquier respuesta (su bandera, por acción); los adjuntos los prepara UN motor (viajes) con el lector
// mixto (`lectura-mixta.ts`), y el modelo decide por contexto si una foto es dato del viaje o soporte de un gasto.
// ============================================================

import { componerDominio, reglamentoDelTurno } from '../componer.ts';
import type { Composicion } from '../componer.ts';
import { CLAVES_VIAJES, MOTOR_VIAJES } from '../funciones/equipo-viajes.ts';
import { FUNCIONES_EQUIPO_ONE, MOTOR_ONE } from '../funciones/equipo-one.ts';
import type { FuncionPrendida } from '../funciones/tipos.ts';
import { DATOS_POR_ACCION_ONE } from '../one/dominio.ts';
import { RF_ROL_NO_LEIDO, RF_SIN_ROL } from '../one/turno-con-rol.ts';
import { ESCALAMIENTO_METRIK, MOTOR_PERSONA, dominioPersona, escalamientoDe } from '../persona.ts';
import type { EscalamientoWaLink } from '../persona.ts';
import { huellaDe } from '../reglamento.ts';
import { rolFijo, rolParaTraza } from '../roles.ts';
import type { Resolucion } from '../roles.ts';
import type { Dominio, Reglamento, RolTraza } from '../tipos.ts';
import type { TOPES_BLOQUE } from '../contexto.ts';

export { RF_ROL_NO_LEIDO, RF_SIN_ROL };

const CLAVES_ONE: ReadonlySet<string> = new Set(FUNCIONES_EQUIPO_ONE.map((f) => f.clave));

/** ¿El rol trae alguna función del motor ONE? (gastos, ingresos, actividades, consultas, ver plata). Pura. */
export const conFuncionesDeOne = (claves: readonly string[]): boolean => claves.some((c) => CLAVES_ONE.has(c));

/** ¿El rol trae alguna función que lea soportes de pago? (para el lector mixto). Pura. */
export const leeSoportes = (claves: readonly string[]): boolean => claves.includes('equipo.gastos') || claves.includes('equipo.ingresos');

/**
 * Los topes de los bloques del prompt cuando un turno lleva dos motores (viajes + ONE): el reglamento junto pasa del
 * tope de uno solo (medido el 2026-10-29: «siempre» ≈ 1.160 tokens la bandeja y ≈ 1.890 ONE; juntos ≈ 2.900 contra un
 * tope de 2.500, y el recorte se come las últimas fichas). Con un motor, null: los de siempre. Pura.
 */
export function bloquesDelTurno(c: Pick<Composicion, 'declaradas' | 'duenas'>): Partial<typeof TOPES_BLOQUE> | null {
  const motores = new Set(Object.values(c.duenas).map((f) => (CLAVES_ONE.has(f) ? MOTOR_ONE : CLAVES_VIAJES.has(f) ? MOTOR_VIAJES : f)));
  return motores.has(MOTOR_ONE) && motores.has(MOTOR_VIAJES) ? { siempre: 4200, indice: 3200, estado: 900 } : null;
}

export interface PuertosTurnoViajes {
  /** La resolución de este remitente (`resolverRol`). */
  resolver(): Promise<Resolucion>;
  /** El `traza.rol` más reciente de la conversación (en su ventana), o null. Solo se llama con roles. */
  rolPrevio(): Promise<RolTraza | null>;
  /** La versión publicada de un rol (bot `rol:<clave>`), o null si no se pudo leer. */
  reglamentoDelRol(clave: string, reglamentoId: string): Promise<Reglamento | null>;
  /** El motor de viajes (la bandeja) para estas funciones (con el lector mixto si el rol lee soportes de pago). */
  motorViajes(funciones: string[]): Dominio;
  /** El motor ONE con los permisos de estas funciones. Solo se llama si el rol trae funciones de ONE. */
  motorOne(funciones: string[], empresa: string | null): Dominio;
  /**
   * El nombre de la empresa (el mensaje ya escrito del paso a persona; en ONE, reconocer el dinero que ENTRÓ a su
   * cuenta). Solo se lee con un rol: el camino de hoy no hace una consulta más.
   */
  empresa?(): Promise<string | null>;
  log?(m: string): void;
}

export type TurnoViajes =
  | { tipo: 'hoy'; motivo: string }
  | {
    tipo: 'atender'; dominio: Dominio; reglamento: Reglamento; rol: RolTraza; composicion: Composicion;
    escalamiento: EscalamientoWaLink;
    empresa: string | null;
    /** Los topes de los bloques del prompt de este turno (dos motores), o null (los de siempre). */
    bloques: Partial<typeof TOPES_BLOQUE> | null;
  }
  | { tipo: 'parar'; texto: string; motivo: string };

/** Compone el dominio de un rol de viajes. Exportada para el arnés y las pruebas (mismo armado que producción). */
export function componerViajes(p: {
  funciones: Array<string | FuncionPrendida>;
  motorViajes: (claves: string[]) => Dominio;
  motorOne: (claves: string[], empresa: string | null) => Dominio;
  escalamiento: EscalamientoWaLink;
  empresa: string | null;
  log?: (m: string) => void;
}): Composicion {
  const claves = p.funciones.map((f) => (typeof f === 'string' ? f : f.funcion));
  const viajes = p.motorViajes(claves);
  const one = conFuncionesDeOne(claves) ? p.motorOne(claves, p.empresa) : null;
  const persona = dominioPersona({ config: p.escalamiento, empresa: p.empresa, base: viajes });
  return componerDominio({
    motores: { [MOTOR_VIAJES]: viajes, ...(one ? { [MOTOR_ONE]: one } : {}), [MOTOR_PERSONA]: persona },
    funciones: p.funciones,
    datosPorAccion: { [MOTOR_ONE]: DATOS_POR_ACCION_ONE },
    adjuntos: MOTOR_VIAJES,
    ...(p.log ? { log: p.log } : {}),
  });
}

export async function turnoViajes(p: PuertosTurnoViajes): Promise<TurnoViajes> {
  const r = await p.resolver();
  if (r.tipo === 'hoy') return { tipo: 'hoy', motivo: r.motivo };
  if (r.tipo === 'parar') return { tipo: 'parar', texto: r.motivo === 'lectura_fallo' ? RF_ROL_NO_LEIDO : RF_SIN_ROL, motivo: r.motivo };
  const fijo = rolFijo(r.rol, await p.rolPrevio().catch(() => null));
  const leido = await p.reglamentoDelRol(fijo.clave, fijo.reglamento_id!);
  if (!leido) return { tipo: 'parar', texto: RF_ROL_NO_LEIDO, motivo: 'reglamento_del_rol_no_leido' };
  const escalamiento = escalamientoDe(leido, ESCALAMIENTO_METRIK, p.log);
  const empresa = p.empresa ? await p.empresa().catch(() => null) : null;
  const composicion = componerViajes({ funciones: fijo.funciones, motorViajes: p.motorViajes, motorOne: p.motorOne, escalamiento, empresa, log: p.log });
  return {
    tipo: 'atender', dominio: composicion.dominio, reglamento: await reglamentoDelTurno(leido, composicion, { huella: huellaDe }),
    rol: rolParaTraza(fijo), composicion, escalamiento, empresa, bloques: bloquesDelTurno(composicion),
  };
}
