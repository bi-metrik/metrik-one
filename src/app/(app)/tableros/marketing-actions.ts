'use server'

/**
 * Los datos de la pestana Marketing.
 *
 * Todo sale de `v_marketing_campana` y `v_marketing_negocio`, que son la MISMA
 * definicion para la cifra y para el panel lateral que la abre. Si el drill
 * reimplementara el criterio mostraria una lista que no cuadra con el numero del que
 * salio — la leccion que ya costo `v_venta_mes_comercial`.
 *
 * ⚠️ NINGUNA llamada a `graph.facebook.com` sale de aqui. El gasto lo trae la edge
 * function `meta-insights-sync` a `campana_insights` y esta pantalla lee la tabla.
 * `/tableros` ya se arreglo una vez por lento y siete llamadas HTTP a Meta en el
 * render lo devuelven al problema.
 *
 * ⚠️ Las dos vistas se leen con el cliente de SERVICIO y el workspace ya resuelto
 * desde la sesion. No es comodidad: `v_venta_mes_comercial` —la definicion canonica
 * de venta, de la que cuelga todo esto— no concede nada a `authenticated` y no filtra
 * por workspace. Exponerla al cliente dejaria las ventas de todos los workspaces al
 * alcance de cualquier sesion.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { bogotaYearMonth, todayBogotaISO } from '@/lib/dates/bogota'
import type { FilaMarketing } from '@/lib/tableros/marketing'

/** Quien ve gasto y recaudo agregados de la operacion. Mismo criterio que Direccion. */
const ROLES_MARKETING = ['owner', 'admin', 'supervisor']

export interface MarketingData {
  filas: FilaMarketing[]
  /** 'YYYY-MM-01' del mes en curso en Bogota, resuelto en el SERVIDOR. */
  mesEnCurso: string
  /** 'YYYY-MM-DD' de hoy en Bogota: decide que cohortes todavia no se pueden juzgar. */
  hoyISO: string
  /** Falso hasta que `meta-insights-sync` corra por primera vez. */
  gastoSincronizado: boolean
  /** Con mas de una, la pantalla estaria sumando monedas distintas. */
  monedas: string[]
}

interface FilaCruda {
  campaign_id: string | null
  campana: string | null
  mes: string
  gasto: number | string | null
  leads: number | string | null
  formularios: number | string | null
  negocios: number | string | null
  ventas: number | string | null
  honorario: number | string | null
  recaudado: number | string | null
  primer_lead: string | null
  ultimo_lead: string | null
  status: string | null
  currency: string | null
  sincronizado_at: string | null
}

const num = (v: number | string | null): number => (v === null ? 0 : Number(v))

export async function getMarketingData(): Promise<MarketingData | null> {
  const { workspaceId, role } = await getWorkspace()
  if (!workspaceId) return null
  if (!ROLES_MARKETING.includes(role || '')) return null

  // Las dos vistas son nuevas y `database.ts` todavia no las tipa (se regenera aparte,
  // junto con sus ~26 alias). El cast es puntual y lo que vuelve se valida al mapear.
  const svc = createServiceClient() as unknown as SupabaseClient
  // Sin paginar a proposito y con el conteo medido: SOENA tiene 7 campanas sobre 4
  // meses mas la fila de "sin rastro" por mes — 22 filas el 2026-09-03. Muy lejos del
  // techo de 1.000 de PostgREST. Si algun dia se acerca, esto pasa por `traerTodo`.
  const { data, error } = await svc
    .from('v_marketing_campana')
    .select(
      'campaign_id, campana, mes, gasto, leads, formularios, negocios, ventas, honorario, recaudado, primer_lead, ultimo_lead, status, currency, sincronizado_at',
    )
    .eq('workspace_id', workspaceId)
    .order('mes', { ascending: false })

  // Una pestana que no pudo armar sus datos DICE que fallo; no se degrada a una
  // tabla vacia, que se leeria como "no hay campanas".
  if (error) throw new Error(`Tablero de marketing: ${error.message}`)

  const crudas = (data ?? []) as unknown as FilaCruda[]
  // El workspace no tiene una sola interaccion de Meta: no hay pestana que dibujar.
  if (crudas.filter(f => f.campaign_id !== null).length === 0) return null

  const filas: FilaMarketing[] = crudas.map(f => ({
    campaignId: f.campaign_id,
    campana: f.campana,
    mes: f.mes,
    gasto: num(f.gasto),
    leads: num(f.leads),
    formularios: num(f.formularios),
    negocios: num(f.negocios),
    ventas: num(f.ventas),
    honorario: num(f.honorario),
    recaudado: num(f.recaudado),
    primerLead: f.primer_lead,
    ultimoLead: f.ultimo_lead,
    status: f.status,
    sincronizadoAt: f.sincronizado_at,
  }))

  return {
    filas,
    mesEnCurso: `${bogotaYearMonth()}-01`,
    hoyISO: todayBogotaISO(),
    gastoSincronizado: crudas.some(f => f.sincronizado_at !== null),
    monedas: [...new Set(crudas.map(f => f.currency).filter((c): c is string => Boolean(c)))].sort(),
  }
}

export interface NegocioDeCampana {
  id: string
  codigo: string | null
  nombre: string | null
  cliente: string | null
  comercial: string | null
  etapa: string | null
  fechaVenta: string | null
  honorario: number
  recaudado: number
}

/**
 * Los negocios detras de una fila de la tabla.
 *
 * `mes` fija la lente: con mes se listan las VENTAS de ese mes (lo que dice la fila
 * en la lente MES); sin mes, todos los negocios que la campana trajo (la cohorte).
 * Son dos preguntas distintas y la fila de la que se abre ya decidio cual.
 */
export async function getNegociosDeCampana(args: {
  campaignId: string | null
  mes: string | null
}): Promise<NegocioDeCampana[]> {
  const { workspaceId, role } = await getWorkspace()
  if (!workspaceId) return []
  if (!ROLES_MARKETING.includes(role || '')) return []

  const svc = createServiceClient() as unknown as SupabaseClient
  let q = svc
    .from('v_marketing_negocio')
    .select('negocio_id, codigo, nombre, cliente, comercial, etapa, fecha_venta, honorario, recaudado')
    .eq('workspace_id', workspaceId)

  q = args.campaignId === null ? q.is('campaign_id', null) : q.eq('campaign_id', args.campaignId)

  if (args.mes) {
    q = q.eq('mes_venta', args.mes)
  } else if (args.campaignId === null) {
    // Sin rastro y sin mes serian los 370 negocios que nunca dejaron huella: una lista
    // que no responde ninguna pregunta. Se acota a las ventas, que es lo que la fila mide.
    q = q.not('fecha_venta', 'is', null)
  }

  const { data, error } = await q.order('fecha_venta', { ascending: false, nullsFirst: false }).limit(500)
  if (error) throw new Error(`Negocios de la campaña: ${error.message}`)

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(n => ({
    id: String(n.negocio_id),
    codigo: (n.codigo as string) ?? null,
    nombre: (n.nombre as string) ?? null,
    cliente: (n.cliente as string) ?? null,
    comercial: (n.comercial as string) ?? null,
    etapa: (n.etapa as string) ?? null,
    fechaVenta: (n.fecha_venta as string) ?? null,
    honorario: num(n.honorario as number | string | null),
    recaudado: num(n.recaudado as number | string | null),
  }))
}
