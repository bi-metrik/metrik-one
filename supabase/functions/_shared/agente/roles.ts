// ============================================================
// Asistentes MeTRIK — qué rol atiende a quien escribe (spec 2026-10-26, §2.5), en los dos canales que existen
// ------------------------------------------------------------
// Una ida a la base por turno: la RPC `asistente_resolver_rol` (migración 20261026183000, PR #1282) devuelve la
// asignación vigente más específica (persona, luego cargo, luego inbox) en el canal del turno, su rol con el puntero y
// las funciones que quedan (las del rol ∩ las prendidas en la empresa).
//
// Qué hace cada resultado (`Resolucion`):
//   · `hoy`      el workspace no usa roles en este canal (`usa_roles: false`), o la RPC/la tabla todavía no existen en
//                producción (42883, 42P01, PGRST202, PGRST205: la migración va antes que el código, pero si el orden sale
//                al revés no se cae nadie). Rige el camino de hoy, sin un cambio.
//   · `rol`      un rol activo y publicado: el componedor arma el dominio con sus funciones.
//   · `parar`    el workspace usa roles y este remitente no tiene uno activo (sin asignación, rol apagado o sin
//                publicar), o la lectura falló en un workspace que se sabe que usa roles: el canal contesta lo fijo
//                (WhatsApp) o pasa a una persona (Chatwoot). Nunca cae al dominio completo.
// Cualquier otro error con un workspace del que no se sabe si usa roles: `hoy` (el camino de siempre ya frena por cargo).
// El «se sabe» es una memoria de la instancia (`usaRolesConocido`), por workspace y canal, de la última lectura buena.
//
// El rol se fija al empezar la conversación (§2.6: cambiar las herramientas a mitad invalida el caché y, con
// razonamiento, da error): si la conversación ya tiene un turno con rol (`traza.rol`), se sigue con esa versión y esas
// funciones, salvo que el rol de ahora esté apagado (el interruptor manda) o que la empresa haya apagado una función.
// ============================================================

import type { FuncionPrendida } from './funciones/tipos.ts';
import type { RolTraza } from './tipos.ts';

export type CanalRol = 'wa_one' | 'chatwoot' | 'wa_propio';

/** Lo que devuelve `asistente_resolver_rol` en `rol`. */
export interface RolResuelto {
  id: string;
  clave: string;
  familia: 'equipo' | 'clientes';
  canal: CanalRol;
  activo: boolean;
  reglamento_id: string | null;
  version: number | null;
  por: 'staff' | 'colaborador' | 'cargo' | 'inbox';
  asignacion_id: string;
  funciones: FuncionPrendida[];
  funciones_apagadas: string[];
}

export type Resolucion =
  | { tipo: 'hoy'; motivo: string }
  | { tipo: 'rol'; rol: RolResuelto }
  | { tipo: 'parar'; motivo: 'sin_rol' | 'rol_apagado' | 'sin_publicar' | 'lectura_fallo'; rol?: RolResuelto };

/** Quien escribe, con lo que el canal sabe de él. Lo que no aplique va en null. */
export interface SujetoRol {
  workspaceId: string;
  canal: CanalRol;
  /**
   * `staff.id` de quien escribe (o su `profiles.id`: la RPC acepta los dos dentro del workspace). Por WhatsApp sale de
   * `identificarRemitente` (`WaUser.staff_id`), resuelto por teléfono.
   */
  staff?: string | null;
  colaborador?: string | null;
  /** El cargo de ONE (`WaUser.role`). Ojo: por WhatsApp todo staff no principal llega como `operator` (§ cargos.ts). */
  cargo?: string | null;
  /** 'cw:<cuenta>:<inbox>' (Chatwoot) o 'wa:<phone_number_id>' (Meta). */
  inbox?: string | null;
}

