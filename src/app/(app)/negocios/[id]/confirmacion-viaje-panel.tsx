'use client'

/**
 * Etapa Confirmación del viaje (F2): «El cliente dijo sí: ONE arma el plan y los servicios».
 *
 * El panel muestra lo que pide la etapa con su estado, el mensaje que se le preparó al cliente y la
 * prerreserva. La hoja «El cliente confirmó» guarda en una acción la tarifa, la fecha, el
 * pantallazo opcional, a nombre de quién va la factura, el plan acordado y la prerreserva (F2-2).
 *
 * Canal (Vera C1): el mensaje se abre en el WhatsApp de la comercial con el texto listo y ella toca
 * «Ya lo mandé»; si el cliente tiene correo, también le llega por correo.
 *
 * Copy de Noor §2 (etapa 4) y §8, sin palabras técnicas (Vera §7.6). Celular: la hoja ocupa la
 * pantalla y el botón de confirmar queda fijo abajo con el total y el estado de la regla.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Clock, MessageCircle, Plus, X, AlertTriangle, Paperclip } from 'lucide-react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { useIntencion } from '@/hooks/use-intencion'
import { createClient } from '@/lib/supabase/client'
import { BUCKET_DOCUMENTOS_ONE } from '@/lib/almacenamiento/referencia'
import { comprobanteDelPortapapeles, motivoRechazoComprobante } from '@/lib/cobros/comprobante-pegado'
import { todayBogotaISO } from '@/lib/dates/bogota'
import {
  fechaCorta,
  huellaPlan,
  lineasDeValidacion,
  normalizarCuotas,
  pesos,
  planSugerido,
  reglaEnPalabras,
  validarPlan,
  type CuotaPlan,
} from '@/lib/viaje/plan-pagos'
import {
  gatesConfirmacionPendientes,
  horaBogota,
  mensajeConfirmacion,
  primerNombre,
  seccionesDeTerminos,
  type TipoTitular,
} from '@/lib/viaje/confirmacion'
import type { VistaConfirmacion } from '@/lib/viaje/confirmacion-datos'
import {
  aplicarPrerreservaSiVencio,
  confirmarClienteViaje,
  decidirAprobacionPlan,
  marcarConfirmacionEnviada,
  pedirAprobacionPlan,
} from '../confirmacion-viaje-actions'

interface Props {
  vista: VistaConfirmacion
  puedeConfirmar: boolean
  esDireccion: boolean
}

const BOTON = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-50'
const BOTON_PRIMARIO = `${BOTON} bg-[#10B981] text-white hover:bg-[#059669]`
const BOTON_SECUNDARIO = `${BOTON} border border-[#E5E7EB] bg-white text-[#1A1A1A] hover:bg-gray-50`

function Linea({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#10B981]" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
      <span className={ok ? 'text-[#1A1A1A]' : 'text-[#6B7280]'}>{children}</span>
    </li>
  )
}

export default function ConfirmacionViajePanel({ vista, puedeConfirmar, esDireccion }: Props) {
  const router = useRouter()
  const [abierta, setAbierta] = useState(false)
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  const nombre = primerNombre(vista.cliente.nombre)
  const conf = vista.confirmacion
  const pendientes = gatesConfirmacionPendientes(vista.gates, vista.estado, vista.gateMensajes)

  // Prerreserva vencida: se aplica al abrir (el cron lo hace a primera hora; esto cubre el día).
  const yaPidioVencer = useRef(false)
  const vencida = vista.prerreservaVencida
  useEffect(() => {
    if (!vencida || yaPidioVencer.current) return
    yaPidioVencer.current = true
    void aplicarPrerreservaSiVencio(vista.negocioId).then((r) => {
      if (r.ok && r.aplicada) {
        toast.message('Venció la prerreserva sin anticipo. La cotización volvió a armarse: revisa tarifas antes de enviarla de nuevo.')
        router.refresh()
      }
    })
  }, [vencida, vista.negocioId, router])

  // Antes de confirmar y sin cotización para confirmar, no hay nada que mostrar.
  if (!conf && (!vista.cotizacion || !(vista.antesDeConfirmacion || vista.enConfirmacion))) return null

  function yaLoMande() {
    startTransition(async () => {
      const r = await marcarConfirmacionEnviada(vista.negocioId, intencion.clave())
      intencion.cerrar()
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Listo: quedó anotado que se lo mandaste.')
      router.refresh()
    })
  }

  const tarifaElegida = conf ? vista.tarifas.find((t) => t.itinerarioId === conf.itinerario_id) : null
  const plan = vista.plan && vista.plan.estado === 'acordado' ? vista.plan : null

  return (
    <section className="mb-3 rounded-xl border border-[#E5E7EB] bg-white p-4" aria-label="Confirmación del viaje">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">
          {vista.etapaConfirmacion?.nombre ?? 'Confirmación'} <span className="font-normal text-[#6B7280]">· El cliente dijo sí</span>
        </h2>
        {vista.prerreserva?.estado === 'vigente' && !vista.hayPago && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
            <Clock className="h-3.5 w-3.5" />
            Tarifa congelada hasta {todayBogotaISO(new Date(vista.prerreserva.vence_at)) === todayBogotaISO() ? 'hoy' : fechaCorta(todayBogotaISO(new Date(vista.prerreserva.vence_at)))} a las {horaBogota(vista.prerreserva.vence_at)}
          </span>
        )}
      </div>

      {!conf ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-[#6B7280]">
            El cliente todavía no ha confirmado. Cuando te diga que sí por WhatsApp, regístralo aquí: ONE arma el plan de pagos y los servicios.
          </p>
          {puedeConfirmar && (
            <button type="button" className={BOTON_PRIMARIO} onClick={() => setAbierta(true)}>
              El cliente confirmó
            </button>
          )}
          {esDireccion && vista.aprobacion?.estado === 'solicitada' && (
            <AprobacionPendiente vista={vista} />
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <ul className="space-y-1.5">
            <Linea ok>El cliente confirmó el {fechaCorta(conf.fecha)}{conf.pantallazo ? ' (pantallazo)' : ''}</Linea>
            <Linea ok>Tarifa {conf.tarifa_nombre ?? tarifaElegida?.nombre ?? ''} · {pesos(conf.total)}</Linea>
            <Linea ok={vista.estado.planVigente}>
              {plan
                ? `Plan de pagos: ${plan.cuotas.length} cuota${plan.cuotas.length === 1 ? '' : 's'}, ${plan.dentro_de_regla ? 'dentro de la regla' : 'aprobado por dirección'}`
                : 'Falta el plan de pagos acordado con el cliente.'}
            </Linea>
            <Linea ok={vista.estado.anticipoConSoporte}>Anticipo con comprobante y cuenta donde entró</Linea>
          </ul>

          {pendientes.length > 0 && vista.enConfirmacion && (
            <p className="text-sm text-[#1A1A1A]">
              <span className="font-medium">Sigue:</span> Cuando {nombre} pague el anticipo, pega aquí el comprobante.
            </p>
          )}

          <div className="rounded-lg bg-gray-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-[#6B7280]">Así le llegó a {nombre}</p>
              <p className="text-xs text-[#6B7280]">
                {conf.mensaje.enviado_at
                  ? `Enviado por ${conf.mensaje.enviado_por_nombre ?? 'la comercial'} el ${fechaCorta(todayBogotaISO(new Date(conf.mensaje.enviado_at)))}`
                  : 'Preparado, falta mandarlo'}
                {conf.mensaje.correo?.estado === 'enviado' ? ` · correo enviado a ${conf.mensaje.correo.destino}` : ''}
                {conf.mensaje.correo?.estado === 'omitido' ? ' · sin correo' : ''}
                {conf.mensaje.correo?.estado === 'fallido' ? ' · el correo no salió' : ''}
              </p>
            </div>
            <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm text-[#1A1A1A]">{conf.mensaje.texto}</pre>
            {puedeConfirmar && (
              <div className="mt-2 flex flex-wrap gap-2">
                <a href={conf.mensaje.wa_url} target="_blank" rel="noopener noreferrer" className={BOTON_SECUNDARIO}>
                  <MessageCircle className="h-4 w-4" /> Abrir mi WhatsApp con el mensaje
                </a>
                {!conf.mensaje.enviado_at && (
                  <button type="button" className={BOTON_PRIMARIO} onClick={yaLoMande} disabled={isPending}>
                    Ya lo mandé
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {abierta && (
        <HojaConfirmacion
          vista={vista}
          onCerrar={() => setAbierta(false)}
          onConfirmado={() => { setAbierta(false); router.refresh() }}
        />
      )}
    </section>
  )
}

// ── Aprobación del plan (dirección) ──────────────────────────────────────────

function AprobacionPendiente({ vista }: { vista: VistaConfirmacion }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  const [motivo, setMotivo] = useState('')
  const [noAprobar, setNoAprobar] = useState(false)
  const ap = vista.aprobacion
  if (!ap) return null
  const d = ap.detalle as { pct_al_minimo?: number; fecha_minimo?: string | null; total?: number; razon?: string | null }

  function decidir(decision: 'aprobada' | 'rechazada') {
    startTransition(async () => {
      const r = await decidirAprobacionPlan(vista.negocioId, ap!.id, decision, decision === 'rechazada' ? motivo : null, intencion.clave())
      intencion.cerrar()
      if (!r.ok) { toast.error(r.error); return }
      toast.success(decision === 'aprobada' ? 'Aprobado. Le avisamos a quien lo pidió.' : 'Listo: le llegó el motivo a quien lo pidió.')
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm">
      <p className="text-[#1A1A1A]">
        {ap.solicitada_por_nombre ?? 'La comercial'} pide aprobar un plan de pagos fuera de la regla
        {d.fecha_minimo ? `: al ${fechaCorta(d.fecha_minimo)} el cliente llevaría el ${d.pct_al_minimo ?? 0} %` : ''}.
      </p>
      {d.razon && <p className="mt-1 text-[#6B7280]">«{d.razon}»</p>}
      {noAprobar && (
        <textarea
          className="mt-2 w-full rounded-lg border border-[#E5E7EB] p-2 text-sm"
          placeholder="¿Por qué no? (le llega a quien lo pidió)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BOTON_PRIMARIO} disabled={isPending} onClick={() => decidir('aprobada')}>Aprobar</button>
        {noAprobar
          ? <button type="button" className={BOTON_SECUNDARIO} disabled={isPending || motivo.trim().length < 3} onClick={() => decidir('rechazada')}>No aprobar</button>
          : <button type="button" className={BOTON_SECUNDARIO} disabled={isPending} onClick={() => setNoAprobar(true)}>No aprobar</button>}
      </div>
    </div>
  )
}

// ── La hoja «El cliente confirmó» ────────────────────────────────────────────

function cuotasIniciales(vista: VistaConfirmacion, total: number, hoy: string): CuotaPlan[] {
  const guardado = vista.plan && vista.plan.estado === 'propuesta' && vista.plan.total === total ? vista.plan.cuotas : null
  if (guardado && guardado.length > 0) return guardado
  return planSugerido({ total, fechaSalida: vista.viaje.fechaSalida, hoy, regla: vista.regla })
    ?? [{ numero: 0, monto: total, fecha: hoy, concepto: 'Anticipo' }]
}

function HojaConfirmacion({ vista, onCerrar, onConfirmado }: { vista: VistaConfirmacion; onCerrar: () => void; onConfirmado: () => void }) {
  const hoy = todayBogotaISO()
  const nombre = primerNombre(vista.cliente.nombre)
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  const intencionAprob = useIntencion()

  const tarifasConPrecio = vista.tarifas.filter((t) => t.precio !== null)
  const inicial = tarifasConPrecio.find((t) => t.itinerarioId === vista.cotizacion?.tarifaAceptadaId)
    ?? tarifasConPrecio.find((t) => t.esRecomendada)
    ?? tarifasConPrecio[0]
    ?? null
  const [tarifaId, setTarifaId] = useState<string | null>(inicial?.itinerarioId ?? null)
  const tarifa = tarifasConPrecio.find((t) => t.itinerarioId === tarifaId) ?? null
  const total = tarifa?.precio ?? 0

  const [fecha, setFecha] = useState(hoy)
  const [pantallazo, setPantallazo] = useState<{ storage_path: string; file_name: string; mime_type: string } | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [tipoTitular, setTipoTitular] = useState<TipoTitular>('viajero')
  const [docNumero, setDocNumero] = useState('')
  const [docTipo, setDocTipo] = useState<'13' | '22' | '41'>('13')
  const [titNombre, setTitNombre] = useState('')
  const [titCorreo, setTitCorreo] = useState('')
  const [correoCliente, setCorreoCliente] = useState('')
  const [cuotas, setCuotas] = useState<CuotaPlan[]>(() => cuotasIniciales(vista, total, hoy))
  const [motivoPlan, setMotivoPlan] = useState('')
  const [conPrerreserva, setConPrerreserva] = useState(false)
  const [venceA, setVenceA] = useState('')
  const [extra, setExtra] = useState('')
  const [preguntar, setPreguntar] = useState(false)

  // Cambiar de tarifa rehace el sugerido con el total nuevo.
  const totalPrevio = useRef(total)
  useEffect(() => {
    if (totalPrevio.current === total) return
    totalPrevio.current = total
    setCuotas(planSugerido({ total, fechaSalida: vista.viaje.fechaSalida, hoy, regla: vista.regla }) ?? [{ numero: 0, monto: total, fecha: hoy, concepto: 'Anticipo' }])
  }, [total, hoy, vista.viaje.fechaSalida, vista.regla])

  const ctxPlan = { total, fechaSalida: vista.viaje.fechaSalida, hoy, regla: vista.regla }
  const v = validarPlan(cuotas, ctxPlan)
  const lineas = lineasDeValidacion(v, ctxPlan)
  const huella = huellaPlan(cuotas, total)
  const ap = vista.aprobacion
  const aprobadaParaEste = !!ap && ap.estado === 'aprobada' && ap.huella === huella
  const pedidaParaEste = !!ap && ap.estado === 'solicitada' && ap.huella === huella
  const rechazadaParaEste = !!ap && ap.estado === 'rechazada' && ap.huella === huella

  const mensaje = useMemo(() => mensajeConfirmacion({
    nombreCliente: vista.cliente.nombre,
    destino: vista.viaje.destino,
    fechaSalida: vista.viaje.fechaSalida,
    fechaRegreso: vista.viaje.fechaRegreso,
    composicion: vista.viaje.composicion,
    tarifaNombre: tarifa?.nombre ?? null,
    total,
    cuotas: normalizarCuotas(cuotas),
    fechaMinimo: v.fechaMinimo,
    pctMinimo: vista.regla.pct_minimo,
    hoy,
    terminos: seccionesDeTerminos(vista.terminosBase),
    extra,
    comercial: vista.comercial ? primerNombre(vista.comercial) : null,
    agencia: vista.agencia,
  }), [vista, tarifa, total, cuotas, v.fechaMinimo, hoy, extra])

  const puedeConfirmarYa = !!tarifa && v.cuadra && !v.despuesDelViaje && (v.dentroDeRegla || aprobadaParaEste)
  const motivoApagado = !tarifa
    ? 'Escoge la tarifa'
    : v.diferencia > 0
      ? `Faltan ${pesos(v.diferencia)}`
      : v.diferencia < 0
        ? `Sobran ${pesos(-v.diferencia)}`
        : v.despuesDelViaje
          ? 'Hay una cuota después del viaje'
          : !v.dentroDeRegla && !aprobadaParaEste
            ? 'Fuera de la regla'
            : null

  function cambiarCuota(i: number, campo: 'fecha' | 'monto', valor: string) {
    setCuotas((cs) => cs.map((c, j) => (j === i ? { ...c, [campo]: campo === 'monto' ? Math.round(Number(valor.replace(/\D/g, '')) || 0) : valor } : c)))
  }

  async function subir(file: File) {
    const motivo = motivoRechazoComprobante(file)
    if (motivo) { toast.error(motivo); return }
    setSubiendo(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `${vista.workspaceId}/confirmaciones/${crypto.randomUUID()}.${ext}`
      const { error } = await createClient().storage.from(BUCKET_DOCUMENTOS_ONE).upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (error) { toast.error(`No se pudo subir el pantallazo: ${error.message}`); return }
      setPantallazo({ storage_path: path, file_name: file.name, mime_type: file.type || '' })
    } finally {
      setSubiendo(false)
    }
  }

  function entradaPlan() {
    return { negocioId: vista.negocioId, cotizacionId: vista.cotizacion?.id ?? '', itinerarioId: tarifa?.itinerarioId ?? null, cuotas: normalizarCuotas(cuotas), motivo: motivoPlan || null }
  }

  function pedirAEdgar() {
    startTransition(async () => {
      const r = await pedirAprobacionPlan(entradaPlan(), intencionAprob.clave())
      intencionAprob.cerrar()
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Le llegó a dirección el pedido.')
      onConfirmado()
    })
  }

  function confirmar() {
    setPreguntar(false)
    startTransition(async () => {
      const r = await confirmarClienteViaje({
        ...entradaPlan(),
        fechaConfirmacion: fecha,
        titular: tipoTitular === 'viajero'
          ? { tipo: 'viajero', tipo_documento: docNumero ? docTipo : null, numero_documento: docNumero || null, correo: titCorreo || null }
          : { tipo: tipoTitular, tipo_documento: tipoTitular === 'empresa' ? '31' : docTipo, numero_documento: docNumero, nombre: titNombre, correo: titCorreo || null },
        correoCliente: correoCliente || null,
        prerreservaVence: conPrerreserva && venceA ? new Date(venceA).toISOString() : null,
        extra: extra || null,
        pantallazo,
      }, intencion.clave())
      intencion.cerrar()
      if (!r.ok) { toast.error(r.error); return }
      toast.success(`Confirmación preparada para ${r.nombre}. Se crearon ${r.servicios} servicios y el plan de pagos.`)
      if (r.avisoTitular) toast.message(r.avisoTitular)
      onConfirmado()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="El cliente confirmó">
      <div
        className="flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-xl"
        onPaste={(e) => {
          const f = comprobanteDelPortapapeles(e.clipboardData?.items)
          if (f) { e.preventDefault(); void subir(f) }
        }}
      >
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
          <h3 className="text-base font-semibold text-[#1A1A1A]">El cliente confirmó</h3>
          <button type="button" className="min-h-11 min-w-11 rounded-lg text-[#6B7280] hover:bg-gray-100" onClick={onCerrar} aria-label="Cerrar">
            <X className="mx-auto h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* 1. Tarifa */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-[#1A1A1A]">¿Qué tarifa escogió?</legend>
            {vista.errorTarifas && <p className="text-sm text-red-600">{vista.errorTarifas}</p>}
            {tarifasConPrecio.length === 0 && !vista.errorTarifas && (
              <p className="text-sm text-red-600">Esta cotización no tiene tarifas con precio. Ábrela y revísala antes de confirmar.</p>
            )}
            <div className="space-y-2">
              {vista.tarifas.map((t) => (
                <label key={t.itinerarioId} className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${tarifaId === t.itinerarioId ? 'border-[#10B981] bg-emerald-50' : 'border-[#E5E7EB]'} ${t.precio === null ? 'opacity-50' : ''}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="tarifa" checked={tarifaId === t.itinerarioId} disabled={t.precio === null} onChange={() => setTarifaId(t.itinerarioId)} />
                    {t.esRecomendada ? `Recomendada · ${t.nombre}` : t.nombre}
                  </span>
                  <span className="font-medium">{t.precio !== null ? pesos(t.precio) : t.motivo}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* 2. Cuándo */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[#1A1A1A]">¿Cuándo confirmó?</span>
              <input type="date" max={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} className="min-h-11 w-full rounded-lg border border-[#E5E7EB] px-3" />
            </label>
            <div className="text-sm">
              <span className="mb-1 block font-medium text-[#1A1A1A]">Pega el pantallazo del sí (opcional)</span>
              <label className={`${BOTON_SECUNDARIO} w-full cursor-pointer`}>
                <Paperclip className="h-4 w-4" />
                {subiendo ? 'Subiendo…' : pantallazo ? pantallazo.file_name : 'Pegar (Ctrl+V), foto o archivo'}
                <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f) }} />
              </label>
            </div>
          </div>

          {/* 3. Factura */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-[#1A1A1A]">¿A nombre de quién va la factura?</legend>
            <div className="flex flex-wrap gap-2">
              {([['viajero', `${vista.cliente.nombre} (quien viaja)`], ['empresa', 'Una empresa'], ['tercero', 'Otra persona']] as const).map(([v2, et]) => (
                <label key={v2} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${tipoTitular === v2 ? 'border-[#10B981] bg-emerald-50' : 'border-[#E5E7EB]'}`}>
                  <input type="radio" name="titular" checked={tipoTitular === v2} onChange={() => setTipoTitular(v2)} />
                  {et}
                </label>
              ))}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {tipoTitular !== 'viajero' && (
                <input className="min-h-11 rounded-lg border border-[#E5E7EB] px-3 text-sm" placeholder={tipoTitular === 'empresa' ? 'Razón social' : 'Nombre completo'} value={titNombre} onChange={(e) => setTitNombre(e.target.value)} />
              )}
              <div className="flex gap-2">
                {tipoTitular !== 'empresa' && (
                  <select className="min-h-11 rounded-lg border border-[#E5E7EB] px-2 text-sm" value={docTipo} onChange={(e) => setDocTipo(e.target.value as '13' | '22' | '41')}>
                    <option value="13">Cédula</option>
                    <option value="22">C. extranjería</option>
                    <option value="41">Pasaporte</option>
                  </select>
                )}
                <input className="min-h-11 w-full rounded-lg border border-[#E5E7EB] px-3 text-sm" inputMode="numeric" placeholder={tipoTitular === 'empresa' ? 'NIT' : tipoTitular === 'viajero' ? 'Documento (opcional)' : 'Documento'} value={docNumero} onChange={(e) => setDocNumero(e.target.value)} />
              </div>
              <input className="min-h-11 rounded-lg border border-[#E5E7EB] px-3 text-sm" type="email" placeholder="Correo de facturación (opcional)" value={titCorreo} onChange={(e) => setTitCorreo(e.target.value)} />
            </div>
            {docTipo === '41' && tipoTitular !== 'empresa' && (
              <p className="mt-1 text-xs text-amber-700">Con pasaporte no se puede facturar desde ONE; esta factura se hace por fuera.</p>
            )}
            {!vista.cliente.correo && (
              <label className="mt-2 block text-sm">
                <span className="mb-1 block text-[#6B7280]">{nombre} no tiene correo. Si te lo da, escríbelo y también le llega por ahí (opcional).</span>
                <input className="min-h-11 w-full rounded-lg border border-[#E5E7EB] px-3 text-sm" type="email" value={correoCliente} onChange={(e) => setCorreoCliente(e.target.value)} />
              </label>
            )}
          </fieldset>

          {/* 4. Plan de pagos */}
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-[#1A1A1A]">Plan de pagos</legend>
            {!vista.viaje.fechaSalida && (
              <p className="mb-2 text-xs text-[#6B7280]">Sin fecha exacta de salida, la regla va en palabras: {reglaEnPalabras(vista.regla)}.</p>
            )}
            <ul className="mb-2 space-y-0.5">
              {lineas.map((l, i) => (
                <li key={i} className={`flex items-start gap-1.5 text-xs ${l.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                  {l.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  {l.texto}
                </li>
              ))}
            </ul>
            <div className="space-y-2">
              {cuotas.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-[#6B7280]">{i === 0 ? 'Anticipo' : `Cuota ${i + 1}`}</span>
                  <input type="date" className="min-h-11 w-36 rounded-lg border border-[#E5E7EB] px-2 text-sm" value={c.fecha} onChange={(e) => cambiarCuota(i, 'fecha', e.target.value)} aria-label="Fecha" />
                  <input inputMode="numeric" className="min-h-11 w-full min-w-0 rounded-lg border border-[#E5E7EB] px-2 text-right text-sm" value={c.monto ? c.monto.toLocaleString('es-CO') : ''} onChange={(e) => cambiarCuota(i, 'monto', e.target.value)} aria-label="Monto" />
                  <button type="button" className="min-h-11 min-w-11 rounded-lg text-[#6B7280] hover:bg-gray-100 disabled:opacity-30" onClick={() => setCuotas((cs) => cs.filter((_, j) => j !== i))} disabled={cuotas.length <= 1} aria-label="Quitar cuota">
                    <X className="mx-auto h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={BOTON_SECUNDARIO} onClick={() => setCuotas((cs) => [...cs, { numero: cs.length, monto: Math.max(0, v.diferencia), fecha: vista.viaje.fechaSalida ?? hoy, concepto: null }])}>
                <Plus className="h-4 w-4" /> Cuota
              </button>
              <button type="button" className={BOTON_SECUNDARIO} onClick={() => setCuotas(planSugerido({ total, fechaSalida: vista.viaje.fechaSalida, hoy, regla: vista.regla }) ?? [{ numero: 0, monto: total, fecha: hoy, concepto: 'Anticipo' }])}>
                Volver al plan sugerido
              </button>
            </div>
            {v.cuadra && !v.dentroDeRegla && !v.despuesDelViaje && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                {aprobadaParaEste ? (
                  <p className="text-emerald-700">✓ Aprobado por {ap?.decidida_por_nombre ?? 'dirección'}</p>
                ) : pedidaParaEste ? (
                  <p className="text-amber-800">Pedido a dirección · esperando</p>
                ) : (
                  <>
                    {rechazadaParaEste && <p className="mb-2 text-red-600">No aprobado: {ap?.motivo}</p>}
                    <p className="text-amber-800">Fuera de la regla. Si el cliente lo pidió así, pídele aprobación a dirección.</p>
                    <input className="mt-2 min-h-11 w-full rounded-lg border border-[#E5E7EB] px-3 text-sm" placeholder="¿Por qué? (por ejemplo: el cliente pidió 4 cuotas)" value={motivoPlan} onChange={(e) => setMotivoPlan(e.target.value)} />
                    <button type="button" className={`${BOTON_SECUNDARIO} mt-2`} disabled={isPending} onClick={pedirAEdgar}>Pedir aprobación</button>
                  </>
                )}
              </div>
            )}
          </fieldset>

          {/* 5. Prerreserva */}
          <fieldset>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-[#1A1A1A]">
              <input type="checkbox" checked={conPrerreserva} onChange={(e) => setConPrerreserva(e.target.checked)} />
              ¿Hay tarifa congelada sin pago?
            </label>
            {conPrerreserva && (
              <label className="block text-sm">
                <span className="mb-1 block text-[#6B7280]">Vence a las</span>
                <input type="datetime-local" className="min-h-11 w-full rounded-lg border border-[#E5E7EB] px-3" value={venceA} onChange={(e) => setVenceA(e.target.value)} />
              </label>
            )}
          </fieldset>

          {/* 6. Mensaje */}
          <div>
            <p className="mb-1 text-sm font-medium text-[#1A1A1A]">Así le llega a {nombre}</p>
            <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-sans text-sm text-[#1A1A1A]">{mensaje}</pre>
            <label className="mt-2 block text-sm">
              <span className="mb-1 block text-[#6B7280]">Algo más para {nombre} (opcional)</span>
              <textarea className="w-full rounded-lg border border-[#E5E7EB] p-2 text-sm" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} />
            </label>
          </div>
        </div>

        {/* Botón fijo abajo con el total y la regla */}
        <div className="sticky bottom-0 border-t border-[#E5E7EB] bg-white px-4 py-3">
          {preguntar ? (
            <div className="space-y-2">
              <p className="text-sm text-[#1A1A1A]">
                ¿Registrar la confirmación con el plan de pagos? Se abre tu WhatsApp con el mensaje listo; envíalo desde ahí.
                {vista.cliente.correo || correoCliente ? ` A ${nombre} también le llega por correo.` : ''}
              </p>
              <div className="flex gap-2">
                <button type="button" className={BOTON_PRIMARIO} disabled={isPending} onClick={confirmar}>Sí, confirmar</button>
                <button type="button" className={BOTON_SECUNDARIO} onClick={() => setPreguntar(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[#6B7280]">
                {pesos(total)}
                {v.fechaMinimo ? ` · ${vista.regla.pct_minimo} % al ${fechaCorta(v.fechaMinimo)} ${v.cumpleMinimo ? '✓' : '✗'}` : ''}
              </p>
              <button type="button" className={BOTON_PRIMARIO} disabled={!puedeConfirmarYa || isPending || subiendo} onClick={() => setPreguntar(true)}>
                {motivoApagado ?? `Confirmar y enviar a ${nombre}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
