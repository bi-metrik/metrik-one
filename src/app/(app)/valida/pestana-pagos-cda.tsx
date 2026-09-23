import { AvisoCarga } from '@/components/terminos/pestana-terminos'
import { formatCOP } from '@/lib/cobros/format'
import { etiquetaFuentePago } from '@/lib/suscripciones/pasarela/dominios'
import { fechaCorta, type CuotaConEstado, type EstadoCuota } from '@/lib/valida-cda/pago-pendiente'
import type { PagoRecibidoCda } from '@/lib/valida-cda/pago-servidor'
import type { ResultadoPagosCda } from '@/lib/valida-cda/pestanas-servidor'

/**
 * La pestaña Pagos de `/valida` de un CDA, con el patrón de la de Valida API: las cuotas del contrato
 * (período, valor, vencimiento, estado, el enlace de pago en línea si hay uno vigente y la factura electrónica)
 * y, debajo, los pagos recibidos con su recibo.
 *
 * Las descargas van por `/api/valida/archivo/<clase>/<id>`, que vuelve a autorizar con la MISMA RPC
 * que listó (`mis_cuotas_de_servicio` para la factura, `mis_cobros_de_servicio` para el recibo) y
 * responde con una URL firmada de 60 s. Aquí no se pinta ninguna ruta del bucket.
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

export function PestanaPagosCda({ carga }: { carga: ResultadoPagosCda }) {
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
          <p className="mt-3 text-xs text-tinta-suave">Tus cuotas aparecen aquí cuando MeTRIK las registre.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-tinta-suave">
                <tr>
                  <th className="py-1 pr-3 font-medium">Período</th>
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
        )}
      </section>

      <section data-pagos-cda className="rounded-lg border border-border bg-white p-4">
        <p className="text-sm font-semibold text-tinta">Pagos recibidos</p>
        {carga.pagos.length === 0 ? (
          <p className="mt-2 text-xs text-tinta-suave">Sin pagos registrados en este contrato.</p>
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
      <td className="py-1.5 pr-3">
        {c.enlacePago ? (
          <a
            href={c.enlacePago}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md bg-acento px-3 py-1 font-semibold text-white"
          >
            Pagar en línea
          </a>
        ) : (
          '—'
        )}
      </td>
      <td className="py-1.5">
        {c.factura && c.cuotaId ? (
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
        ) : (
          <span className="text-tinta-suave">Pendiente</span>
        )}
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
