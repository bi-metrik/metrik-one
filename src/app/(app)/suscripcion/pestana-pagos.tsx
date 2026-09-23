import { AvisoCarga } from '@/components/terminos/pestana-terminos'
import { formatCOP } from '@/lib/cobros/format'
import { etiquetaFuentePago } from '@/lib/suscripciones/pasarela/dominios'
import { fechaCorta, type CuotaConEstado, type EstadoCuota } from '@/lib/valida-cda/pago-pendiente'
import type { PagoRecibidoCda } from '@/lib/valida-cda/pago-servidor'
import type { ResultadoPagosCda } from '@/lib/valida-cda/pestanas-servidor'

/**
 * La pestaña Pagos de `/suscripcion`: las cuotas del contrato (periodo, valor, vencimiento, estado,
 * el enlace de pago si hay uno vigente y la factura electrónica) y, debajo, los pagos recibidos con
 * su recibo. En el teléfono cada cuota es una tarjeta; desde `sm` es una tabla.
 *
 * Las descargas van por `/api/valida/archivo/<clase>/<id>`, que vuelve a autorizar con la MISMA RPC
 * que listó (`mis_cuotas_de_servicio` para la factura, `mis_cobros_de_servicio` para el recibo) y
 * responde con una URL firmada de 60 s. Aquí no se pinta ninguna ruta del bucket.
 *
 * El enlace sale de `cobros.enlace_pago_url` venga de donde venga: la pestaña no nombra proveedor.
 *
 * Sin estado ni efectos: se pinta en el servidor.
 */

const ETIQUETA_CUOTA: Record<EstadoCuota, string> = {
  pagada: 'Pagada',
  abonada: 'Abono parcial',
  pendiente: 'Pendiente',
  vencida: 'Vencida',
}

const CLASE_CUOTA: Record<EstadoCuota, string> = {
  pagada: 'text-emerald-800',
  abonada: 'text-tinta',
  pendiente: 'text-tinta',
  vencida: 'font-semibold text-amber-800',
}

const ETIQUETA_PAGO = { pagado: 'Recibido', programado: 'Programado', anulado: 'Anulado' } as const

