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
import { traerTodo } from '@/lib/supabase/paginar'
import { bogotaYearMonth, todayBogotaISO } from '@/lib/dates/bogota'
import { columnaDirectivo, type ColumnaDirectivo } from '@/lib/dian/agrupacion-directivo'
import { drillSeAcotaAVentas } from '@/lib/tableros/marketing'
import type { FilaMarketing, FilaNegocioMarketing } from '@/lib/tableros/marketing'

/** Quien ve gasto y recaudo agregados de la operacion. Mismo criterio que Direccion. */
const ROLES_MARKETING = ['owner', 'admin', 'supervisor']

export interface MarketingData {
  filas: FilaMarketing[]
  /**
   * Las VENTAS, una por fila, con su ciudad. Alimentan la tabla "Ventas por ciudad".
   *
   * Solo ventas y no todos los negocios: la ciudad es la seccional DIAN, que llega con
   * el RUT en Documentacion, asi que un lead recien entrado no tiene ninguna. Medido el
   * 2026-09-14 en SOENA: de 99 negocios con campana, 28 tienen seccional y son
   * exactamente las 28 ventas.
   */
  ventas: FilaNegocioMarketing[]
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

interface FilaNegocioCruda {
  negocio_id: string
  campaign_id: string | null
  mes_venta: string | null
  /** Cruda, de `negocios.metadata`. La agrupa `columnaDirectivo`, nunca el SQL. */
  seccional: string | null
  honorario: number | string | null
  recaudado: number | string | null
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

  // ⚠️⚠️ LA MIGRACION VA ANTES DEL MERGE, no despues.
  // `seccional` es una columna que agrega `20260914220000_marketing_negocio_seccional`.
  // Contra la vista sin esa columna, PostgREST responde 400, `traerTodo` lanza y el
  // `throw` sube por el `Promise.all` de `page.tsx`, que NO tiene catch por rama: se cae
  // /tableros ENTERO, no solo la pestana. Medido el 2026-09-14: el modulo
  // `marketing_campanas` esta encendido en 1 de los 17 workspaces (soena), asi que el
  // alcance es esa cuenta, y para esa cuenta es toda la pantalla.
  // Al reves es inofensivo: aplicar la migracion sin desplegar el codigo solo agrega una
  // columna que nadie pide todavia.
  //
  // Las ventas con su ciudad, para el corte por seccional. Esta SI va paginada: son 330
  // filas en SOENA el 2026-09-14 (28 con campana + 302 sin rastro) y el conteo crece con
  // cada venta que se cierra, mes a mes. La de arriba es por (campana, mes) y no crece
  // asi; esta si, y el techo de 1.000 de PostgREST no avisa cuando lo cruza — devuelve
  // 200 con la lista recortada y la tabla mostraria menos ventas sin decirlo.
  const ventasCrudas = await traerTodo<FilaNegocioCruda>(
    (d, h) =>
      svc
        .from('v_marketing_negocio')
        .select('negocio_id, campaign_id, mes_venta, seccional, honorario, recaudado')
        .eq('workspace_id', workspaceId)
        .not('fecha_venta', 'is', null)
        // Orden estable: sin el, la pagina 2 no continua donde termino la 1.
        .order('negocio_id')
        .range(d, h) as unknown as PromiseLike<{
        data: FilaNegocioCruda[] | null
        error: { message: string } | null
      }>,
    { etiqueta: 'Tablero de marketing: ventas por ciudad' },
  )

  const ventas: FilaNegocioMarketing[] = ventasCrudas.map(v => ({
    campaignId: v.campaign_id,
    mesVenta: v.mes_venta,
    seccional: v.seccional,
    honorario: num(v.honorario),
    recaudado: num(v.recaudado),
  }))

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
    ventas,
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
  /** La seccional cruda. `null` = el caso todavia no tiene RUT cargado. */
  seccional: string | null
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
  /**
   * La columna del tablero directivo en la que se hizo clic. `undefined` = la fila
   * entera de la campana (la tabla de arriba); con valor, solo las VENTAS de esa
   * columna (la tabla de ciudades).
   */
  columna?: ColumnaDirectivo
}): Promise<NegocioDeCampana[]> {
  const { workspaceId, role } = await getWorkspace()
  if (!workspaceId) return []
  if (!ROLES_MARKETING.includes(role || '')) return []

  const svc = createServiceClient() as unknown as SupabaseClient
  let q = svc
    .from('v_marketing_negocio')
    .select('negocio_id, codigo, nombre, cliente, comercial, etapa, fecha_venta, honorario, recaudado, seccional')
    .eq('workspace_id', workspaceId)

  q = args.campaignId === null ? q.is('campaign_id', null) : q.eq('campaign_id', args.campaignId)

  if (args.mes) {
    q = q.eq('mes_venta', args.mes)
  } else if (drillSeAcotaAVentas(args)) {
    // El porque vive en `drillSeAcotaAVentas`, que ademas esta probado aparte: es la
    // decision que hace que la lista traiga exactamente tantos casos como dice la celda.
    q = q.not('fecha_venta', 'is', null)
  }

  const { data, error } = await q.order('fecha_venta', { ascending: false, nullsFirst: false }).limit(500)
  if (error) throw new Error(`Negocios de la campaña: ${error.message}`)

  const negocios = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(n => ({
    id: String(n.negocio_id),
    codigo: (n.codigo as string) ?? null,
    nombre: (n.nombre as string) ?? null,
    cliente: (n.cliente as string) ?? null,
    comercial: (n.comercial as string) ?? null,
    etapa: (n.etapa as string) ?? null,
    fechaVenta: (n.fecha_venta as string) ?? null,
    honorario: num(n.honorario as number | string | null),
    recaudado: num(n.recaudado as number | string | null),
    seccional: (n.seccional as string) ?? null,
  }))

  // El filtro por ciudad se aplica con `columnaDirectivo`, la MISMA funcion que agrupo
  // la celda. Mandarle al SQL la lista de seccionales de cada columna seria una segunda
  // expresion del mismo criterio, y ademas "Sin seccional" no se puede escribir como
  // lista: es una negacion (sin valor, o con un texto que el catalogo no reconoce).
  if (args.columna === undefined) return negocios
  return negocios.filter(n => columnaDirectivo(n.seccional) === args.columna)
}
