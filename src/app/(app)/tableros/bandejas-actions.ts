'use server'

/**
 * Datos de los tableros operativos (bandejas por fase). Solo LEE.
 *
 * El cálculo vive en `@/lib/tableros/bandejas`, puro y probado; aquí se trae la materia
 * prima con el cliente de la SESIÓN (RLS por workspace) y además acotada por
 * `workspace_id` a mano. Las lecturas que crecen pasan por `traerTodo`: el techo de 1.000
 * filas de PostgREST no avisa.
 *
 * Fuentes, todas vivas:
 *  - `negocios` + `etapas_negocio.stage`: la fase del flujo real (venta, ejecucion, cobro).
 *  - `activity_log` con autor: el último movimiento humano de cada negocio.
 *  - `v_cartera_negocio`: lo vencido (columnas `saldo_vencido`, `dias_mora`, `con_cronograma`).
 *  - `cobros` programados sin pagar (`fecha IS NULL`): las cuotas pendientes.
 *  - `v_pyl_mes.ingresos_con_iva`: el cobrado del mes, la misma cifra de /numeros.
 *  - `gastos.soporte_pendiente`: el gasto registrado por WhatsApp que quedó esperando la foto.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { traerTodo } from '@/lib/supabase/paginar'
import { bogotaYearMonth, todayBogotaISO } from '@/lib/dates/bogota'
import {
  armarBandejas,
  type Bandejas,
  type FilaCarteraBandeja,
  type NegocioBandeja,
} from '@/lib/tableros/bandejas'

export interface BandejasData {
  bandejas: Bandejas
  /** `YYYY-MM-DD` de hoy en Bogotá, resuelto en el servidor. */
  hoy: string
}

function lanzar(ctx: string, e: { message: string } | null) {
  if (e) throw new Error(`[tableros operativos] ${ctx}: ${e.message}`)
}

interface NegocioRow {
  id: string
  codigo: string | null
  nombre: string
  estado: string | null
  etapa_actual_id: string | null
  precio_aprobado: number | string | null
  precio_estimado: number | string | null
  pausado: boolean | null
  is_paused: boolean | null
  pausado_hasta: string | null
  created_at: string
  etapa_cambiada_at: string | null
  linea_id: string | null
  closed_at: string | null
}

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v))

