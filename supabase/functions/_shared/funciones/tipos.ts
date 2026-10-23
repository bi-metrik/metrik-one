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
  /** Solo en preventa: hasta qué día rige (AAAA-MM-DD, inclusive, día de Bogotá); `null` = sin fecha de fin. */
  preventa_hasta: string | null;
  /** Abono por persona para apartar; `null` = no se aparta con abono. */
  abono_persona: number | null;
  permite_pago_total: boolean;
}

/**
 * El estado de una función para N personas, SIN números de cupo («Nunca dejar ir a un cliente», Mauricio 2026-10-22):
 *   · `alcanza`              caben en el cupo del asistente y la función está disponible;
 *   · `llena_para_asistente` no caben en el cupo del asistente pero sí en la capacidad: el asistente ofrece pasar a
 *                            una persona, sin prometer el puesto (no cuenta la sobreventa);
 *   · `llena`                no caben ni en la capacidad;
 *   · `no_disponible`        pausada, cancelada, pasada, con la venta cerrada o de una campaña no publicada o no activa.
 */
export type EstadoAsistente = 'alcanza' | 'llena_para_asistente' | 'llena' | 'no_disponible';

/** Una función donde SÍ caben esas personas, con la misma regla de disponibilidad. Sin números de cupo. */
export interface Alternativa {
  funcion_id: string;
  experiencia: string;
  campana: string;
  campana_codigo: string;
  inicia_at: string;
  /** «sábado 24 de octubre, 1:00 p. m.», hora de Bogotá. */
  inicia_texto: string;
  tarifa: TarifaPublica;
  alcanza: true;
  grupo: 'misma_campana' | 'otra_experiencia';
}

/** Lo que el asistente ve de UNA función para N personas. Nunca un número de cupo ni datos de otras reservas. */
export interface CupoPublico {
  funcion_id: string;
  campana_codigo: string;
  inicia_at: string;
  inicia_texto: string;
  estado: EstadoAsistente;
  tarifa: TarifaPublica;
  /** Hasta 3, solo si el estado no es `alcanza`: primero la misma campaña por cercanía, después otras experiencias. */
  alternativas: Alternativa[];
}

/** Una función que el asistente puede ofrecer (`ver_funciones_disponibles`). Sin números de cupo. */
export interface FuncionDisponible {
  funcion_id: string;
  campana_codigo: string;
  campana: string;
  experiencia: string;
  inicia_at: string;
  inicia_texto: string;
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

/** La campaña de una conversación (P10), por el id del anuncio de donde llegó o por el código que escribió. */
export interface CampanaDeConversacion {
  campana_id: string;
  codigo: string;
  nombre: string;
  experiencia: string;
  estado: string;
  /** Si el asistente puede ofrecer sus funciones (activa y con la agenda publicada). */
  activa: boolean;
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
  'reserva_no_existe',
  'reserva_inactiva',
  'distinta_conversacion',
  'apartado_vencido',
  'reserva_en_otro_pago',
  'ya_realineada',
  'pago_con_link',
  'pasarela_fallo',
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

/** Si falla por cupo (`sin_cupo`), trae el mismo estado y las mismas alternativas de `consultar_cupo`. */
export type ResultadoApartar =
  | ({ ok: true } & Apartado)
  | { ok: false; error: CodigoErrorFunciones; estado?: EstadoAsistente; alternativas?: Alternativa[] };

export type RespuestaAutorizacion = 'si' | 'no' | null;

/** Una reserva dentro del resumen de un pago (`funcion_resumen_pago`). Montos calculados por la base. */
export interface LineaResumenPago {
  reserva_id: string;
  funcion_id: string;
  inicia_at: string;
  personas: number;
  precio_unitario: number;
  tarifa: 'preventa' | 'completa';
  modalidad: Modalidad;
  monto_a_pagar: number;
  /** Sigue apartada y sin vencer: se puede cobrar. */
  vigente: boolean;
  estado: string;
}

/** Lo que el asistente muestra antes de pedir el pago: cada reserva y el total SIN las vencidas. No suma: lee. */
export interface ResumenPago {
  reservas: LineaResumenPago[];
  total: number;
  vencidas: string[];
}

/** El pago que creó la base (`funcion_preparar_pago`), con sus reservas realineadas. */
export interface PagoPreparado {
  pago_id: string;
  monto_esperado: number;
  vence_at: string;
  reservas: string[];
}

/** El link listo para mandar al cliente. */
export interface LinkPago {
  pagoId: string;
  referencia: string;
  url: string;
  monto: number;
  venceAt: string;
}

export interface PuertoFunciones {
  consultarCupo(workspaceId: string, funcionId: string, personas: number): Promise<ResultadoCupo>;
  verDisponibles(workspaceId: string, codigoCampana: string | null): Promise<Resultado<FuncionDisponible[]>>;
  campanasActivas(workspaceId: string): Promise<Resultado<CampanasActivas>>;
  /** `null` = ningún anuncio o código asociado a una campaña publicada. */
  campanaPorAnuncio(workspaceId: string, adId: string): Promise<Resultado<CampanaDeConversacion | null>>;
  campanaPorCodigo(workspaceId: string, codigo: string): Promise<Resultado<CampanaDeConversacion | null>>;
  /** La ÚLTIMA respuesta a la autorización `general` de la conversación (`null` = nunca respondió). */
  autorizacionGeneral(llave: LlaveConversacion): Promise<RespuestaAutorizacion>;
  apartar(p: PropuestaApartado): Promise<ResultadoApartar>;
  /** Solo reservas de una conversación (`distinta_conversacion` si no). */
  resumenPago(workspaceId: string, reservaIds: string[]): Promise<Resultado<ResumenPago>>;
  /** Candados, realineación (una vez por reserva) y el pago con `monto_esperado`. */
  prepararPago(workspaceId: string, reservaIds: string[]): Promise<Resultado<PagoPreparado>>;
  /** Guarda la referencia y el link que devolvió la pasarela. */
  vincularLink(pagoId: string, referencia: string, url: string): Promise<Resultado<null>>;
}

/** El código estable de un error de la base, o `error_base`. Pura. */
export function codigoDeError(mensaje: string | null | undefined): CodigoErrorFunciones {
  const m = String(mensaje ?? '').trim();
  return (ERRORES_FUNCIONES as readonly string[]).includes(m) ? (m as CodigoErrorFunciones) : 'error_base';
}