export function PestanaPagos({ carga }: { carga: ResultadoPagosCda }) {
  if (carga.estado === 'sin_acceso') return <AvisoCarga carga={carga} />
  if (carga.estado === 'no_disponible') return <AvisoCarga carga={{ estado: 'no_disponible', motivo: carga.motivo }} />

  return (
    <div className="space-y-5">
      <section data-cuotas-cda className="rounded-lg border border-border bg-white p-4">
        <p className="text-sm font-semibold text-tinta">Cuotas de tu suscripción</p>
        <p className="mt-1 text-xs text-tinta-suave">
          Sin IVA: servicio de computación en la nube excluido del impuesto (numeral 21 del artículo 476 del Estatuto
          Tributario).
        </p>
        {carga.cuotas.length === 0 ? (
          <p className="mt-3 text-sm text-tinta-suave" data-sin-cuotas>
            Aquí vas a ver cada cuota con su factura electrónica.
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-3 sm:hidden">
              {carga.cuotas.map((c) => (
                <TarjetaCuota key={`m-${c.numero}-${c.fechaVencimiento}`} cuota={c} />
              ))}
            </ul>
            <div className="mt-3 hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-xs">
                <thead className="text-tinta-suave">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Periodo</th>
                    <th className="py-1 pr-3 font-medium">Valor</th>
                    <th className="py-1 pr-3 font-medium">Vence</th>
                    <th className="py-1 pr-3 font-medium">Estado</th>
                    <th className="py-1 pr-3 font-medium">Pago</th>
                    <th className="py-1 font-medium">Factura</th>
                  </tr>
                </thead>
                <tbody className="text-tinta">
                  {carga.cuotas.map((c) => (
                    <FilaCuota key={`${c.numero}-${c.fechaVencimiento}`} cuota={c} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section data-pagos-cda className="rounded-lg border border-border bg-white p-4">
        <p className="text-sm font-semibold text-tinta">Pagos recibidos</p>
        {carga.pagos.length === 0 ? (
          <p className="mt-2 text-xs text-tinta-suave">Todavía no hay pagos registrados en tu suscripción.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-tinta-suave">
                <tr>
                  <th className="py-1 pr-3 font-medium">Fecha</th>
                  <th className="py-1 pr-3 font-medium">Valor</th>
                  <th className="py-1 pr-3 font-medium">Medio</th>
                  <th className="py-1 pr-3 font-medium">Estado</th>
                  <th className="py-1 font-medium">Recibo</th>
                </tr>
              </thead>
              <tbody className="text-tinta">
                {carga.pagos.map((p) => (
                  <FilaPago key={p.cobroId} pago={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function BotonPagar({ href, className = '' }: { href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center rounded-md bg-acento px-3 py-1.5 font-semibold text-white ${className}`}
    >
      Pagar en línea
    </a>
  )
}

function Factura({ cuota: c }: { cuota: CuotaConEstado }) {
  if (!c.factura || !c.cuotaId) return <span className="text-tinta-suave">Pendiente</span>
  return (
    <span className="flex flex-wrap gap-x-3">
      <span className="text-tinta-suave">{c.factura.numero}</span>
      {c.factura.pdf && (
        <a href={`/api/valida/archivo/factura_pdf/${c.cuotaId}`} className="font-semibold text-acento">
          PDF
        </a>
      )}
      {c.factura.xml && (
        <a href={`/api/valida/archivo/factura_xml/${c.cuotaId}`} className="font-semibold text-acento">
          XML
        </a>
      )}
    </span>
  )
}

function TarjetaCuota({ cuota: c }: { cuota: CuotaConEstado }) {
  return (
    <li className="rounded-md border border-border p-3 text-sm text-tinta" data-cuota-movil={c.numero}>
      <p className="font-medium">{c.concepto ?? `Cuota ${c.numero}`}</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="font-semibold">{formatCOP(c.monto)}</span>
        <span className={CLASE_CUOTA[c.estado]}>{ETIQUETA_CUOTA[c.estado]}</span>
      </div>
      {c.estado === 'abonada' && <p className="text-xs text-tinta-suave">Faltan {formatCOP(c.saldo)}</p>}
      <p className="mt-1 text-xs text-tinta-suave">Vence el {fechaCorta(c.fechaVencimiento)}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          Factura: <Factura cuota={c} />
        </span>
        {c.enlacePago && <BotonPagar href={c.enlacePago} className="w-full text-sm" />}
      </div>
    </li>
  )
}

function FilaCuota({ cuota: c }: { cuota: CuotaConEstado }) {
  return (
    <tr className="border-t border-border align-top" data-cuota={c.numero}>
      <td className="py-1.5 pr-3">{c.concepto ?? `Cuota ${c.numero}`}</td>
      <td className="py-1.5 pr-3">
        {formatCOP(c.monto)}
        {c.estado === 'abonada' && <span className="block text-tinta-suave">Faltan {formatCOP(c.saldo)}</span>}
      </td>
      <td className="py-1.5 pr-3">{fechaCorta(c.fechaVencimiento)}</td>
      <td className={`py-1.5 pr-3 ${CLASE_CUOTA[c.estado]}`}>{ETIQUETA_CUOTA[c.estado]}</td>
      <td className="py-1.5 pr-3">{c.enlacePago ? <BotonPagar href={c.enlacePago} /> : '—'}</td>
      <td className="py-1.5">
        <Factura cuota={c} />
      </td>
    </tr>
  )
}

function FilaPago({ pago: p }: { pago: PagoRecibidoCda }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-3">{p.fecha ? fechaCorta(p.fecha) : '—'}</td>
      <td className={`py-1.5 pr-3 ${p.estado === 'anulado' ? 'text-tinta-suave line-through' : ''}`}>{formatCOP(p.monto)}</td>
      <td className="py-1.5 pr-3">{etiquetaFuentePago(p.fuente) ?? '—'}</td>
      <td className="py-1.5 pr-3">{ETIQUETA_PAGO[p.estado]}</td>
      <td className="py-1.5">
        {p.reciboDescargable ? (
          <a href={`/api/valida/archivo/recibo/${p.cobroId}`} className="font-semibold text-acento">
            {p.reciboNumero ?? 'Descargar'}
          </a>
        ) : (
          (p.reciboNumero ?? '—')
        )}
      </td>
    </tr>
  )
}
