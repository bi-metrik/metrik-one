import { Paperclip, Undo2 } from 'lucide-react'
import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'
import { hrefArchivo } from '@/lib/almacenamiento/referencia'
import { recaudadoNeto, type DevolucionDelNegocio } from '@/lib/cobros/devolucion-dinero'

/**
 * Las devoluciones de dinero del negocio (SOE-007), en la ficha. Se pinta solo si hay alguna.
 *
 * Va aparte del bloque de pagos a propósito: ese bloque vive en una etapa, y el caso típico
 * de una devolución es un negocio perdido en venta, donde el bloque de pagos ni se muestra.
 * Lo registra Tesorería → Devoluciones; aquí solo se lee.
 */

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

export function DevolucionesNegocio({
  devoluciones,
  cobrado,
}: {
  devoluciones: DevolucionDelNegocio[]
  /** Suma de los cobros del negocio (sin remanentes por devolver). */
  cobrado: number
}) {
  if (devoluciones.length === 0) return null
  const devuelto = devoluciones.reduce((s, d) => s + Number(d.monto || 0), 0)
  const neto = recaudadoNeto(cobrado, devuelto)

  return (
    <section className="rounded-lg border bg-white p-4" style={{ borderColor: '#E5E7EB' }}>
      <div className="flex items-center gap-1.5">
        <Undo2 className="h-4 w-4 text-tinta-suave" />
        <h3 className="text-sm font-semibold text-tinta">Devoluciones de dinero</h3>
      </div>
      <p className="mt-1 text-xs tabular-nums text-tinta-suave">
        Cobrado {fmtCOP(cobrado)} · Devuelto {fmtCOP(devuelto)} ·{' '}
        <strong className="text-tinta">Recaudado neto {fmtCOP(neto)}</strong>
      </p>
      <ul className="mt-3 space-y-2">
        {devoluciones.map((d) => {
          const soporte = hrefArchivo(d.soporte_url)
          return (
            <li key={d.id} className="rounded-md border px-3 py-2" style={{ borderColor: '#F3F4F6' }}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-tinta-suave">{formatBogotaFechaCortaAno(d.fecha) ?? d.fecha}</span>
                <span className="font-semibold tabular-nums" style={{ color: '#B91C1C' }}>− {fmtCOP(Number(d.monto))}</span>
              </div>
              <p className="mt-1 text-xs text-tinta">{d.motivo}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-tinta-suave">
                {d.autor && <span>Registró {d.autor}</span>}
                <span>{d.cerro_caso ? '· Cerró el caso' : '· No cerró el caso'}</span>
                {soporte && (
                  <a href={soporte} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    · <Paperclip className="h-3 w-3" /> {d.soporte_nombre ?? 'Soporte'}
                  </a>
                )}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
