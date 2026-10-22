// ============================================================
// Funciones (campañas, cupo, precio y reservas) — los tipos de los servicios del asistente (Sabor, etapa 2)
// ------------------------------------------------------------
// Diseño: proyectos/sabor-experiencias/clarity/docs/entrada/diseno-etapa2-funciones-mapa.md (§3).
// Base: migración 20261022170000_modulo_funciones.sql (`funcion_consultar_cupo`, `funcion_ver_disponibles`,
// `funcion_campanas_activas`, `funcion_apartar`).
//
// «Todo sale y vuelve a ONE» (Mauricio, 2026-10-22): el precio, el abono, los cupos y el monto de cada reserva los
// calcula la base. El asistente los LEE de aquí y no hace cuentas: la propuesta no lleva montos.
//
// PREPARADOS, SIN CONECTAR: `chatwoot-agente` no los importa todavía. Cuando se conecten, entran como un puerto más
// del asistente (como `AlmacenPublico` en `../agente/publico/puertos.ts`), con `memoria.ts` como doble del arnés.
// ============================================================

import type { Canal, LlaveConversacion } from '../agente/publico/tipos.ts';

/** El precio que rige una función, resuelto por la base (`funcion_tarifa`). Pesos enteros. */
export interface TarifaPublica {
  tarifa: 'preventa' | 'completa';
  /** El precio ofrecido por persona. `null` = sin precio: no se aparta. */
  precio_persona: number | null;
  /** Solo en preventa: el precio completo, como contexto («después sube a…»). */
  precio_completo_persona: number | null;
  /** Abono por persona para apartar; `null` = no se aparta con abono. */
  abono_persona: number | null;
  permite_pago_total: boolean;
}

/** Por qué el asistente no puede ofrecer una función (la regla vive en `funcion_motivo_asistente`). */
export type MotivoNoDisponible = 'campana_no_activa' | 'funcion_no_activa' | 'funcion_pasada' | 'venta_cerrada' | 'agotada';

/** Lo que el asistente ve de UNA función. Nunca la capacidad ni datos de otras reservas. */
export interface CupoPublico {
  funcion_id: string;
  campana_codigo: string;
  inicia_at: string;
  disponible: boolean;
  motivo: MotivoNoDisponible | null;
  /** Lo libre DEL ASISTENTE (su cupo menos lo ocupado), no la capacidad. */
  cupo_libre: number;
  agotada: boolean;
  tarifa: TarifaPublica;
}

/** Una función que el asistente puede ofrecer (`ver_funciones_disponibles`). */
export interface FuncionDisponible {
  funcion_id: string;
  campana_codigo: string;
  campana: string;
  experiencia: string;
  inicia_at: string;
  cupo_libre: number;
  tarifa: TarifaPublica;
}

/** Una campaña con agenda publicada y activa. Si hay más de una, el asistente pregunta a qué viene el cliente. */
export interface CampanaActiva {
  campana_id: string;
  codigo: string;
  nombre: string;
  experiencia: string;
  desde: string | null;
  hasta: string | null;
  funciones_disponibles: number;
}

export interface CampanasActivas {
  total: number;
  campanas: CampanaActiva[];
}

export type Modalidad = 'abono' | 'total';

/** De dónde llegó el cliente (lo genérico; el anuncio y el link exactos están en verificación con Meta y Chatwoot). */
export type FuenteAtribucion = 'anuncio' | 'link_campana' | 'preguntado' | 'desconocida';

/**
 * Lo que el asistente manda a apartar tras el «sí» del cliente sobre la propuesta.
 *
 * A propósito NO hay campo de mesa, de puesto ni de MONTO: Sabor no asigna puestos (alcance del 2026-10-22) y el monto
 * lo calcula la base. Lo que el cliente pida («vamos 6, queremos estar juntos») va en `solicitudCliente`, como texto.
 */
export interface PropuestaApartado {
  llave: LlaveConversacion;
  canal: Canal;
  funcionId: string;
  personas: number;
  modalidad: Modalidad;
  nombre: string | null;
  documento: string | null;
  telefono: string | null;
  /** El usuario del canal (IG, TikTok) cuando no hay teléfono. */
  contactoCanal: string | null;
  /** Lo que pide el cliente, en sus palabras. Texto libre: nunca es una mesa ni un puesto. */
  solicitudCliente: string | null;
  atribucion: { fuente: FuenteAtribucion; ref: string | null };
  /** La huella de la propuesta vigente: es la clave de idempotencia (el reintento devuelve la misma reserva). */
  huellaPropuesta: string;
}

/** Los códigos que el asistente puede recibir. Los de la base son los mismos (`raise exception '<codigo>'`). */
export const ERRORES_FUNCIONES = [
  'sin_cupo',
  'sin_precio',
  'modalidad_no_permitida',
  'campana_no_activa',
  'funcion_no_activa',
  'funcion_pasada',
  'venta_cerrada',
  'sin_regla_apartado',
  'sin_autorizacion',
  'funcion_no_existe',
  'clave_reusada',
  'datos_invalidos',
  'dato_no_admitido',
  'personas_invalidas',
] as const;

/** `error_base`: cualquier otra falla (red, permiso, un código que este módulo no conoce). No es un «no hay cupo». */
export type CodigoErrorFunciones = (typeof ERRORES_FUNCIONES)[number] | 'error_base';

export type Resultado<T> = { ok: true; dato: T } | { ok: false; error: CodigoErrorFunciones };

export type ResultadoCupo = { ok: true; cupo: CupoPublico } | { ok: false; error: CodigoErrorFunciones };

/** La foto del apartado, calculada por la base. */
export interface Apartado {
  reservaId: string;
  /** `apartada` en un apartado nuevo; en un reintento, el estado que tenga hoy la reserva. */
  estado: 'apartada' | 'confirmada' | 'cancelada' | 'vencida';
  venceAt: string | null;
  repetida: boolean;
  campanaId: string;
  tarifa: 'preventa' | 'completa';
  precioUnitario: number;
  montoTotal: number;
  modalidad: Modalidad;
  montoAPagar: number;
}

export type ResultadoApartar = ({ ok: true } & Apartado) | { ok: false; error: CodigoErrorFunciones };

export type RespuestaAutorizacion = 'si' | 'no' | null;

export interface PuertoFunciones {
  consultarCupo(workspaceId: string, funcionId: string): Promise<ResultadoCupo>;
  verDisponibles(workspaceId: string, codigoCampana: string | null): Promise<Resultado<FuncionDisponible[]>>;
  campanasActivas(workspaceId: string): Promise<Resultado<CampanasActivas>>;
  /** La ÚLTIMA respuesta a la autorización `general` de la conversación (`null` = nunca respondió). */
  autorizacionGeneral(llave: LlaveConversacion): Promise<RespuestaAutorizacion>;
  apartar(p: PropuestaApartado): Promise<ResultadoApartar>;
}

/** El código estable de un error de la base, o `error_base`. Pura. */
export function codigoDeError(mensaje: string | null | undefined): CodigoErrorFunciones {
  const m = String(mensaje ?? '').trim();
  return (ERRORES_FUNCIONES as readonly string[]).includes(m) ? (m as CodigoErrorFunciones) : 'error_base';
}
