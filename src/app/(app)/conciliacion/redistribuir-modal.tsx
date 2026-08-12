'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Loader2, AlertTriangle, Search } from 'lucide-react'
import { toast } from 'sonner'
import { redistribuirReferencia } from '@/lib/actions/conciliacion-actions'
import { buscarNegociosParaValida } from '@/lib/actions/valida-consultas'
import type { ReferenciaPago } from '@/lib/actions/conciliacion-actions'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const VERDE = '#10B981'
const AMBAR = '#B45309'

type Linea = {
  key: string
  negocioId: string
  negocioCodigo: string | null
  negocioNombre: string | null
  monto: number
  porDevolver: boolean
  /** Ya tiene factura emitida: de este no se puede quitar plata. */
  facturado: boolean
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

/**
 * Editar cómo se reparte una referencia de pago entre negocios.
 *
 * Una sola pantalla para los cuatro gestos: repartir, deshacer el reparto, dejar todo en
 * el negocio original y mover la referencia completa a otro negocio. Todos son editar
 * esta lista. Cuatro botones distintos serían cuatro caminos que mantener y equivocar.
 *
 * La validación de verdad vive en el servidor (`planearRedistribucion`); acá se calcula
 * lo mismo solo para que la persona vea el descuadre mientras escribe, no para decidir.
 */
export function RedistribuirModal({
  referencia,
  onCerrar,
  onListo,
}: {
  referencia: ReferenciaPago
  onCerrar: () => void
  onListo: () => void
}) {
  const pagoOriginal = referencia.total_declarado ?? referencia.valor_pagado

  const [lineas, setLineas] = useState<Linea[]>(() =>
    referencia.porciones
      .filter(p => p.negocio_id && !p.por_devolver)
      .map((p, i) => ({
        key: `p${i}`,
        negocioId: p.negocio_id as string,
        negocioCodigo: p.negocio_codigo,
        negocioNombre: p.negocio_nombre,
        monto: p.monto,
        porDevolver: false,
        facturado: false,
      })),
  )
  const [motivo, setMotivo] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isPending) onCerrar() }
    document.addEventListener('keydown', onKey)
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previo
    }
  }, [onCerrar, isPending])

  const totalAsignado = useMemo(
    () => lineas.filter(l => !l.porDevolver).reduce((s, l) => s + (l.monto || 0), 0),
    [lineas],
  )
  const totalPorDevolver = useMemo(
    () => lineas.filter(l => l.porDevolver).reduce((s, l) => s + (l.monto || 0), 0),
    [lineas],
  )
  const sinAsignar = pagoOriginal - totalAsignado - totalPorDevolver
  const sobrepasa = sinAsignar < -1

  const guardar = () => {
    startTransition(async () => {
      const res = await redistribuirReferencia({
        externalRef: referencia.external_ref,
        pagoOriginal,
        lineas: lineas
          .filter(l => l.negocioId && l.monto > 0)
          .map(l => ({ negocioId: l.negocioId, monto: l.monto, porDevolver: l.porDevolver })),
        motivo,
      })

      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(
        res.gatesReabiertos > 0
          ? `Reparto actualizado. ${res.gatesReabiertos} ${res.gatesReabiertos === 1 ? 'gate reabierto' : 'gates reabiertos'}: revisa esos casos.`
          : 'Reparto actualizado.',
      )
      onListo()
    })
  }

  const contenido = (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={() => !isPending && onCerrar()}
    >
      <div
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="shrink-0 border-b px-5 py-4" style={{ borderColor: BORDE }}>
          <h2 className="text-base font-bold" style={{ color: CARBON }}>
            Repartir la referencia {referencia.external_ref}
          </h2>
          <p className="mt-1 text-xs" style={{ color: GRIS }}>
            Pago de <strong style={{ color: CARBON }}>{fmt(pagoOriginal)}</strong>
            {referencia.fuente ? ` · ${referencia.fuente}` : ''}. Agrega, edita o elimina
            líneas: así se reparte, se deshace un reparto o se pasa todo a otro negocio.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            {lineas.map((l, idx) => (
              <FilaLinea
                key={l.key}
                linea={l}
                onCambiar={(cambios) =>
                  setLineas(prev => prev.map((x, i) => (i === idx ? { ...x, ...cambios } : x)))
                }
                onEliminar={() => setLineas(prev => prev.filter((_, i) => i !== idx))}
                deshabilitado={isPending}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setLineas(prev => [
                ...prev,
                {
                  key: `n${Date.now()}`,
                  negocioId: '',
                  negocioCodigo: null,
                  negocioNombre: null,
                  monto: 0,
                  porDevolver: false,
                  facturado: false,
                },
              ])
            }
            disabled={isPending}
            className="mt-3 flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-[#F5F4F2] disabled:opacity-50"
            style={{ borderColor: BORDE, color: CARBON }}
          >
            <Plus className="h-3.5 w-3.5" /> Agregar negocio
          </button>

          {/* El descuadre se ve mientras se escribe, no al guardar. */}
          <div className="mt-4 rounded-lg border p-3" style={{ borderColor: sobrepasa ? AMBAR : BORDE }}>
            <Renglon label="Pago recibido" valor={fmt(pagoOriginal)} />
            <Renglon label="Asignado a negocios" valor={fmt(totalAsignado)} />
            {totalPorDevolver > 0 && (
              <Renglon label="Por devolver al cliente" valor={fmt(totalPorDevolver)} />
            )}
            <div className="mt-2 border-t pt-2" style={{ borderColor: BORDE }}>
              <Renglon
                label={sinAsignar < 0 ? 'Te pasaste por' : 'Sin asignar'}
                valor={fmt(Math.abs(sinAsignar))}
                fuerte
                color={sobrepasa ? AMBAR : sinAsignar > 1 ? GRIS : VERDE}
              />
            </div>
            {sobrepasa && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px]" style={{ color: AMBAR }}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Estás repartiendo más plata de la que llegó. Ajusta los montos.
              </p>
            )}
          </div>

          <label className="mt-4 block">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: GRIS }}>
              Por qué se redistribuye
            </span>
            <textarea
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              rows={2}
              disabled={isPending}
              placeholder="Ej: el comercial partió la referencia equivocada; esta era la de la tarifa."
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
              style={{ borderColor: BORDE, color: CARBON }}
            />
            <span className="text-[11px]" style={{ color: GRIS }}>
              Queda escrito en el timeline de cada negocio. Es lo único que después explica
              por qué se movió la plata.
            </span>
          </label>
        </div>

        <div className="shrink-0 border-t px-5 py-4" style={{ borderColor: BORDE }}>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCerrar}
              disabled={isPending}
              className="rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[#F5F4F2] disabled:opacity-50"
              style={{ borderColor: BORDE, color: CARBON }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={isPending || sobrepasa || motivo.trim().length < 10}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#10B981] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar el reparto
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(contenido, document.body)
}

