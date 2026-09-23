'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FileCheck2, Upload } from 'lucide-react'
import { cargarFacturaCuota } from '@/lib/actions/factura-cuota-carga'
import { formatCOP } from '@/lib/cobros/format'
import { fechaCorta } from '@/lib/valida-cda/pago-pendiente'
import type { CuotaConFactura } from '@/lib/valida-cda/facturas-negocio-servidor'

/**
 * Facturas electrónicas de las cuotas de un contrato de servicio, en la ficha del negocio del lado de
 * MeTRIK. Cada mes se sube el PDF y el XML de la factura de la cuota; el cliente los descarga desde
 * la pestaña Pagos de su `/valida`.
 *
 * Solo lo ven el dueño y los administradores (la página no lo pinta a nadie más, y la acción lo
 * vuelve a exigir). Volver a cargar reemplaza la parte que se sube y conserva la otra.
 */
export function FacturasCuotas({ cuotas }: { cuotas: CuotaConFactura[] }) {
  return (
    <section data-facturas-cuotas className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-start gap-2">
        <FileCheck2 className="mt-0.5 h-4 w-4 text-acento" />
        <div>
          <p className="text-sm font-semibold text-tinta">Facturas de las cuotas</p>
          <p className="text-xs text-tinta-suave">
            El PDF y el XML de cada cuota. El cliente los descarga en la pestaña Pagos de su Valida.
          </p>
        </div>
      </div>
      {cuotas.length === 0 ? (
        <p className="mt-3 text-xs text-tinta-suave">Este contrato todavía no tiene cuotas registradas.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {cuotas.map((c) => (
            <FilaCuota key={c.cuotaId} cuota={c} />
          ))}
        </ul>
      )}
    </section>
  )
}

function FilaCuota({ cuota: c }: { cuota: CuotaConFactura }) {
  const router = useRouter()
  const [abierta, setAbierta] = useState(false)
  const [pendiente, iniciar] = useTransition()

  function enviar(formData: FormData) {
    formData.set('cuota_id', c.cuotaId)
    iniciar(async () => {
      const r = await cargarFacturaCuota(formData)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Factura ${r.numero} guardada.`)
      setAbierta(false)
      router.refresh()
    })
  }

  return (
    <li className="py-2.5 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-tinta">{c.concepto ?? `Cuota ${c.numero}`}</p>
          <p className="text-tinta-suave">
            {formatCOP(c.monto)} · vence {fechaCorta(c.fechaVencimiento)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {c.factura ? (
            <span className="text-tinta" data-factura-cargada>
              {c.factura.numero} · {[c.factura.pdf && 'PDF', c.factura.xml && 'XML'].filter(Boolean).join(' y ')}
            </span>
          ) : (
            <span className="text-tinta-suave">Sin factura</span>
          )}
          <button
            type="button"
            onClick={() => setAbierta((v) => !v)}
            className="inline-flex items-center gap-1 font-semibold text-acento"
          >
            <Upload className="h-3.5 w-3.5" />
            {c.factura ? 'Reemplazar' : 'Cargar'}
          </button>
        </div>
      </div>
      {abierta && (
        <form action={enviar} className="mt-2 grid gap-2 rounded-md border border-border bg-papel p-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 sm:col-span-1">
            <span className="text-tinta-suave">Número</span>
            <input
              name="numero"
              required
              maxLength={40}
              defaultValue={c.factura?.numero ?? ''}
              placeholder="FE-123"
              className="rounded-md border border-border bg-white px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-tinta-suave">PDF</span>
            <input name="pdf" type="file" accept="application/pdf,.pdf" className="text-xs" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-tinta-suave">XML</span>
            <input name="xml" type="file" accept=".xml,application/xml,text/xml" className="text-xs" />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={pendiente}
              className="w-full rounded-md bg-acento px-3 py-1.5 font-semibold text-white disabled:opacity-50"
            >
              {pendiente ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}
    </li>
  )
}
