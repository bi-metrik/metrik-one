'use server'

import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardVerNegocio } from '@/lib/permissions/guard-negocio'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { leerDatosGantt, type EncabezadoGantt, type VersionGantt } from '@/lib/cronograma/datos-gantt'
import { construirGantt, type ModeloGantt } from '@/lib/cronograma/gantt'
import CronogramaGanttPDF from '@/lib/pdf/cronograma-gantt-pdf'

export interface GanttCronograma {
  encabezado: EncabezadoGantt
  version: VersionGantt | null
  modelo: ModeloGantt
}

/**
 * El Gantt ya calculado. Lo pide la vista expandida y lo usa el PDF: el cálculo corre
 * en un solo lugar para que la pantalla y el documento del cliente digan lo mismo, con
 * el mismo «hoy» (el de Bogotá, no el del navegador).
 */
async function armarGantt(
  negocioBloqueId: string,
): Promise<{ gantt: GanttCronograma | null; error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { gantt: null, error: 'No autenticado' }

  const { data: bloque } = await supabase
    .from('negocio_bloques')
    .select('negocio_id')
    .eq('id', negocioBloqueId)
    .maybeSingle()
  const negocioId = (bloque as { negocio_id: string } | null)?.negocio_id
  if (!negocioId) return { gantt: null, error: 'Cronograma no encontrado' }

  const guard = await guardVerNegocio(negocioId)
  if (!guard.ok) return { gantt: null, error: guard.error ?? 'Sin acceso a este negocio' }

  const datos = await leerDatosGantt(supabase, { negocioBloqueId, negocioId, workspaceId })
  if (!datos) return { gantt: null, error: 'No se pudo leer el cronograma' }

  return {
    gantt: {
      encabezado: datos.encabezado,
      version: datos.version,
      modelo: construirGantt(datos.pasos, todayBogotaISO()),
    },
    error: null,
  }
}

export async function leerGanttCronograma(negocioBloqueId: string) {
  return armarGantt(negocioBloqueId)
}

export async function generarCronogramaPDF(
  negocioBloqueId: string,
): Promise<{ pdf: string | null; filename: string | null; error: string | null }> {
  const { gantt, error } = await armarGantt(negocioBloqueId)
  if (!gantt) return { pdf: null, filename: null, error }

  const element = createElement(CronogramaGanttPDF, gantt)
  // renderToBuffer espera DocumentElement; createElement lo produce en runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any)

  const base = gantt.encabezado.negocioCodigo ?? gantt.encabezado.negocioNombre
  const sufijo = gantt.version ? `v${gantt.version.numero}` : 'borrador'
  const filename = `Cronograma ${base} ${sufijo}.pdf`.replace(/[\\/:*?"<>|]+/g, '-')

  return { pdf: Buffer.from(buffer).toString('base64'), filename, error: null }
}
