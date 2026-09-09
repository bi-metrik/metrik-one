/**
 * Máquina de estados de una suscripción de licencia ONE. Pura: sin base, sin reloj.
 *
 * Regla de negocio (`cerebro/reglas/pago-anticipado-habilita-acceso.md`): el pago
 * anticipado habilita el mes; el impago suspende desde el vencimiento, con aviso
 * escrito y sin gracia, tras los reintentos. **El acceso es el producto.**
 *
 *   trial ──pago──▶ activa ──vencimiento──▶ pendiente_pago ──suspender──▶ suspendida
 *     │               ▲                          │   ▲                        │
 *     │               └───────── pago ───────────┘   └── cargo_fallido ──┐    │
 *     │                                              (intentos < max)   │    │
 *     │               ◀────────────── pago (reactivación) ──────────────│────┘
 *     └──────────────────────── cancelar (desde cualquiera) ───────────▶ cancelada
 *
 * `cancelada` es terminal. `suspendida` NO lo es: el recibo del pago reactiva, que
 * es lo que dice la regla ("hasta el recibo del pago").
 *
 * La política de suspensión (cuántos reintentos, cuánta gracia, y si el sistema
 * suspende solo) entra como PARÁMETRO. En Fase 1 arranca apagada: la máquina sabe
 * suspender, pero el cron no aprieta ese botón hasta que Mauricio decida la política.
 */

export const ESTADOS_SUSCRIPCION = ['trial', 'activa', 'pendiente_pago', 'suspendida', 'cancelada'] as const
export type EstadoSuscripcion = (typeof ESTADOS_SUSCRIPCION)[number]

// `wompi` es la pasarela elegida para el cobro recurrente (decision 2026-09-09).
// El orden importa solo para leerlo: el CHECK de la tabla lista los mismos cuatro.
export const PASARELAS = ['manual', 'wompi', 'bold', 'epayco'] as const
export type Pasarela = (typeof PASARELAS)[number]

export type EventoSuscripcion =
  /** Entró la plata de la cuota (cargo aprobado, link pagado, o confirmación manual). */
  | 'pago_recibido'
  /** La cuota venció (fecha esperada + gracia) sin que entrara la plata. */
  | 'vencimiento'
  /** La pasarela rechazó el cargo (solo pasarelas con cobro iniciado por el comercio). */
  | 'cargo_fallido'
  /** Orden explícita de suspender: la toma una persona, o el ciclo cuando la política lo permite. */
  | 'suspender'
  | 'cancelar'

export interface PoliticaSuspension {
  /** Días después de la fecha esperada antes de declarar la cuota impaga. */
  diasGracia: number
  /** Cargos rechazados seguidos antes de suspender (pasarelas con cobro por token). */
  maxIntentos: number
  /**
   * Si el ciclo puede pasar a `suspendida` por su cuenta. En `false` la máquina se
   * detiene en `pendiente_pago` y la suspensión queda en manos de una persona.
   */
  suspenderAutomaticamente: boolean
}

/**
 * Fase 1: la gracia de hoy (3 días, la misma del cron que marca `vencido`), tres
 * intentos, y NADIE se suspende solo. Es la decisión que queda abierta para Mauricio;
 * mientras tanto el sistema informa (`pendiente_pago`) y no cierra puertas.
 */
export const POLITICA_FASE_1: PoliticaSuspension = {
  diasGracia: 3,
  maxIntentos: 3,
  suspenderAutomaticamente: false,
}

export interface EstadoMaquina {
  estado: EstadoSuscripcion
  intentosFallidos: number
}

export type Transicion =
  | { ok: true; siguiente: EstadoMaquina; cambio: boolean }
  | { ok: false; motivo: 'terminal' | 'evento_no_aplica' }

export function esEstadoSuscripcion(v: unknown): v is EstadoSuscripcion {
  return typeof v === 'string' && (ESTADOS_SUSCRIPCION as readonly string[]).includes(v)
}

export function esPasarela(v: unknown): v is Pasarela {
  return typeof v === 'string' && (PASARELAS as readonly string[]).includes(v)
}

function siguiente(actual: EstadoMaquina, estado: EstadoSuscripcion, intentosFallidos: number): Transicion {
  const cambio = actual.estado !== estado || actual.intentosFallidos !== intentosFallidos
  return { ok: true, siguiente: { estado, intentosFallidos }, cambio }
}

/**
 * Aplica `evento` sobre `actual`. Nunca lanza: un evento que no aplica devuelve
 * `ok:false` para que quien llama decida si es error o ruido.
 */
export function transicionar(
  actual: EstadoMaquina,
  evento: EventoSuscripcion,
  politica: PoliticaSuspension = POLITICA_FASE_1,
): Transicion {
  if (actual.estado === 'cancelada') return { ok: false, motivo: 'terminal' }

  switch (evento) {
    case 'cancelar':
      return siguiente(actual, 'cancelada', actual.intentosFallidos)

    case 'pago_recibido':
      // Desde trial es la activación; desde pendiente_pago o suspendida es la
      // reactivación. En todos los casos el contador de fallos vuelve a cero.
      return siguiente(actual, 'activa', 0)

    case 'vencimiento':
      if (actual.estado === 'trial' || actual.estado === 'activa') {
        return siguiente(actual, 'pendiente_pago', actual.intentosFallidos)
      }
      // Ya estaba pendiente o suspendida: el vencimiento no dice nada nuevo.
      return siguiente(actual, actual.estado, actual.intentosFallidos)

    case 'cargo_fallido': {
      const intentos = actual.intentosFallidos + 1
      if (actual.estado === 'suspendida') return siguiente(actual, 'suspendida', intentos)
      const agotados = intentos >= Math.max(1, politica.maxIntentos)
      if (agotados && politica.suspenderAutomaticamente) return siguiente(actual, 'suspendida', intentos)
      return siguiente(actual, 'pendiente_pago', intentos)
    }

    case 'suspender':
      return siguiente(actual, 'suspendida', actual.intentosFallidos)
  }
}

export type AccesoWorkspace = 'permitido' | 'suspendido'

/**
 * Lo que el layout de la app pregunta en cada render: ¿esta persona entra?
 *
 * Solo `suspendida` cierra la puerta. Todo lo demás pasa, incluidos los valores
 * heredados de `workspaces.subscription_status` (`trial`, `active`, `active_pro`,
 * medidos en producción el 2026-09-08) y el NULL: un workspace sin suscripción
 * gestionada no es un workspace suspendido.
 *
 * El platform_admin entra siempre: si el acceso se cierra por plata, alguien tiene
 * que poder entrar a ver por qué y a arreglarlo.
 */
export function accesoWorkspace(
  subscriptionStatus: string | null | undefined,
  esPlatformAdmin: boolean,
): AccesoWorkspace {
  if (esPlatformAdmin) return 'permitido'
  return subscriptionStatus === 'suspendida' ? 'suspendido' : 'permitido'
}
