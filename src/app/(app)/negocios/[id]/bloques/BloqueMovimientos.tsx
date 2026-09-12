'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDownLeft, ArrowUpRight, Clock, Plus, Receipt, Wallet } from 'lucide-react'
import DistribuirPagoModal from '@/components/distribuir-pago-modal'
import { referenciaVisible } from '@/lib/cobros/referencia-externa'
import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'
import GastosPorCategoria, { type CategoriaGasto } from './financiero/GastosPorCategoria'
import { fmt } from './financiero/formato'

/** Un cobro, reducido a lo que hace falta para leerlo como movimiento de entrada. */
export interface MovimientoCobro {
  id: string
  concepto: string | null
  monto: number
  fecha: string | null
  fecha_esperada: string | null
  external_ref: string | null
  vencido: boolean
}

interface BloqueMovimientosProps {
  /** Para prellenar el destino del gasto: el negocio que se está mirando. */
  negocioId: string
  cobros: MovimientoCobro[]
  gastosPorCategoria: CategoriaGasto[]
  totalGastos: number
  totalHoras: number
  costoHoras: number
  modo: 'editable' | 'visible'
  /** Habilita "Registrar pago". Solo en modo editable y fuera del historial. */
  registrarPagoEnabled?: boolean
  negocioFijado?: { negocio_id: string; codigo: string | null; nombre: string | null }
}

type Filtro = 'todo' | 'entradas' | 'salidas'

/**
 * Los MOVIMIENTOS del negocio: lo que entró y lo que salió, en una sola tarjeta.
 *
 * Antes esto vivía repartido en dos bloques (Cobros y Ejecución) que respondían la
 * misma pregunta desde dos lados. En una operación de una sola persona eso no es
 * separación de funciones, es tener que abrir dos tarjetas para saber cómo va la plata.
 * El resultado (margen, presupuesto, ganancia) NO va aquí: va en el bloque de Resultado.
 */
