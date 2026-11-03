import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, HardHat } from 'lucide-react'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { obrasActivas, puedeVerObras, MENSAJE_SIN_MIGRACION_OBRAS } from '@/lib/obras/modulo'
import { leerResumenObras, type ObraDelResumen } from '@/lib/obras/servidor'
import { retenidoPorCliente } from '@/lib/obras/facturas'
import { pesos, porcentaje } from '@/lib/obras/formato'
import { ROTULO_CSV, TIPOS_CSV } from '@/lib/obras/csv'

/**
 * «Obras» (2026-10-21, `modules.obras`): cómo va cada obra (de `v_cierre_obra`), lo retenido por
 * cliente (solo facturas pagadas; de las abiertas, el saldo pendiente) y las descargas CSV en
 * autoservicio (C13). El detalle y el PDF de cada obra viven en su ficha.
 */
export default async function ObrasPage() {
  const { supabase, workspaceId, role } = await getWorkspace()
  if (!workspaceId || !puedeVerObras(role)) notFound()
  const { data: ws } = await supabase.from('workspaces').select('modules').eq('id', workspaceId).maybeSingle()
  if (!obrasActivas(ws?.modules)) notFound()

  const r = await leerResumenObras(supabase, workspaceId)
  const exporta = getRolePermissions(role ?? 'read_only').canExportCSV

  if (r.estado !== 'ok') {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-lg font-semibold">Obras</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {r.estado === 'sin_migracion' ? MENSAJE_SIN_MIGRACION_OBRAS : 'No se pudieron leer las obras. Recarga la página.'}
        </p>
      </div>
    )
  }

  const porCliente = retenidoPorCliente(r.facturas, (id) => (id ? (r.nombreDeEmpresa[id] ?? 'Sin nombre') : 'Sin cliente'))

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6" data-obras>
      <div className="flex items-center gap-2">
        <HardHat className="h-5 w-5 text-tinta-suave" />
        <h1 className="text-lg font-semibold">Obras</h1>
      </div>

      <section className="rounded-xl border border-border bg-card" data-obras-abiertas>
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">En curso</h2>
        {r.abiertas.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">No hay obras en curso.</p>
        ) : (
          <TablaObras obras={r.abiertas} />
        )}
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">Utilidad hasta hoy: faltan los gastos que no se han registrado.</p>
      </section>

      {r.cerradas.length > 0 && (
        <details className="rounded-xl border border-border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Cerradas ({r.cerradas.length})</summary>
          <TablaObras obras={r.cerradas} />
        </details>
      )}

      <section className="rounded-xl border border-border bg-card" data-retenido-cliente>
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Retenido por cliente</h2>
        {porCliente.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">Todavía no hay facturas de obras.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-2 py-2 text-right font-medium">Facturado</th>
                  <th className="px-2 py-2 text-right font-medium">Recibido</th>
                  <th className="px-2 py-2 text-right font-medium">Retenido</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo pendiente</th>
                </tr>
              </thead>
              <tbody>
                {porCliente.map((c) => (
                  <tr key={c.empresa_id ?? 'sin'} className="border-b last:border-0">
                    <td className="px-4 py-2">{c.cliente}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pesos(c.facturado)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pesos(c.recibido)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">
                      {pesos(c.retenido)}
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        {c.facturasPagadas === 1 ? '1 pagada' : `${c.facturasPagadas} pagadas`}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {pesos(c.saldoPendiente)}
                      <span className="block text-[10px] text-muted-foreground">
                        {c.facturasAbiertas === 1 ? '1 abierta' : `${c.facturasAbiertas} abiertas`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          Retenido = diferencia entre lo facturado y lo recibido en las facturas marcadas como pagadas. ONE no la liquida ni la certifica.
        </p>
      </section>

      {exporta && (
        <section className="rounded-xl border border-border bg-card p-4" data-descargas-obras>
          <h2 className="text-sm font-semibold">Descargar CSV</h2>
          <p className="mt-1 text-xs text-muted-foreground">El rango de fechas aplica a pagos, ingresos y jornadas. Vacío = todo.</p>
          <form action="/api/obras/export" method="get" className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label className="space-y-0.5 text-[11px] text-muted-foreground">
              Archivo
              <select name="tipo" className="block h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground" defaultValue="pagos">
                {TIPOS_CSV.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_CSV[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-0.5 text-[11px] text-muted-foreground">
              Desde
              <input type="date" name="desde" className="block h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground" />
            </label>
            <label className="space-y-0.5 text-[11px] text-muted-foreground">
              Hasta
              <input type="date" name="hasta" className="block h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground" />
            </label>
            <button type="submit" className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-[#10B981] px-3 text-xs font-medium text-white hover:bg-[#059669]">
              <Download className="h-3.5 w-3.5" /> Descargar
            </button>
          </form>
        </section>
      )}
    </div>
  )
}

function TablaObras({ obras }: { obras: ObraDelResumen[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-xs">
        <thead className="text-left text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 font-medium">Obra</th>
            <th className="px-2 py-2 text-right font-medium">Vendido</th>
            <th className="px-2 py-2 text-right font-medium">Gastado</th>
            <th className="px-2 py-2 text-right font-medium">Utilidad</th>
            <th className="px-2 py-2 text-right font-medium">Cobrado</th>
            <th className="px-4 py-2 text-right font-medium">Por cobrar</th>
          </tr>
        </thead>
        <tbody>
          {obras.map((o) => (
            <tr key={o.negocio_id} className="border-b last:border-0">
              <td className="px-4 py-2">
                <Link href={`/negocios/${o.negocio_id}`} className="font-medium text-foreground hover:underline">
                  {o.nombre}
                </Link>
                <span className="block text-[10px] text-muted-foreground">{[o.codigo, o.cliente].filter(Boolean).join(' · ')}</span>
                {o.cierre.jornadasSinValor > 0 && (
                  <span className="block text-[10px] text-[#9A5F0C]">
                    {o.cierre.jornadasSinValor === 1 ? '1 llegada sin valor de jornada' : `${o.cierre.jornadasSinValor} llegadas sin valor de jornada`}
                  </span>
                )}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{pesos(o.cierre.vendido)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{pesos(o.cierre.gastosTotal + o.cierre.manoObra)}</td>
              <td className={`px-2 py-2 text-right tabular-nums font-medium ${o.cierre.utilidad < 0 ? 'text-red-700' : ''}`}>
                {pesos(o.cierre.utilidad)}
                <span className="block text-[10px] font-normal text-muted-foreground">{porcentaje(o.cierre.utilidadPct)}</span>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{pesos(o.cierre.cobrado)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{pesos(o.cierre.porCobrar)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
