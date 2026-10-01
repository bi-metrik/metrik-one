/**
 * La actividad leída de un pantallazo (brief del 2026-10-01, «actividad por pantallazo»,
 * COT-2026-0020 del negocio de prueba P2 26 1).
 *
 * Lo que aquí se decide, puro y sin base:
 *
 *  · el lugar con que nace el bloque de una actividad (punto 4): la ciudad que muestra la
 *    captura; si no la muestra, ninguno, y el servidor usa el destino del viaje. Antes nacía
 *    con lo que dijera el detector, que en una excursión es el nombre de la excursión
 *    («Actividad en Cayo Cangrejo»);
 *  · el aviso de la fecha de la actividad fuera del viaje (punto 5), con la fecha corregida
 *    encima de la leída;
 *  · el aviso de que el costo no entró porque falta la tasa de cambio (punto 3): la tarjeta
 *    cerrada y «Revisar y enviar» lo dicen, para que un precio en $0 nunca pase callado.
 *
 * El reparto del costo con el infante gratis vive con el resto del reparto, en
 * `tarifa-pasajero.ts` (`infanteGratisEnActividad`).
 */

import type { Correcciones } from './correcciones'
import { casillasConEstadia } from './estadia'
import { conHabitaciones, resolverHabitaciones } from './habitaciones'
import { avisoFechaActividadFueraDelViaje } from './ingreso-manual'
import type { TipoRanura } from './ranuras-cotizacion'
import {
  confirmacionDesactualizada,
  monedaDeTarifa,
  resolverTarifa,
  type Composicion,
  type LecturaCasilla,
  type TarifaPax,
} from './tarifa-pasajero'

const RANURA_ACTIVIDAD = 'actividad_detalle'

/** Un campo leído por su rótulo («Ciudad», «Fecha»), o `null` si está vacío. */
function campoLeido(l: LecturaCasilla | null | undefined, rotulo: string): string | null {
  const v = l?.campos?.find(c => c.label === rotulo)?.valor
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * La ciudad de una actividad: la que corrigió la persona (en la fila de la bandeja o en la
 * ficha), y si no, la que leyó la captura. `null` = la captura no la muestra.
 *
 * ⚠️ Nunca el nombre de la actividad ni lo que diga el detector del lugar: «Cayo Cangrejo» es
 * la excursión, no la ciudad.
 */
export function ciudadDeActividad(
  lectura: LecturaCasilla | null | undefined,
  correcciones?: readonly { slug: string; valor: string }[] | Correcciones | null,
): string | null {
  const corregida = Array.isArray(correcciones)
    ? correcciones.find(c => c.slug === 'ciudad')?.valor
    : (correcciones as Correcciones | null | undefined)?.ciudad?.valor
  if (typeof corregida === 'string' && corregida.trim() !== '') return corregida.trim()
  return campoLeido(lectura, 'Ciudad')
}

/**
 * El lugar con que se nombra el bloque NUEVO de una captura (`crearRanuraConOpcion`, que con
 * `null` usa el destino del viaje).
 *
 * Solo cambia la actividad (punto 4): su lugar es la ciudad que muestra la captura, o ninguno.
 * Los demás tipos siguen con lo que dijo el detector.
 */
export function lugarDeBloqueNuevo(
  tipo: TipoRanura,
  lectura: LecturaCasilla,
  pistaLugar: string | null,
  correcciones?: readonly { slug: string; valor: string }[] | null,
): string | null {
  if (tipo !== 'actividad') return pistaLugar
  return ciudadDeActividad(lectura, correcciones)
}

/** La fecha de la actividad: la corregida en la ficha, y si no, la leída. */
export function fechaDeActividad(lectura: LecturaCasilla | null | undefined, correcciones?: Correcciones | null): string | null {
  const corregida = correcciones?.fecha?.valor
  if (typeof corregida === 'string' && corregida.trim() !== '') return corregida.trim()
  const deIdentidad = lectura?.identidad?.fecha
  if (typeof deIdentidad === 'string' && deIdentidad.trim() !== '') return deIdentidad.trim()
  return campoLeido(lectura, 'Fecha')
}

/**
 * El aviso de la tarjeta de una actividad cuya fecha cae fuera del viaje (punto 5). `null` en
 * cualquier otra opción, sin fecha, o sin fechas del viaje.
 */
export function avisoFechaDeActividad(
  ranuraSlug: string | null | undefined,
  tarifa: TarifaPax,
  fechasViaje: { inicio: string | null; fin: string | null } | null | undefined,
): string | null {
  if (ranuraSlug !== RANURA_ACTIVIDAD) return null
  return avisoFechaActividadFueraDelViaje(fechaDeActividad(tarifa.casillas?.grupo_completo, tarifa.correcciones), fechasViaje)
}

/**
 * Lo que se dice cuando el costo de la opción ya se puede calcular pero no entró porque el
 * precio está en otra moneda y nadie ha escrito la tasa de cambio (punto 3). `null` si no es
 * el caso: sin lectura, con el costo ya cargado y vigente, en COP, o con otro faltante (ese lo
 * dice su propio bloque).
 */
export function avisoTasaPendiente(
  tarifa: TarifaPax,
  composicion: Composicion | null,
  ranuraSlug: string | null | undefined,
): string | null {
  if (!ranuraSlug || !tarifa.casillas?.grupo_completo) return null
  if (tarifa.confirmada && !confirmacionDesactualizada(tarifa, composicion)) return null
  const moneda = monedaDeTarifa(tarifa)
  if (moneda.asumida || moneda.moneda === 'COP') return null
  const estado = conHabitaciones(tarifa)
    ? resolverHabitaciones(tarifa, composicion, { moneda: moneda.moneda })
    : composicion
      ? resolverTarifa(composicion, casillasConEstadia(tarifa.casillas, tarifa.correcciones), ranuraSlug, { moneda: moneda.moneda })
      : null
  if (estado?.estado !== 'resuelta') return null
  return textoTasaPendiente(estado.moneda)
}

/** «El precio está en EUR: escribe la tasa de cambio para cargar el costo.» */
export function textoTasaPendiente(moneda: string): string {
  return `El precio está en ${moneda.toUpperCase()}: escribe la tasa de cambio para cargar el costo.`
}
