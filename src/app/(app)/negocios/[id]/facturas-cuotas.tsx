'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, FileCheck2, Link2, Upload } from 'lucide-react'
import { cargarFacturaCuota } from '@/lib/actions/factura-cuota-carga'
import { generarEnlacePagoDeCuota } from '@/lib/actions/enlace-pago-cuota'
import { enlaceVigente } from '@/lib/cobros/enlace-pago-cuota'
import { formatCOP } from '@/lib/cobros/format'
import { todayBogotaISO } from '@/lib/dates/bogota'
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
          <p className="text-sm font-semibold text-tinta">Cuotas: facturas y enlaces de pago</p>
          <p className="text-xs text-tinta-suave">
            El PDF y el XML de cada cuota, y su enlace de pago en línea. El cliente ve las dos cosas en la pestaña
            Pagos de su Valida. El enlace se genera solo cuando faltan 7 días o menos para el vencimiento, y la
            persona designada recibe un correo; el botón sirve para adelantarlo o reponer uno vencido.
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
      <EnlacePagoCuota cuota={c} />
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

/**
 * El enlace de pago en línea de la cuota: el vigente, con su vencimiento y para copiar; o el botón que lo
 * genera (también cuando el que había venció). Una cuota pagada o con el cobro anulado no ofrece enlace.
 */
function EnlacePagoCuota({ cuota: c }: { cuota: CuotaConFactura }) {
  const router = useRouter()
  const [pendiente, iniciar] = useTransition()
  // Se fija al montar, no en cada render: el render tiene que ser puro.
  const [ahora] = useState(() => Date.now())

  if (c.cobro?.pagado) return <p className="mt-1 text-emerald-700">Pagada</p>
  if (c.cobro?.anulado) return <p className="mt-1 text-tinta-suave">Cobro anulado: sin enlace de pago.</p>

  const url = c.cobro?.enlaceUrl ?? null
  // La misma regla del botón y del cron: un enlace que vence en menos de una hora ya no cuenta.
  const vigente = url !== null && enlaceVigente({ enlacePagoUrl: url, enlacePagoExpira: c.cobro?.enlaceExpira ?? null }, ahora)

  function generar() {
    iniciar(async () => {
      const r = await generarEnlacePagoDeCuota(c.cuotaId)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.estado === 'vigente' ? 'La cuota ya tenía un enlace vigente.' : 'Enlace de pago generado.')
      router.refresh()
    })
  }

  async function copiar(u: string) {
    try {
      await navigator.clipboard.writeText(u)
      toast.success('Enlace copiado.')
    } catch {
      toast.error('No se pudo copiar el enlace.')
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2" data-enlace-pago>
      <Link2 className="h-3.5 w-3.5 text-tinta-suave" />
      {vigente && url ? (
        <>
          <a href={url} target="_blank" rel="noreferrer" className="max-w-[16rem] truncate text-acento underline">
            {url}
          </a>
          {c.cobro?.enlaceExpira && <span className="text-tinta-suave">vence {fechaCorta(todayBogotaISO(new Date(c.cobro.enlaceExpira)))}</span>}
          <button type="button" onClick={() => copiar(url)} className="inline-flex items-center gap-1 font-semibold text-acento">
            <Copy className="h-3.5 w-3.5" />
            Copiar
          </button>
        </>
      ) : (
        <>
          <span className="text-tinta-suave">{url ? 'El enlace venció.' : 'Sin enlace de pago.'}</span>
          <button
            type="button"
            onClick={generar}
            disabled={pendiente}
            className="inline-flex items-center gap-1 font-semibold text-acento disabled:opacity-50"
          >
            {pendiente ? 'Generando…' : 'Generar enlace de pago'}
          </button>
        </>
      )}
    </div>
  )
}