/** Lo que hace falta de un cliente de Supabase (en las pruebas, un doble). */
export interface ClienteRpc {
  rpc(nombre: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

/** Los códigos de «la función o la tabla no existe todavía» (Postgres y PostgREST). */
export const CODIGOS_SIN_MIGRACION = ['42883', '42P01', 'PGRST202', 'PGRST205'];

/** La memoria de la instancia: por `workspace|canal`, si la última lectura buena dijo que usa roles. */
export const usaRolesConocido = new Map<string, { usa: boolean; at: number }>();
const VIGENCIA_CONOCIDO_MS = 6 * 3600 * 1000;

/** La respuesta de la RPC, ya validada, a `Resolucion`. Pura. */
export function resolucionDe(data: unknown): Resolucion {
  const d = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  if (!d || d.usa_roles !== true) return { tipo: 'hoy', motivo: 'el workspace no usa roles en este canal' };
  const r = d.rol && typeof d.rol === 'object' ? d.rol as RolResuelto : null;
  if (!r) return { tipo: 'parar', motivo: 'sin_rol' };
  const rol: RolResuelto = { ...r, funciones: Array.isArray(r.funciones) ? r.funciones : [], funciones_apagadas: Array.isArray(r.funciones_apagadas) ? r.funciones_apagadas : [] };
  if (!rol.activo) return { tipo: 'parar', motivo: 'rol_apagado', rol };
  if (!rol.reglamento_id) return { tipo: 'parar', motivo: 'sin_publicar', rol };
  return { tipo: 'rol', rol };
}

export async function resolverRol(supabase: ClienteRpc, s: SujetoRol, o: { ahora?: number; log?: (m: string) => void } = {}): Promise<Resolucion> {
  const ahora = o.ahora ?? Date.now();
  const log = o.log ?? ((m: string) => console.error(`[roles] ${m}`));
  const llave = `${s.workspaceId}|${s.canal}`;
  let r: { data: unknown; error: { code?: string; message?: string } | null };
  try {
    r = await supabase.rpc('asistente_resolver_rol', {
      p_workspace_id: s.workspaceId, p_canal: s.canal, p_staff: s.staff ?? null, p_colaborador: s.colaborador ?? null,
      p_cargo: s.cargo ?? null, p_inbox: s.inbox ?? null,
    });
  } catch (err) {
    r = { data: null, error: { message: String(err) } };
  }
  if (r.error) {
    if (CODIGOS_SIN_MIGRACION.includes(String(r.error.code ?? ''))) return { tipo: 'hoy', motivo: `sin la migración de roles (${r.error.code})` };
    const c = usaRolesConocido.get(llave);
    log(`asistente_resolver_rol falló en ${llave}: ${r.error.code ?? ''} ${r.error.message ?? ''}`);
    if (c?.usa && ahora - c.at < VIGENCIA_CONOCIDO_MS) return { tipo: 'parar', motivo: 'lectura_fallo' };
    return { tipo: 'hoy', motivo: 'la lectura falló y no se sabe si el workspace usa roles' };
  }
  const res = resolucionDe(r.data);
  usaRolesConocido.set(llave, { usa: res.tipo !== 'hoy', at: ahora });
  return res;
}

// ── El rol fijo de la conversación ───────────────────────────────────────────

/** Lo que queda en la traza de cada turno (§2.9): el rol, su versión y sus funciones. Pura. */
export function rolParaTraza(r: RolResuelto): RolTraza {
  return { clave: r.clave, id: r.id, version: r.version, reglamento_id: r.reglamento_id, por: r.por, funciones: r.funciones };
}

/** El rol de un cargo de ONE en el camino de hoy (sin roles en la base): para la traza y las métricas. Pura. */
export function rolDeCargo(cargo: string, funciones: string[]): RolTraza {
  return { clave: `cargo:${cargo}`, id: null, version: null, reglamento_id: null, por: 'cargo', funciones: funciones.map((f) => ({ funcion: f, parametros: {} })) };
}

/**
 * El rol de este turno, fijo en la conversación (§2.6). `previo`: el `traza.rol` más reciente de la conversación (en su
 * ventana). Si es el MISMO rol, se sigue con la versión y las funciones con que empezó (publicar una versión nueva no
 * cambia las herramientas a mitad); si la empresa apagó alguna de esas funciones, se quita (su interruptor manda;
 * agregar no se agrega a mitad). Si la asignación cambió a otro rol, manda la de ahora: el rol viejo pudo apagarse, y
 * su interruptor no se puede saltar. Pura.
 */
export function rolFijo(actual: RolResuelto, previo: RolTraza | null | undefined): RolResuelto {
  if (!previo || !previo.reglamento_id || previo.clave !== actual.clave) return actual;
  const apagadas = new Set(actual.funciones_apagadas);
  return {
    ...actual,
    reglamento_id: previo.reglamento_id,
    version: previo.version,
    funciones: previo.funciones.filter((f) => !apagadas.has(f.funcion)),
  };
}

/** El `traza.rol` más reciente de unas filas (las de la conversación, en orden). Pura. */
export function rolPrevio(filas: Array<{ traza?: { rol?: RolTraza | null } | null }>): RolTraza | null {
  for (let i = filas.length - 1; i >= 0; i--) {
    const r = filas[i].traza?.rol;
    if (r && typeof r === 'object' && typeof r.clave === 'string') return r;
  }
  return null;
}
