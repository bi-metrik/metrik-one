/**
 * Registrar, SIN frenar, que un caso salió de una etapa antes de su plazo.
 *
 * SOE-001 (SOENA, decisión de Mauricio del 2026-10-07): la etapa «Validación de rechazo»
 * existe para llamar al cliente hacia el día 15 hábil desde la entrega a la DIAN (T0) y
 * preguntarle si le llegó un rechazo. No tiene gate: no se quiere frenar a nadie. Pero se
 * quiere MEDIR cuántos casos la saltan, es decir, cuántos salen de ella antes de T0 + 15.
 *
 * Por qué una marca propia y no deducirlo después del `cambio_etapa` del timeline:
 *  - El T0 se puede corregir después, y un reproceso lo archiva (`data._ciclos`): una
 *    consulta posterior compararía la salida contra un T0 que ya no es el de ese momento.
 *  - El `cambio_etapa` guarda el NOMBRE de la etapa, y los nombres cambian.
 * Aquí se congela en el momento del avance: cuántos días hábiles llevaba desde T0.
 *
 * La etapa lo declara (opt-in; sin esto nada cambia):
 *
 *   etapas_negocio.config_extra.registrar_avance_anticipado =
 *     { "ancla_campo": "fecha_entrega_dian", "dias_habiles": 15 }
 *
 * y la marca queda en `activity_log` con `tipo = 'sistema'` y
 * `campo_modificado = 'avance_anticipado'`. Consulta:
 *
 *   select entidad_id, valor_anterior as etapa, valor_nuevo as dias_habiles, created_at
 *   from activity_log where campo_modificado = 'avance_anticipado';
 *
 * `valor_nuevo` es el número de días hábiles, o `sin_ancla` si el caso no tenía T0.
 *
 * Los días hábiles se cuentan como `dias_habiles_entre` de la base (el día inicial NO
 * cuenta, festivos de Colombia), para que el número coincida con el de los avisos de plazo.
 */

import { esDiaHabil } from '@/lib/dates/dias-habiles'

export const CAMPO_AVANCE_ANTICIPADO = 'avance_anticipado'
export const SIN_ANCLA = 'sin_ancla'

export type ConfigAvanceAnticipado = { ancla_campo: string; dias_habiles: number }

export function configAvanceAnticipado(
  configEtapa: Record<string, unknown> | null | undefined,
): ConfigAvanceAnticipado | null {
  const c = configEtapa?.registrar_avance_anticipado as { ancla_campo?: unknown; dias_habiles?: unknown } | undefined
  if (!c || typeof c !== 'object') return null
  const campo = typeof c.ancla_campo === 'string' ? c.ancla_campo.trim() : ''
  const dias = typeof c.dias_habiles === 'number' ? c.dias_habiles : Number(c.dias_habiles)
  if (!campo || !Number.isInteger(dias) || dias <= 0) return null
  return { ancla_campo: campo, dias_habiles: dias }
}

/**
 * Espejo de `fecha_de_texto` (SQL): un año fuera de 2020-2100 no es fecha, es un error de
 * digitación ('0006-02-18' existe en producción). Mejor no contar que contar mal.
 */
export function fechaDeTexto(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null
  const anio = Number(v.slice(0, 4))
  if (anio < 2020 || anio > 2100) return null
  const iso = v.slice(0, 10)
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso
}

/** La fecha más reciente y legible del campo en cualquier casilla del caso (como el motor). */
export function anclaDeBloques(datas: ReadonlyArray<Record<string, unknown> | null | undefined>, campo: string): string | null {
  let max: string | null = null
  for (const d of datas) {
    const f = fechaDeTexto(d?.[campo])
    if (f && (!max || f > max)) max = f
  }
  return max
}

/** Días hábiles en (desde, hasta]. Mismo criterio que `dias_habiles_entre` de la base. */
export function diasHabilesEntre(desdeISO: string, hastaISO: string): number {
  if (hastaISO <= desdeISO) return 0
  let n = 0
  const d = new Date(`${desdeISO}T00:00:00Z`)
  const fin = new Date(`${hastaISO}T00:00:00Z`)
  // Tope de seguridad, como `sumar_dias_habiles`: una fecha disparatada no deja el avance girando.
  for (let i = 0; i < 3660 && d < fin; i++) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (esDiaHabil(d.toISOString().slice(0, 10))) n++
  }
  return n
}

export type AvanceAnticipado = { dias: number | null; plazo: number }

/** `null` si el avance NO es anticipado (ya pasó el plazo). */
export function evaluarAvanceAnticipado(input: {
  config: ConfigAvanceAnticipado
  fechaAncla: string | null
  hoy: string
}): AvanceAnticipado | null {
  const { config, fechaAncla, hoy } = input
  if (!fechaAncla) return { dias: null, plazo: config.dias_habiles }
  const dias = diasHabilesEntre(fechaAncla, hoy)
  return dias < config.dias_habiles ? { dias, plazo: config.dias_habiles } : null
}

export function contenidoAvanceAnticipado(etapaNombre: string, r: AvanceAnticipado): string {
  const texto = r.dias === null
    ? `Salió de ${etapaNombre} sin fecha de inicio registrada, así que no se sabe si cumplió los ${r.plazo} días hábiles.`
    : `Salió de ${etapaNombre} en el día hábil ${r.dias} de ${r.plazo}.`
  return `${texto} No se frenó: queda registrado para medir cuántos casos se adelantan.`.slice(0, 280)
}
