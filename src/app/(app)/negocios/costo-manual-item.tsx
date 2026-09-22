'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { guardarCostoManualEnMoneda } from '@/app/(app)/negocios/costo-manual-actions'
import { costoManualVigente, normalizarCostoManual } from '@/lib/cotizaciones/costo-manual'
import { leerTarifaPax, MONEDAS_FRECUENTES } from '@/lib/cotizaciones/tarifa-pasajero'
import { formatCOP } from '@/lib/contacts/constants'

/**
 * El costo unitario escrito a mano en una línea de viaje, con su moneda (brief del
 * 2026-09-22, parte 2: *«cada bloque de cada ítem debe poder configurar la moneda; por
 * defecto COP»*).
 *
 * Solo lo monta el flujo de viaje (`lineasPorTipo`). Las cotizaciones de Termotech, Arca o
 * WMC siguen con su casilla en pesos de siempre: ahí un proveedor en dólares no existe, y
 * ofrecerlo sería ruido (R6).
 *
 * Lo que se guarda en `items.subtotal` son pesos; lo escrito —moneda, valor y tasa— queda
 * anotado y se enseña mientras explique esos pesos (`costoManualVigente`).
 */
export default function CostoManualItem({
  itemId,
  subtotalPesos,
  tarifaPax,
  onCambio,
}: {
  itemId: string
  /** `items.subtotal`: el costo unitario en pesos que hay hoy. */
  subtotalPesos: number
  tarifaPax: unknown
  onCambio: () => void
}) {
  const anotado = leerTarifaPax(tarifaPax).costoManual
  const vigente = costoManualVigente(anotado, subtotalPesos) ? anotado : null
  const [moneda, setMoneda] = useState(vigente?.moneda ?? 'COP')
  const [valor, setValor] = useState(
    vigente ? String(vigente.valor) : subtotalPesos ? subtotalPesos.toLocaleString('es-CO') : '',
  )
  const [tasa, setTasa] = useState(vigente ? String(vigente.tasa) : '')
  const [isPending, startTransition] = useTransition()

  const enCOP = moneda === 'COP'
  const entrada = { valor: numero(valor), moneda, tasa: numero(tasa) || null }
  const vistaPrevia = normalizarCostoManual(entrada)
  const monedas = MONEDAS_FRECUENTES.includes(moneda) ? MONEDAS_FRECUENTES : [...MONEDAS_FRECUENTES, moneda]

  function guardar(e = entrada, avisar = true) {
    const limpio = normalizarCostoManual(e)
    if (!limpio.ok) { if (avisar) toast.error(limpio.motivo); return }
    // Nada cambió: no se escribe (igual que la casilla en pesos de siempre).
    if (limpio.pesos === Math.round(subtotalPesos)
      && (limpio.origen?.moneda ?? 'COP') === (vigente?.moneda ?? 'COP')
      && (limpio.origen?.tasa ?? null) === (vigente?.tasa ?? null)) return
    startTransition(async () => {
      const r = await guardarCostoManualEnMoneda(itemId, e)
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar el costo'); return }
      onCambio()
    })
  }

  return (
    <>
      <div className="flex gap-1">
        <select
          value={moneda}
          onChange={e => {
            setMoneda(e.target.value)
            // A pesos se guarda en el acto; a otra moneda, cuando haya tasa (sin avisar
            // todavía: la persona apenas la está escribiendo).
            guardar({ ...entrada, moneda: e.target.value }, false)
          }}
          aria-label="Moneda del costo"
          className="rounded border bg-background px-1 py-1.5 text-xs"
        >
          {monedas.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          type="text"
          inputMode="decimal"
          placeholder="Costo"
          value={valor}
          onChange={e => setValor(e.target.value)}
          onBlur={() => guardar()}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          aria-label={`Costo unitario en ${moneda}`}
          className="w-full min-w-0 rounded border bg-background px-2 py-1.5 text-sm tabular-nums"
        />
      </div>
      {!enCOP && (
        <div className="mt-1">
          <label className="mb-0.5 block text-[10px] text-muted-foreground" htmlFor={`tasa-${itemId}`}>Tasa {moneda} → COP</label>
          <input
            id={`tasa-${itemId}`}
            type="text"
            inputMode="decimal"
            placeholder="ej. 4150"
            value={tasa}
            onChange={e => setTasa(e.target.value)}
            onBlur={() => guardar()}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="w-20 rounded border bg-background px-1.5 py-1 text-[11px] tabular-nums"
          />
        </div>
      )}
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {isPending ? (
          <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Guardando…</span>
        ) : enCOP ? (
          'Lo que le pagas al proveedor'
        ) : vistaPrevia.ok ? (
          <>= {formatCOP(vistaPrevia.pesos)} en pesos. El sistema no consulta la TRM.</>
        ) : (
          <span className="text-amber-800">Escribe la tasa a pesos: sin ella el costo no se guarda.</span>
        )}
      </p>
    </>
  )
}

/** Un número escrito con puntos de miles o coma decimal, como lo teclea quien cotiza. */
function numero(texto: string): number {
  const t = texto.trim()
  if (t === '') return 0
  // «1.200,50» (es-CO) y «1200.50» se leen igual; «4.980.000» también.
  const normal = /,\d{1,2}$/.test(t)
    ? t.replace(/\./g, '').replace(',', '.')
    : (t.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(t)
      ? t.replace(/\./g, '')
      : t
  const n = Number(normal.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}
