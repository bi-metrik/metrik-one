'use client'

/**
 * Riel de cobro al viajero (F2): la franja fija debajo de la cabecera de la etapa 4 a la 8.
 *
 * Barra con lo pagado (verde), lo vencido sin pagar (rojo) y la marca del 80 %; los textos de Noor
 * §8 («Pagado $X de $Y (p %)», «Próxima cuota…», «80 % al {fecha}: en camino»). Un toque abre el
 * plan con el estado de cada cuota, los pagos y su recibo.
 *
 * «Pegar comprobante» funciona en cualquier parte del negocio (Ctrl+V fuera de un campo, Vera C17):
 * se lee en segundo plano, la persona confirma, se registra con «Deshacer (8)» y luego sale el
 * recibo. Nada se registra sin el toque de la persona.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, MessageCircle, Paperclip, X } from 'lucide-react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { useIntencion } from '@/hooks/use-intencion'
import { createClient } from '@/lib/supabase/client'
import { BUCKET_DOCUMENTOS_ONE } from '@/lib/almacenamiento/referencia'
import { comprobanteDelPortapapeles, motivoRechazoComprobante } from '@/lib/cobros/comprobante-pegado'
import { fechaConDia, pesos } from '@/lib/viaje/plan-pagos'
import { cuotasConEstadoViaje, linkDePagoPropio, mensajeRecordatorioCuota, textosDelRiel, type CuotaConEstadoViaje } from '@/lib/viaje/riel-cobro'
import { enlaceWhatsApp, primerNombre } from '@/lib/viaje/confirmacion'
import type { VistaRiel } from '@/lib/viaje/riel-cobro-datos'
import {
  consolidarPagoViajero,
  deshacerPagoViajero,
  leerComprobantePago,
  registrarPagoViajero,
  reintentarReciboViaje,
} from '../riel-cobro-actions'

const BOTON = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-50'
const PRIMARIO = `${BOTON} bg-[#10B981] text-white hover:bg-[#059669]`
const SECUNDARIO = `${BOTON} border border-[#E5E7EB] bg-white text-[#1A1A1A] hover:bg-gray-50`

const COLOR_CUOTA: Record<CuotaConEstadoViaje['estado'], string> = {
  pagada: 'text-emerald-700',
  parcial: 'text-amber-700',
  por_pagar: 'text-[#6B7280]',
  vence_hoy: 'text-amber-700',
  vencida: 'text-red-600',
}

interface Props {
  vista: VistaRiel
  puedeRegistrar: boolean
}

export default function RielCobroPanel({ vista, puedeRegistrar }: Props) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [archivoInicial, setArchivoInicial] = useState<File | null>(null)
  const [hoja, setHoja] = useState(false)
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  const r = vista.riel
  const t = textosDelRiel(r)
  const nombre = primerNombre(vista.cliente.nombre)
  const marcaPct = r.marca?.pct ?? vista.regla.pct_minimo
  const vencidoPct = r.total > 0 ? Math.min(100 - r.pct, Math.round((r.vencido / r.total) * 100)) : 0

  // Pegar en cualquier parte del negocio (fuera de un campo de texto): abre «pago del viajero».
  useEffect(() => {
    if (!puedeRegistrar) return
    const alPegar = (e: ClipboardEvent) => {
      const destino = e.target as HTMLElement | null
      if (destino && (destino.closest('input, textarea, [contenteditable="true"], [role="dialog"]'))) return
      const f = comprobanteDelPortapapeles(e.clipboardData?.items)
      if (!f) return
      e.preventDefault()
      setArchivoInicial(f)
      setHoja(true)
    }
    document.addEventListener('paste', alPegar)
    return () => document.removeEventListener('paste', alPegar)
  }, [puedeRegistrar])

  const proxima = r.cuotas.find((c) => c.estado !== 'pagada') ?? null
  const recordatorio = proxima
    ? enlaceWhatsApp(vista.cliente.telefono, mensajeRecordatorioCuota({
      nombreCliente: vista.cliente.nombre,
      cuota: { monto: proxima.saldo, fecha: proxima.fecha },
      hoy: vista.hoy,
      link: linkDePagoPropio(vista.cuentas),
      comercial: null,
      agencia: vista.agencia,
    }))
    : null

  function reintentar(cobroId: string) {
    startTransition(async () => {
      const res = await reintentarReciboViaje(vista.negocioId, cobroId, intencion.clave())
      intencion.cerrar()
      if (!res.ok) { toast.error(res.error); return }
      if (res.numero) toast.success(`Recibo de caja ${res.numero} emitido.`)
      else toast.message(`Recibo pendiente: ${res.pendiente}`)
      router.refresh()
    })
  }

  return (
    <section className="mb-3 rounded-xl border border-[#E5E7EB] bg-white p-3" aria-label="Cobro al viajero">
      <button type="button" className="block w-full text-left" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="absolute inset-y-0 left-0 bg-[#10B981]" style={{ width: `${r.pct}%` }} />
          {vencidoPct > 0 && <div className="absolute inset-y-0 bg-red-400" style={{ left: `${r.pct}%`, width: `${vencidoPct}%` }} />}
          <div className="absolute inset-y-0 w-0.5 bg-[#1A1A1A]" style={{ left: `${marcaPct}%` }} aria-hidden />
        </div>
        {/* Celular: una línea. Escritorio: los tres textos. */}
        <p className="mt-2 flex items-center justify-between gap-2 text-sm text-[#1A1A1A] sm:hidden">
          <span className="truncate">{pesos(r.pagado)} de {pesos(r.total)}{proxima ? ` · próxima ${fechaConDia(proxima.fecha).split(' ').slice(1).join(' ')}` : ''}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} />
        </p>
        <p className="mt-2 hidden flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#1A1A1A] sm:flex">
          <span className="font-medium">{t.pagado}</span>
          {t.proxima && <span className="text-[#6B7280]">· {t.proxima}</span>}
          {t.marca && <span className={r.marca?.estado === 'en_riesgo' ? 'text-red-600' : r.marca?.estado === 'cumplido' ? 'text-emerald-700' : 'text-[#6B7280]'}>· {t.marca}</span>}
          {t.aFavor && <span className="font-medium text-red-600">· {t.aFavor}</span>}
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} />
        </p>
      </button>

      <div className="mt-2 flex flex-wrap gap-2">
        {puedeRegistrar && (
          <button type="button" className={PRIMARIO} onClick={() => { setArchivoInicial(null); setHoja(true) }}>
            <Paperclip className="h-4 w-4" /> Pegar comprobante
          </button>
        )}
        {puedeRegistrar && recordatorio && (
          <a className={SECUNDARIO} href={recordatorio} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4" /> Recordar ahora
          </a>
        )}
      </div>

      {abierto && (
        <div className="mt-3 space-y-3 border-t border-[#E5E7EB] pt-3">
          <div>
            <p className="mb-1 text-xs font-medium text-[#6B7280]">Plan de pagos</p>
            <ul className="space-y-1">
              {r.cuotas.map((c, i) => (
                <li key={`${c.fecha}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span>{i === 0 ? 'Anticipo' : `Cuota ${i + 1}`} · {pesos(c.monto)} · {fechaConDia(c.fecha)}</span>
                  <span className={COLOR_CUOTA[c.estado]}>{c.etiqueta}</span>
                </li>
              ))}
            </ul>
          </div>
          {vista.pagos.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-[#6B7280]">Pagos recibidos</p>
              <ul className="space-y-1">
                {vista.pagos.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span>{pesos(p.monto)} · {p.fecha ? fechaConDia(p.fecha) : ''}{p.cuenta ? ` · ${p.cuenta}` : ''}</span>
                    {p.recibo.estado === 'emitido' && <span className="text-emerald-700">Recibo {p.recibo.numero}</span>}
                    {p.recibo.estado === 'pendiente' && (
                      <span className="flex items-center gap-2 text-amber-700">
                        Recibo pendiente: {p.recibo.motivo}
                        {puedeRegistrar && <button type="button" className="underline" disabled={isPending} onClick={() => reintentar(p.id)}>Reintentar</button>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {hoja && (
        <HojaComprobante
          vista={vista}
          archivoInicial={archivoInicial}
          nombre={nombre}
          onCerrar={() => setHoja(false)}
          onRegistrado={() => { setHoja(false); router.refresh() }}
        />
      )}
    </section>
  )
}

// ── La hoja del comprobante ──────────────────────────────────────────────────

function HojaComprobante({ vista, archivoInicial, nombre, onCerrar, onRegistrado }: {
  vista: VistaRiel
  archivoInicial: File | null
  nombre: string
  onCerrar: () => void
  onRegistrado: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  const [soporte, setSoporte] = useState<{ storage_path: string; file_name: string; mime_type: string } | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(vista.hoy)
  const [banco, setBanco] = useState('')
  const [referencia, setReferencia] = useState('')
  const [cuentaId, setCuentaId] = useState(vista.cuentas.length === 1 ? vista.cuentas[0].id : '')
  const [aviso, setAviso] = useState<string | null>(null)
  const [repetido, setRepetido] = useState<string | null>(null)
  const yaLeyoInicial = useRef(false)

  const montoNum = Math.round(Number(monto.replace(/\D/g, '')) || 0)
  // «Va a: Cuota n» con el mismo reparto que el riel, contando este pago.
  const vaA = useMemo(() => {
    if (!(montoNum > 0)) return null
    const antes = vista.riel.cuotas.find((c) => c.estado !== 'pagada')
    if (!antes) return null
    const idx = vista.riel.cuotas.indexOf(antes)
    const despues = cuotasConEstadoViaje(vista.riel.cuotas, [{ monto: vista.riel.pagado + montoNum, fecha: vista.hoy }], vista.hoy).cuotas[idx]
    const nombreCuota = idx === 0 ? 'Cuota 1 · anticipo' : `Cuota ${idx + 1}`
    return despues?.estado === 'pagada' ? `${nombreCuota} (${pesos(antes.saldo)})` : `${nombreCuota}: queda faltando ${pesos(despues?.saldo ?? 0)}`
  }, [montoNum, vista])

  const subirYLeer = useCallback(async (file: File) => {
    const motivo = motivoRechazoComprobante(file)
    if (motivo) { toast.error(motivo); return }
    setLeyendo(true)
    setAviso(null)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `${vista.workspaceId}/pagos-viajero/${crypto.randomUUID()}.${ext}`
      const { error } = await createClient().storage.from(BUCKET_DOCUMENTOS_ONE).upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (error) { toast.error(`No se pudo subir el comprobante: ${error.message}`); return }
      const s = { storage_path: path, file_name: file.name, mime_type: file.type || '' }
      setSoporte(s)
      // La lectura no bloquea: se puede escribir mientras tanto y lo escrito no se pisa.
      const res = await leerComprobantePago(vista.negocioId, s)
      if (!res.ok) { toast.error(res.error); return }
      const l = res.lectura
      setMonto((v) => v || (l.monto ? l.monto.toLocaleString('es-CO') : ''))
      setFecha((v) => (v !== vista.hoy ? v : l.fecha ?? v))
      setBanco((v) => v || (l.banco ?? ''))
      setReferencia((v) => v || (l.referencia ?? ''))
      setCuentaId((v) => v || (l.cuentaId ?? ''))
      setAviso(res.aviso)
    } finally {
      setLeyendo(false)
    }
  }, [vista])

  useEffect(() => {
    if (archivoInicial && !yaLeyoInicial.current) {
      yaLeyoInicial.current = true
      void subirYLeer(archivoInicial)
    }
  }, [archivoInicial, subirYLeer])

  function registrar(confirmarRepetido = false) {
    if (!soporte) { toast.error('Pega o sube el comprobante.'); return }
    startTransition(async () => {
      const res = await registrarPagoViajero({
        negocioId: vista.negocioId,
        monto: montoNum,
        fecha,
        cuentaId,
        referencia: referencia || null,
        banco: banco || null,
        soporte,
        confirmarRepetido,
      }, intencion.clave())
      intencion.cerrar()
      if (!res.ok) {
        if (res.repetido) { setRepetido(res.error); return }
        toast.error(res.error)
        return
      }
      onRegistrado()
      // Con el anticipo a medias el negocio no pasa: el texto dice cuánto falta (QA G11).
      if (res.textoAvance) toast.message(res.avanzo ? `${res.textoAvance} El negocio pasó a ${res.avanzo}.` : res.textoAvance)
      // Deshacer (8): pasados los 8 s sale el recibo.
      let deshecho = false
      const id = toast.success('Pago registrado. El recibo sale en 8 s', {
        duration: 8000,
        action: {
          label: 'Deshacer',
          onClick: () => {
            deshecho = true
            void deshacerPagoViajero(vista.negocioId, res.cobroId).then((d) => {
              if (d.ok) toast.message('Deshecho.')
              else toast.error(d.error)
              router.refresh()
            })
          },
        },
      })
      setTimeout(() => {
        if (deshecho) return
        toast.dismiss(id)
        void consolidarPagoViajero(vista.negocioId, res.cobroId).then((c) => {
          if (!c.ok) { toast.error(c.error); return }
          const correo = c.correo === 'enviado' ? ` y por correo a ${nombre}` : ''
          if (c.numero) {
            toast.success(`Recibo de caja ${c.numero} listo${correo}.`, { action: { label: 'Mandar por WhatsApp', onClick: () => window.open(c.waUrl, '_blank', 'noopener') } })
          } else {
            toast.message(`Recibo pendiente: ${c.pendiente}`, { action: { label: 'Avisar por WhatsApp', onClick: () => window.open(c.waUrl, '_blank', 'noopener') } })
          }
          router.refresh()
        })
      }, 8000)
    })
  }

  const listo = !!soporte && montoNum > 0 && !!cuentaId && !!fecha

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Pago del cliente">
      <div
        className="flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-xl"
        onPaste={(e) => {
          const f = comprobanteDelPortapapeles(e.clipboardData?.items)
          if (f) { e.preventDefault(); void subirYLeer(f) }
        }}
      >
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
          <h3 className="text-base font-semibold text-[#1A1A1A]">Pago de {nombre}</h3>
          <button type="button" className="min-h-11 min-w-11 rounded-lg text-[#6B7280] hover:bg-gray-100" onClick={onCerrar} aria-label="Cerrar">
            <X className="mx-auto h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <label className={`${SECUNDARIO} w-full cursor-pointer`}>
            <Paperclip className="h-4 w-4" />
            {soporte ? soporte.file_name : 'Pega el comprobante (Ctrl+V), toma una foto o súbelo'}
            <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirYLeer(f) }} />
          </label>
          {leyendo && <p className="text-sm text-[#6B7280]">Leyendo el comprobante…</p>}
          {aviso && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{aviso}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Valor</span>
              <input inputMode="numeric" className="min-h-11 w-full rounded-lg border border-[#E5E7EB] px-3" value={monto} onChange={(e) => setMonto(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Fecha</span>
              <input type="date" max={vista.hoy} className="min-h-11 w-full rounded-lg border border-[#E5E7EB] px-3" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Desde (banco)</span>
              <input className="min-h-11 w-full rounded-lg border border-[#E5E7EB] px-3" value={banco} onChange={(e) => setBanco(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Referencia</span>
              <input className="min-h-11 w-full rounded-lg border border-[#E5E7EB] px-3" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Entró a</span>
            <select className="min-h-11 w-full rounded-lg border border-[#E5E7EB] px-3" value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
              <option value="">Elige la cuenta</option>
              {vista.cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            {vista.cuentas.length === 0 && <span className="mt-1 block text-xs text-red-600">El espacio no tiene cuentas de recaudo configuradas.</span>}
          </label>
          {vaA && <p className="text-sm text-[#1A1A1A]">Va a: {vaA}</p>}
          {repetido && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p>{repetido}</p>
              <button type="button" className={`${SECUNDARIO} mt-2`} disabled={isPending} onClick={() => { setRepetido(null); registrar(true) }}>Sí, es otro pago</button>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 border-t border-[#E5E7EB] bg-white px-4 py-3">
          <button type="button" className={`${PRIMARIO} w-full`} disabled={!listo || isPending} onClick={() => registrar(false)}>
            Registrar pago{montoNum > 0 ? ` de ${pesos(montoNum)}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
