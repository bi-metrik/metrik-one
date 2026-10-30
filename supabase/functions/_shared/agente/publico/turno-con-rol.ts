// ============================================================
// El canal `chatwoot` (`chatwoot-agente`): con qué reglamento y qué funciones atiende este turno, con roles
// ------------------------------------------------------------
// Spec 2026-10-26, §2.5 y §3.1: Sabor sale el 29-oct como un rol asignado por su inbox ('cw:<cuenta>:<inbox>'). Puro
// con puertos (`turno-con-rol.test.ts`); `chatwoot-agente/index.ts` le pone la base.
//   · `hoy` (sin roles en este canal, o sin la migración): el reglamento de siempre (bot `asistente-publico`) y el
//     dominio público entero, sin un cambio.
//   · `rol`: la versión publicada del rol (bot `rol:<clave>`, la del puntero) y sus funciones; la cola compone.
//   · `persona`: el workspace usa roles y este inbox no tiene uno activo, o no se pudo leer: la conversación pasa a una
//     persona en Chatwoot (el respaldo de Sabor, decisión del 26-oct). Nunca el dominio completo.
//   · sin banco (encargo 2026-10-30): la versión que tocaría (del rol o la de siempre) no pasó su banco del arnés
//     (`bancoValido === false`, migración 20261030190000): también pasa a una persona. Publicar sin banco es ensayo;
//     atender en vivo no. Si quien lee no pidió el banco (`bancoValido` ausente), no se decide aquí.
// El rol del inbox no depende de quién escribe, así que no hay rol que fijar por conversación: un cambio de versión
// entra en el turno siguiente (se marca en la traza).
// ============================================================

import type { FuncionPrendida } from '../funciones/tipos.ts';
import { rolParaTraza } from '../roles.ts';
import type { Resolucion } from '../roles.ts';
import type { Reglamento, RolTraza } from '../tipos.ts';

export interface PuertosTurnoPublico {
  resolver(): Promise<Resolucion>;
  reglamentoDelRol(clave: string, reglamentoId: string): Promise<Reglamento | null>;
  reglamentoDeHoy(): Promise<Reglamento | null>;
}

export type TurnoPublico =
  | { tipo: 'atender'; reglamento: Reglamento; funciones?: FuncionPrendida[]; rol?: RolTraza }
  | { tipo: 'persona'; motivo: string }
  | { tipo: 'nada'; motivo: string };

/** La nota privada cuando el inbox no tiene un rol activo (para el equipo en Chatwoot; nunca la ve el cliente). */
export const NOTA_SIN_ROL = 'El asistente no tiene un rol activo para este canal (o no se pudo leer): la conversación queda para una persona.';

/** El motivo cuando la versión vigente no pasó su banco; `chatwoot-agente` lo usa para la nota y el correo. */
export const MOTIVO_SIN_BANCO = 'version_sin_banco';

/** La nota privada cuando la versión vigente no pasó su banco del arnés (nunca la ve el cliente). */
export const NOTA_SIN_BANCO = 'La versión publicada del asistente no pasó su banco de pruebas (pass^k): la conversación queda para una persona.';

export async function turnoPublico(p: PuertosTurnoPublico): Promise<TurnoPublico> {
  const r = await p.resolver();
  if (r.tipo === 'parar') return { tipo: 'persona', motivo: r.motivo };
  if (r.tipo === 'rol') {
    const reglamento = await p.reglamentoDelRol(r.rol.clave, r.rol.reglamento_id!);
    if (!reglamento) return { tipo: 'persona', motivo: 'reglamento_del_rol_no_leido' };
    if (reglamento.bancoValido === false) return { tipo: 'persona', motivo: MOTIVO_SIN_BANCO };
    return { tipo: 'atender', reglamento, funciones: r.rol.funciones, rol: rolParaTraza(r.rol) };
  }
  const reglamento = await p.reglamentoDeHoy();
  if (!reglamento) return { tipo: 'nada', motivo: 'sin reglamento publicado' };
  if (reglamento.bancoValido === false) return { tipo: 'persona', motivo: MOTIVO_SIN_BANCO };
  return { tipo: 'atender', reglamento };
}
