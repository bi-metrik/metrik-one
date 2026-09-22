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
 *
 * Desde el 2026-09-22 (brief «Tesorería solo emite recibos de la tarifa UPME») el botón
 * emite SOLO el RC-3 de la tarifa. El honorario se abona solo a la factura y ese abono no
 * se pinta aquí; lo único que se ve de él es lo que quedó para Tesorería («Abonos a
 * mano»), como aviso y sin botón.
 */

import { useMemo, useState, useTransition } from 'react'
import { Receipt, Check, AlertTriangle, Loader2, ExternalLink, Ban, Mail } from 'lucide-react'
import { toast } from 'sonner'
import BusquedaInput from '@/components/busqueda-input'
import { emitirReciboDeNegocio } from '@/lib/actions/facturacion-actions'
import type {
  AbonoParaTesoreria,
  ControlRecibos,
  PagoConRecibo,
  EstadoRecibo,
} from '@/lib/actions/recibos-control-actions'
import { docDeRecibo, hrefArchivoDeCobro } from '@/lib/almacenamiento/archivo-de-cobro'
import type { ComponenteRecibo } from '@/lib/siigo/recibo-componentes'

/**
 * Cómo se le nombra cada componente a una persona.
 *
 * `pasante` es la palabra del modelo de dinero (plata que entra y se gira a un tercero);
 * en pantalla no dice nada, así que se traduce.
 */
const ETIQUETA_COMPONENTE: Record<ComponenteRecibo, string> = {
  honorario: 'el honorario',
  pasante: 'la plata de terceros',
}

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

const fmtFecha = (f: string | null) =>
  f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const VERDE = 'var(--acento)'

/** Las listas del panel: los tres estados del recibo, más los abonos que van a mano. */
type Vista = EstadoRecibo | 'abonos_a_mano'

