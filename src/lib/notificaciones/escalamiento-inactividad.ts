/**
 * Escalamiento del aviso de inactividad: a QUIÉN se le avisa y con qué texto.
 *
 * Si el negocio AMERITA aviso no se decide acá: lo decide `debe_alertar_inactividad`
 * en SQL, una sola definición que consultan el detector y el resolver (migración
 * `20260901000011`, y por qué eso importa está escrito ahí).
 *
 * Lo que vive acá es el escalamiento, y se expresa como DISTANCIAS sobre el umbral,
 * no como días absolutos. Antes eran 3/5/7/15 con el umbral clavado en 3; desde que
 * el umbral sale del SLA de la etapa, un número absoluto se rompe: la etapa
 * Seguimiento tiene umbral 10 y el escalamiento al supervisor decía 7, o sea que el
 * supervisor se enteraría ANTES de que existiera el primer aviso. Con distancias, un
 * umbral de 3 reproduce exactamente los 3/5/7/15 de siempre.
 */

/** Días hábiles por encima del umbral en los que el aviso sube de nivel. */
export const DISTANCIA_ESCALAMIENTO = {
  /** El supervisor del área entra (rama legacy, por rol global del workspace). */
  supervisor: 2,
  /** Entra la administración. */
  admin: 4,
  /** El aviso pasa a preguntar si el negocio se cierra como perdido. */
  cierre: 12,
  /**
   * Rama legacy del cron de ejecución (workspaces sin routing por responsable): el
   * owner entra además del supervisor. Eran 5 días absolutos con el umbral en 2.
   */
  ownerEjecucion: 3,
} as const

export type NivelInactividad = {
  /** Días hábiles sin gestión a partir de los cuales aplica este nivel. */
  dias: number
  /** Etiqueta que queda en `notificaciones.metadata.nivel`. */
  nivel: string
  roles: string[]
}

/**
 * Escalera de la etapa de venta, de mayor a menor: el cron toma el PRIMER nivel que
 * el negocio alcanza, así que el orden descendente es parte del contrato.
 */
export function nivelesInactividadVenta(umbralDias: number): NivelInactividad[] {
  const nivel = (extra: number, roles: string[]): NivelInactividad => {
    const dias = umbralDias + extra
    return { dias, nivel: `${dias}d`, roles }
  }
  return [
    nivel(DISTANCIA_ESCALAMIENTO.cierre, ['operator', 'supervisor', 'admin', 'owner']),
    nivel(DISTANCIA_ESCALAMIENTO.admin, ['operator', 'supervisor', 'admin', 'owner']),
    nivel(DISTANCIA_ESCALAMIENTO.supervisor, ['operator', 'supervisor']),
    nivel(0, ['operator']),
  ]
}

/** Día a partir del cual el aviso deja de pedir gestión y pregunta si se cierra. */
export function diaCierrePorInactividad(umbralDias: number): number {
  return umbralDias + DISTANCIA_ESCALAMIENTO.cierre
}

/**
 * Día en que el supervisor del área entra en la rama de routing por responsable.
 *
 * `escalar_supervisor_dias` es config del workspace y sigue siendo un número absoluto
 * (7 por defecto, 7 en SOENA). El `max` es lo que impide que un umbral largo lo deje
 * llegando antes que el propio aviso: nunca adelanta al responsable, solo lo sigue.
 */
export function diaEscalarSupervisor(umbralDias: number, diasConfigurados: number): number {
  return Math.max(diasConfigurados, umbralDias)
}
