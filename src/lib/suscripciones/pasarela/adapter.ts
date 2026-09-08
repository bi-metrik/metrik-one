/**
 * Contrato de una pasarela de pago vista desde el ciclo de suscripción.
 *
 * La decisión de pasarela está ABIERTA (2026-09-08): Bold hoy no tiene tokenización
 * ni cobro iniciado por el comercio (su doc dice que las APIs de recurrencia
 * "vendrán"), ePayco sí cobra por token. El ciclo no puede depender de cuál gane, así
 * que habla con esta interfaz y nada más. Tres implementaciones previstas:
 *
 *   - `manual`       (Fase 1, esta) — no cobra: deja el cobro programado y una persona
 *                    confirma el pago desde el bloque de cobros, como hoy.
 *   - `bold-link`    (Fase 2) — un link de pago por cuota + webhook CloudEvents. El
 *                    cliente hace clic cada mes.
 *   - `epayco-token` (Fase 2) — cargo por token contra la tarjeta guardada. Débito
 *                    sin clic.
 *
 * Lo que el ciclo exige de cualquiera: `cobrar` es IDEMPOTENTE por `referencia` (la
 * misma cuota pedida dos veces no puede cobrarse dos veces), y ningún método lanza
 * por un rechazo de negocio —un rechazo es un resultado, no una excepción. Las
 * excepciones quedan para lo que de verdad es excepcional (red, credenciales).
 *
 * Spec: docs/specs/2026-09-08_suscripciones-cobro-automatico.md
 */

import type { Pasarela } from '../estado'

/**
 * Lo que se guarda del medio de pago. NUNCA el PAN completo, NUNCA el CVV, NUNCA la
 * fecha de vencimiento junto al número. Solo lo que sirve para que una persona lo
 * reconozca en pantalla ("VISA ···· 4242") y la referencia del token en la pasarela.
 */
export interface MedioPagoEnmascarado {
  tipo: 'tarjeta' | 'cuenta' | 'pse' | 'otro'
  /** VISA, MASTERCARD, AMEX… tal como lo reporta la pasarela. */
  marca?: string
  ultimos4?: string
  titular?: string
  /** Referencia del token/cliente en la pasarela. Es un puntero, no el dato. */
  token_ref?: string
  /** Pasarela que emitió el token. Un token de ePayco no sirve en Bold. */
  pasarela?: Pasarela
  registrado_at?: string
}

export interface ClienteCargo {
  nombre: string | null
  email: string | null
  documento: string | null
}

export interface SolicitudCargo {
  /**
   * Clave de idempotencia del cargo. Determinista por cuota: `referenciaCargo()`.
   * Se manda a la pasarela como referencia del comercio y se guarda en
   * `cobros.external_ref` cuando la pasarela no devuelve una propia.
   */
  referencia: string
  suscripcionId: string
  /** Workspace del CLIENTE (el que paga), no el del cobrador. */
  workspaceId: string
  cobroId: string
  planCobroId: string
  numeroCuota: number
  /** COP, entero. Es lo que se debita: la factura sale sin IVA (art. 476 num. 21 ET). */
  monto: number
  moneda: 'COP'
  descripcion: string
  /** Número de la factura Siigo que respalda el cargo. `null` mientras la factura no exista (Fase 1). */
  facturaRef: string | null
  medioPago: MedioPagoEnmascarado | null
  cliente: ClienteCargo | null
}

export type ResultadoCargo =
  | {
      estado: 'aprobado'
      /** Id de la transacción en la pasarela. Se guarda en `cobros.external_ref`. */
      externalRef: string
      /** 'YYYY-MM-DD' Bogotá en que entró la plata. */
      fecha: string
      monto: number
    }
  | {
      estado: 'pendiente'
      /** Id del intento/link si la pasarela dio uno; `null` en manual. */
      externalRef: string | null
      /** URL que el cliente tiene que abrir (bold-link). */
      linkPago?: string
      /** ISO-8601 de expiración del link/intento, si aplica. */
      expira?: string
      detalle?: string
    }
  | {
      estado: 'rechazado'
      externalRef: string | null
      /** Código de la pasarela (p. ej. `51` fondos insuficientes). */
      codigo: string
      mensaje: string
      /** `false` cuando reintentar no tiene sentido (tarjeta cancelada, token revocado). */
      reintentable: boolean
    }
  | {
      estado: 'error'
      mensaje: string
      reintentable: boolean
    }

export interface CapacidadesPasarela {
  /** Cobra sin que el cliente haga nada cada mes (cargo iniciado por el comercio). */
  cobroSinClic: boolean
  /** Guarda el medio de pago y devuelve un token reutilizable. */
  tokenizacion: boolean
  /** Genera un link/checkout por cuota. */
  linkDePago: boolean
  /** Avisa por webhook cuando el pago se resuelve. */
  webhook: boolean
}

/** Un evento de pasarela ya verificado y normalizado. Lo produce `verificarWebhook`. */
export interface EventoPasarela {
  tipo: 'aprobado' | 'rechazado' | 'anulado' | 'otro'
  /** Id ÚNICO del evento/transacción en la pasarela: es la clave de idempotencia del webhook. */
  transaccionId: string
  /** Referencia del comercio que viajó en el cargo (`SolicitudCargo.referencia`), si vuelve. */
  referencia: string | null
  monto: number | null
  ocurridoAt: string | null
  /** El cuerpo tal cual llegó, para dejarlo en la bandeja de eventos. */
  crudo: unknown
}

export type VerificacionWebhook =
  | { ok: true; evento: EventoPasarela }
  | { ok: false; motivo: 'firma_invalida' | 'sin_firma' | 'cuerpo_invalido' | 'no_configurado' }

export interface PasarelaAdapter {
  readonly nombre: Pasarela
  readonly capacidades: CapacidadesPasarela
  /** Inicia el cobro de UNA cuota. Idempotente por `solicitud.referencia`. */
  cobrar(solicitud: SolicitudCargo): Promise<ResultadoCargo>
  /** Estado actual de un cargo/link ya iniciado. Sirve para sondear lo pendiente. */
  consultar(externalRef: string): Promise<ResultadoCargo>
  /**
   * Verifica firma y normaliza un webhook. Sincrónico y sin red a propósito: el
   * route handler tiene que responder 200 en menos de 2 s (Bold reintenta 5 veces).
   */
  verificarWebhook?(cuerpoCrudo: string, cabeceras: Record<string, string | undefined>): VerificacionWebhook
}

/**
 * Referencia determinista por cuota. Corta (≤ 30 caracteres) para que quepa donde
 * sea que haya que ponerla: la clave de idempotencia de Siigo admite 30, y una
 * referencia de comercio en Bold/ePayco también tiene tope.
 */
export function referenciaCargo(suscripcionId: string, numeroCuota: number): string {
  const corto = suscripcionId.replace(/-/g, '').slice(0, 12)
  return `sub-${corto}-c${numeroCuota}`
}