function Renglon({
  label, valor, fuerte, color,
}: { label: string; valor: string; fuerte?: boolean; color?: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-xs" style={{ color: GRIS }}>{label}</span>
      <span
        className={`tabular-nums ${fuerte ? 'text-sm font-bold' : 'text-xs font-medium'}`}
        style={{ color: color ?? CARBON }}
      >
        {valor}
      </span>
    </div>
  )
}

function FilaLinea({
  linea, onCambiar, onEliminar, deshabilitado,
}: {
  linea: Linea
  onCambiar: (c: Partial<Linea>) => void
  onEliminar: () => void
  deshabilitado: boolean
}) {
  const [cambiando, setCambiando] = useState(false)
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<Array<{ id: string; codigo: string | null; nombre: string | null }>>([])

  // ⚠️ El buscador está a la vista cuando la línea todavía NO tiene negocio (recién
  // agregada) o cuando se pidió cambiar el que tenía. La búsqueda depende de ESO, no de
  // la bandera `cambiando`: una línea nueva muestra el buscador con `cambiando` en false,
  // así que atarla a la bandera dejaba el campo mudo — se escribía y no aparecía nada,
  // sin error. Lo destapó el QA en pantalla; ninguna prueba de los módulos puros podía
  // verlo, porque el defecto vivía en la condición de render.
  const buscadorVisible = !linea.negocioId || cambiando

  useEffect(() => {
    let vivo = true
    const termino = q.trim()
    const t = setTimeout(async () => {
      if (!buscadorVisible || termino.length < 2) { if (vivo) setResultados([]); return }
      const res = await buscarNegociosParaValida(termino)
      if (vivo) setResultados(res.ok ? res.negocios.slice(0, 8) : [])
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [q, buscadorVisible])

  return (
    <div className="rounded-lg border p-3" style={{ borderColor: BORDE }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {!buscadorVisible ? (
            <button
              type="button"
              onClick={() => !deshabilitado && setCambiando(true)}
              className="text-left"
            >
              <span className="rounded bg-[#1A1A1A] px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white">
                {linea.negocioCodigo ?? 'Negocio'}
              </span>
              <p className="mt-1 truncate text-sm" style={{ color: CARBON }}>
                {linea.negocioNombre ?? 'Sin nombre'}
              </p>
              <span className="text-[10px]" style={{ color: GRIS }}>Cambiar negocio</span>
            </button>
          ) : (
            <div>
              <div className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5" style={{ borderColor: BORDE }}>
                <Search className="h-3.5 w-3.5 shrink-0" style={{ color: GRIS }} />
                <input
                  autoFocus
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Código o nombre del negocio"
                  className="w-full text-sm outline-none"
                  style={{ color: CARBON }}
                />
              </div>
              {resultados.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border" style={{ borderColor: BORDE }}>
                  {resultados.map(n => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onCambiar({ negocioId: n.id, negocioCodigo: n.codigo, negocioNombre: n.nombre })
                          setCambiando(false); setQ(''); setResultados([])
                        }}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[#F5F4F2]"
                      >
                        <span className="font-bold" style={{ color: CARBON }}>{n.codigo}</span>
                        <span className="truncate" style={{ color: GRIS }}>{n.nombre}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0">
          <input
            type="number"
            value={linea.monto || ''}
            onChange={e => onCambiar({ monto: Number(e.target.value) || 0 })}
            disabled={deshabilitado}
            className="w-32 rounded-lg border px-2 py-1.5 text-right text-sm tabular-nums disabled:opacity-50"
            style={{ borderColor: BORDE, color: CARBON }}
            placeholder="0"
          />
        </div>

        <button
          type="button"
          onClick={onEliminar}
          disabled={deshabilitado}
          aria-label="Quitar esta línea"
          className="shrink-0 rounded-lg p-2 transition-colors hover:bg-[#F5F4F2] disabled:opacity-50"
          style={{ color: GRIS }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <label className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: GRIS }}>
        <input
          type="checkbox"
          checked={linea.porDevolver}
          onChange={e => onCambiar({ porDevolver: e.target.checked })}
          disabled={deshabilitado}
        />
        Esta parte se le devuelve al cliente
      </label>
    </div>
  )
}
