'use client'

/**
 * Pestaña "Pago fuera de ePayco" — formulario ARRIBA, registro ABAJO.
 *
 * El listado no es un adorno: hasta el 2026-08-11 esta pantalla solo escribía, y por eso
 * la referencia 378962162 (un pago real de $1.020.000) terminó con $2.040.000 cargados.
 * Quien lo registró la segunda vez no tenía cómo saber que esa referencia ya estaba
 * usada. Ver `lib/cobros/sobreasignacion.ts`.
 *
 * Las cuatro piezas, en el orden en que se ven:
 *   1. La alerta de referencia sobre-asignada aparece mientras se escribe, ANTES de
 *      guardar. NO bloquea repetir la referencia (repartir un pago es legítimo): bloquea
 *      que la suma pase del pago original, y se puede seguir con justificación escrita.
 *   2. El soporte es obligatorio (lo declara el servidor con la config del workspace).
 *   3. El listado muestra referencia, monto, negocio, quién y cuándo, y si hay soporte.
 *   4. Editar corrige lo descriptivo; anular conserva la fila y le quita la plata.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  AlertTriangle, CheckCircle2, ExternalLink, FileUp, Landmark, Loader2, Paperclip,
  Pencil, Search, Ban, X, RefreshCw,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  getPagosExternos,
  getNegociosParaPagoExterno,
  consultarReferencia,
  registrarPagoExterno,
  editarPagoExterno,
  anularPagoExterno,
  type CuentaPagoExterno,
  type EstadoReferenciaConsulta,
  type NegocioParaPagoExterno,
  type PagoExternoFila,
  type PanelPagosExternos,
} from '@/lib/actions/pagos-externos'
import { formatFecha } from '@/lib/dates/bogota'

const VERDE = '#10B981'
const BUCKET = 've-documentos'
const TIPOS_SOPORTE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

function fmtFechaHora(iso: string | null): string {
  return formatFecha(iso, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) ?? '—'
}

export default function PagosExternosTab({ onDone }: { onDone: () => void }) {
  const [panel, setPanel] = useState<PanelPagosExternos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const aplicar = useCallback((res: { data: PanelPagosExternos | null; error?: string }) => {
    if (res.error) setError(res.error)
    else { setError(null); setPanel(res.data) }
    setCargando(false)
  }, [])

  const recargar = useCallback(() => { getPagosExternos().then(aplicar) }, [aplicar])

  useEffect(() => {
    let cancel = false
    getPagosExternos().then((res) => { if (!cancel) aplicar(res) })
    return () => { cancel = true }
  }, [aplicar])

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-[13px]" style={{ color: '#6B7280' }}>
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando pagos…
      </div>
    )
  }
  if (error || !panel) {
    return <p className="text-[13px]" style={{ color: '#DC2626' }}>{error ?? 'No se pudo cargar el panel'}</p>
  }

  return (
    <div className="space-y-8">
      <FormularioPago
        panel={panel}
        onRegistrado={() => { recargar(); onDone() }}
      />
      <ListadoPagos
        panel={panel}
        onCambio={() => { recargar(); onDone() }}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// FORMULARIO
// ════════════════════════════════════════════════════════════════════════════

function FormularioPago({ panel, onRegistrado }: { panel: PanelPagosExternos; onRegistrado: () => void }) {
  const hoyBogota = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

  const [negocios, setNegocios] = useState<NegocioParaPagoExterno[]>([])
  const [cargandoNegocios, setCargandoNegocios] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [negocioId, setNegocioId] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoyBogota)
  const [fuente, setFuente] = useState(panel.cuentas[0]?.valor ?? 'davivienda')
  const [referencia, setReferencia] = useState('')
  const [totalPago, setTotalPago] = useState('')
  const [soporte, setSoporte] = useState<{ storage_path: string; file_name: string; mime_type: string } | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [estadoRef, setEstadoRef] = useState<EstadoReferenciaConsulta | null>(null)
  const [consultando, setConsultando] = useState(false)
  const [justificacion, setJustificacion] = useState('')
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancel = false
    getNegociosParaPagoExterno().then((res) => {
      if (cancel) return
      if (res.error) setLoadError(res.error)
      else setNegocios(res.negocios)
      setCargandoNegocios(false)
    })
    return () => { cancel = true }
  }, [])

  // La alerta vive donde sirve: mientras se escribe. El servidor la vuelve a evaluar al
  // guardar — esto es ayuda, no control.
  useEffect(() => {
    const ref = referencia.trim()
    if (!ref) { setEstadoRef(null); return }
    let cancel = false
    setConsultando(true)
    const t = setTimeout(() => {
      consultarReferencia(ref, Number(monto) || 0, Number(totalPago) || 0).then((res) => {
        if (cancel) return
        setEstadoRef(res.data ?? null)
        setConsultando(false)
      })
    }, 400)
    return () => { cancel = true; clearTimeout(t) }
  }, [referencia, monto, totalPago])

  const seleccionado = useMemo(
    () => negocios.find((n) => n.negocio_id === negocioId) ?? null,
    [negocios, negocioId],
  )
  const query = q.trim().toLowerCase()
  const resultados = useMemo(() => {
    if (!query) return []
    return negocios
      .filter((n) => [n.codigo, n.nombre, n.empresa].filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query)))
      .slice(0, 8)
  }, [negocios, query])

  async function subirSoporte(file: File) {
    if (file.type && !TIPOS_SOPORTE.includes(file.type)) {
      toast.error('El soporte debe ser PDF, JPG, PNG o WebP')
      return
    }
    setSubiendo(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
      // La primera carpeta DEBE ser el workspace: es lo que exige la policy del bucket.
      const path = `${panel.workspace_id}/pagos-externos/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) { toast.error(`No se pudo subir el soporte: ${upErr.message}`); return }
      setSoporte({ storage_path: path, file_name: file.name, mime_type: file.type || '' })
    } finally {
      setSubiendo(false)
    }
  }

  const sobreasignada = estadoRef?.estado === 'sobreasignada'

  function limpiar() {
    setNegocioId(''); setQ(''); setMonto(''); setFecha(hoyBogota)
    setFuente(panel.cuentas[0]?.valor ?? 'davivienda')
    setReferencia(''); setTotalPago(''); setSoporte(null); setEstadoRef(null); setJustificacion('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function registrar() {
    if (!negocioId) return toast.error('Elige el negocio al que cae el pago')
    const valor = Number(monto)
    if (!Number.isFinite(valor) || valor <= 0) return toast.error('Ingresa el valor del pago')
    if (panel.soporte_obligatorio && !soporte) return toast.error('Adjunta el soporte del pago')
    if (sobreasignada && justificacion.trim().length < 10) {
      return toast.error('Escribe por qué este registro es correcto pese a superar el pago original')
    }

    startTransition(async () => {
      const res = await registrarPagoExterno({
        negocio_id: negocioId,
        monto: valor,
        fecha: fecha || undefined,
        fuente,
        referencia: referencia.trim() || undefined,
        total_pago: Number(totalPago) || undefined,
        soporte: soporte ?? undefined,
        confirmar_sobreasignacion: sobreasignada,
        justificacion: justificacion.trim() || undefined,
      })
      if (res.success) {
        toast.success('Pago registrado')
        limpiar()
        onRegistrado()
      } else {
        if (res.code === 'referencia_sobreasignada' && res.referencia) setEstadoRef(res.referencia)
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="max-w-xl">
      <div className="mb-4 rounded-lg border px-4 py-3" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }}>
        <div className="flex items-center gap-1.5">
          <Landmark className="h-4 w-4" style={{ color: '#B45309' }} />
          <h2 className="text-[13px] font-bold" style={{ color: '#92400E' }}>Registro excepcional</h2>
        </div>
        <p className="mt-1 text-[12px]" style={{ color: '#92400E' }}>
          Solo para el dinero que entró a una cuenta bancaria y no por ePayco. Se registra el
          valor contra el negocio y queda con su soporte. No reparte ni concilia: eso se hace
          en la pestaña &quot;Por confirmar&quot;.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border bg-white p-4" style={{ borderColor: '#E5E7EB' }}>
        {/* Negocio.
            NO es un <label>: adentro hay un input y además la lista de resultados, que
            son <button>. Un <label> se asocia al primer control labelable que contiene y
            reenvía hacia él los clics de todo lo que envuelve. */}
        <div className="block">
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Negocio</span>
          {cargandoNegocios ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: '#6B7280' }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando negocios…
            </div>
          ) : loadError ? (
            <p className="text-[12px]" style={{ color: '#DC2626' }}>{loadError}</p>
          ) : seleccionado ? (
            <div className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5" style={{ borderColor: VERDE, backgroundColor: '#ECFDF5' }}>
              <span className="min-w-0 truncate text-[13px]">
                <span className="font-semibold" style={{ color: '#1A1A1A' }}>{seleccionado.codigo ?? '—'}</span>
                <span style={{ color: '#6B7280' }}> · {seleccionado.empresa ?? seleccionado.nombre ?? ''}</span>
              </span>
              <button onClick={() => { setNegocioId(''); setQ('') }} className="shrink-0 rounded p-0.5 hover:bg-white" aria-label="Cambiar negocio">
                <X className="h-3.5 w-3.5" style={{ color: '#6B7280' }} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: '#E5E7EB' }}>
                <Search className="h-4 w-4" style={{ color: '#9CA3AF' }} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Busca por código, empresa o nombre…"
                  className="w-full text-[13px] outline-none"
                  style={{ color: '#1A1A1A' }}
                />
              </div>
              {query && (
                resultados.length === 0 ? (
                  <p className="mt-1.5 text-[12px]" style={{ color: '#9CA3AF' }}>Sin resultados.</p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {resultados.map((n) => (
                      <button
                        key={n.negocio_id}
                        onClick={() => setNegocioId(n.negocio_id)}
                        className="block w-full rounded-md border px-2.5 py-1.5 text-left text-[13px] transition hover:bg-gray-50"
                        style={{ borderColor: '#E5E7EB' }}
                      >
                        <span className="font-semibold" style={{ color: '#1A1A1A' }}>{n.codigo ?? '—'}</span>
                        <span style={{ color: '#6B7280' }}> · {n.empresa ?? n.nombre ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </div>

        {/* Valor + fecha */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Valor</span>
            <input
              value={monto}
              onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="ej. 1500000"
              className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none"
              style={{ borderColor: '#E5E7EB' }}
            />
            {Number(monto) > 0 && (
              <p className="mt-1 text-right text-[11px] font-semibold" style={{ color: VERDE }}>{fmtCOP(Number(monto))}</p>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Fecha del pago</span>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ borderColor: '#E5E7EB' }}
            />
          </label>
        </div>

        {/* Cuenta */}
        <div>
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>¿A qué cuenta entró?</span>
          <div className="grid grid-cols-2 gap-2">
            {panel.cuentas.map((c: CuentaPagoExterno) => (
              <button
                key={c.valor}
                onClick={() => setFuente(c.valor)}
                className="rounded-md border px-2 py-1.5 text-[12px] font-semibold transition"
                style={fuente === c.valor
                  ? { borderColor: VERDE, color: VERDE, backgroundColor: '#ECFDF5' }
                  : { borderColor: '#E5E7EB', color: '#6B7280' }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Referencia + total del pago */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>
              Referencia <span className="font-normal" style={{ color: '#9CA3AF' }}>(opcional)</span>
            </span>
            <input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value.slice(0, panel.max_largo_referencia))}
              placeholder="N.º de consignación o comprobante"
              maxLength={panel.max_largo_referencia}
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ borderColor: '#E5E7EB' }}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>
              Valor total del pago <span className="font-normal" style={{ color: '#9CA3AF' }}>(si se reparte)</span>
            </span>
            <input
              value={totalPago}
              onChange={(e) => setTotalPago(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="igual al valor"
              className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none"
              style={{ borderColor: '#E5E7EB' }}
            />
          </label>
        </div>
        <p className="-mt-2 text-[11px]" style={{ color: '#9CA3AF' }}>
          Sin referencia el sistema genera una interna. Repetir una referencia SÍ se permite
          (un pago se puede repartir entre varios negocios); lo que se controla es que la suma
          registrada no supere el pago original.
        </p>

        {/* Estado de la referencia — la alerta, antes de guardar */}
        {referencia.trim() && (
          <PanelReferencia estado={estadoRef} consultando={consultando} />
        )}

        {sobreasignada && (
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#B91C1C' }}>
              Justificación (obligatoria para registrar por encima del pago original)
            </span>
            <textarea
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value.slice(0, 300))}
              rows={2}
              placeholder="Por qué este registro es correcto…"
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ borderColor: '#FCA5A5' }}
            />
          </label>
        )}

        {/* Soporte */}
        <div>
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>
            Soporte del pago{panel.soporte_obligatorio && <span style={{ color: '#DC2626' }}> *</span>}
          </span>
          {soporte ? (
            <div className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5" style={{ borderColor: VERDE, backgroundColor: '#ECFDF5' }}>
              <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px]" style={{ color: '#1A1A1A' }}>
                <Paperclip className="h-3.5 w-3.5 shrink-0" style={{ color: VERDE }} />
                <span className="truncate">{soporte.file_name}</span>
              </span>
              <button
                onClick={() => { setSoporte(null); if (fileRef.current) fileRef.current.value = '' }}
                className="shrink-0 rounded p-0.5 hover:bg-white"
                aria-label="Quitar soporte"
              >
                <X className="h-3.5 w-3.5" style={{ color: '#6B7280' }} />
              </button>
            </div>
          ) : (
            <label
              className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-[13px] transition hover:bg-gray-50"
              style={{ borderColor: '#E5E7EB', color: '#6B7280' }}
            >
              {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {subiendo ? 'Subiendo…' : 'Adjuntar comprobante (PDF, JPG, PNG)'}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirSoporte(f) }}
              />
            </label>
          )}
          {panel.soporte_obligatorio && (
            <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>
              Cuando el pago no entra por la pasarela, el comprobante es el único respaldo que existe.
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button
            onClick={registrar}
            disabled={pending || cargandoNegocios || subiendo}
            className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: sobreasignada ? '#DC2626' : VERDE }}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {sobreasignada ? 'Registrar de todos modos' : 'Registrar pago'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PanelReferencia({ estado, consultando }: { estado: EstadoReferenciaConsulta | null; consultando: boolean }) {
  if (consultando && !estado) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px]" style={{ borderColor: '#E5E7EB', color: '#6B7280' }}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Revisando la referencia…
      </div>
    )
  }
  if (!estado) return null

  if (estado.porciones.length === 0) {
    return (
      <div className="rounded-md border px-2.5 py-2 text-[12px]" style={{ borderColor: '#D1FAE5', backgroundColor: '#ECFDF5', color: '#047857' }}>
        Referencia libre: no hay nada registrado con <strong>{estado.referencia_label}</strong>.
      </div>
    )
  }

  const alerta = estado.estado === 'sobreasignada'
  const colores = alerta
    ? { borde: '#FCA5A5', fondo: '#FEF2F2', texto: '#B91C1C' }
    : estado.estado === 'incompleta'
      ? { borde: '#FDE68A', fondo: '#FFFBEB', texto: '#92400E' }
      : { borde: '#E5E7EB', fondo: '#F9FAFB', texto: '#374151' }

  return (
    <div className="rounded-md border px-2.5 py-2" style={{ borderColor: colores.borde, backgroundColor: colores.fondo }}>
      <div className="flex items-start gap-1.5">
        {alerta && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colores.texto }} />}
        <div className="min-w-0 text-[12px]" style={{ color: colores.texto }}>
          <p className="font-semibold">
            {alerta
              ? `Esta referencia quedaría ${fmtCOP(estado.excedente)} por encima del pago original.`
              : estado.estado === 'incompleta'
                ? `Faltan ${fmtCOP(estado.sin_asignar)} por asignar de este pago.`
                : 'La referencia ya tiene registros.'}
          </p>
          <p className="mt-0.5">
            Pago declarado {fmtCOP(estado.total)} · ya registrados {fmtCOP(estado.asignado)}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {estado.porciones.map((p, i) => (
              <li key={i} className="tabular-nums">
                {p.negocio_codigo ?? '—'} · {fmtCOP(p.monto)} · {p.fecha ?? 's/f'} · {p.fuente ?? '—'}
              </li>
            ))}
          </ul>
          {alerta && (
            <p className="mt-1.5">
              Repetir una referencia es normal cuando un pago se reparte. Lo que no cuadra es
              el monto: revisa si este pago ya se registró.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// LISTADO
// ════════════════════════════════════════════════════════════════════════════

function ListadoPagos({ panel, onCambio }: { panel: PanelPagosExternos; onCambio: () => void }) {
  const [verAnulados, setVerAnulados] = useState(false)
  const visibles = panel.pagos.filter((p) => verAnulados || !p.anulado)
  const anulados = panel.pagos.filter((p) => p.anulado).length

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold" style={{ color: '#1A1A1A' }}>
          Pagos registrados fuera de ePayco
          <span className="ml-1.5 font-normal" style={{ color: '#6B7280' }}>({visibles.length})</span>
        </h2>
        {anulados > 0 && (
          <button
            onClick={() => setVerAnulados((v) => !v)}
            className="text-[12px] font-semibold underline-offset-2 hover:underline"
            style={{ color: '#6B7280' }}
          >
            {verAnulados ? 'Ocultar anulados' : `Ver anulados (${anulados})`}
          </button>
        )}
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-[13px]" style={{ borderColor: '#E5E7EB', color: '#6B7280' }}>
          Todavía no hay pagos registrados fuera de ePayco.
        </p>
      ) : (
        <div className="space-y-2">
          {visibles.map((p) => (
            <FilaPago key={p.cobro_id} pago={p} panel={panel} onCambio={onCambio} />
          ))}
        </div>
      )}
    </div>
  )
}

function FilaPago({ pago, panel, onCambio }: { pago: PagoExternoFila; panel: PanelPagosExternos; onCambio: () => void }) {
  const [modo, setModo] = useState<'ver' | 'editar' | 'anular'>('ver')

  return (
    <div
      className="rounded-lg border bg-white p-3"
      style={{ borderColor: pago.anulado ? '#E5E7EB' : pago.ref_estado === 'sobreasignada' ? '#FCA5A5' : '#E5E7EB', opacity: pago.anulado ? 0.72 : 1 }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="text-[13px] font-bold tabular-nums"
              style={{ color: '#1A1A1A', textDecoration: pago.anulado ? 'line-through' : 'none' }}
            >
              {fmtCOP(pago.monto)}
            </span>
            {pago.negocio_id ? (
              <Link
                href={`/negocios/${pago.negocio_id}`}
                className="inline-flex items-center gap-0.5 text-[12px] font-semibold hover:underline"
                style={{ color: VERDE }}
              >
                {pago.negocio_codigo ?? 'negocio'} <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              <span className="text-[12px]" style={{ color: '#9CA3AF' }}>sin negocio</span>
            )}
            {pago.anulado && <Chip texto="ANULADO" fondo="#F3F4F6" color="#6B7280" />}
            {!pago.anulado && pago.ref_estado === 'sobreasignada' && (
              <Chip texto={`Sobre-asignada +${fmtCOP(pago.ref_excedente)}`} fondo="#FEF2F2" color="#B91C1C" icono />
            )}
            {!pago.anulado && pago.ref_estado === 'incompleta' && (
              <Chip texto={`Sin asignar ${fmtCOP(pago.ref_sin_asignar)}`} fondo="#FFFBEB" color="#92400E" />
            )}
            {!pago.anulado && pago.ref_negocios > 1 && (
              <Chip texto={`Repartida entre ${pago.ref_negocios}`} fondo="#EFF6FF" color="#1D4ED8" />
            )}
          </div>

          <p className="mt-1 text-[12px]" style={{ color: '#6B7280' }}>
            {pago.empresa ?? pago.negocio_nombre ?? '—'}
          </p>

          <p className="mt-1 text-[11px]" style={{ color: '#6B7280' }}>
            Ref <strong style={{ color: '#374151' }}>{pago.referencia_autogenerada ? 'interna' : pago.referencia_label}</strong>
            {' · '}{pago.fuente ?? '—'}
            {' · '}pago {pago.fecha ?? 's/f'}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: '#9CA3AF' }}>
            Cargado por {pago.registrado_por ?? '—'} el {fmtFechaHora(pago.registrado_en)}
          </p>

          {pago.anulado && (
            <p className="mt-1 text-[11px]" style={{ color: '#B91C1C' }}>
              Anulado por {pago.anulado_por ?? '—'} el {fmtFechaHora(pago.anulado_en)} — {pago.anulacion_motivo}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {pago.soporte ? (
            <a
              href={pago.soporte.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline"
              style={{ color: VERDE }}
            >
              <Paperclip className="h-3.5 w-3.5" /> Soporte
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: '#B45309' }}>
              <AlertTriangle className="h-3.5 w-3.5" /> Sin soporte
            </span>
          )}

          {panel.puede_gestionar && !pago.anulado && modo === 'ver' && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setModo('editar')}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition hover:bg-gray-50"
                style={{ borderColor: '#E5E7EB', color: '#374151' }}
              >
                <Pencil className="h-3 w-3" /> Corregir
              </button>
              <button
                onClick={() => setModo('anular')}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition hover:bg-red-50"
                style={{ borderColor: '#FCA5A5', color: '#B91C1C' }}
              >
                <Ban className="h-3 w-3" /> Anular
              </button>
            </div>
          )}
        </div>
      </div>

      {modo === 'editar' && (
        <FormEditar pago={pago} panel={panel} onCerrar={() => setModo('ver')} onGuardado={() => { setModo('ver'); onCambio() }} />
      )}
      {modo === 'anular' && (
        <FormAnular pago={pago} panel={panel} onCerrar={() => setModo('ver')} onAnulado={() => { setModo('ver'); onCambio() }} />
      )}
    </div>
  )
}

