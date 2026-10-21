'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft, CheckCircle2, Clock, XCircle } from 'lucide-react'
import DistribuirPagoModal from '@/components/distribuir-pago-modal'
import { estadoRepartosDelNegocio, type RepartoDelNegocio } from '@/lib/actions/conciliacion-actions'

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

/**
 * Cómo va el reparto del comercial, visto desde el bloque del negocio:
 *   - «Reparto enviado, pendiente de financiera» con «Editar reparto»;
 *   - «Reparto aprobado», sin editar (lo hace cumplir la base, no esta pantalla);
 *   - «Rechazado: <nota>», hasta que la referencia se vuelva a repartir.
 *
 * Quien no puede repartir (`ctxFabPago`) recibe la lista vacía y no ve nada.
 */
export default function EstadoRepartoComercial({ negocioId }: { negocioId: string }) {
  const router = useRouter()
  const [repartos, setRepartos] = useState<RepartoDelNegocio[]>([])
  const [editando, setEditando] = useState<RepartoDelNegocio | null>(null)

  const cargar = useCallback(() => {
    estadoRepartosDelNegocio(negocioId).then(setRepartos).catch(() => setRepartos([]))
  }, [negocioId])

  useEffect(() => { cargar() }, [cargar])

  if (repartos.length === 0) return null

  return (
    <div className="space-y-1.5">
      {repartos.map((r) => (
        <div
          key={r.referencia}
          className={`rounded-lg border p-2.5 text-[11px] ${
            r.estado === 'rechazado' ? 'border-red-200 bg-red-50' : r.estado === 'aprobado' ? 'border-[#BBF7D0] bg-[var(--acento-tinte)]' : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`flex items-center gap-1 font-semibold ${r.estado === 'rechazado' ? 'text-red-700' : r.estado === 'aprobado' ? 'text-acento' : 'text-amber-900'}`}>
                {r.estado === 'rechazado' ? <XCircle className="h-3.5 w-3.5" /> : r.estado === 'aprobado' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                {r.estado === 'rechazado'
                  ? 'Reparto rechazado'
                  : r.estado === 'aprobado' ? 'Reparto aprobado' : 'Reparto enviado, pendiente de financiera'}
              </p>
              <p className="mt-0.5 text-tinta-suave">Ref {r.referencia}{r.total > 0 ? ` · ${fmtCOP(r.total)}` : ''}</p>
              {r.porciones.length > 0 && (
                <p className="mt-0.5 text-tinta tabular-nums">
                  {r.porciones.map((p) => `${p.codigo ?? 'negocio'} ${fmtCOP(p.monto)}`).join(' · ')}
                </p>
              )}
              {r.estado === 'rechazado' && (
                <p className="mt-0.5 text-red-700">{r.nota ? `Nota de financiera: ${r.nota}` : 'Sin nota.'} Vuelve a repartirlo.</p>
              )}
            </div>
            {r.estado === 'enviado' && (
              <button
                onClick={() => setEditando(r)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400 bg-white px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
              >
                <ArrowRightLeft className="h-3 w-3" /> Editar reparto
              </button>
            )}
          </div>
        </div>
      ))}
      {editando && (
        <DistribuirPagoModal
          edicion={editando}
          onClose={() => setEditando(null)}
          onDone={() => { setEditando(null); cargar(); router.refresh() }}
        />
      )}
    </div>
  )
}
