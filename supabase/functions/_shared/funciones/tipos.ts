// ============================================================
// Funciones (cupo y reservas) — los tipos de los servicios del asistente (etapa 2 de Sabor & Experiencias)
// ------------------------------------------------------------
// Diseño: proyectos/sabor-experiencias/clarity/docs/entrada/diseno-etapa2-funciones-mapa.md (§3).
// Base: migración 20261022170000_modulo_funciones.sql (`funcion_consultar_cupo`, `funcion_apartar`).
//
// PREPARADOS, SIN CONECTAR: `chatwoot-agente` no los importa todavía. Cuando se conecten, entran como un puerto más
// del asistente (como `AlmacenPublico` en `../agente/publico/puertos.ts`), con `memoria.ts` como doble del arnés.
// ============================================================

import type { Canal, LlaveConversacion } from '../agente/publico/tipos.ts';

/** Lo único que el asistente ve de una función. Nunca datos de otras reservas. */
export interface CupoPublico {
  funcion_id: string;
  inicia_at: string;
  /** `cerrada` también cuando ya pasó la hora de cierre de la venta. */
  estado: 'abierta' | 'cerrada' | 'cancelada';
  cupo_libre: number;
  agotada: boolean;
}

/**
 * Lo que el asistente manda a apartar tras el «sí» del cliente sobre la propuesta.
 *
 * A propósito NO hay campo de mesa ni de puesto: Sabor no asigna puestos (la gente se sienta en orden de llegada y a
 * los grupos de 5 o más les guarda mesa a mano, fuera de ONE; alcance del 2026-10-22). Lo que el cliente pida («vamos
 * 6, queremos estar juntos») va en `solicitudCliente`, como texto libre, sin ninguna lógica.
 */
export interface PropuestaApartado {
  llave: LlaveConversacion;
  canal: Canal;
  funcionId: string;
  personas: number;
  nombre: string | null;
  documento: string | null;
  telefono: string | null;
  /** El usuario del canal (IG, TikTok) cuando no hay teléfono. */
  contactoCanal: string | null;
  /** Lo que pide el cliente, en sus palabras. Texto libre: nunca es una mesa ni un puesto. */
  solicitudCliente: string | null;
  /** La huella de la propuesta vigente: es la clave de idempotencia (el reintento devuelve la misma reserva). */
  huellaPropuesta: string;
}

/** Los códigos que el asistente puede recibir. Los de la base son los mismos (`raise exception '<codigo>'`). */
export const ERRORES_FUNCIONES = [
  'sin_cupo',
  'funcion_cerrada',
  'venta_cerrada',
  'sin_regla_apartado',
  'sin_autorizacion',
  'funcion_no_existe',
  'clave_reusada',
  'datos_invalidos',
  'personas_invalidas',
] as const;

/** `error_base`: cualquier otra falla (red, permiso, un código que este módulo no conoce). No es un «no hay cupo». */
export type CodigoErrorFunciones = (typeof ERRORES_FUNCIONES)[number] | 'error_base';

export type ResultadoCupo = { ok: true; cupo: CupoPublico } | { ok: false; error: CodigoErrorFunciones };

export type ResultadoApartar =
  | {
      ok: true;
      reservaId: string;
      /** `apartada` en un apartado nuevo; en un reintento, el estado que tenga hoy la reserva. */
      estado: 'apartada' | 'confirmada' | 'cancelada' | 'vencida';
      venceAt: string | null;
      repetida: boolean;
    }
  | { ok: false; error: CodigoErrorFunciones };

export type RespuestaAutorizacion = 'si' | 'no' | null;

export interface PuertoFunciones {
  consultarCupo(workspaceId: string, funcionId: string): Promise<ResultadoCupo>;
  /** La ÚLTIMA respuesta a la autorización `general` de la conversación (`null` = nunca respondió). */
  autorizacionGeneral(llave: LlaveConversacion): Promise<RespuestaAutorizacion>;
  apartar(p: PropuestaApartado): Promise<ResultadoApartar>;
}

/** El código estable de un error de la base, o `error_base`. Pura. */
export function codigoDeError(mensaje: string | null | undefined): CodigoErrorFunciones {
  const m = String(mensaje ?? '').trim();
  return (ERRORES_FUNCIONES as readonly string[]).includes(m) ? (m as CodigoErrorFunciones) : 'error_base';
}