export default function TabRecibos(
  { control, onCambio }: { control: ControlRecibos; onCambio: () => void },
) {
  const [vista, setVista] = useState<Vista>('pendiente')
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

  const abonosVisibles = useMemo(() => {
    const todos = control.abonos_a_mano ?? []
    if (!term) return todos
    return todos.filter(a => [a.negocio_codigo, a.cliente, a.motivo].some(v => v?.toLowerCase().includes(term)))
  }, [control.abonos_a_mano, term])

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
            <div className="text-[11px]" style={{ color: 'var(--tinta-suave)' }}>{x.label}</div>
            <div className="mt-0.5 text-[15px] font-bold tabular-nums"
                 style={{ color: x.destaque ? '#B45309' : 'var(--tinta)' }}>{x.value}</div>
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
          { k: 'pendiente' as Vista, label: `Sin recibo (${t.pendientes})` },
          { k: 'con_recibo' as Vista, label: `Con recibo (${t.con_recibo})` },
          { k: 'no_aplica' as Vista, label: `No aplica (${t.no_aplica})` },
          // Solo aparece si hay algo: en un workspace sin abono a la factura sería ruido.
          ...((t.abonos_a_mano ?? 0) > 0
            ? [{ k: 'abonos_a_mano' as Vista, label: `Abonos a mano (${t.abonos_a_mano})` }]
            : []),
        ]).map(o => (
          <button
            key={o.k}
            onClick={() => setVista(o.k)}
            className="rounded-full border px-3 py-1 text-[12px] font-medium transition"
            style={{
              borderColor: vista === o.k ? VERDE : '#E5E7EB',
              backgroundColor: vista === o.k ? 'var(--acento-tinte)' : 'transparent',
              color: vista === o.k ? 'var(--acento)' : 'var(--tinta-suave)',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {vista === 'abonos_a_mano' ? (
        <div className="space-y-1.5">
          <p className="mb-2 text-[11px]" style={{ color: 'var(--tinta-suave)' }}>
            El honorario se abona solo a la factura. Estos son los que ONE no pudo abonar:
            crúzalos en Siigo. No llevan recibo de caja.
          </p>
          {abonosVisibles.length === 0 ? (
            <div className="rounded-lg border p-6 text-center" style={{ borderColor: '#E5E7EB' }}>
              <p className="text-[13px]" style={{ color: 'var(--tinta-suave)' }}>
                {term ? `Sin resultados para "${q.trim()}".` : 'No hay abonos pendientes a mano.'}
              </p>
            </div>
          ) : abonosVisibles.map(a => <FilaAbonoAMano key={a.cobro_id} abono={a} />)}
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-lg border p-6 text-center" style={{ borderColor: '#E5E7EB' }}>
          <p className="text-[13px]" style={{ color: 'var(--tinta-suave)' }}>
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

/**
 * Exportada para poder pintarla sola en una prueba de render: la vista de la pestaña es
 * estado interno y sin DOM no se puede cambiar. Mismo criterio que `FilaPorFacturar`.
 */
export function FilaPago({ pago, onCambio }: { pago: PagoConRecibo; onCambio: () => void }) {
  const [pendiente, startTransition] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [justificacion, setJustificacion] = useState('')
  const [duplicados, setDuplicados] = useState<Array<{ numero: string; fecha: string; valor: number }> | null>(null)

  function emitir() {
    startTransition(async () => {
      // Sin valor: el recibo acusa la porción UPME que sale del reparto del pago. El
      // servidor no acepta otra cifra (ver `emitirReciboDeNegocio`).
      const r = await emitirReciboDeNegocio(pago.negocio_id, {
        cobroId: pago.cobro_id,
        justificacionDuplicado: justificacion.trim() || undefined,
      })
      if (r.ok) {
        toast.success(
          r.archivada
            ? `Recibo ${r.numero} emitido y archivado.`
            : `Recibo ${r.numero} emitido. El PDF no se pudo archivar: revísalo.`,
        )
        setAbierto(false)
        onCambio()
        return
      }
      // Siigo ya tiene un recibo de este cliente por el mismo valor. No bloquea solo: el
      // histórico de SOENA es ruidoso (medido el 2026-08-09: de 45 recibos, 4 eran el
      // mismo caso duplicado el mismo día). Se muestra y la persona decide.
      if (r.duplicados) { setDuplicados(r.duplicados); return }
      toast.error(r.error)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2"
         style={{ borderColor: '#E5E7EB' }}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold" style={{ color: 'var(--tinta)' }}>
            {pago.negocio_codigo ?? '—'}
          </span>
          <span className="truncate text-[12px]" style={{ color: 'var(--tinta-suave)' }}>{pago.cliente ?? '—'}</span>
          {pago.facturado && (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                  style={{ backgroundColor: '#F3F4F6', color: 'var(--tinta-suave)' }}>facturado</span>
          )}
        </div>
        <div className="text-[11px]" style={{ color: 'var(--tinta-suave)' }}>
          {fmtFecha(pago.fecha)}
          {pago.concepto && ` · ${pago.concepto}`}
        </div>
      </div>

      <span className="shrink-0 text-right">
        <span className="block text-[13px] font-bold tabular-nums" style={{ color: 'var(--tinta)' }}>
          {fmtCOP(pago.monto)}
        </span>
        {/* En un pago mixto el recibo acusa solo la tarifa: se dice cuánto es, para que
            nadie espere un recibo por el pago entero. */}
        {pago.valor_upme != null && pago.valor_upme > 0 && Math.round(pago.valor_upme) !== Math.round(pago.monto) && (
          <span className="block text-[10px] tabular-nums" style={{ color: 'var(--tinta-suave)' }}>
            tarifa UPME {fmtCOP(pago.valor_upme)}
          </span>
        )}
      </span>

      <div className="shrink-0">
        {/* Un pago mixto sale con DOS documentos y se listan los dos: mostrar uno solo
            escondería un recibo que ya consumió numeración. */}
        {pago.estado === 'con_recibo' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {pago.recibos.map(r => {
              // El PDF del recibo ya no se abre en Drive: nace cerrado y los bytes los
              // baja `/api/archivos/cobro` con la cuenta de servicio. Un recibo cargado
              // a mano no trae enlace, que es lo que ya pintaba "sin PDF".
              const href = hrefArchivoDeCobro(pago.cobro_id, docDeRecibo(r.componente), r.url)
              return href ? (
                <a
                  key={r.numero}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
                  style={{ color: 'var(--acento)' }}
                >
                  <Check className="h-3.5 w-3.5" />
                  {r.numero}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                // Emitido pero sin PDF archivado: el recibo existe en Siigo igual, y
                // decirlo es más útil que mostrar un enlace roto.
                <span key={r.numero} className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--acento)' }}>
                  <Check className="h-3.5 w-3.5" />
                  {r.numero} · sin PDF
                </span>
              )
            })}
          </div>
        )}

        {pago.estado === 'no_aplica' && (
          <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--tinta-suave)' }}>
            <Ban className="h-3.5 w-3.5" />
            {pago.no_aplica_motivo ?? 'No lleva recibo'}
          </span>
        )}

        {pago.estado === 'pendiente' && (
          pago.faltantes.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#B91C1C' }}>
              <AlertTriangle className="h-3.5 w-3.5" />
              Falta {pago.faltantes.join(', ')}
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setAbierto(true)}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-papel"
                style={{ borderColor: '#E5E7EB', color: 'var(--tinta)' }}
              >
                <Receipt className="h-3.5 w-3.5" />
                {pago.componentes_pendientes.length > 0 ? 'Completar recibos' : 'Emitir recibo'}
              </button>
              {/* La emisión quedó a medias: se dice QUÉ falta, para que el pendiente no
                  parezca un pago sin acusar cuando ya tiene un documento emitido. */}
              {pago.componentes_pendientes.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#B45309' }}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Falta el recibo de {pago.componentes_pendientes.map(c => ETIQUETA_COMPONENTE[c]).join(' y ')}
                </span>
              )}
              {/* A dónde va el aviso, con nombre propio. El dato existía y no se pintaba
                  en ninguna parte: por eso nadie vio que el panel decía "no hay correo"
                  sobre casos a los que el aviso sí les llegaba (112 de 119 en SOENA,
                  medido el 2026-09-22). Decir la dirección es más útil que decir de qué
                  documento salió: es lo que quien emite puede verificar. */}
              {pago.correo && (
                <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--tinta-suave)' }}>
                  <Mail className="h-3.5 w-3.5" />
                  se le avisa a {pago.correo}
                </span>
              )}
              {/* El recibo sale igual: esto se dice ANTES de emitir, no se calla. */}
              {pago.avisos.map(a => (
                <span key={a} className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#B45309' }}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {a}
                </span>
              ))}
            </div>
          )
        )}
      </div>

      {abierto && (
        <div className="mt-2 w-full rounded-md border p-3" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFAFA' }}>
          <ResumenReciboUpme pago={pago} />

          {duplicados && (
            <div className="mt-2 rounded-md border p-2" style={{ borderColor: '#F0C060', backgroundColor: '#FFF8E6' }}>
              <div className="flex items-start gap-1.5 text-[11px]" style={{ color: '#7A4A00' }}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  Siigo ya tiene {duplicados.length === 1 ? 'un recibo' : `${duplicados.length} recibos`} de
                  este cliente por ese mismo valor: {duplicados.map(d => `${d.numero} (${fmtCOP(d.valor)})`).join(', ')}.
                  Si aun así hay que emitirlo, escribe por qué.
                </div>
              </div>
              <textarea
                value={justificacion}
                onChange={e => setJustificacion(e.target.value)}
                rows={2}
                placeholder="Por qué se emite de todos modos…"
                className="mt-2 w-full rounded border px-2 py-1 text-[12px]"
                style={{ borderColor: '#F0C060' }}
              />
            </div>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => { setAbierto(false); setDuplicados(null) }}
              disabled={pendiente}
              className="rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-white disabled:opacity-50"
              style={{ borderColor: '#E5E7EB', color: 'var(--tinta)' }}
            >
              Cancelar
            </button>
            <button
              onClick={emitir}
              disabled={pendiente || (duplicados != null && justificacion.trim().length < 10)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
              style={{ backgroundColor: VERDE }}
            >
              {pendiente && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Emitir recibo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Qué emite el botón, antes de emitirlo.
 *
 * Regla 3 del brief del 2026-09-22: el formulario muestra y emite SOLO la porción UPME del
 * pago, no su monto. No hay campo para escribir otra cifra: la porción sale del reparto del
 * pago, y si el soporte dice otra cosa lo que está mal es el monto del pago.
 *
 * Exportado para pintarlo solo en una prueba de render: el formulario vive detrás de un
 * estado (`abierto`) que sin DOM no se puede cambiar.
 */
export function ResumenReciboUpme({ pago }: { pago: PagoConRecibo }) {
  const valor = pago.valor_upme
  const mixto = valor != null && Math.round(valor) !== Math.round(pago.monto)
  return (
    <div>
      <p className="text-[12px] font-semibold" style={{ color: 'var(--tinta)' }}>
        Recibo de caja por el recaudo de la tarifa UPME
      </p>
      <div className="mt-2 text-[10px] uppercase tracking-wide" style={{ color: 'var(--tinta-suave)' }}>
        Valor del recibo
      </div>
      <div className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--tinta)' }}>
        {valor != null ? fmtCOP(valor) : '—'}
      </div>
      <p className="mt-1 text-[10px]" style={{ color: 'var(--tinta-suave)' }}>
        {mixto
          ? `Es la porción UPME de este pago de ${fmtCOP(pago.monto)}. El honorario no lleva recibo: se abona solo a la factura del negocio.`
          : 'Es la porción UPME de este pago.'}
        {' '}Si el soporte dice otra cosa, corrige el monto del pago.
      </p>
    </div>
  )
}

/** Un honorario que el abono automático le dejó a Tesorería. Aviso, sin botón. */
export function FilaAbonoAMano({ abono }: { abono: AbonoParaTesoreria }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2"
         style={{ borderColor: '#F0C060', backgroundColor: '#FFFBF0' }}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold" style={{ color: 'var(--tinta)' }}>
            {abono.negocio_codigo ?? '—'}
          </span>
          <span className="truncate text-[12px]" style={{ color: 'var(--tinta-suave)' }}>{abono.cliente ?? '—'}</span>
        </div>
        <div className="text-[11px]" style={{ color: 'var(--tinta-suave)' }}>
          {fmtFecha(abono.fecha)} · pago de {fmtCOP(abono.monto)}
        </div>
      </div>
      <span className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: 'var(--tinta)' }}>
        {fmtCOP(abono.valor)}
      </span>
      <div className="w-full sm:w-auto">
        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#B45309' }}>
          <AlertTriangle className="h-3.5 w-3.5" />
          Abono a mano en Siigo: {abono.motivo}
        </span>
        {abono.detalle && (
          <p className="text-[10px]" style={{ color: 'var(--tinta-suave)' }}>{abono.detalle}</p>
        )}
      </div>
    </div>
  )
}
