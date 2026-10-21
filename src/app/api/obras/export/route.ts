import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { faltaMigracionObras, MENSAJE_SIN_MIGRACION_OBRAS } from '@/lib/obras/modulo'
import { COLUMNAS_CIERRE } from '@/lib/obras/cierre'
import { COLUMNAS_FACTURA_OBRA } from '@/lib/obras/facturas'
import {
  COLUMNAS_CSV,
  esTipoCsv,
  filasIngresos,
  filasJornadas,
  filasObras,
  filasPagos,
  filasRetenido,
  nombreArchivoCsv,
  type Fila,
  type ObraRef,
} from '@/lib/obras/csv'

export const runtime = 'nodejs'

/**
 * Descargas CSV de las obras en autoservicio (C13): `?tipo=pagos|ingresos|jornadas|obras|retenido`,
 * con `desde`/`hasta` opcionales (`YYYY-MM-DD`) para pagos, ingresos y jornadas.
 *
 * Gate: sesión, rol con `canExportCSV` y la llave `modules.obras`. Lee con el cliente de sesión
 * (RLS del workspace). Las cifras derivadas salen de las vistas.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const PAGINA = 1000
const TOPE = 50_000

/** Lee todo en páginas (PostgREST corta en 1.000 filas por respuesta). */
async function todas<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>) {
  const out: T[] = []
  for (let i = 0; i < TOPE; i += PAGINA) {
    const { data, error } = await consulta(i, i + PAGINA - 1)
    if (error) return { data: null, error }
    out.push(...(data ?? []))
    if (!data || data.length < PAGINA) break
  }
  return { data: out, error: null }
}

