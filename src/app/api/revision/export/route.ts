import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'

export const runtime = 'nodejs'

interface FilaGasto {
  fecha: string
  codigo_negocio: string | null
  empresa: string | null
  categoria: string | null
  clasificacion: string | null
  descripcion: string | null
  monto: number
  retencion: number
  deducible: string
  tercero_nit: string | null
  estado_pago: string | null
  revisado: string
  revisado_at: string | null
  soporte_url: string | null
}

interface FilaCobro {
  fecha: string
  codigo_negocio: string | null
  empresa: string | null
  descripcion: string | null
  monto: number
  retencion: number
  tercero_nit: string | null
  revisado: string
  revisado_at: string | null
}

export async function GET(req: NextRequest) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return new NextResponse('No autenticado', { status: 401 })

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canExportRevision) return new NextResponse('Sin permisos', { status: 403 })

  const url = new URL(req.url)
  const mes = url.searchParams.get('mes') ?? new Date().toISOString().slice(0, 7)
  const formato = (url.searchParams.get('formato') ?? 'xlsx') as 'csv' | 'xlsx'

  if (!/^\d{4}-\d{2}$/.test(mes)) return new NextResponse('Mes invalido (YYYY-MM)', { status: 400 })
  if (formato !== 'csv' && formato !== 'xlsx') return new NextResponse('Formato invalido (csv|xlsx)', { status: 400 })

  const [y, m] = mes.split('-').map(Number)
  const startDate = `${mes}-01`
  const endDate = new Date(y, m, 0).toISOString().split('T')[0]

  const [gastosRes, cobrosRes] = await Promise.all([
    supabase
      .from('gastos')
      .select('fecha, monto, descripcion, mensaje_original, categoria, clasificacion_costo, deducible, retencion, tercero_nit, estado_pago, soporte_url, revisado, revisado_at, negocio_id, negocios(nombre, codigo, empresa_id, empresas(nombre))')
      .eq('workspace_id', workspaceId)
      .gte('fecha', startDate)
      .lte('fecha', endDate)
      .order('fecha', { ascending: true }),
    supabase
      .from('cobros')
      .select('fecha, monto, notas, retencion, tercero_nit, revisado, revisado_at, negocio_id, negocios(nombre, codigo, empresa_id, empresas(nombre))')
      .eq('workspace_id', workspaceId)
      .gte('fecha', startDate)
      .lte('fecha', endDate)
      .order('fecha', { ascending: true }),
  ])

  const gastos: FilaGasto[] = (gastosRes.data ?? []).map(g => {
    const neg = g.negocios as { nombre: string | null; codigo: string | null; empresas: { nombre: string | null } | null } | null
    return {
      fecha: g.fecha ?? '',
      codigo_negocio: neg?.codigo ?? null,
      empresa: neg?.empresas?.nombre ?? null,
      categoria: g.categoria,
      clasificacion: g.clasificacion_costo,
      descripcion: g.descripcion ?? g.mensaje_original ?? null,
      monto: Number(g.monto ?? 0),
      retencion: Number(g.retencion ?? 0),
      deducible: g.deducible ? 'Si' : 'No',
      tercero_nit: g.tercero_nit ?? null,
      estado_pago: g.estado_pago ?? null,
      revisado: g.revisado ? 'Si' : 'No',
      revisado_at: g.revisado_at ?? null,
      soporte_url: g.soporte_url ?? null,
    }
  })

  const cobros: FilaCobro[] = (cobrosRes.data ?? []).map(c => {
    const neg = c.negocios as { nombre: string | null; codigo: string | null; empresas: { nombre: string | null } | null } | null
    return {
      fecha: c.fecha ?? '',
      codigo_negocio: neg?.codigo ?? null,
      empresa: neg?.empresas?.nombre ?? null,
      descripcion: c.notas,
      monto: Number(c.monto ?? 0),
      retencion: Number(c.retencion ?? 0),
      tercero_nit: c.tercero_nit ?? null,
      revisado: c.revisado ? 'Si' : 'No',
      revisado_at: c.revisado_at ?? null,
    }
  })

  // Resumen del mes
  const totalGastos = gastos.reduce((s, g) => s + g.monto, 0)
  const totalCobros = cobros.reduce((s, c) => s + c.monto, 0)
  const totalRetencionGastos = gastos.reduce((s, g) => s + g.retencion, 0)
  const totalRetencionCobros = cobros.reduce((s, c) => s + c.retencion, 0)
  const gastosRevisados = gastos.filter(g => g.revisado === 'Si').length
  const cobrosRevisados = cobros.filter(c => c.revisado === 'Si').length
  const gastosDeducibles = gastos.filter(g => g.deducible === 'Si').reduce((s, g) => s + g.monto, 0)

  const resumen = [
    { metrica: 'Mes', valor: mes },
    { metrica: 'Generado', valor: new Date().toISOString() },
    { metrica: '', valor: '' },
    { metrica: 'Total ingresos (cobros)', valor: totalCobros },
    { metrica: 'Total egresos (gastos)', valor: totalGastos },
    { metrica: 'Neto', valor: totalCobros - totalGastos },
    { metrica: '', valor: '' },
    { metrica: 'Cobros registrados', valor: cobros.length },
    { metrica: 'Cobros revisados', valor: cobrosRevisados },
    { metrica: 'Gastos registrados', valor: gastos.length },
    { metrica: 'Gastos revisados', valor: gastosRevisados },
    { metrica: 'Gastos deducibles', valor: gastosDeducibles },
    { metrica: '', valor: '' },
    { metrica: 'Retenciones aplicadas (cobros)', valor: totalRetencionCobros },
    { metrica: 'Retenciones aplicadas (gastos)', valor: totalRetencionGastos },
    { metrica: '', valor: '' },
    { metrica: 'Disclaimer', valor: 'ONE no es software contable. Consulta a tu contador.' },
  ]

  const filename = `revision_${mes}.${formato}`

  if (formato === 'csv') {
    // CSV: una sola hoja combinada con tipo
    const filasCsv = [
      ...cobros.map(c => ({
        tipo: 'cobro',
        fecha: c.fecha,
        codigo_negocio: c.codigo_negocio ?? '',
        empresa: c.empresa ?? '',
        categoria: '',
        clasificacion: '',
        descripcion: c.descripcion ?? '',
        monto: c.monto,
        retencion: c.retencion,
        deducible: '',
        tercero_nit: c.tercero_nit ?? '',
        estado_pago: '',
        revisado: c.revisado,
        revisado_at: c.revisado_at ?? '',
        soporte_url: '',
      })),
      ...gastos.map(g => ({
        tipo: 'gasto',
        fecha: g.fecha,
        codigo_negocio: g.codigo_negocio ?? '',
        empresa: g.empresa ?? '',
        categoria: g.categoria ?? '',
        clasificacion: g.clasificacion ?? '',
        descripcion: g.descripcion ?? '',
        monto: g.monto,
        retencion: g.retencion,
        deducible: g.deducible,
        tercero_nit: g.tercero_nit ?? '',
        estado_pago: g.estado_pago ?? '',
        revisado: g.revisado,
        revisado_at: g.revisado_at ?? '',
        soporte_url: g.soporte_url ?? '',
      })),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha))

    const ws = XLSX.utils.json_to_sheet(filasCsv)
    const csv = XLSX.utils.sheet_to_csv(ws)
    // BOM para Excel detecte UTF-8 con tildes correctamente
    const buffer = Buffer.from('\uFEFF' + csv, 'utf-8')
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // XLSX: 3 hojas
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cobros), 'Cobros')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastos), 'Gastos')
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(xlsxBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