export async function getBandejasOperativas(): Promise<BandejasData | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return null
  const db = supabase as unknown as SupabaseClient
  const ws = workspaceId
  const hoy = todayBogotaISO()
  const mesInicio = `${bogotaYearMonth()}-01`

  const [negociosRaw, actividad, carteraR, cuotas, gastosR, pylR, cobrosMes, cambiosEtapa] = await Promise.all([
    traerTodo<NegocioRow>(
      (desde, hasta) =>
        db
          .from('negocios')
          .select(
            'id, codigo, nombre, estado, etapa_actual_id, precio_aprobado, precio_estimado, pausado, is_paused, pausado_hasta, created_at, etapa_cambiada_at, linea_id, closed_at',
          )
          .eq('workspace_id', ws)
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'negocios' },
    ),
    traerTodo<{ entidad_id: string; created_at: string }>(
      (desde, hasta) =>
        db
          .from('activity_log')
          .select('entidad_id, created_at')
          .eq('workspace_id', ws)
          .eq('entidad_tipo', 'negocio')
          .not('autor_id', 'is', null)
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'activity_log' },
    ),
    db
      .from('v_cartera_negocio')
      .select('negocio_id, codigo, nombre, honorario, honorario_recaudado, saldo, dias, con_cronograma, saldo_vencido, dias_mora')
      .eq('workspace_id', ws),
    traerTodo<{ negocio_id: string; monto: number | string; fecha_esperada: string | null }>(
      (desde, hasta) =>
        db
          .from('cobros')
          .select('negocio_id, monto, fecha_esperada')
          .eq('workspace_id', ws)
          .eq('tipo_cobro', 'programado')
          .is('fecha', null)
          .is('anulado_at', null)
          .not('negocio_id', 'is', null)
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'cuotas pendientes' },
    ),
    db
      .from('gastos')
      .select('id, fecha, monto, descripcion, categoria')
      .eq('workspace_id', ws)
      .eq('soporte_pendiente', true),
    db
      .from('v_pyl_mes')
      .select('ingresos_con_iva')
      .eq('workspace_id', ws)
      .eq('mes', mesInicio)
      .maybeSingle(),
    // Respaldo del cobrado cuando la vista no tiene fila del mes, igual que /numeros.
    db
      .from('cobros')
      .select('monto')
      .eq('workspace_id', ws)
      .gte('fecha', mesInicio)
      .lte('fecha', hoy)
      .or('tipo_cobro.is.null,tipo_cobro.neq.pasante'),
    // Historial de etapas para la tasa de cierre (con o sin autor: un avance es un avance).
    traerTodo<{ entidad_id: string; valor_anterior: string | null; valor_nuevo: string | null; created_at: string }>(
      (desde, hasta) =>
        db
          .from('activity_log')
          .select('entidad_id, valor_anterior, valor_nuevo, created_at')
          .eq('workspace_id', ws)
          .eq('entidad_tipo', 'negocio')
          .eq('tipo', 'cambio_etapa')
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'cambios de etapa' },
    ),
  ])
  lanzar('cartera', carteraR.error)
  lanzar('gastos', gastosR.error)
  lanzar('cobros del mes', cobrosMes.error)
  if (pylR.error) console.error('[tableros operativos] v_pyl_mes:', pylR.error)

  // Todas las etapas de las lineas del workspace: la actual de cada negocio y, para la tasa
  // de cierre, la fase de los nombres guardados en el historial.
  const lineaIds = [...new Set(negociosRaw.map((n) => n.linea_id).filter((x): x is string => !!x))]
  const etapaIds = [...new Set(negociosRaw.map((n) => n.etapa_actual_id).filter((x): x is string => !!x))]
  const filtro = [
    lineaIds.length ? `linea_id.in.(${lineaIds.join(',')})` : null,
    etapaIds.length ? `id.in.(${etapaIds.join(',')})` : null,
  ].filter(Boolean).join(',')
  const etapasR = filtro
    ? await db.from('etapas_negocio').select('id, linea_id, stage, nombre').or(filtro)
    : { data: [], error: null }
  lanzar('etapas', etapasR.error)
  const listaEtapas = (etapasR.data ?? []) as { id: string; linea_id: string | null; stage: string | null; nombre: string | null }[]
  const etapas = new Map(listaEtapas.map((e) => [e.id, e]))

  const ultima = new Map<string, string>()
  for (const a of actividad) {
    const prev = ultima.get(a.entidad_id)
    if (!prev || a.created_at > prev) ultima.set(a.entidad_id, a.created_at)
  }

  const negocios: NegocioBandeja[] = negociosRaw.map((n) => {
    const etapa = n.etapa_actual_id ? etapas.get(n.etapa_actual_id) : undefined
    return {
      id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      estado: n.estado,
      fase: etapa?.stage ?? null,
      etapa: etapa?.nombre ?? null,
      valor: num(n.precio_aprobado) ?? num(n.precio_estimado),
      pausado: Boolean(n.pausado || n.is_paused),
      pausadoHasta: n.pausado_hasta,
      creadoEn: n.created_at,
      etapaCambiadaEn: n.etapa_cambiada_at,
      ultimaActividad: ultima.get(n.id) ?? null,
      lineaId: n.linea_id,
      cerradoEn: n.closed_at,
    }
  })

  const pyl = pylR.data as { ingresos_con_iva: number | string | null } | null
  const cobradoMes = pyl?.ingresos_con_iva != null
    ? Number(pyl.ingresos_con_iva)
    : ((cobrosMes.data ?? []) as { monto: number | string }[]).reduce((s, c) => s + Number(c.monto), 0)

  return {
    hoy,
    bandejas: armarBandejas(
      {
        negocios,
        cartera: (carteraR.data ?? []) as FilaCarteraBandeja[],
        cuotasPendientes: cuotas.map((c) => ({
          negocioId: c.negocio_id,
          monto: Number(c.monto),
          fechaEsperada: c.fecha_esperada,
        })),
        gastosSinSoporte: ((gastosR.data ?? []) as {
          id: string
          fecha: string
          monto: number | string
          descripcion: string | null
          categoria: string | null
        }[]).map((g) => ({ ...g, monto: Number(g.monto) })),
        cobradoMes,
        historial: {
          etapas: listaEtapas.map((e) => ({ id: e.id, lineaId: e.linea_id, nombre: e.nombre ?? '', stage: e.stage })),
          cambios: cambiosEtapa.map((c) => ({
            negocioId: c.entidad_id,
            anterior: c.valor_anterior,
            nuevo: c.valor_nuevo,
            fecha: c.created_at,
          })),
        },
      },
      hoy,
    ),
  }
}
