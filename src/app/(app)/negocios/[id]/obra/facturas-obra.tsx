'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileText, Loader2, Paperclip, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { hrefArchivo } from '@/lib/almacenamiento/referencia'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { diferenciaDeFactura } from '@/lib/obras/facturas'
import { fechaLegible, pesos } from '@/lib/obras/formato'
import type { CobroDeLaObra, FacturaDeLaObra } from '@/lib/obras/servidor'
import { uploadSoporteGasto } from '@/app/(app)/nuevo/gasto/gasto-action'
import {
  asociarCobroAFactura,
  eliminarFacturaObra,
  guardarFacturaObra,
  marcarFacturaPagada,
  reabrirFacturaObra,
} from '../../obra-actions'
import { botonPrimario, botonSecundario, cabecera, campo, etiqueta, tarjeta } from './ui'

interface Borrador {
  id: string | null
  numero_factura: string
  fecha_emision: string
  monto: string
  soporte_url: string | null
}

/** Pregunta abierta al marcar pagada con diferencia (§6.3-d). */
interface Pregunta {
  facturaId: string
  numero: string
  diferencia: number
  /** Respondió que no: se explica qué hacer y no se marca. */
  respuestaNo: string | null
}

/**
 * Facturas de la obra (C9, C10): número, fecha, total, lo recibido y el estado. Lo recibido, el
 * saldo y lo retenido los calcula la vista; aquí solo se muestran.
 */
