import { AvisoCarga } from '@/components/terminos/pestana-terminos'
import { formatCOP } from '@/lib/cobros/format'
import { NOTA_IVA_CDA } from '@/lib/valida-cda/redaccion-fiscal'
import { etiquetaFuentePago } from '@/lib/suscripciones/pasarela/dominios'
import { fechaCorta, type CuotaConEstado, type EstadoCuota } from '@/lib/valida-cda/pago-pendiente'
import { fechaDiaMes, fechasDePagoV15, textoPagaHasta } from '@/lib/valida-cda/plazos'
import type { PagoRecibidoCda } from '@/lib/valida-cda/pago-servidor'
import type { ResultadoPagosCda } from '@/lib/valida-cda/pestanas-servidor'
import { TEXTO_CARTERA } from '@/lib/valida-cda/cancelada'
import { periodoEnLetrasConAnio } from '@/lib/valida-cda/aviso-suspendida'

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

export function PestanaPagos({
  carga,
  opciones = null,
  pagoAutomatico = null,
  transicion = null,
  reactivar = null,
}: {
  carga: ResultadoPagosCda
  /** «Reactivar la suscripción» (11.4) con la suscripción Cancelada: va primero y reemplaza las formas de pagar. */
  reactivar?: React.ReactNode
  /** La vigencia de la v1.5 (`contextoSuscripcion().transicion`): la fecha de pago en lugar del vencimiento (D7). */
  transicion?: string | null
  opciones?: React.ReactNode
  /** «Pago automático con tarjeta» de un CDA (Términos v1.5, 2.4), junto a las formas de pagar. */
  pagoAutomatico?: React.ReactNode
}) {
  if (carga.estado === 'sin_acceso') return <AvisoCarga carga={carga} />
  if (carga.estado === 'no_disponible') return <AvisoCarga carga={{ estado: 'no_disponible', motivo: carga.motivo }} />

  return (
    <div className="space-y-5">
      {reactivar}
      {/* «Pagar el mes» y «Pagar 12 meses» (Plan Anual), cuando el contrato los tiene encendidos. */}
      {opciones}
      {pagoAutomatico}
      <section data-cuotas-cda className="rounded-lg border border-border bg-white p-4">
        <p className="text-sm font-semibold text-tinta">Cuotas de tu suscripción</p>
        <p className="mt-1 text-xs text-tinta-suave">{NOTA_IVA_CDA}</p>
        {carga.cuotas.length === 0 ? (
          <p className="mt-3 text-sm text-tinta-suave" data-sin-cuotas>
            Aquí vas a ver cada cuota con su factura electrónica.
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-3 sm:hidden">
              {carga.cuotas.map((c) => (
                <TarjetaCuota key={`m-${c.numero}-${c.fechaVencimiento}`} cuota={c} transicion={transicion} />
              ))}
            </ul>
            <div className="mt-3 hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-xs">
                <thead className="text-tinta-suave">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Periodo</th>
                    <th className="py-1 pr-3 font-medium">Valor</th>
                    <th className="py-1 pr-3 font-medium">{transicion ? 'Fecha de pago' : 'Vence'}</th>
                    <th className="py-1 pr-3 font-medium">Estado</th>
                    <th className="py-1 pr-3 font-medium">Pago</th>
                    <th className="py-1 font-medium">Factura</th>
                  </tr>
                </thead>
                <tbody className="text-tinta">
                  {carga.cuotas.map((c) => (
                    <FilaCuota key={`${c.numero}-${c.fechaVencimiento}`} cuota={c} transicion={transicion} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {(carga.cartera ?? []).length > 0 && <Cartera cuotas={carga.cartera ?? []} />}

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

/**
 * La cartera (Términos v1.5, 11.7): períodos que empezaron antes del 1-dic-2026 y siguen sin pagar después de
 * la Cancelada o de la reactivación. Sin intereses ni recargos (2.5) y sin condicionar nada: solo se ve y se
 * paga. Los períodos desde el 1-dic que no se pagaron no aparecen: no se cobran.
 */
function Cartera({ cuotas }: { cuotas: CuotaConEstado[] }) {
  return (
    <section data-cartera-cda className="rounded-lg border border-border bg-white p-4">
      <p className="text-sm font-semibold text-tinta">{TEXTO_CARTERA.titulo}</p>
      <p className="mt-1 text-xs text-tinta-suave">{TEXTO_CARTERA.detalle}</p>
      <ul className="mt-3 space-y-2 text-sm text-tinta">
        {cuotas.map((c) => (
          <li
            key={`cartera-${c.cuotaId ?? c.numero}-${c.fechaVencimiento}`}
            data-cartera-cuota={c.numero}
            className="flex flex-col gap-2 border-t border-border pt-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              Período {periodoEnLetrasConAnio(c) ?? `de la cuota ${c.numero}`} · <span className="font-semibold">{formatCOP(c.saldo)}</span>
            </span>
            {c.enlacePago ? <BotonPagar href={c.enlacePago} className="text-xs" /> : <span className="text-xs text-tinta-suave">{TEXTO_CARTERA.sinEnlace}</span>}
          </li>
        ))}
      </ul>
    </section>
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

/** La fecha y el medio del pago que cubrió la cuota; la fecha baja el recibo si lo hay. */
function PagoDeLaCuota({ cuota: c }: { cuota: CuotaConEstado }) {
  const p = c.ultimoPago
  if (!p) return null
  const fecha = fechaCorta(p.fecha)
  const medio = etiquetaFuentePago(p.fuente)
  return (
    <span data-pago-cuota={p.cobroId}>
      {p.reciboDescargable ? (
        <a href={`/api/valida/archivo/recibo/${p.cobroId}`} className="font-semibold text-acento">
          {fecha}
        </a>
      ) : (
        fecha
      )}
      {medio && ` · ${medio}`}
    </span>
  )
}

/**
 * La columna Pago: en una cuota pagada, el pago que la cubrió; con saldo, el pago abonado (si lo hay)
 * y el botón si hay enlace vigente; sin nada, «—».
 */
function Pago({ cuota: c }: { cuota: CuotaConEstado }) {
  if (!c.ultimoPago && !c.enlacePago) return <>—</>
  return (
    <span className="flex flex-col items-start gap-1">
      {c.ultimoPago && <PagoDeLaCuota cuota={c} />}
      {c.enlacePago && <BotonPagar href={c.enlacePago} />}
    </span>
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

/**
 * La fecha de pago de una cuota con la v1.5 (D7 del diseño del 4-nov): «a más tardar el 23-dic» para un
 * período que empieza desde la vigencia, «a más tardar el 30-nov» para uno de la transición impago, y la
 * línea de la Suspendida si queda saldo. Un período de la transición ya pagado conserva su vencimiento (se
 * pagó bajo la versión anterior). `null` sin la v1.5: se dice el vencimiento de siempre.
 */
export function fechaDePagoCuota(c: CuotaConEstado, transicion: string | null): { fecha: string; suspendida: string | null } | null {
  const f = fechasDePagoV15(c, transicion)
  if (!f) return null
  if (f.enTransicion && c.estado === 'pagada') return null
  const paga = textoPagaHasta(f)
  return {
    fecha: paga.charAt(0).toLowerCase() + paga.slice(1),
    suspendida: c.estado === 'pagada' ? null : `Suspendida por pago desde el ${fechaDiaMes(f.suspendidaDesde)} si no se paga`,
  }
}

function TarjetaCuota({ cuota: c, transicion }: { cuota: CuotaConEstado; transicion: string | null }) {
  const v15 = fechaDePagoCuota(c, transicion)
  return (
    <li className="rounded-md border border-border p-3 text-sm text-tinta" data-cuota-movil={c.numero}>
      <p className="font-medium">{c.concepto ?? `Cuota ${c.numero}`}</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="font-semibold">{formatCOP(c.monto)}</span>
        <span className={CLASE_CUOTA[c.estado]}>{ETIQUETA_CUOTA[c.estado]}</span>
      </div>
      {c.estado === 'abonada' && <p className="text-xs text-tinta-suave">Faltan {formatCOP(c.saldo)}</p>}
      <p className="mt-1 text-xs text-tinta-suave">
        {v15 ? `Fecha de pago: ${v15.fecha}` : `Vence el ${fechaCorta(c.fechaVencimiento)}`}
      </p>
      {v15?.suspendida && <p className="text-xs text-tinta-suave">{v15.suspendida}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          Factura: <Factura cuota={c} />
        </span>
        {c.ultimoPago && (
          <span>
            Pago: <PagoDeLaCuota cuota={c} />
          </span>
        )}
        {c.enlacePago && <BotonPagar href={c.enlacePago} className="w-full text-sm" />}
      </div>
    </li>
  )
}

function FilaCuota({ cuota: c, transicion }: { cuota: CuotaConEstado; transicion: string | null }) {
  const v15 = fechaDePagoCuota(c, transicion)
  return (
    <tr className="border-t border-border align-top" data-cuota={c.numero}>
      <td className="py-1.5 pr-3">{c.concepto ?? `Cuota ${c.numero}`}</td>
      <td className="py-1.5 pr-3">
        {formatCOP(c.monto)}
        {c.estado === 'abonada' && <span className="block text-tinta-suave">Faltan {formatCOP(c.saldo)}</span>}
      </td>
      <td className="py-1.5 pr-3">
        {v15 ? v15.fecha : fechaCorta(c.fechaVencimiento)}
        {v15?.suspendida && <span className="block text-tinta-suave">{v15.suspendida}</span>}
      </td>
      <td className={`py-1.5 pr-3 ${CLASE_CUOTA[c.estado]}`}>{ETIQUETA_CUOTA[c.estado]}</td>
      <td className="py-1.5 pr-3">
        <Pago cuota={c} />
      </td>
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
