import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { puedeDescargarNegocios } from '@/lib/roles'
import { createServiceClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginar'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { getNegociosV2 } from '@/app/(app)/negocios/negocio-v2-actions'
import {
  COLUMNAS_FECHA,
  COLUMNAS_FECHA_HORA,
  COLUMNA_LINK,
  ENCABEZADOS,
  armarFilasExcel,
  type BonificableNegocio,
  type CobroExportable,
  type ComercialNegocio,
  type ResponsableOperaciones,
  type StaffNombre,
  type TramoCobro,
  type ValorNegocio,
  type VentaNegocio,
} from '@/lib/negocios/export-excel'

/**
 * POST /api/negocios/export  { ids: string[] }  →  negocios-{slug}-{YYYY-MM-DD}.xlsx
 *
 * Descarga de autoservicio de la tabla de `/negocios` (Acta SOENA, cláusula SEXTA
 * numeral 2). El cliente manda los ids de las filas que tiene A LA VISTA después de
 * sus filtros, y esta ruta baja exactamente esas: así lo que se descarga es lo que se
 * ve, sin reimplementar `aplicarFiltros` del lado del servidor.
 *
 * Solo lectura. No escribe nada, no hay migración.
 *
 * Quién: owner / admin / supervisor (`puedeDescargarNegocios`, fuente única con el
 * botón). La lista de negocios sale de `getNegociosV2`, que ya acota por workspace y,
 * si el rol fuera operator, por responsable; los ids que no pertenezcan a lo que ese
 * usuario puede ver se ignoran en silencio.
 *
 * Si CUALQUIER lectura falla, la respuesta es 500 y queda en el log con prefijo
 * `[negocios-export]`. Nunca un Excel con ceros disfrazados: un archivo a medias con
 * cara de completo es peor que ningún archivo (ver `traerTodo`).
 */

export const runtime = 'nodejs'

const MAX_IDS = 5000

const PREFIJO = '[negocios-export]'

// Las vistas del dinero no están en `database.ts` y algunas son server-only:
// se leen sin tipar, como hace el resto del módulo de negocios.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (c: unknown): any => c

/** `.in()` viaja en la URL: con miles de ids se pasa del largo permitido. */
const TAMANO_LOTE_IDS = 200

function lotes<T>(xs: T[], tamano: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += tamano) out.push(xs.slice(i, i + tamano))
  return out
}

function leerIds(body: unknown): string[] | null {
  const ids = (body as { ids?: unknown } | null)?.ids
  if (!Array.isArray(ids)) return null
  if (ids.length === 0 || ids.length > MAX_IDS) return null
  const limpios = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null
    limpios.add(id)
  }
  return Array.from(limpios)
}

function baseUrlDelWorkspace(slug: string): string {
  const dominio = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  const protocolo = dominio.startsWith('localhost') ? 'http' : 'https'
  return `${protocolo}://${slug}.${dominio}`
}

