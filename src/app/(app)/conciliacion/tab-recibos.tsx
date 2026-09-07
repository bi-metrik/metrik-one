'use client'

/**
 * Control de recibos de caja: de la plata que entró, cuál está acusada.
 *
 * Es una pestaña propia y no una sección de facturación (Mauricio, 2026-09-07). El
 * recibo y la factura son documentos independientes: un caso ya facturado sigue
 * necesitando el recibo de sus pagos, así que mientras esto vivió dentro de la cola de
 * facturación, esos pagos solo se veían entrando por "Ya facturados", que es donde
 * nadie los busca.
 *
 * La lista es POR PAGO, no por negocio. Un negocio con tres pagos tiene tres líneas y
 * tres recibos: el 24% de los negocios de SOENA ya recibió más de un pago (medido el
 * 2026-09-02), así que agrupar por negocio escondería justo lo que hay que ver.
 */

import { useMemo, useState, useTransition } from 'react'
import { Receipt, Check, AlertTriangle, Loader2, ExternalLink, Ban } from 'lucide-react'
import { toast } from 'sonner'
import BusquedaInput from '@/components/busqueda-input'
import { emitirReciboDeNegocio } from '@/lib/actions/facturacion-actions'
import type { ControlRecibos, PagoConRecibo, EstadoRecibo } from '@/lib/actions/recibos-control-actions'

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

const fmtFecha = (f: string | null) =>
  f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const VERDE = '#10B981'

export default function TabRecibos(
  { control, onCambio }: { control: ControlRecibos; onCambio: () => void },
) {
  const [vista, setVista] = useState<EstadoRecibo>('pendiente')
  const [q, setQ] = useState('')

  const term = q.trim().toLowerCase()
  const visibles = useMemo(() => {
    const delEstado = control.pagos.filter(p => p.estado === vista)
    if (!term) return delEstado
    return delEstado.filter(p =>
      [p.negocio_codigo, p.cliente, p.recibo_numero, p.concepto]
        .some(v => v?.toLowerCase().includes(term)),
    )
  }, [control.pagos, vista, term])

  const t = control.totales

  return (
    <div>
      {/* Foto completa: no cambia con el filtro, es el estado del recaudo. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Pagos sin recibo', value: String(t.pendientes), destaque: true },
          { label: 'Se pueden emitir ya', value: String(t.emitibles) },
          { label: 'Con recibo', value: String(t.con_recibo) },
          { label: 'Valor sin acusar', value: fmtCOP(t.valor_pendiente) },
        ].map(x => (
          <div key={x.label} className="rounded-lg border px-3 py-2" style={{ borderColor: '#E5E7EB' }}>
            <div className="text-[11px]" style={{ color: '#6B7280' }}>{x.label}</div>
            <div className="mt-0.5 text-[15px] font-bold tabular-nums"
                 style={{ color: x.destaque ? '#B45309' : '#1A1A1A' }}>{x.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-3">
        <BusquedaInput
          value={q}
          onChange={setQ}
          placeholder="Buscar por caso, cliente, número de recibo…"
          ariaLabel="Buscar pagos"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {([
          { k: 'pendiente' as EstadoRecibo, label: `Sin recibo (${t.pendientes})` },
          { k: 'con_recibo' as EstadoRecibo, label: `Con recibo (${t.con_recibo})` },
          { k: 'no_aplica' as EstadoRecibo, label: `No aplica (${t.no_aplica})` },
        ]).map(o => (
          <button
            key={o.k}
            onClick={() => setVista(o.k)}
            className="rounded-full border px-3 py-1 text-[12px] font-medium transition"
            style={{
              borderColor: vista === o.k ? VERDE : '#E5E7EB',
              backgroundColor: vista === o.k ? '#D1FAE5' : 'transparent',
              color: vista === o.k ? '#047857' : '#6B7280',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <div className="rounded-lg border p-6 text-center" style={{ borderColor: '#E5E7EB' }}>
          <p className="text-[13px]" style={{ color: '#6B7280' }}>
            {term
              ? `Sin resultados para "${q.trim()}" en esta vista.`
              : vista === 'pendiente'
                ? 'Toda la plata que entró tiene su recibo de caja.'
                : vista === 'con_recibo'
                  ? 'Todavía no se ha emitido ningún recibo.'
                  : 'Ningún pago está marcado como que no lleva recibo.'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {visibles.map(p => <FilaPago key={p.cobro_id} pago={p} onCambio={onCambio} />)}
        </div>
      )}
    </div>
  )
}

function FilaPago({ pago, onCambio }: { pago: PagoConRecibo; onCambio: () => void }) {
  const [pendiente, startTransition] = useTransition()

  function emitir() {
    startTransition(async () => {
      const r = await emitirReciboDeNegocio(pago.negocio_id, { cobroId: pago.cobro_id })
      if (r.ok) {
        toast.success(
          r.archivada
            ? `Recibo ${r.numero} emitido y archivado.`
            : `Recibo ${r.numero} emitido. El PDF no se pudo archivar: revísalo.`,
        )
        onCambio()
        return
      }
      // El duplicado en Siigo pide justificación, que aquí no se puede escribir: se
      // manda a Tesorería en vez de fingir que el botón no hizo nada.
      if (r.duplicados) {
        toast.warning('Siigo ya tiene un recibo de este cliente por ese valor. Emítelo desde Por facturar, que pide la justificación.')
        return
      }
      toast.error(r.error)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2"
         style={{ borderColor: '#E5E7EB' }}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold" style={{ color: '#1A1A1A' }}>
            {pago.negocio_codigo ?? '—'}
          </span>
          <span className="truncate text-[12px]" style={{ color: '#6B7280' }}>{pago.cliente ?? '—'}</span>
          {pago.facturado && (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                  style={{ backgroundColor: '#F3F4F6', color: '#6B7280' }}>facturado</span>
          )}
        </div>
        <div className="text-[11px]" style={{ color: '#6B7280' }}>
          {fmtFecha(pago.fecha)}
          {pago.concepto && ` · ${pago.concepto}`}
        </div>
      </div>

      <span className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: '#1A1A1A' }}>
        {fmtCOP(pago.monto)}
      </span>

      <div className="shrink-0">
        {pago.estado === 'con_recibo' && (
          pago.recibo_url ? (
            <a
              href={pago.recibo_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
              style={{ color: '#047857' }}
            >
              <Check className="h-3.5 w-3.5" />
              {pago.recibo_numero}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            // Emitido pero sin PDF archivado: el recibo existe en Siigo igual, y decirlo
            // es más útil que mostrar un enlace roto.
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#047857' }}>
              <Check className="h-3.5 w-3.5" />
              {pago.recibo_numero} · sin PDF
            </span>
          )
        )}

        {pago.estado === 'no_aplica' && (
          <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#6B7280' }}>
            <Ban className="h-3.5 w-3.5" />
            {pago.no_aplica_motivo ?? 'No lleva recibo'}
          </span>
        )}

        {pago.estado === 'pendiente' && (
          pago.faltantes.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#B45309' }}>
              <AlertTriangle className="h-3.5 w-3.5" />
              Falta {pago.faltantes.join(', ')}
            </span>
          ) : (
            <button
              onClick={emitir}
              disabled={pendiente}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[#F5F4F2] disabled:opacity-50"
              style={{ borderColor: '#E5E7EB', color: '#1A1A1A' }}
            >
              {pendiente ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
              Emitir recibo
            </button>
          )
        )}
      </div>
    </div>
  )
}