export async function GET(req: NextRequest) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return new NextResponse('No autenticado', { status: 401 })
  if (!getRolePermissions(role ?? 'read_only').canExportCSV) return new NextResponse('Sin permisos', { status: 403 })
  if (!(await exigirModulo(REQUISITO.obras)).ok) return new NextResponse('Las obras no están activas en este espacio', { status: 403 })

  const url = new URL(req.url)
  const tipo = url.searchParams.get('tipo')
  if (!esTipoCsv(tipo)) return new NextResponse('Tipo inválido (pagos|ingresos|jornadas|obras|retenido)', { status: 400 })
  const desde = url.searchParams.get('desde') || null
  const hasta = url.searchParams.get('hasta') || null
  if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) return new NextResponse('Fecha inválida (YYYY-MM-DD)', { status: 400 })

  const db = supabase as Cliente
  const conRango = (q: Cliente, col: string) => {
    let r = q
    if (desde) r = r.gte(col, desde)
    if (hasta) r = r.lte(col, hasta)
    return r
  }

  // Obras del workspace (código, nombre y cliente) para poner nombre a cada fila.
  const negocios = await todas<{ id: string; codigo: string | null; nombre: string | null; empresas: { nombre: string | null } | null }>((a, b) =>
    db.from('negocios').select('id, codigo, nombre, empresas(nombre)').eq('workspace_id', workspaceId).order('id').range(a, b),
  )
  if (negocios.error) return new NextResponse('No se pudieron leer las obras', { status: 500 })
  const obras = new Map<string, ObraRef>(
    (negocios.data ?? []).map((n) => [n.id, { codigo: n.codigo, nombre: n.nombre, cliente: n.empresas?.nombre ?? null }]),
  )
  const obra = (id: string | null | undefined) => (id ? (obras.get(id) ?? null) : null)

  let filas: Fila[] = []
  let fallo: { code?: string; message?: string } | null = null

  if (tipo === 'pagos') {
    const r = await todas<Record<string, unknown>>((a, b) =>
      conRango(
        db
          .from('gastos')
          .select('fecha, monto, descripcion, categoria, negocio_id, numero_transaccion, numero_repetido, obra_rubros(nombre)')
          .eq('workspace_id', workspaceId),
        'fecha',
      )
        .order('fecha')
        .order('id')
        .range(a, b),
    )
    fallo = r.error
    filas = filasPagos(
      (r.data ?? []).map((g) => ({
        fecha: (g.fecha as string | null) ?? null,
        monto: Number(g.monto ?? 0),
        descripcion: (g.descripcion as string | null) ?? null,
        categoria: (g.categoria as string | null) ?? null,
        negocio_id: (g.negocio_id as string | null) ?? null,
        numero_transaccion: (g.numero_transaccion as string | null) ?? null,
        numero_repetido: (g.numero_repetido as boolean | null) ?? null,
        rubro: (g.obra_rubros as { nombre: string | null } | null)?.nombre ?? null,
      })),
      obra,
    )
  } else if (tipo === 'ingresos') {
    // Lo recibido de verdad: sin anulados y con fecha (sin fecha es una cuota programada).
    const r = await todas<Record<string, unknown>>((a, b) =>
      conRango(
        db
          .from('cobros')
          .select('fecha, monto, negocio_id, numero_transaccion, tipo_cobro, notas, facturas(numero_factura)')
          .eq('workspace_id', workspaceId)
          .is('anulado_at', null)
          .not('fecha', 'is', null),
        'fecha',
      )
        .order('fecha')
        .order('id')
        .range(a, b),
    )
    fallo = r.error
    filas = filasIngresos(
      (r.data ?? []).map((c) => ({
        fecha: (c.fecha as string | null) ?? null,
        monto: Number(c.monto ?? 0),
        negocio_id: (c.negocio_id as string | null) ?? null,
        numero_transaccion: (c.numero_transaccion as string | null) ?? null,
        tipo_cobro: (c.tipo_cobro as string | null) ?? null,
        notas: (c.notas as string | null) ?? null,
        factura: (c.facturas as { numero_factura: string | null } | null)?.numero_factura ?? null,
      })),
      obra,
    )
  } else if (tipo === 'jornadas') {
    const r = await todas<Record<string, unknown>>((a, b) =>
      conRango(
        db.from('v_jornadas_dia').select('fecha, hora, colaborador, negocio_id, fraccion, valor_jornada, costo').eq('workspace_id', workspaceId),
        'fecha',
      )
        .order('fecha')
        .order('hora')
        .order('id')
        .range(a, b),
    )
    fallo = r.error
    filas = filasJornadas(r.data as Parameters<typeof filasJornadas>[0], obra)
  } else if (tipo === 'obras') {
    const r = await todas<Record<string, unknown>>((a, b) =>
      db.from('v_cierre_obra').select(COLUMNAS_CIERRE).eq('workspace_id', workspaceId).order('codigo').order('negocio_id').range(a, b),
    )
    fallo = r.error
    filas = filasObras(r.data as Parameters<typeof filasObras>[0], obra)
  } else {
    const r = await todas<Record<string, unknown>>((a, b) =>
      db
        .from('v_facturas_obra')
        .select(COLUMNAS_FACTURA_OBRA)
        .eq('workspace_id', workspaceId)
        .eq('estado', 'pagada')
        .order('fecha_emision')
        .order('id')
        .range(a, b),
    )
    fallo = r.error
    filas = filasRetenido(r.data as Parameters<typeof filasRetenido>[0], obra)
  }

  if (fallo) {
    if (faltaMigracionObras(fallo)) return new NextResponse(MENSAJE_SIN_MIGRACION_OBRAS, { status: 409 })
    console.error('[obras/export] no se pudo leer', tipo, fallo.code, fallo.message)
    return new NextResponse('No se pudo armar el archivo', { status: 500 })
  }

  const hoja = XLSX.utils.json_to_sheet(filas, { header: [...COLUMNAS_CSV[tipo]] })
  const csv = XLSX.utils.sheet_to_csv(hoja)
  // BOM: Excel abre el archivo como UTF-8 y respeta las tildes.
  const cuerpo = Buffer.from('﻿' + csv, 'utf-8')
  return new NextResponse(cuerpo, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombreArchivoCsv(tipo, todayBogotaISO())}"`,
      'Cache-Control': 'no-store',
    },
  })
}
