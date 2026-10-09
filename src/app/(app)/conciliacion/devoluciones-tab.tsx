'use client'

/**
 * Tesorería → Devoluciones (SOE-007).
 *
 * «Registrar devolución» es UNA acción: negocio, fecha, valor, motivo, soporte opcional y la
 * casilla «cerrar el caso», que cierra el negocio como perdido en la misma operación. La
 * devolución es una salida propia en su fecha: el cobro original no se toca (para eso NO sirve
 * anular, que borraría un ingreso que sí entró).
 *
 * Lo ve quien entra a Tesorería; registrar lo decide el servidor (`ctxPagosExternos`: área
 * financiera, más owner/admin).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { CheckCircle2, FileUp, Loader2, Paperclip, Search, Undo2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  getPanelDevoluciones,
  registrarDevolucionDinero,
  type DevolucionFila,
  type NegocioDevolvible,
  type PanelDevoluciones,
} from '@/lib/actions/devoluciones-dinero'
import {
  MOTIVO_DEVOLUCION_MIN,
  RAZONES_CIERRE_DEVOLUCION,
  validarDevolucion,
} from '@/lib/cobros/devolucion-dinero'
import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'
import { BUCKET_DOCUMENTOS_ONE, hrefArchivo } from '@/lib/almacenamiento/referencia'
import { useIntencion } from '@/hooks/use-intencion'

const VERDE = 'var(--acento)'
const TIPOS_SOPORTE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

export default function DevolucionesTab({ onDone }: { onDone: () => void }) {
  const [panel, setPanel] = useState<PanelDevoluciones | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const aplicar = useCallback((res: { data: PanelDevoluciones | null; error?: string }) => {
    if (res.error) setError(res.error)
    else { setError(null); setPanel(res.data) }
    setCargando(false)
  }, [])

  useEffect(() => {
    let cancel = false
    getPanelDevoluciones().then((res) => { if (!cancel) aplicar(res) })
    return () => { cancel = true }
  }, [aplicar])

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--tinta-suave)' }}>
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando devoluciones…
      </div>
    )
  }
  if (error || !panel) {
    return <p className="text-[13px]" style={{ color: '#DC2626' }}>{error ?? 'No se pudo cargar el panel'}</p>
  }

  return (
    <div className="space-y-8">
      <FormularioDevolucion
        panel={panel}
        onRegistrado={() => { getPanelDevoluciones().then(aplicar); onDone() }}
      />
      <ListadoDevoluciones devoluciones={panel.devoluciones} />
    </div>
  )
}

function FormularioDevolucion({ panel, onRegistrado }: { panel: PanelDevoluciones; onRegistrado: () => void }) {
  const hoyBogota = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  const intencion = useIntencion()
  const [q, setQ] = useState('')
  const [negocioId, setNegocioId] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoyBogota)
  const [motivo, setMotivo] = useState('')
  const [cerrar, setCerrar] = useState(false)
  const [razon, setRazon] = useState('desistio')
  const [soporte, setSoporte] = useState<{ storage_path: string; file_name: string; mime_type: string } | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const seleccionado: NegocioDevolvible | null = useMemo(
    () => panel.negocios.find((n) => n.negocio_id === negocioId) ?? null,
    [panel.negocios, negocioId],
  )
  const abierto = seleccionado ? seleccionado.estado === 'abierto' : undefined
  const query = q.trim().toLowerCase()
  const resultados = useMemo(() => {
    if (!query) return []
    return panel.negocios
      .filter((n) => [n.codigo, n.nombre, n.empresa].filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query)))
      .slice(0, 8)
  }, [panel.negocios, query])

  async function subirSoporte(file: File) {
    if (file.type && !TIPOS_SOPORTE.includes(file.type)) {
      toast.error('El soporte debe ser PDF, JPG, PNG o WebP')
      return
    }
    setSubiendo(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
      // La primera carpeta DEBE ser el workspace: lo exige la policy del bucket y la puerta
      // que abre el archivo.
      const path = `${panel.workspace_id}/devoluciones/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from(BUCKET_DOCUMENTOS_ONE)
        .upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) { toast.error(`No se pudo subir el soporte: ${upErr.message}`); return }
      setSoporte({ storage_path: path, file_name: file.name, mime_type: file.type || '' })
    } finally {
      setSubiendo(false)
    }
  }

  function limpiar() {
    setNegocioId(''); setQ(''); setMonto(''); setFecha(hoyBogota); setMotivo('')
    setCerrar(false); setRazon('desistio'); setSoporte(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function registrar() {
    const entrada = {
      negocio_id: negocioId,
      monto: Number(monto),
      fecha,
      motivo: motivo.trim(),
      cerrar_caso: cerrar,
      razon_cierre: cerrar && abierto ? razon : undefined,
    }
    const error = validarDevolucion(entrada, hoyBogota, { neto: seleccionado?.neto, abierto })
    if (error) return toast.error(error)

    startTransition(async () => {
      const res = await registrarDevolucionDinero({ ...entrada, soporte: soporte ?? undefined }, intencion.clave())
      intencion.cerrar()
      if (res.success) {
        toast.success(
          res.cerro_caso
            ? 'Devolución registrada y caso cerrado'
            : res.ya_cerrado
              ? 'Devolución registrada. El caso ya estaba cerrado'
              : 'Devolución registrada',
        )
        limpiar()
        onRegistrado()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="max-w-xl">
      <div className="mb-4 rounded-lg border px-4 py-3" style={{ borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' }}>
        <div className="flex items-center gap-1.5">
          <Undo2 className="h-4 w-4" style={{ color: 'var(--tinta)' }} />
          <h2 className="text-[13px] font-bold" style={{ color: 'var(--tinta)' }}>Registrar devolución</h2>
        </div>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--tinta-suave)' }}>
          Dinero que se le devolvió al cliente. Queda como una salida en la fecha de la
          devolución: el pago original no se modifica y los meses anteriores no cambian. Resta
          del recaudo del mes en que se devolvió.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border bg-white p-4" style={{ borderColor: '#E5E7EB' }}>
        {/* Negocio. No es un <label>: adentro hay botones (ver pagos-externos-tab). */}
        <div className="block">
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Negocio</span>
          {seleccionado ? (
            <div className="rounded-md border px-2.5 py-1.5" style={{ borderColor: VERDE, backgroundColor: 'var(--acento-tinte)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[13px]">
                  <span className="font-semibold" style={{ color: 'var(--tinta)' }}>{seleccionado.codigo ?? '—'}</span>
                  <span style={{ color: 'var(--tinta-suave)' }}> · {seleccionado.empresa ?? seleccionado.nombre ?? ''}</span>
                </span>
                <button onClick={() => { setNegocioId(''); setQ('') }} className="shrink-0 rounded p-0.5 hover:bg-white" aria-label="Cambiar negocio">
                  <X className="h-3.5 w-3.5" style={{ color: 'var(--tinta-suave)' }} />
                </button>
              </div>
              <p className="mt-0.5 text-[11px] tabular-nums" style={{ color: 'var(--tinta-suave)' }}>
                Cobrado {fmtCOP(seleccionado.cobrado)}
                {seleccionado.devuelto > 0 && <> · Devuelto {fmtCOP(seleccionado.devuelto)}</>}
                {' '}· <strong style={{ color: 'var(--tinta)' }}>Recaudado neto {fmtCOP(seleccionado.neto)}</strong>
                {!abierto && <> · Caso {seleccionado.estado}</>}
              </p>
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
                  style={{ color: 'var(--tinta)' }}
                />
              </div>
              {query && (
                resultados.length === 0 ? (
                  <p className="mt-1.5 text-[12px]" style={{ color: '#9CA3AF' }}>
                    Sin resultados. Solo aparecen negocios con dinero recaudado por devolver.
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {resultados.map((n) => (
                      <button
                        key={n.negocio_id}
                        onClick={() => setNegocioId(n.negocio_id)}
                        className="flex w-full items-center justify-between gap-3 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition hover:bg-gray-50"
                        style={{ borderColor: '#E5E7EB' }}
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-semibold" style={{ color: 'var(--tinta)' }}>{n.codigo ?? '—'}</span>
                          <span style={{ color: 'var(--tinta-suave)' }}> · {n.empresa ?? n.nombre ?? ''}</span>
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--tinta-suave)' }}>
                          neto {fmtCOP(n.neto)}
                        </span>
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
            <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Valor devuelto</span>
            <input
              value={monto}
              onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="ej. 637500"
              className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none"
              style={{ borderColor: '#E5E7EB' }}
            />
            {Number(monto) > 0 && (
              <p className="mt-1 text-right text-[11px] font-semibold" style={{ color: 'var(--tinta)' }}>{fmtCOP(Number(monto))}</p>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Fecha de la devolución</span>
            <input
              type="date"
              value={fecha}
              max={hoyBogota}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ borderColor: '#E5E7EB' }}
            />
          </label>
        </div>

        {/* Motivo */}
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Motivo</span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value.slice(0, 500))}
            rows={2}
            placeholder={`Por qué se devolvió el dinero (mínimo ${MOTIVO_DEVOLUCION_MIN} caracteres)`}
            className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
            style={{ borderColor: '#E5E7EB' }}
          />
        </label>

        {/* Soporte (opcional) */}
        <div>
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>
            Soporte <span className="font-normal" style={{ color: '#9CA3AF' }}>(opcional)</span>
          </span>
          {soporte ? (
            <div className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5" style={{ borderColor: VERDE, backgroundColor: 'var(--acento-tinte)' }}>
              <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px]" style={{ color: 'var(--tinta)' }}>
                <Paperclip className="h-3.5 w-3.5 shrink-0" style={{ color: VERDE }} />
                <span className="truncate">{soporte.file_name}</span>
              </span>
              <button
                onClick={() => { setSoporte(null); if (fileRef.current) fileRef.current.value = '' }}
                className="shrink-0 rounded p-0.5 hover:bg-white"
                aria-label="Quitar soporte"
              >
                <X className="h-3.5 w-3.5" style={{ color: 'var(--tinta-suave)' }} />
              </button>
            </div>
          ) : (
            <label
              className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-[13px] transition hover:bg-gray-50"
              style={{ borderColor: '#E5E7EB', color: 'var(--tinta-suave)' }}
            >
              {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {subiendo ? 'Subiendo…' : 'Adjuntar comprobante de la devolución (PDF, JPG, PNG)'}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirSoporte(f) }}
              />
            </label>
          )}
        </div>

        {/* Cerrar el caso */}
        <div className="rounded-md border px-3 py-2.5" style={{ borderColor: '#E5E7EB' }}>
          <label className="flex cursor-pointer items-start gap-2 text-[13px]" style={{ color: 'var(--tinta)' }}>
            <input
              type="checkbox"
              checked={cerrar}
              onChange={(e) => setCerrar(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-semibold">Cerrar el caso</span>
              <span className="block text-[11px]" style={{ color: 'var(--tinta-suave)' }}>
                Cierra el negocio como perdido en la misma operación y lo deja en el historial.
              </span>
            </span>
          </label>
          {cerrar && seleccionado && !abierto && (
            <p className="mt-2 text-[12px]" style={{ color: 'var(--tinta-suave)' }}>
              Este caso ya está cerrado ({seleccionado.estado}): no se vuelve a cerrar.
            </p>
          )}
          {cerrar && abierto !== false && (
            <label className="mt-2 block">
              <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Razón del cierre</span>
              <select
                value={razon}
                onChange={(e) => setRazon(e.target.value)}
                className="w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none"
                style={{ borderColor: '#E5E7EB' }}
              >
                {RAZONES_CIERRE_DEVOLUCION.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex justify-end">
          <button
            onClick={registrar}
            disabled={pending || subiendo}
            className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: VERDE }}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Registrar devolución
          </button>
        </div>
      </div>
    </div>
  )
}

function ListadoDevoluciones({ devoluciones }: { devoluciones: DevolucionFila[] }) {
  return (
    <div>
      <h2 className="mb-2 text-[13px] font-bold" style={{ color: 'var(--tinta)' }}>
        Devoluciones registradas
        <span className="ml-1.5 font-normal" style={{ color: 'var(--tinta-suave)' }}>({devoluciones.length})</span>
      </h2>
      {devoluciones.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-[13px]" style={{ borderColor: '#E5E7EB', color: 'var(--tinta-suave)' }}>
          Todavía no hay devoluciones registradas.
        </p>
      ) : (
        <div className="space-y-2">
          {devoluciones.map((d) => <FilaDevolucion key={d.id} d={d} />)}
        </div>
      )}
    </div>
  )
}

export function FilaDevolucion({ d }: { d: DevolucionFila }) {
  const soporteHref = hrefArchivo(d.soporte_url)
  return (
    <div className="rounded-lg border bg-white px-3 py-2.5" style={{ borderColor: '#E5E7EB' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px]">
          <Link href={`/negocios/${d.negocio_id}`} className="font-semibold hover:underline" style={{ color: 'var(--tinta)' }}>
            {d.codigo ?? '—'}
          </Link>
          <span style={{ color: 'var(--tinta-suave)' }}> · {d.nombre ?? ''}</span>
        </span>
        <span className="text-[13px] font-semibold tabular-nums" style={{ color: '#B91C1C' }}>− {fmtCOP(d.monto)}</span>
      </div>
      <p className="mt-1 text-[12px]" style={{ color: 'var(--tinta)' }}>{d.motivo}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px]" style={{ color: 'var(--tinta-suave)' }}>
        <span>Devuelto el {formatBogotaFechaCortaAno(d.fecha) ?? d.fecha}</span>
        {d.autor && <span>· registró {d.autor}</span>}
        {d.cerro_caso && <span className="font-semibold">· cerró el caso</span>}
        {soporteHref && (
          <a href={soporteHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
            · <Paperclip className="h-3 w-3" /> {d.soporte_nombre ?? 'Soporte'}
          </a>
        )}
      </p>
    </div>
  )
}