export default function BloqueMovimientos({
  negocioId,
  cobros,
  gastosPorCategoria,
  totalGastos,
  totalHoras,
  costoHoras,
  modo,
  registrarPagoEnabled = false,
  negocioFijado,
}: BloqueMovimientosProps) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<Filtro>('todo')
  const [pagoModal, setPagoModal] = useState(false)

  // Un cobro sin fecha es una cuota esperada, no plata que entró. Se lista aparte para
  // que el total de entradas no se infle con lo que todavía no llega.
  const recibidos = cobros.filter(c => c.fecha !== null)
  const esperados = cobros.filter(c => c.fecha === null)
  const totalEntradas = recibidos.reduce((s, c) => s + c.monto, 0)
  const totalSalidas = totalGastos + costoHoras
  const neto = totalEntradas - totalSalidas

  const verEntradas = filtro !== 'salidas'
  const verSalidas = filtro !== 'entradas'
  const puedeRegistrar = modo === 'editable' && registrarPagoEnabled

  return (
    <div className="space-y-3">
      {/* Los tres números que responden "¿cómo va la plata?" sin abrir nada más. */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-green-100 bg-green-50 p-2.5">
          <div className="mb-0.5 flex items-center gap-1">
            <ArrowDownLeft className="h-3 w-3 text-green-500" />
            <p className="text-[10px] font-medium text-green-600">Entró</p>
          </div>
          <p className="text-sm font-bold tabular-nums text-green-700">{fmt(totalEntradas)}</p>
        </div>
        <div className="rounded-lg border border-red-100 bg-red-50 p-2.5">
          <div className="mb-0.5 flex items-center gap-1">
            <ArrowUpRight className="h-3 w-3 text-red-500" />
            <p className="text-[10px] font-medium text-red-600">Salió</p>
          </div>
          <p className="text-sm font-bold tabular-nums text-red-700">{fmt(totalSalidas)}</p>
          {costoHoras > 0 && (
            <p className="text-[10px] tabular-nums text-red-500">incluye {totalHoras}h</p>
          )}
        </div>
        <div
          className={`rounded-lg border p-2.5 ${neto >= 0 ? 'border-acento/30 bg-acento/10' : 'border-red-100 bg-red-50'}`}
        >
          <div className="mb-0.5 flex items-center gap-1">
            <Wallet className={`h-3 w-3 ${neto >= 0 ? 'text-acento' : 'text-red-500'}`} />
            <p className={`text-[10px] font-medium ${neto >= 0 ? 'text-acento' : 'text-red-600'}`}>Neto en caja</p>
          </div>
          <p className={`text-sm font-bold tabular-nums ${neto >= 0 ? 'text-acento' : 'text-red-700'}`}>
            {fmt(neto)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="Filtrar movimientos">
          {(['todo', 'entradas', 'salidas'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              aria-pressed={filtro === f}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium capitalize transition-colors ${
                filtro === f
                  ? 'bg-tinta text-papel'
                  : 'border border-[#E5E7EB] text-tinta-suave hover:bg-black/[0.03]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 gap-1">
          {/* El gasto es el movimiento más frecuente de una obra y era el que tenía más
              pasos: había que salir de la ficha, abrir el FAB y volver a elegir el
              negocio. Elegirlo mal es plata imputada a otro proyecto, así que el destino
              viaja en la URL y el formulario lo recibe ya puesto. Es el MISMO formulario
              de siempre (categorías, centro de costos, soporte), no una copia. */}
          {modo === 'editable' && (
            <Link
              href={`/nuevo/gasto?negocio=${negocioId}`}
              className="flex items-center gap-1 rounded-full border border-[#E5E7EB] px-2.5 py-1 text-[10px] font-medium text-tinta hover:bg-black/[0.03]"
            >
              <Receipt className="h-3 w-3" /> Registrar gasto
            </Link>
          )}
          {puedeRegistrar && (
            <button
              type="button"
              onClick={() => setPagoModal(true)}
              className="flex items-center gap-1 rounded-full bg-acento px-2.5 py-1 text-[10px] font-medium text-papel"
            >
              <Plus className="h-3 w-3" /> Registrar pago
            </button>
          )}
        </div>
      </div>

      {verEntradas && (
        <div>
          <p className="mb-1.5 text-[10px] font-medium text-tinta-suave">Entradas</p>
          {recibidos.length === 0 ? (
            <p className="text-[10px] text-tinta-suave/60">Todavía no ha entrado plata de este negocio.</p>
          ) : (
            <ul className="space-y-1">
              {recibidos.map(c => (
                <li key={c.id} className="flex items-start gap-2">
                  <span className="w-14 shrink-0 text-[10px] tabular-nums text-tinta-suave">
                    {formatBogotaFechaCortaAno(c.fecha) ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[10px] text-tinta">
                    {c.concepto || 'Pago'}
                    {referenciaVisible(c.external_ref) && (
                      <span className="ml-1 text-tinta-suave">· {referenciaVisible(c.external_ref)}</span>
                    )}
                  </span>
                  <span className="w-24 shrink-0 text-right text-[10px] font-medium tabular-nums text-green-700">
                    {fmt(c.monto)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Lo esperado no suma a lo que entró, pero tampoco puede desaparecer: es la
              única pista de que falta cobrar algo. */}
          {esperados.length > 0 && (
            <ul className="mt-1.5 space-y-1 border-t border-dashed border-[#E5E7EB] pt-1.5">
              {esperados.map(c => (
                <li key={c.id} className="flex items-start gap-2">
                  <span className="flex w-14 shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-tinta-suave">
                    <Clock className="h-2.5 w-2.5" />
                    {formatBogotaFechaCortaAno(c.fecha_esperada) ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[10px] text-tinta-suave">
                    {c.concepto || 'Cuota'} · esperado
                    {c.vencido && <span className="ml-1 font-medium text-red-600">vencido</span>}
                  </span>
                  <span className="w-24 shrink-0 text-right text-[10px] tabular-nums text-tinta-suave">
                    {fmt(c.monto)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {verSalidas && (
        <GastosPorCategoria
          categorias={gastosPorCategoria}
          totalGastos={totalGastos}
          titulo="Salidas por categoría"
        />
      )}

      {verSalidas && costoHoras > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5">
          <span className="flex items-center gap-1 text-[10px] font-medium text-blue-600">
            <Clock className="h-3 w-3" /> Horas del equipo ({totalHoras}h)
          </span>
          <span className="text-[10px] font-bold tabular-nums text-blue-700">{fmt(costoHoras)}</span>
        </div>
      )}

      {pagoModal && (
        <DistribuirPagoModal
          negocioFijado={negocioFijado}
          onClose={() => setPagoModal(false)}
          onDone={() => { setPagoModal(false); router.refresh() }}
        />
      )}
    </div>
  )
}
