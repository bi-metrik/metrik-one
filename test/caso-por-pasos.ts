// ============================================================
// El caso fijo de San Andrés (`caso-san-andres.ts`) con lo que hace falta para que el
// INTERRUPTOR de la cotización por pasos se pueda encender en el doble de igualdad.
//
// `caso-san-andres.ts` es dato congelado de C0 y no se toca. Aquí solo se le AGREGA:
//  · un bloque de la etapa 1 que declara quiénes viajan, con las columnas ya proyectadas
//    que pide `leerLineasPorTipo` (`fields` y el filtro `etapas_negocio.linea_id`), para que
//    la línea «cotice por tipo» (condición 1);
//  · el `config_extra` del workspace con `cotizacion_por_pasos` (condición 3).
// La plantilla `trappvel` (condición 2) y el estado `borrador` (condición 4) ya vienen en
// el caso.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

import { LINEA_VIAJE, tablasCasoSanAndres } from './caso-san-andres'
import type { Fila } from './igualdad-servidor-doble'

export const INTERRUPTOR_ENCENDIDO = {
  cotizacion_por_pasos: {
    activo: true,
    piezas: { modelo_destino: true, toda_opcion_en_tarifas: true, opcional_traslado: true, incluye_por_one: true, lista_unica: true, margen_por_tarifa: true },
  },
}

const CAMPOS_VIAJE = [{ slug: 'adultos' }, { slug: 'ninos' }, { slug: 'infantes' }, { slug: 'fecha_salida' }]

export interface OpcionesPorPasos {
  /** Enciende `cotizacion_por_pasos.activo`. */
  interruptor?: boolean
  /** La línea declara quiénes viajan (es de viaje). Por defecto sí. */
  lineasPorTipo?: boolean
  /** La plantilla del workspace. Por defecto `trappvel`. */
  plantilla?: string | null
  /** El estado de la cotización. Por defecto `borrador`. */
  estado?: string
  /** Piezas apagadas explícitamente. */
  piezasApagadas?: string[]
  /** Lo demás de `tablasCasoSanAndres`. */
  caso?: Parameters<typeof tablasCasoSanAndres>[0]
}

export function tablasPorPasos(o: OpcionesPorPasos = {}): Record<string, Fila[]> {
  const interruptor = o.interruptor !== false
  const piezas = { ...INTERRUPTOR_ENCENDIDO.cotizacion_por_pasos.piezas } as Record<string, boolean>
  for (const p of o.piezasApagadas ?? []) piezas[p] = false
  const configWorkspace = {
    ...(o.caso?.configWorkspace ?? {}),
    ...(interruptor ? { cotizacion_por_pasos: { activo: true, piezas } } : {}),
  }
  const t = tablasCasoSanAndres({ ...o.caso, configWorkspace })
  if (o.lineasPorTipo !== false) {
    t.bloque_configs.push({
      id: 'bc-viaje', etapa_id: 'e-solicitud', workspace_id: (t.workspaces[0] as Fila).id, estado: 'editable',
      tipo: 'datos', config_extra: { fields: CAMPOS_VIAJE },
      // Las columnas proyectadas del `select` de `leerLineasPorTipo`, tal como las devuelve PostgREST.
      fields: CAMPOS_VIAJE, 'etapas_negocio.linea_id': LINEA_VIAJE, etapas_negocio: { linea_id: LINEA_VIAJE },
    })
  }
  if (o.plantilla !== undefined) (t.workspaces[0] as Fila).cotizacion_template_slug = o.plantilla
  if (o.estado) (t.cotizaciones[0] as Fila).estado = o.estado
  return t
}