function Chip({ texto, fondo, color, icono }: { texto: string; fondo: string; color: string; icono?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: fondo, color }}
    >
      {icono && <AlertTriangle className="h-3 w-3" />}
      {texto}
    </span>
  )
}

function FormEditar({
  pago, panel, onCerrar, onGuardado,
}: { pago: PagoExternoFila; panel: PanelPagosExternos; onCerrar: () => void; onGuardado: () => void }) {
  const [fecha, setFecha] = useState(pago.fecha ?? '')
  const [fuente, setFuente] = useState(pago.fuente ?? panel.cuentas[0]?.valor ?? '')
  const [referencia, setReferencia] = useState(pago.referencia_autogenerada ? '' : pago.referencia_label)
  const [notas, setNotas] = useState(pago.notas ?? '')
  const [confirmar, setConfirmar] = useState(false)
  const [pending, startTransition] = useTransition()

  function guardar() {
    startTransition(async () => {
      const res = await editarPagoExterno({
        cobro_id: pago.cobro_id,
        fecha: fecha || undefined,
        fuente: fuente || undefined,
        referencia: referencia.trim() ? referencia.trim() : undefined,
        notas,
        confirmar_sobreasignacion: confirmar,
      })
      if (res.success) { toast.success('Pago corregido'); onGuardado() }
      else {
        if (res.code === 'referencia_sobreasignada') setConfirmar(true)
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border p-3" style={{ borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' }}>
      <p className="text-[11px]" style={{ color: '#6B7280' }}>
        El <strong>monto</strong> y el <strong>negocio</strong> no se editan: los dos mueven plata.
        Para cambiarlos, anula este pago y regístralo de nuevo — así quedan las dos filas.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Fecha del pago</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            className="w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Cuenta</span>
          <select value={fuente} onChange={(e) => setFuente(e.target.value)}
            className="w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }}>
            {panel.cuentas.map((c) => <option key={c.valor} value={c.valor}>{c.label}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Referencia</span>
        <input value={referencia} onChange={(e) => setReferencia(e.target.value.slice(0, panel.max_largo_referencia))}
          placeholder="N.º de consignación o comprobante"
          className="w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Nota</span>
        <input value={notas} onChange={(e) => setNotas(e.target.value.slice(0, 500))}
          className="w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }} />
      </label>
      {confirmar && (
        <p className="text-[11px] font-semibold" style={{ color: '#B91C1C' }}>
          La referencia destino queda sobre-asignada. Vuelve a guardar para confirmarlo.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onCerrar} className="rounded-md border px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: '#E5E7EB', color: '#6B7280' }}>
          Cancelar
        </button>
        <button onClick={guardar} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: VERDE }}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Guardar
        </button>
      </div>
    </div>
  )
}

function FormAnular({
  pago, panel, onCerrar, onAnulado,
}: { pago: PagoExternoFila; panel: PanelPagosExternos; onCerrar: () => void; onAnulado: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [pending, startTransition] = useTransition()

  function anular() {
    if (motivo.trim().length < panel.min_largo_motivo) {
      return toast.error(`Escribe el motivo (mínimo ${panel.min_largo_motivo} caracteres)`)
    }
    startTransition(async () => {
      const res = await anularPagoExterno(pago.cobro_id, motivo)
      if (res.success) { toast.success('Pago anulado'); onAnulado() }
      else toast.error(res.error)
    })
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border p-3" style={{ borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }}>
      <p className="text-[12px]" style={{ color: '#B91C1C' }}>
        Anular <strong>{fmtCOP(pago.monto)}</strong>. La fila se conserva con tu nombre, la fecha y
        el motivo; el negocio deja de contar esa plata y, si algún paso se había habilitado
        solo por ese saldo, se vuelve a exigir.
      </p>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#7F1D1D' }}>Motivo</span>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value.slice(0, 300))}
          rows={2}
          placeholder="ej. se cargó dos veces la misma consignación"
          className="w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none"
          style={{ borderColor: '#FCA5A5' }}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onCerrar} className="rounded-md border bg-white px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: '#E5E7EB', color: '#6B7280' }}>
          Cancelar
        </button>
        <button onClick={anular} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: '#DC2626' }}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Anular pago
        </button>
      </div>
    </div>
  )
}