export async function POST(req: NextRequest) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return new NextResponse('No autenticado', { status: 401 })
  if (!puedeDescargarNegocios(role)) return new NextResponse('Sin permisos', { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Cuerpo inválido', { status: 400 })
  }
  const ids = leerIds(body)
  if (!ids) {
    return new NextResponse(`Se esperaba { ids: string[] } con entre 1 y ${MAX_IDS} ids`, { status: 400 })
  }

  try {
    // ── 1. Los negocios, tal como los ve la lista (mismo origen que la pantalla) ──
    const [abiertos, cerrados, wsRes] = await Promise.all([
      getNegociosV2('abierto'),
      getNegociosV2('completado'),
      supabase.from('workspaces').select('slug').eq('id', workspaceId).single(),
    ])
    if (wsRes.error || !wsRes.data?.slug) {
      throw new Error(`workspace: ${wsRes.error?.message ?? 'sin slug'}`)
    }
    const slug = wsRes.data.slug as string

    const porId = new Map([...abiertos, ...cerrados].map((n) => [n.id, n]))
    // En el orden en que el cliente los mandó, que es el orden de la pantalla.
    const negocios = ids.map((id) => porId.get(id)).filter((n): n is NonNullable<typeof n> => !!n)
    const idsValidos = negocios.map((n) => n.id)
    const enLista = new Set(idsValidos)

    // ── 2. Dinero, venta, comercial, bonificable: vistas server-only ──
    //
    // Van con el cliente de SERVICIO a propósito: `v_venta_mes_comercial`,
    // `v_negocio_bonificable` y `v_negocio_comercial` están revocadas a
    // `authenticated`, y con el cliente de la sesión devuelven `42501`, que un `?? []`
    // convertiría en ceros sin que nadie lo note (mismo patrón que `numeros/actions-v2`,
    // PR #518). El `.eq('workspace_id', …)` NO es adorno: el service client no pasa por
    // RLS y sin él la lectura mezclaría los quince workspaces.
    //
    // Se lee todo el workspace y se filtra en memoria por los ids pedidos: mandar los
    // ids por `.in()` rompería la URL con miles, y las vistas no tienen más filas que
    // negocios. Todas pasan por `traerTodo` con orden estable: PostgREST corta en
    // 1.000 filas sin avisar.
    const svc = createServiceClient()
    const soloPedidos = <T extends { negocio_id: string | null }>(xs: T[]) =>
      xs.filter((x) => x.negocio_id && enLista.has(x.negocio_id))

    const [valores, ventas, bonificables, comerciales, tramos, cobros, staff] = await Promise.all([
      traerTodo<ValorNegocio>(
        (desde, hasta) =>
          db(svc)
            .from('v_negocio_valor')
            .select('negocio_id, valor_base, valor_iva, plan_pago, techo_tarifa')
            .eq('workspace_id', workspaceId)
            .order('negocio_id')
            .range(desde, hasta),
        { etiqueta: `${PREFIJO} v_negocio_valor` },
      ),
      traerTodo<VentaNegocio>(
        (desde, hasta) =>
          db(svc)
            .from('v_venta_mes_comercial')
            .select('negocio_id, fecha_venta, caso_completo')
            .eq('workspace_id', workspaceId)
            .order('negocio_id')
            .range(desde, hasta),
        { etiqueta: `${PREFIJO} v_venta_mes_comercial` },
      ),
      traerTodo<BonificableNegocio>(
        (desde, hasta) =>
          db(svc)
            .from('v_negocio_bonificable')
            .select('negocio_id, bonificable')
            .eq('workspace_id', workspaceId)
            .order('negocio_id')
            .range(desde, hasta),
        { etiqueta: `${PREFIJO} v_negocio_bonificable` },
      ),
      traerTodo<ComercialNegocio>(
        (desde, hasta) =>
          db(svc)
            .from('v_negocio_comercial')
            .select('negocio_id, comercial_staff_id')
            .eq('workspace_id', workspaceId)
            .order('negocio_id')
            .range(desde, hasta),
        { etiqueta: `${PREFIJO} v_negocio_comercial` },
      ),
      // Tramos BRUTOS (con IVA) de cada cobro: es el recaudado de honorario que se
      // resta del honorario con IVA. Ver la cabecera de `export-excel.ts`.
      traerTodo<TramoCobro>(
        (desde, hasta) =>
          db(svc)
            .from('v_cobro_valor')
            .select('negocio_id, a_tramo1, a_tramo2')
            .eq('workspace_id', workspaceId)
            .order('cobro_id')
            .range(desde, hasta),
        { etiqueta: `${PREFIJO} v_cobro_valor` },
      ),
      // Los pagos uno a uno (para primer/segundo/otros). Con la sesión: `cobros` sí
      // está concedida y la RLS acota por workspace; el filtro explícito lo refuerza.
      traerTodo<CobroExportable>(
        (desde, hasta) =>
          db(supabase)
            .from('cobros')
            .select('id, negocio_id, monto, fecha, created_at, external_ref, anulado_at')
            .eq('workspace_id', workspaceId)
            .is('anulado_at', null)
            .not('negocio_id', 'is', null)
            .order('fecha', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(desde, hasta),
        { etiqueta: `${PREFIJO} cobros` },
      ),
      traerTodo<StaffNombre>(
        (desde, hasta) =>
          db(supabase)
            .from('staff')
            .select('id, full_name')
            .eq('workspace_id', workspaceId)
            .order('id')
            .range(desde, hasta),
        { etiqueta: `${PREFIJO} staff` },
      ),
    ])

    // ── 3. Responsable de operaciones (`negocio_responsables.rol`) ──
    // No tiene `workspace_id`: se pide por ids, en lotes que quepan en la URL.
    const operaciones: ResponsableOperaciones[] = []
    for (const lote of lotes(idsValidos, TAMANO_LOTE_IDS)) {
      const filas = await traerTodo<ResponsableOperaciones>(
        (desde, hasta) =>
          db(supabase)
            .from('negocio_responsables')
            .select('negocio_id, staff_id')
            .in('negocio_id', lote)
            .eq('rol', 'operaciones')
            .order('negocio_id')
            .order('staff_id')
            .range(desde, hasta),
        { etiqueta: `${PREFIJO} negocio_responsables` },
      )
      operaciones.push(...filas)
    }

    // ── 4. Filas y hoja ──
    const filas = armarFilasExcel({
      negocios,
      valores: soloPedidos(valores),
      ventas: soloPedidos(ventas),
      bonificables: soloPedidos(bonificables),
      comerciales: soloPedidos(comerciales),
      tramos: soloPedidos(tramos),
      cobros: soloPedidos(cobros),
      operaciones,
      staff,
      baseUrl: baseUrlDelWorkspace(slug),
    })

    // `cellDates` en las DOS llamadas: en `json_to_sheet` para que un `Date` sea celda
    // de fecha (no texto), y en `write` para que se escriba como fecha exacta (sin
    // el redondeo de un milisegundo del serial).
    const ws = XLSX.utils.json_to_sheet(filas, { header: [...ENCABEZADOS], cellDates: true })
    const colDe = (h: (typeof ENCABEZADOS)[number]) => ENCABEZADOS.indexOf(h)
    const colLink = colDe(COLUMNA_LINK)
    const colsFecha = COLUMNAS_FECHA.map(colDe)
    const colsFechaHora = COLUMNAS_FECHA_HORA.map(colDe)
    for (let r = 1; r <= filas.length; r++) {
      for (const c of colsFecha) {
        const celda = ws[XLSX.utils.encode_cell({ c, r })]
        if (celda) celda.z = 'yyyy-mm-dd'
      }
      for (const c of colsFechaHora) {
        const celda = ws[XLSX.utils.encode_cell({ c, r })]
        if (celda) celda.z = 'yyyy-mm-dd hh:mm'
      }
      const link = ws[XLSX.utils.encode_cell({ c: colLink, r })]
      if (link && typeof link.v === 'string') link.l = { Target: link.v, Tooltip: 'Abrir en ONE' }
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Negocios')
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true })

    const filename = `negocios-${slug}-${todayBogotaISO()}.xlsx`
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error(`${PREFIJO} no se pudo generar el Excel`, e)
    return new NextResponse('No se pudo generar el archivo. Inténtalo de nuevo.', { status: 500 })
  }
}
