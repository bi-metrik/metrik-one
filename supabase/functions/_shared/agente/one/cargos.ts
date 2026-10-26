// ============================================================
// El dominio ONE partido por cargo (spec 2026-10-26, §2.6 «Efecto en ONE de hoy»)
// ------------------------------------------------------------
// Hasta hoy el dominio ONE declaraba TODAS sus herramientas a todos los cargos y frenaba por rol al ejecutar
// (`dominio.ts`, `permisosDe`): un operador veía `ingreso` y `contacto_nuevo` y recibía «tu rol no permite». Desde
// aquí cada cargo recibe solo las funciones que su permiso le da, con un mapa FIJO que reproduce `permisosDe` sin
// cambiarle el significado (la prueba `cargos.test.ts` lo exige para los seis cargos y uno desconocido):
//
//   cargo       escribir  ingresos  contactos  negocios  plata  gastos
//   owner/admin    sí        sí        sí         sí       sí     sí
//   supervisor     sí        sí        no         sí       no     no
//   operator       sí        no        no         sí       no     no
//   contador       no        no        no         sí       sí     sí
//   read_only      no        no        no         no       sí     sí
//
// Por WhatsApp todo staff que no es el principal entra hoy como `operator` (`wa_identify_user` no devuelve el rol; ver
// `wa-identificar.ts`). No se arregla aquí: un staff con otro cargo se asigna POR PERSONA en `asistente_asignaciones`.
// ============================================================

import { componerDominio, reglamentoDelTurno } from '../componer.ts';
import type { Composicion, OpcionesComponer } from '../componer.ts';
import { MOTOR_ONE } from '../funciones/equipo-one.ts';
import { MOTOR_PERSONA } from '../persona.ts';
import type { Dominio, Reglamento } from '../tipos.ts';
import { huellaDe } from '../reglamento.ts';
import { DATOS_POR_ACCION_ONE, permisosDeFunciones } from './dominio.ts';
import { REESCRITURAS_ONE } from './reglamento.ts';

/** Las funciones de cada cargo de ONE (el mapa fijo). Un cargo que no está, ninguna. */
export const FUNCIONES_POR_CARGO: Readonly<Record<string, readonly string[]>> = Object.freeze({
  owner: ['equipo.gastos', 'equipo.ingresos', 'equipo.actividades', 'equipo.contactos', 'equipo.consulta_negocio', 'equipo.consulta_gastos', 'equipo.ver_plata'],
  admin: ['equipo.gastos', 'equipo.ingresos', 'equipo.actividades', 'equipo.contactos', 'equipo.consulta_negocio', 'equipo.consulta_gastos', 'equipo.ver_plata'],
  supervisor: ['equipo.gastos', 'equipo.ingresos', 'equipo.actividades', 'equipo.consulta_negocio'],
  operator: ['equipo.gastos', 'equipo.actividades', 'equipo.consulta_negocio'],
  contador: ['equipo.consulta_negocio', 'equipo.consulta_gastos', 'equipo.ver_plata'],
  read_only: ['equipo.consulta_gastos', 'equipo.ver_plata'],
});

export const funcionesDelCargo = (cargo: string): string[] => [...(FUNCIONES_POR_CARGO[cargo] ?? [])];

export { permisosDeFunciones };

/**
 * El dominio ONE compuesto con estas funciones (las de un cargo o las de un rol). `motor` ya armado con las mismas.
 * `persona`: el motor del paso a una persona (`../persona.ts`, `dominioPersona`), que pone `comun.persona` en todo rol
 * (§4.2). Sin él, el rol queda sin paso a persona (pruebas del motor ONE solo).
 */
export function componerOne(motor: Dominio, funciones: OpcionesComponer['funciones'], log?: (m: string) => void, persona?: Dominio | null): Composicion {
  return componerDominio({
    motores: { [MOTOR_ONE]: motor, ...(persona ? { [MOTOR_PERSONA]: persona } : {}) }, funciones,
    datosPorAccion: { [MOTOR_ONE]: DATOS_POR_ACCION_ONE }, ...(log ? { log } : {}),
  });
}

/** El reglamento ONE del turno: las fichas de las funciones que quedaron (con las reescrituras de la prosa de ONE). */
export function reglamentoOneDelTurno(r: Reglamento, c: Composicion): Promise<Reglamento> {
  return reglamentoDelTurno(r, c, { reescribir: REESCRITURAS_ONE, huella: huellaDe });
}
