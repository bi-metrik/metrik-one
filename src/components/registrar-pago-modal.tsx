'use client'

import { useState, useEffect, useRef, useCallback, useTransition } from 'react'
import { X, Loader2, Wallet, CheckCircle, XCircle, FileUp, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { agregarPagoFab, getNegociosParaPagoFab, negocioPuedeRecibirCobro, type NegocioParaPagoFab } from '@/lib/actions/fab-pago-actions'
import { MENSAJE_HONORARIO_PENDIENTE } from '@/lib/negocios/honorario-confirmado'
import { consultarEpayco } from '@/lib/actions/epayco-actions'
import type { EpaycoDesglose } from '@/lib/epayco'
import { createClient } from '@/lib/supabase/client'
import {
  comprobanteDelPortapapeles,
  motivoRechazoComprobante,
  nombreDeComprobantePegado,
} from '@/lib/cobros/comprobante-pegado'

const VERDE = 'var(--acento)'

/** El negocio al que entra la plata, cuando ya se sabe cuál es. */
export interface NegocioFijadoPago {
  negocio_id: string
  codigo: string | null
  nombre: string | null
}

// ── Modal "Registrar pago" ───────────────────────────
//
// Formulario aislado de captura: negocio + fuente + referencia + valor + fecha. NO abre
// el editor de bloque de la etapa. Escribe por agregarPagoFab, que reusa la vía única
// registrarPagoEnNegocio (misma validación ePayco/duplicado/saldo).
//
// Dos puntos de entrada, un solo formulario:
//   - FAB global        → sin `negocioFijado`, el negocio se elige de la lista.
//   - Bloque Movimientos → `negocioFijado` trae el negocio de la ficha abierta y el
//     selector desaparece. Elegirlo mal es plata imputada a otro proyecto, y en la
//     ficha esa pregunta ya está contestada.

export default function RegistrarPagoModal({
  onClose,
  onDone,
  negocioFijado,
}: {
  onClose: () => void
  onDone: () => void
  negocioFijado?: NegocioFijadoPago
}) {
  const [negocios, setNegocios] = useState<NegocioParaPagoFab[]>([])
  const [loadingNegocios, setLoadingNegocios] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // `null` mientras carga: el formulario no puede decidir si pedir una referencia
  // ePayco o una fuente libre antes de saber si el workspace tiene pasarela.
  const [cobraPorEpayco, setCobraPorEpayco] = useState<boolean | null>(null)
  // El path del comprobante en Storage tiene que empezar por el workspace: lo exige
  // la policy del bucket, no es una convención de nombres.
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)

  const [negocioId, setNegocioId] = useState(negocioFijado?.negocio_id ?? '')
  const [fuente, setFuente] = useState<'epayco' | 'davivienda' | 'otra'>('epayco')
  const [referencia, setReferencia] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState('')
  const [justificacion, setJustificacion] = useState('')
  const [needJust, setNeedJust] = useState(false)
  const [pending, startTransition] = useTransition()

  // Comprobante: OPCIONAL. Un pantallazo de la transferencia ahorra la discusión
  // después, pero exigirlo para poder anotar la plata deja el ingreso sin registrar.
  const [soporte, setSoporte] = useState<{ storage_path: string; file_name: string; mime_type: string } | null>(null)
  const [subiendoSoporte, setSubiendoSoporte] = useState(false)
  const [arrastrando, setArrastrando] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Estado de verificacion ePayco
  const [epaycoStatus, setEpaycoStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [epaycoData, setEpaycoData] = useState<EpaycoDesglose | null>(null)
  const [epaycoError, setEpaycoError] = useState<string | null>(null)

  // ¿El negocio elegido puede recibir el cobro? Se pregunta al elegirlo, no al
  // enviar: el trigger de `cobros` ya rechaza, pero ese rechazo llega después de
  // teclear referencia y valor.
  // Se guarda el ID del negocio bloqueado, no un booleano: al cambiar de negocio
  // el aviso se apaga solo porque el id deja de coincidir, sin quedar prendido
  // por el resultado del anterior mientras la consulta del nuevo está en vuelo.
  const [negocioSinHonorario, setNegocioSinHonorario] = useState<string | null>(null)
  const faltaHonorario = negocioSinHonorario !== null && negocioSinHonorario === negocioId

  // Sin pasarela en el workspace no se enciende ninguna rama de ePayco: ni la
  // verificación contra la API, ni la referencia numérica, ni el bloqueo del botón.
  const esEpayco = cobraPorEpayco === true && fuente === 'epayco'

  useEffect(() => {
    let cancel = false
    getNegociosParaPagoFab().then((res) => {
      if (cancel) return
      if (res.error) setLoadError(res.error)
      else setNegocios(res.negocios)
      setCobraPorEpayco(res.cobraPorEpayco)
      setWorkspaceId(res.workspaceId)
      // Sin pasarela la fuente nace libre: 'epayco' dejaría el formulario pidiendo
      // una ref_payco que en ese workspace no existe.
      if (!res.cobraPorEpayco) setFuente('otra')
      setLoadingNegocios(false)
    })
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    if (!negocioId) return
    let cancel = false
    negocioPuedeRecibirCobro(negocioId).then((res) => {
      if (!cancel && !res.puede) setNegocioSinHonorario(negocioId)
    })
    return () => { cancel = true }
  }, [negocioId])

  // Debounce de verificacion ePayco
  useEffect(() => {
    if (!esEpayco || !referencia || referencia.length < 5) return

    let cancelled = false

    const timer = setTimeout(async () => {
      if (cancelled) return
      setEpaycoStatus('loading')
      const res = await consultarEpayco(referencia, true)
      if (cancelled) return
      if (res.success) {
        setEpaycoStatus('success')
        setEpaycoData(res.data)
        setMonto(String(res.data.monto_bruto))
        const fechaIso = res.data.fecha
          ? new Date(res.data.fecha).toISOString().slice(0, 10)
          : ''
        setFecha(fechaIso)
      } else {
        setEpaycoStatus('error')
        setEpaycoError(res.error)
      }
    }, 600)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [esEpayco, referencia])

  const subirSoporte = useCallback(async (file: File, nombre?: string) => {
    const motivo = motivoRechazoComprobante(file)
    if (motivo) { toast.error(motivo); return }
    if (!workspaceId) { toast.error('Aún no cargó el workspace, intenta de nuevo'); return }
    const fileName = nombre ?? file.name
    setSubiendoSoporte(true)
    try {
      const supabase = createClient()
      const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${workspaceId}/pagos-fab/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from('ve-documentos')
        .upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (error) { toast.error(`No se pudo subir el comprobante: ${error.message}`); return }
      setSoporte({ storage_path: path, file_name: fileName, mime_type: file.type || '' })
    } finally {
      setSubiendoSoporte(false)
    }
  }, [workspaceId])

  // Ctrl+V en cualquier parte del modal. El listener va en el documento y NO en el
  // recuadro: pegar exige tener el foco ahí, y quien acaba de recortar la pantalla no
  // va a hacer clic en una zona antes de pegar. Se registra solo mientras el modal está
  // abierto, así que no le roba el pegado a nada más de la app.
  useEffect(() => {
    function alPegar(e: ClipboardEvent) {
      if (subiendoSoporte) return
      const file = comprobanteDelPortapapeles(e.clipboardData?.items)
      if (!file) return
      // Solo aquí, cuando ya se sabe que lo pegado es un archivo: interceptar antes
      // rompería el pegado normal de texto en la referencia o el valor.
      e.preventDefault()
      void subirSoporte(file, nombreDeComprobantePegado(file))
    }
    document.addEventListener('paste', alPegar)
    return () => document.removeEventListener('paste', alPegar)
  }, [subirSoporte, subiendoSoporte])

  function handleSubmit() {
    if (!negocioId) return toast.error('Elige el negocio')
    if (faltaHonorario) return toast.error(MENSAJE_HONORARIO_PENDIENTE)
    if (cobraPorEpayco && !referencia.trim()) return toast.error('Ingresa la referencia del pago')
    if (esEpayco && epaycoStatus !== 'success') return toast.error('Verifica la referencia ePayco antes de registrar')
    if (!esEpayco && (!Number(monto) || Number(monto) <= 0)) return toast.error('Ingresa el monto del pago')

    startTransition(async () => {
      const res = await agregarPagoFab({
        negocio_id: negocioId,
        fuente,
        referencia: referencia.trim(),
        monto: esEpayco ? undefined : Number(monto),
        fecha: fecha || undefined,
        justificacion: needJust ? justificacion.trim() : undefined,
        soporte_subido: soporte ?? undefined,
      })
      if (res.success) {
        toast.success('Pago registrado')
        onDone()
      } else if (res.code === 'referencia_duplicada') {
        setNeedJust(true)
        toast.error(res.error)
      } else {
        toast.error(res.error)
      }
    })
  }

  // Hasta aquí NO se sabe si el workspace tiene pasarela, y el formulario entero
  // depende de eso: con pasarela pide una ref_payco y la verifica contra la API; sin
  // ella pide de dónde entró la plata y el valor a mano. Pintar una versión y cambiarla
  // al llegar la respuesta le enseña al usuario una pregunta que no era la suya, y en
  // Termotech el salto se veía: primero el bloque de ePayco, después el campo libre.
  // Un "Cargando" es honesto; una pantalla que se corrige sola, no.
  if (cobraPorEpayco === null) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
        <div className="flex w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
          <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4" style={{ color: VERDE }} />
              <h3 className="text-[15px] font-bold" style={{ color: 'var(--tinta)' }}>Registrar pago</h3>
            </div>
            <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" style={{ color: 'var(--tinta-suave)' }} /></button>
          </div>
          <div className="flex items-center gap-2 px-5 py-8 text-[13px]" style={{ color: 'var(--tinta-suave)' }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4" style={{ color: VERDE }} />
            <h3 className="text-[15px] font-bold" style={{ color: 'var(--tinta)' }}>Registrar pago</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" style={{ color: 'var(--tinta-suave)' }} /></button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          {/* Desde la ficha el negocio no se vuelve a preguntar: viene fijado y se
              muestra para que quede claro a dónde entra la plata. */}
          <PagoField label="Negocio">
            {negocioFijado ? (
              <p
                className="rounded-md border px-2.5 py-1.5 text-[13px]"
                style={{ borderColor: '#E5E7EB', backgroundColor: '#F9FAFB', color: 'var(--tinta)' }}
              >
                {negocioFijado.codigo ?? negocioFijado.nombre ?? 'Este negocio'}
                {negocioFijado.codigo && negocioFijado.nombre ? ` · ${negocioFijado.nombre}` : ''}
              </p>
            ) : loadError ? (
              <p className="text-[12px]" style={{ color: '#DC2626' }}>{loadError}</p>
            ) : (
              <select value={negocioId} onChange={(e) => setNegocioId(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }}>
                <option value="">Elige negocio…</option>
                {negocios.map((n) => (
                  <option key={n.negocio_id} value={n.negocio_id}>
                    {(n.codigo ?? n.nombre ?? '')}{n.empresa ? ` · ${n.empresa}` : (n.nombre ? ` · ${n.nombre}` : '')}
                  </option>
                ))}
              </select>
            )}
          </PagoField>

          {faltaHonorario && (
            <div className="rounded-md border px-3 py-2 text-[12px] leading-relaxed" style={{ borderColor: '#FCD34D', backgroundColor: '#FFFBEB', color: '#78350F' }}>
              <span className="font-semibold">Falta confirmar el honorario. </span>
              {MENSAJE_HONORARIO_PENDIENTE}
            </div>
          )}

          {/* La fuente solo se pregunta donde hay pasarela, porque ahí decide el
              camino: ePayco verifica la referencia contra la API. Sin pasarela la
              pregunta no elegía nada, era un campo de texto libre que cada quien
              llenaba distinto; lo que de verdad dice de dónde entró la plata es el
              comprobante adjunto. */}
          {cobraPorEpayco && (
            <PagoField label="Fuente del pago">
              <div className="grid grid-cols-1 gap-2">
                {(['epayco'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      setFuente(f)
                      setNeedJust(false)
                      setEpaycoStatus('idle')
                      setEpaycoData(null)
                      setEpaycoError(null)
                      setMonto('')
                      setFecha('')
                    }}
                    className="rounded-md border px-2 py-1.5 text-[12px] font-semibold transition"
                    style={fuente === f
                      ? { borderColor: VERDE, color: VERDE, backgroundColor: 'var(--acento-tinte)' }
                      : { borderColor: '#E5E7EB', color: 'var(--tinta-suave)' }}
                  >
                    ePayco
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>Los comerciales registran solo pagos por ePayco.</p>
            </PagoField>
          )}

          {/* La referencia es la llave del control de duplicados de ePayco, y ahí se
              teclea del comprobante de la pasarela. Sin pasarela no había nada que
              teclear: el campo salía vacío o con lo que cupiera, y el duplicado que
              debía atrapar no existe. Cuando falta, el servidor genera la referencia
              interna, como ya lo hace el panel de pagos externos. */}
          {cobraPorEpayco && (
            <PagoField label={esEpayco ? 'Referencia ePayco (ref_payco)' : 'Referencia / comprobante'}>
              <div className="relative">
                <input
                  value={referencia}
                  onChange={(e) => {
                  const val = esEpayco ? e.target.value.replace(/[^\d]/g, '') : e.target.value
                  setReferencia(val)
                  if (esEpayco) {
                    setEpaycoStatus('idle')
                    setEpaycoData(null)
                    setEpaycoError(null)
                  }
                }}
                  inputMode={esEpayco ? 'numeric' : 'text'}
                  placeholder={esEpayco ? 'ej. 123456789' : 'ej. comprobante o nº de transacción'}
                  className="w-full rounded-md border px-2.5 py-1.5 pr-8 text-[13px] outline-none"
                  style={{ borderColor: epaycoStatus === 'success' ? VERDE : epaycoStatus === 'error' ? '#DC2626' : '#E5E7EB' }}
                />
                {esEpayco && epaycoStatus === 'loading' && (
                  <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin" style={{ color: '#9CA3AF' }} />
                )}
                {esEpayco && epaycoStatus === 'success' && (
                  <CheckCircle className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: VERDE }} />
                )}
                {esEpayco && epaycoStatus === 'error' && (
                  <XCircle className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: '#DC2626' }} />
                )}
              </div>
              {esEpayco && epaycoStatus === 'idle' && (
                <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>Se valida con ePayco: solo se registra si está Aceptada.</p>
              )}
              {esEpayco && epaycoStatus === 'error' && epaycoError && (
                <p className="mt-1 text-[11px]" style={{ color: '#DC2626' }}>{epaycoError}</p>
              )}
              {esEpayco && epaycoStatus === 'success' && (
                <p className="mt-1 text-[11px] font-medium" style={{ color: VERDE }}>Transaccion ePayco verificada</p>
              )}
            </PagoField>
          )}

          {/* Comprobante: opcional a propósito. El pantallazo de la transferencia es
              lo que evita la discusión tres meses después, pero pedirlo para poder
              anotar la plata deja el ingreso sin registrar. */}
          <PagoField label="Comprobante (opcional)">
            {soporte ? (
              <div
                className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5"
                style={{ borderColor: VERDE, backgroundColor: 'var(--acento-tinte)' }}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px]" style={{ color: 'var(--tinta)' }}>
                  <Paperclip className="h-3.5 w-3.5 shrink-0" style={{ color: VERDE }} />
                  <span className="truncate">{soporte.file_name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setSoporte(null); if (fileRef.current) fileRef.current.value = '' }}
                  className="shrink-0 rounded p-0.5 hover:bg-white"
                  aria-label="Quitar comprobante"
                >
                  <X className="h-3.5 w-3.5" style={{ color: 'var(--tinta-suave)' }} />
                </button>
              </div>
            ) : (
              <label
                onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setArrastrando(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) void subirSoporte(f)
                }}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-2.5 py-3 text-center text-[13px] transition"
                style={arrastrando
                  ? { borderColor: VERDE, backgroundColor: 'var(--acento-tinte)', color: VERDE }
                  : { borderColor: '#E5E7EB', color: 'var(--tinta-suave)' }}
              >
                <span className="flex items-center gap-2">
                  {subiendoSoporte ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                  {subiendoSoporte
                    ? 'Subiendo…'
                    : arrastrando
                      ? 'Suelta el comprobante aquí'
                      : 'Pega el pantallazo con Ctrl+V'}
                </span>
                {!subiendoSoporte && !arrastrando && (
                  <span className="text-[11px]" style={{ color: '#9CA3AF' }}>
                    o arrástralo aquí, o toca para buscarlo
                  </span>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirSoporte(f) }}
                />
              </label>
            )}
            <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>
              Queda guardado junto al pago, en la carpeta del negocio.
            </p>
          </PagoField>

          {esEpayco && epaycoStatus === 'success' && epaycoData && (
            <div className="grid grid-cols-2 gap-3">
              <PagoField label="Valor (ePayco)">
                <input
                  value={Number(monto).toLocaleString('es-CO')}
                  readOnly
                  className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none"
                  style={{ borderColor: VERDE, backgroundColor: 'var(--acento-tinte)', color: 'var(--acento)' }}
                />
              </PagoField>
              <PagoField label="Fecha (ePayco)">
                <input
                  value={fecha}
                  readOnly
                  className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: VERDE, backgroundColor: 'var(--acento-tinte)', color: 'var(--acento)' }}
                />
              </PagoField>
            </div>
          )}

          {!esEpayco && (
            <div className="grid grid-cols-2 gap-3">
              <PagoField label="Valor">
                <input value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="0" className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none" style={{ borderColor: '#E5E7EB' }} />
              </PagoField>
              <PagoField label="Fecha">
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }} />
              </PagoField>
            </div>
          )}

          {needJust && (
            <PagoField label="Justificación (referencia duplicada)">
              <textarea value={justificacion} onChange={(e) => setJustificacion(e.target.value)} rows={2} placeholder="Explica por qué registrar esta referencia que ya existe…" className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: 'var(--advertencia)' }} />
            </PagoField>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] font-semibold" style={{ color: 'var(--tinta-suave)' }}>Cancelar</button>
          <button onClick={handleSubmit} disabled={pending || loadingNegocios || faltaHonorario || (esEpayco && epaycoStatus !== 'success')} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: VERDE }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            Registrar pago
          </button>
        </div>
      </div>
    </div>
  )
}

function PagoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold" style={{ color: '#374151' }}>{label}</span>
      {children}
    </label>
  )
}