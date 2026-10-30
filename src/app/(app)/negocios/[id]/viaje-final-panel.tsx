'use client'

/**
 * En viaje · Cierre económico · Postventa (F6; Noor §2 etapas 7-9, copy literal §8).
 *
 * En viaje: «Anotar cortesía» y «Anotar incidencia» (dos botones grandes, la etapa más de celular).
 * Cierre: las cuatro cifras arriba (Ingreso real · Costo real · Margen real · Cotizado), la tabla
 * por servicio, cortesías, comisiones aparte, y «Confirmar cierre» solo para la dirección.
 * Postventa: calificación 1 a 5, referido y próximo viaje.
 *
 * Todo lo que queda dentro de ONE ofrece «Deshacer» o se puede reabrir; nada se teclea del margen.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { useIntencion } from '@/hooks/use-intencion'
import { TIPOS_CORTESIA, pesosCierre } from '@/lib/viaje/cierre-viaje'
import type { VistaViajeFinal } from '@/lib/viaje/cierre-viaje-datos'
import {
  anotarCortesia,
  anotarIncidencia,
  confirmarCierre,
  decidirSaldoAFavor,
  marcarComision,
  reabrirCierre,
  registrarPostventa,
} from '../viaje-final-actions'

const BOTON = 'min-h-11 rounded-md px-3 text-sm font-medium disabled:opacity-60'
const PRIMARIO = `${BOTON} bg-primary text-primary-foreground`
const SECUNDARIO = `${BOTON} border`

function Cifra({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string | null }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-[11px] text-muted-foreground">{titulo}</p>
      <p className="text-base font-semibold tabular-nums">{valor}</p>
      {nota && <p className="text-[11px] text-muted-foreground">{nota}</p>}
    </div>
  )
}

export default function ViajeFinalPanel({
  vista,
  esDireccion,
  puedeAnotar,
  puedePostventa,
  puedeComision,
}: {
  vista: VistaViajeFinal
  esDireccion: boolean
  puedeAnotar: boolean
  puedePostventa: boolean
  puedeComision: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  const nombre = vista.cliente.nombre.split(/\s+/)[0] || 'el cliente'
  const c = vista.cierre

  // En viaje
  const [hoja, setHoja] = useState<'cortesia' | 'incidencia' | null>(null)
  const [que, setQue] = useState<string>(TIPOS_CORTESIA[0])
  const [detalle, setDetalle] = useState('')
  const [valor, setValor] = useState('')
  const [asumio, setAsumio] = useState<'agencia' | 'proveedor' | 'viajero'>('agencia')

  function guardarAnotacion() {
    startTransition(async () => {
      const r = hoja === 'cortesia'
        ? await anotarCortesia({ negocioId: vista.negocioId, que, detalle: detalle || null, valor }, intencion.clave())
        : await anotarIncidencia({ negocioId: vista.negocioId, que: detalle, servicioId: null, valor: valor || null, asumio }, intencion.clave())
      intencion.cerrar()
      if (!r.ok) { toast.error(r.error); return }
      toast.success(hoja === 'cortesia' ? `Cortesía anotada: suma ${pesosCierre(Number(valor.replace(/\D/g, '')))} al costo real.` : 'Incidencia anotada.')
      setHoja(null); setDetalle(''); setValor('')
      router.refresh()
    })
  }

  // Cierre
  const [motivoReabrir, setMotivoReabrir] = useState('')
  const [motivoRetener, setMotivoRetener] = useState('')
  // La decisión vale si nada de lo que pide decidir el saldo sigue en la lista de lo que falta.
  const saldoDecidido = !!vista.guardado.saldo_a_favor && !vista.faltaCierre.some(f => f.includes('saldo a favor'))
  function correr(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) { toast.error(r.error); return }
      toast.success(ok)
      router.refresh()
    })
  }

  // Postventa
  const pv = vista.postventa
  const [cal, setCal] = useState<number | null>(pv.calificacion)
  const [comentario, setComentario] = useState(pv.comentario ?? '')
  const [referido, setReferido] = useState(pv.referido)
  const [refNombre, setRefNombre] = useState('')
  const [refCel, setRefCel] = useState('')
  const [mes, setMes] = useState(pv.proximo_viaje?.mes ?? '')
  const [destino, setDestino] = useState(pv.proximo_viaje?.destino ?? '')
  function guardarPostventa() {
    startTransition(async () => {
      const r = await registrarPostventa({
        negocioId: vista.negocioId, calificacion: cal, comentario: comentario || null, referido,
        referidoNombre: refNombre || null, referidoCelular: refCel || null, proximoMes: mes || null, proximoDestino: destino || null,
      }, intencion.clave())
      intencion.cerrar()
      if (!r.ok) { toast.error(r.error); return }
      toast.success(r.aviso ?? 'Postventa guardada.')
      router.refresh()
    })
  }

  if (vista.fase === 'en_viaje') {
    return (
      <div className="mb-3 space-y-2 rounded-lg border p-3 text-xs" data-viaje-final="en_viaje">
        <p className="text-sm font-semibold">En viaje · Anota lo que regales</p>
        {vista.textoEnViaje && <p>{vista.textoEnViaje}</p>}
        <p className="text-muted-foreground">
          {c.cortesias.length === 0
            ? 'Nada anotado. Si regalas algo con valor, anótalo: así sabremos si el acompañamiento trae recompra.'
            : `Cortesías: ${c.cortesias.map(x => `${x.descripcion} · ${pesosCierre(x.monto)}`).join(' · ')}`}
        </p>
        {puedeAnotar && !hoja && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={SECUNDARIO} onClick={() => setHoja('incidencia')}>Anotar incidencia</button>
            <button type="button" className={PRIMARIO} onClick={() => setHoja('cortesia')}>Anotar cortesía</button>
          </div>
        )}
        {hoja && (
          <div className="space-y-1.5 rounded-md bg-muted/30 p-2">
            {hoja === 'cortesia' ? (
              <>
                <label className="block">¿Qué regalaste?
                  <select value={que} onChange={e => setQue(e.target.value)} className="mt-0.5 h-11 w-full rounded-md border px-2">
                    {TIPOS_CORTESIA.map(t => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label className="block">Detalle (opcional)
                  <input value={detalle} onChange={e => setDetalle(e.target.value)} className="mt-0.5 h-11 w-full rounded-md border px-2" />
                </label>
              </>
            ) : (
              <>
                <label className="block">¿Qué pasó?
                  <input value={detalle} onChange={e => setDetalle(e.target.value)} className="mt-0.5 h-11 w-full rounded-md border px-2" />
                </label>
                <label className="block">¿Quién lo asumió?
                  <select value={asumio} onChange={e => setAsumio(e.target.value as typeof asumio)} className="mt-0.5 h-11 w-full rounded-md border px-2">
                    <option value="agencia">La agencia</option>
                    <option value="proveedor">El proveedor</option>
                    <option value="viajero">El viajero</option>
                  </select>
                </label>
              </>
            )}
            {(hoja === 'cortesia' || asumio === 'agencia') && (
              <label className="block">Valor aproximado
                <input inputMode="numeric" value={valor} onChange={e => setValor(e.target.value)} className="mt-0.5 h-11 w-full rounded-md border px-2" />
              </label>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={isPending} onClick={guardarAnotacion} className={PRIMARIO}>Guardar</button>
              <button type="button" onClick={() => setHoja(null)} className={`${BOTON} text-muted-foreground underline`}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (vista.fase === 'cierre') {
    const confirmado = vista.guardado.confirmado && !vista.faltaCierre.some(f => f.startsWith('Cambió un pago'))
    return (
      <div className="mb-3 space-y-2 rounded-lg border p-3 text-xs" data-viaje-final="cierre">
        <p className="text-sm font-semibold">Cierre económico · Cuánto dejó</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cifra titulo="Ingreso real" valor={pesosCierre(c.ingresoNeto)} nota={`Solo pagos recibidos${c.iva ? `, sin IVA de ${pesosCierre(c.iva)}` : ''}`} />
          <Cifra titulo="Costo real" valor={pesosCierre(c.costoReal)} />
          <Cifra titulo="Margen real" valor={pesosCierre(c.margenReal)} nota={c.margenRealPct !== null ? `${c.margenRealPct} %` : null} />
          <Cifra titulo="Cotizado" valor={pesosCierre(c.margenCotizado)} nota={c.margenCotizadoPct !== null ? `${c.margenCotizadoPct} %` : null} />
        </div>
        {c.explicacion && <p>{c.explicacion}</p>}
        {/* El mismo saldo que frena `saldo_cero`: sin esto el panel decía «Cerrado» en verde y el
            avance se negaba sin explicación. */}
        {vista.saldoPendiente && (
          <p className="font-medium text-red-700" data-saldo-pendiente>{vista.saldoPendiente}. No se puede cerrar el viaje con saldo por cobrar.</p>
        )}
        <ul className="divide-y rounded-md border">
          {c.filas.map(f => (
            <li key={f.id} className="flex flex-wrap justify-between gap-2 p-2">
              <span className="min-w-0 flex-1">{f.nombre}{f.sacado ? <span className="text-amber-800"> · sacado del viaje</span> : null}</span>
              <span className="tabular-nums text-muted-foreground">cotizado {pesosCierre(f.cotizado)}</span>
              <span className={`tabular-nums ${f.sinCosto ? 'text-red-700' : ''}`}>{f.sinCosto ? 'falta el costo real' : `real ${pesosCierre(f.real)}`}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          {c.cortesias.length === 0 ? 'Sin cortesías en este viaje.' : `Cortesías: ${c.cortesias.map(x => `${x.descripcion} · ${pesosCierre(x.monto)}`).join(' · ')}`}
        </p>
        {c.comisiones.map(k => (
          <div key={k.servicioId} className="flex flex-wrap items-center gap-2">
            <span>Comisión de {k.proveedor} · {pesosCierre(k.esperada)} esperada{k.estado === 'llego' ? ' · llegó' : k.estado === 'perdida' ? ' · se perdió' : ''}</span>
            {puedeComision && k.estado === 'por_cobrar' && (
              <>
                <button type="button" disabled={isPending} className={SECUNDARIO} onClick={() => correr(() => marcarComision(vista.negocioId, k.servicioId, 'llego'), 'Comisión marcada como recibida.')}>Llegó</button>
                <button type="button" disabled={isPending} className={SECUNDARIO} onClick={() => correr(() => marcarComision(vista.negocioId, k.servicioId, 'perdida'), 'Comisión marcada como perdida.')}>Se perdió</button>
              </>
            )}
          </div>
        ))}
        {/* H-28: la plata de un servicio sacado es del cliente hasta que la dirección decida. */}
        {c.saldoAFavor > 0 && (
          <div className="space-y-1.5 rounded-md border border-amber-300 p-2" data-saldo-a-favor>
            <p className="font-medium">
              Saldo a favor de {nombre}: {pesosCierre(c.saldoAFavor)}
              {c.saldoPorSacados > 0 && (
                <span className="font-normal text-muted-foreground"> · {c.sacados.map(x => `${x.nombre} (${pesosCierre(x.cotizado)})`).join(', ')} {c.sacados.length === 1 ? 'salió' : 'salieron'} del viaje</span>
              )}
            </p>
            {saldoDecidido ? (
              <p data-saldo-decision>
                {vista.guardado.saldo_a_favor?.decision === 'devolver'
                  ? 'Se devuelve al cliente.'
                  : vista.guardado.saldo_a_favor?.decision === 'proximo_viaje'
                    ? 'Queda abonado a su próximo viaje.'
                    : `Se retiene como margen. Motivo: ${vista.guardado.saldo_a_favor?.nota ?? '—'}`}
                {vista.avisoSaldo && (
                  <> <a href={vista.avisoSaldo.waUrl} target="_blank" rel="noreferrer" className="underline">Avisar a {nombre} por WhatsApp</a></>
                )}
              </p>
            ) : (
              <>
                <p className="text-red-700">No es margen: decide antes de cerrar.</p>
                {esDireccion && (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={isPending} className={SECUNDARIO} onClick={() => correr(() => decidirSaldoAFavor(vista.negocioId, 'devolver', null), 'Anotado: se devuelve.')}>Devolver</button>
                      <button type="button" disabled={isPending} className={SECUNDARIO} onClick={() => correr(() => decidirSaldoAFavor(vista.negocioId, 'proximo_viaje', null), 'Anotado: queda abonado a su próximo viaje.')}>Dejar abonado a su próximo viaje</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input value={motivoRetener} onChange={e => setMotivoRetener(e.target.value)} placeholder="¿Por qué se retiene?" className="h-11 min-w-0 flex-1 rounded-md border px-2" />
                      <button type="button" disabled={isPending || !motivoRetener.trim()} className={SECUNDARIO} onClick={() => correr(() => decidirSaldoAFavor(vista.negocioId, 'retener', motivoRetener), 'Anotado: se retiene.')}>Retener</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {vista.faltaCierre.filter(f => !f.startsWith('Falta que Edgar') && !f.includes('saldo a favor')).map(f => <p key={f} className="text-red-700">{f}</p>)}
        {confirmado ? (
          <div className="space-y-1.5">
            <p className="font-medium text-emerald-700">Cerrado por Edgar · margen real {vista.guardado.confirmado?.margen_real_pct ?? '—'} %.</p>
            {esDireccion && (
              <div className="flex flex-wrap gap-2">
                <input value={motivoReabrir} onChange={e => setMotivoReabrir(e.target.value)} placeholder="¿Por qué lo reabres?" className="h-11 min-w-0 flex-1 rounded-md border px-2" />
                <button type="button" disabled={isPending || !motivoReabrir.trim()} className={SECUNDARIO} onClick={() => correr(() => reabrirCierre(vista.negocioId, motivoReabrir), 'Cierre reabierto.')}>Reabrir cierre</button>
              </div>
            )}
          </div>
        ) : esDireccion ? (
          <button type="button" disabled={isPending} className={`${PRIMARIO} w-full sm:w-auto`} onClick={() => correr(() => confirmarCierre(vista.negocioId), 'Cierre confirmado.')}>Confirmar cierre</button>
        ) : (
          <p className="text-muted-foreground">Edgar confirma el cierre. Te avisamos cuando lo haga.</p>
        )}
      </div>
    )
  }

  // Postventa
  return (
    <div className="mb-3 space-y-2 rounded-lg border p-3 text-xs" data-viaje-final="postventa">
      <p className="text-sm font-semibold">Postventa · ¿Volvería?</p>
      {vista.faltaPostventa && <p className="text-amber-800">{vista.faltaPostventa}</p>}
      <fieldset className="space-y-1" disabled={!puedePostventa}>
        <legend>Calificación del viaje (lo que respondió {nombre})</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" onClick={() => setCal(n)} aria-pressed={cal === n}
              className={`h-11 w-11 rounded-md border font-semibold ${cal === n ? 'bg-primary text-primary-foreground' : ''}`}>{n}</button>
          ))}
        </div>
        <input value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Comentario (opcional)" className="h-11 w-full rounded-md border px-2" />
      </fieldset>
      <fieldset className="space-y-1" disabled={!puedePostventa || !!pv.referido_contacto_id}>
        <legend>¿Nos recomendó a alguien?</legend>
        <div className="flex flex-wrap gap-2">
          {([['si', 'Sí'], ['no_quiso', 'No quiso'], ['no_se_lo_pedi', 'No se lo pedí']] as const).map(([v, t]) => (
            <button key={v} type="button" onClick={() => setReferido(v)} aria-pressed={referido === v}
              className={`${BOTON} border ${referido === v ? 'bg-primary text-primary-foreground' : ''}`}>{t}</button>
          ))}
        </div>
        {referido === 'si' && !pv.referido_contacto_id && (
          <div className="grid gap-1 sm:grid-cols-2">
            <input value={refNombre} onChange={e => setRefNombre(e.target.value)} placeholder="Nombre" className="h-11 rounded-md border px-2" />
            <input value={refCel} onChange={e => setRefCel(e.target.value)} placeholder="Celular" inputMode="tel" className="h-11 rounded-md border px-2" />
          </div>
        )}
      </fieldset>
      <fieldset className="grid gap-1 sm:grid-cols-2" disabled={!puedePostventa}>
        <legend className="sm:col-span-2">¿Cuándo piensa volver a viajar?</legend>
        <input type="month" value={mes} onChange={e => setMes(e.target.value)} className="h-11 rounded-md border px-2" />
        <input value={destino} onChange={e => setDestino(e.target.value)} placeholder="Destino, si lo dijo" className="h-11 rounded-md border px-2" />
      </fieldset>
      {puedePostventa && <button type="button" disabled={isPending} onClick={guardarPostventa} className={PRIMARIO}>Guardar</button>}
    </div>
  )
}