export function FacturasObra({
  negocioId,
  facturas,
  cobros,
  puedeEditar,
}: {
  negocioId: string
  facturas: FacturaDeLaObra[]
  cobros: CobroDeLaObra[]
  puedeEditar: boolean
}) {
  const router = useRouter()
  const [pendiente, startTransition] = useTransition()
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [repetido, setRepetido] = useState<string | null>(null)
  const [pregunta, setPregunta] = useState<Pregunta | null>(null)
  const inputArchivo = useRef<HTMLInputElement>(null)

  const abiertas = facturas.filter((f) => f.estado === 'abierta')
  const numeroDe = new Map(facturas.map((f) => [f.id, f.numero_factura ?? 'Sin número']))
  const pagadaDe = new Map(facturas.map((f) => [f.id, f.estado === 'pagada']))

  const nueva = () => {
    setRepetido(null)
    setArchivo(null)
    setBorrador({ id: null, numero_factura: '', fecha_emision: todayBogotaISO(), monto: '', soporte_url: null })
  }

  const guardar = (confirmarRepetido = false) =>
    startTransition(async () => {
      if (!borrador) return
      let soporte = borrador.soporte_url
      if (archivo) {
        const fd = new FormData()
        fd.append('file', archivo)
        const up = await uploadSoporteGasto(fd)
        if (!up.success || !up.url) return void toast.error(up.error ?? 'No se pudo subir el soporte')
        soporte = up.url
      }
      const r = await guardarFacturaObra(negocioId, borrador.id, {
        numero_factura: borrador.numero_factura,
        fecha_emision: borrador.fecha_emision,
        monto: borrador.monto,
        soporte_url: soporte,
        confirmarRepetido,
      })
      if (!r.ok) {
        if ('repetido' in r && r.repetido) {
          setBorrador({ ...borrador, soporte_url: soporte })
          setArchivo(null)
          return void setRepetido(r.error)
        }
        return void toast.error(r.error)
      }
      toast.success(borrador.id ? 'Factura corregida' : 'Factura registrada')
      setBorrador(null)
      setArchivo(null)
      setRepetido(null)
      router.refresh()
    })

  const correr = (fn: () => Promise<{ ok: boolean; error?: string }>, exito: string) =>
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) return void toast.error(r.error ?? 'No se pudo.')
      toast.success(exito)
      router.refresh()
    })

  const marcar = (f: FacturaDeLaObra, respuesta: 'si' | 'no' | null) =>
    startTransition(async () => {
      const r = await marcarFacturaPagada(f.id, respuesta)
      if (r.ok) {
        toast.success(`Factura ${f.numero_factura ?? ''} marcada pagada`)
        setPregunta(null)
        return void router.refresh()
      }
      if ('pregunta' in r) {
        return void setPregunta({ facturaId: f.id, numero: f.numero_factura ?? 'Sin número', diferencia: r.diferencia, respuestaNo: null })
      }
      if ('noMarcada' in r) {
        return void setPregunta((p) => (p ? { ...p, respuestaNo: r.error } : p))
      }
      toast.error(r.error)
    })

  const facturaDePregunta = pregunta ? facturas.find((f) => f.id === pregunta.facturaId) : null

  return (
    <section className={tarjeta} data-facturas-obra>
      <div className={cabecera}>
        <div className="flex items-center gap-1.5">
          <FileText className="h-4 w-4 text-tinta-suave" />
          <h3 className="text-sm font-semibold text-foreground">Facturas</h3>
        </div>
        {puedeEditar && !borrador && (
          <button type="button" className={botonPrimario} onClick={nueva}>
            <Plus className="h-3.5 w-3.5" /> Registrar factura
          </button>
        )}
      </div>

      {borrador && (
        <div className="grid gap-3 border-b bg-muted/30 p-4 sm:grid-cols-3" data-borrador-factura>
          <label className={etiqueta}>
            Número
            <input className={campo} value={borrador.numero_factura} onChange={(e) => setBorrador({ ...borrador, numero_factura: e.target.value })} placeholder="FE-231" />
          </label>
          <label className={etiqueta}>
            Fecha
            <input type="date" className={campo} max={todayBogotaISO()} value={borrador.fecha_emision} onChange={(e) => setBorrador({ ...borrador, fecha_emision: e.target.value })} />
          </label>
          <label className={etiqueta}>
            Total
            <input className={campo} type="number" inputMode="numeric" min={1} value={borrador.monto} onChange={(e) => setBorrador({ ...borrador, monto: e.target.value })} placeholder="25000000" />
          </label>
          <div className="sm:col-span-3">
            <input
              ref={inputArchivo}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null)
                if (inputArchivo.current) inputArchivo.current.value = ''
              }}
            />
            <button type="button" className={botonSecundario} onClick={() => inputArchivo.current?.click()}>
              <Paperclip className="h-3.5 w-3.5" />
              {archivo ? archivo.name : borrador.soporte_url ? 'Cambiar soporte' : 'Adjuntar soporte (opcional)'}
            </button>
          </div>
          {repetido && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-3" data-factura-repetida>
              <p>{repetido}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={botonSecundario} disabled={pendiente} onClick={() => guardar(true)}>
                  Sí, es otra factura
                </button>
                <button type="button" className="h-9 px-2 text-xs" onClick={() => setRepetido(null)}>
                  No, corrijo el número
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-2 sm:col-span-3">
            <button type="button" className={botonPrimario} disabled={pendiente} onClick={() => guardar(false)}>
              {pendiente && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
            </button>
            <button type="button" className="h-9 px-2 text-xs text-muted-foreground" onClick={() => (setBorrador(null), setRepetido(null))}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {pregunta && facturaDePregunta && (
        <div className="border-b bg-amber-50 p-4 text-xs text-amber-900" role="alertdialog" aria-label="¿Toda la diferencia es retención?" data-pregunta-retencion>
          <p>
            La factura <strong>{pregunta.numero}</strong> tiene {pesos(facturaDePregunta.monto)} facturados y {pesos(facturaDePregunta.recibido)} recibidos: faltan{' '}
            <strong>{pesos(pregunta.diferencia)}</strong>.
          </p>
          {pregunta.respuestaNo ? (
            <>
              <p className="mt-2">{pregunta.respuestaNo}</p>
              <button type="button" className={`${botonSecundario} mt-2`} onClick={() => setPregunta(null)}>
                Entendido
              </button>
            </>
          ) : (
            <>
              <p className="mt-2 font-semibold">¿Toda la diferencia es retención?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={botonPrimario} disabled={pendiente} onClick={() => marcar(facturaDePregunta, 'si')}>
                  Sí, es retención
                </button>
                <button type="button" className={botonSecundario} disabled={pendiente} onClick={() => marcar(facturaDePregunta, 'no')}>
                  No, hay otro descuento
                </button>
                <button type="button" className="h-9 px-2 text-xs" onClick={() => setPregunta(null)}>
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {facturas.length === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">Esta obra todavía no tiene facturas.</p>
      ) : (
        <ul className="divide-y" data-lista-facturas>
          {facturas.map((f) => {
            const soporte = hrefArchivo(f.soporte_url)
            const diferencia = diferenciaDeFactura(f)
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
                <span className="font-semibold text-foreground">{f.numero_factura ?? 'Sin número'}</span>
                <span className="text-muted-foreground">{fechaLegible(f.fecha_emision)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${f.estado === 'pagada' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
                >
                  {f.estado === 'pagada' ? 'Pagada' : 'Abierta'}
                </span>
                {soporte && (
                  <a href={soporte} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted-foreground hover:underline">
                    <Paperclip className="h-3 w-3" /> Soporte
                  </a>
                )}
                <span className="ml-auto tabular-nums text-foreground">
                  {pesos(f.monto)} · recibido {pesos(f.recibido)}
                  {f.estado === 'pagada'
                    ? ` · retenido ${pesos(f.retenido)}`
                    : diferencia > 0
                      ? ` · saldo ${pesos(f.saldo_pendiente)}`
                      : ''}
                </span>
                {puedeEditar && (
                  <span className="flex w-full justify-end gap-1 sm:w-auto">
                    {f.estado === 'abierta' ? (
                      <>
                        <button type="button" className={botonSecundario} disabled={pendiente} onClick={() => marcar(f, null)} data-marcar-pagada>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Marcar pagada
                        </button>
                        <button
                          type="button"
                          aria-label="Corregir factura"
                          className="rounded p-2 hover:bg-accent"
                          onClick={() => {
                            setRepetido(null)
                            setArchivo(null)
                            setBorrador({ id: f.id, numero_factura: f.numero_factura ?? '', fecha_emision: f.fecha_emision ?? todayBogotaISO(), monto: String(f.monto), soporte_url: f.soporte_url })
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Borrar factura"
                          className="rounded p-2 hover:bg-accent"
                          disabled={pendiente}
                          onClick={() => {
                            if (window.confirm(`¿Borrar la factura ${f.numero_factura ?? ''}?`)) correr(() => eliminarFacturaObra(f.id), 'Factura borrada')
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <button type="button" className={botonSecundario} disabled={pendiente} onClick={() => correr(() => reabrirFacturaObra(f.id), 'Factura reabierta')}>
                        <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                      </button>
                    )}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Los pagos recibidos de la obra y la factura que pagan. */}
      {cobros.length > 0 && (
        <div className="border-t p-4" data-pagos-obra>
          <p className="mb-2 text-xs font-semibold text-foreground">Pagos recibidos de la obra</p>
          <ul className="space-y-1.5">
            {cobros.map((c) => {
              const deFacturaPagada = !!c.factura_id && pagadaDe.get(c.factura_id) === true
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{fechaLegible(c.fecha)}</span>
                  <span className="tabular-nums font-medium">{pesos(c.monto)}</span>
                  {c.numero_transaccion && <span className="text-muted-foreground">#{c.numero_transaccion}</span>}
                  <span className="ml-auto min-w-[10rem]">
                    {puedeEditar && !deFacturaPagada ? (
                      <select
                        aria-label="Factura que paga"
                        className={`${campo} h-8 text-xs`}
                        value={c.factura_id ?? ''}
                        disabled={pendiente}
                        onChange={(e) => correr(() => asociarCobroAFactura(c.id, e.target.value || null), 'Pago asociado')}
                      >
                        <option value="">Sin factura</option>
                        {abiertas.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.numero_factura ?? 'Sin número'} · saldo {pesos(f.saldo_pendiente)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-muted-foreground">{c.factura_id ? `Factura ${numeroDe.get(c.factura_id) ?? ''}` : 'Sin factura'}</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
