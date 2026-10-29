/**
 * Los traslados, trenes y actividades que el modelo de la propuesta necesita (`servicios` de
 * `modeloDePropuesta`). El pendiente del PR 1: las props de @react-pdf no los traen, así que la
 * sección «Trenes y traslados» salía vacía y el día a día no los ponía.
 *
 * Sale de la MISMA lectura que el resto del documento (`serviciosDeItems`), línea por línea,
 * con tres cosas más:
 * - el día: si alguien le asignó un día a la línea (`dia_relativo`), manda sobre la fecha
 *   leída del pantallazo, como en la pantalla por pasos (`por-pasos-vista.ts`);
 * - las tarifas a las que pertenece la línea, con varias tarifas en la propuesta (los mismos
 *   índices de `itinerarios` que marcan vuelos y hoteles);
 * - un traslado de ida y vuelta sale en sus trayectos, con su fecha y su hora
 *   (`trayectosDeTraslado`, hallazgo de la COT-2026-0026 real del 2026-10-14).
 *
 * Puro.
 */
import { esAlquilerDeCarro, fechaCorta, lecturaDeTraslado, lugarDelServicio, serviciosDeItems, type ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
import { esFechaCivil, sumarDiasCivil } from '@/lib/viaje/plan-pagos'
import type { ServicioDelDocumento } from './modelo-documento'
import { trayectosDeTraslado, vehiculoLegible } from './trayectos'

export interface ItemDeServicio extends ItemConLectura {
  /** La línea (`items.id`): el día a día no la pinta dos veces (ver `ServicioDelDocumento.itemId`). */
  id?: string | null
  /** Día del viaje asignado (1 = el de salida). */
  dia_relativo?: number | null
  /** Índices de tarifa a los que pertenece. Vacío o ausente = todas. */
  tarifas?: number[]
}

export function serviciosDelDocumento(items: readonly ItemDeServicio[], inicio: string | null): ServicioDelDocumento[] {
  const salida: ServicioDelDocumento[] = []
  const inicioIso = inicio && esFechaCivil(inicio.slice(0, 10)) ? inicio.slice(0, 10) : null
  for (const item of items) {
    const dia = typeof item.dia_relativo === 'number' && item.dia_relativo >= 1 ? item.dia_relativo : null
    const fechaDelDia = dia !== null && inicioIso ? fechaCorta(sumarDiasCivil(inicioIso, dia - 1)) : null
    const tarifas = {
      ...(item.tarifas && item.tarifas.length > 0 ? { tarifas: [...item.tarifas] } : {}),
      ...(item.id ? { itemId: item.id } : {}),
    }
    const lectura = lecturaDeTraslado(item)
    // N7-4 / V7-3 (QA del 2026-10-29): el carro de alquiler no es un traslado. Un solo servicio con
    // dónde se recoge y dónde se devuelve; el modelo lo rotula «Alquiler de carro».
    if (lectura && esAlquilerDeCarro(item)) {
      const [recogida, devolucion] = (lectura.trayecto ?? '').replace(/\s*\n\s*/g, ' - ').split(/\s*(?:->|→|=>)\s*|\s+[-–]\s+/).map((x) => x.trim()).filter(Boolean)
      const fechaLeida = fechaCorta(/(\d{4}-\d{2}-\d{2})/.exec(lectura.fecha ?? '')?.[1] ?? null)
      const vehiculo = vehiculoLegible(lectura.vehiculo)
      salida.push({
        tipo: 'traslado',
        descripcion: ['Alquiler de carro', vehiculo].filter(Boolean).join(' · '),
        fecha: fechaDelDia ?? fechaLeida,
        hora: null,
        alquiler: { recogida: recogida ?? null, devolucion: devolucion ?? recogida ?? null, vehiculo },
        ...tarifas,
      })
      continue
    }
    if (lectura) {
      trayectosDeTraslado(lectura).forEach((t, i) => {
        // El día asignado es el del primer trayecto; el de vuelta sin fecha propia se deduce de él.
        const fecha = i === 0 ? fechaDelDia ?? t.fecha : t.fecha
        const fechaIda = i > 0 && !t.fecha ? fechaDelDia ?? t.fechaIda ?? null : null
        salida.push({
          tipo: 'traslado',
          descripcion: t.descripcion,
          fecha,
          hora: t.hora,
          ...(fechaIda ? { fechaIda } : {}),
          ...tarifas,
        })
      })
      continue
    }
    for (const { esAlquiler: _alquiler, ...s } of serviciosDeItems([item])) {
      salida.push({ ...s, fecha: fechaDelDia ?? s.fecha, hora: null, ...tarifas })
    }
  }
  return salida
}

/** Dónde y cuándo es un plan opcional: la ciudad leída y la fecha (el día asignado manda). */
export interface LugarDeOpcional {
  ciudad: string | null
  fecha: string | null
}

/**
 * Los lugares de los planes opcionales, en el MISMO orden que `props.sugeridos` (el modelo los
 * empareja por posición). Igual que `serviciosDelDocumento`: el día asignado manda sobre la
 * fecha leída. Puro.
 */
export function lugaresDeOpcionales(items: readonly ItemDeServicio[], inicio: string | null): LugarDeOpcional[] {
  const inicioIso = inicio && esFechaCivil(inicio.slice(0, 10)) ? inicio.slice(0, 10) : null
  return items.map((item) => {
    const dia = typeof item.dia_relativo === 'number' && item.dia_relativo >= 1 ? item.dia_relativo : null
    const fechaDelDia = dia !== null && inicioIso ? fechaCorta(sumarDiasCivil(inicioIso, dia - 1)) : null
    const leido = lugarDelServicio(item)
    return { ciudad: leido.ciudad, fecha: fechaDelDia ?? leido.fecha }
  })
}
