'use client'

import { useState, type ReactNode } from 'react'
import { AlertCircle, Check, ChevronDown, ChevronRight, Circle } from 'lucide-react'

/**
 * El editor de la cotización como CINCO pasos en acordeón (brief del 2026-09-23, PR 2).
 *
 * Mauricio, en el ensayo del caso Providencia: *«No hay una línea lógica de qué se debe hacer
 * primero, qué segundo, y el usuario debería ir desplegando lo que va a trabajar y no ver toda
 * la información junta.»*
 *
 *  · Arriba, los cinco pasos con su estado: hecho ✓, pendiente, o con error (y cuántos).
 *  · Uno abierto a la vez. Al terminar el que está abierto se abre el siguiente; cualquiera se
 *    vuelve a abrir con un clic.
 *  · En celular es el mismo acordeón, con «Siguiente» fijo abajo.
 *
 * Solo del flujo de viaje (Trappvel, `lineasPorTipo`): fuera de él el editor no monta esto.
 * El estado de cada paso lo decide `estado-pasos.ts`; aquí solo se pinta.
 */

export type EstadoPaso = 'hecho' | 'pendiente' | 'error'

export interface PasoCotizacion {
  id: string
  titulo: string
  estado: EstadoPaso
  /** Cuántos problemas tiene el paso, cuando está en error. */
  problemas?: number
  /** Una línea que dice por qué no está hecho, o qué hay. */
  detalle?: string | null
  contenido: ReactNode
}

export default function PasosCotizacion({ pasos }: { pasos: PasoCotizacion[] }) {
  const primeroPendiente = pasos.find(p => p.estado !== 'hecho')?.id ?? pasos[pasos.length - 1]?.id ?? null
  const [abierto, setAbierto] = useState<string | null>(primeroPendiente)
  // «Al terminar un paso se abre el siguiente»: si el que está abierto pasa a hecho entre un
  // render y el siguiente (lo guardado volvió del servidor), se abre el siguiente. Se ajusta al
  // pintar y no en un efecto: un efecto pintaría primero el paso viejo.
  const estados = pasos.map(p => `${p.id}:${p.estado}`).join('|')
  const [estadosVistos, setEstadosVistos] = useState(estados)
  if (estadosVistos !== estados) {
    const antes = new Map(estadosVistos.split('|').map(x => x.split(':') as [string, string]))
    const actual = pasos.find(p => p.id === abierto)
    if (actual && actual.estado === 'hecho' && antes.get(actual.id) !== 'hecho') {
      const i = pasos.findIndex(p => p.id === actual.id)
      const siguiente = pasos.slice(i + 1).find(p => p.estado !== 'hecho') ?? pasos[i + 1]
      if (siguiente) setAbierto(siguiente.id)
    }
    setEstadosVistos(estados)
  }

  const indiceAbierto = pasos.findIndex(p => p.id === abierto)
  const siguiente = indiceAbierto >= 0 ? pasos[indiceAbierto + 1] ?? null : null

  return (
    <div className="space-y-2 pb-16 sm:pb-0">
      <nav aria-label="Pasos de la cotización" className="flex flex-wrap gap-1.5">
        {pasos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setAbierto(p.id)}
            aria-current={p.id === abierto ? 'step' : undefined}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              p.id === abierto ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white' : 'bg-background text-[#1A1A1A] hover:bg-accent'
            }`}
          >
            <MarcaEstado estado={p.estado} problemas={p.problemas} activo={p.id === abierto} />
            <span>{i + 1}. {p.titulo}</span>
          </button>
        ))}
      </nav>

      {pasos.map((p, i) => {
        const esAbierto = p.id === abierto
        return (
          <section key={p.id} aria-label={p.titulo} className="rounded-xl border bg-background">
            <button
              type="button"
              onClick={() => setAbierto(esAbierto ? null : p.id)}
              aria-expanded={esAbierto}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
            >
              {esAbierto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <span className="text-sm font-semibold text-[#1A1A1A]">{i + 1}. {p.titulo}</span>
              <MarcaEstado estado={p.estado} problemas={p.problemas} activo={false} />
              {p.detalle && !esAbierto && <span className="min-w-0 flex-1 truncate text-[11px] text-[#6B7280]">{p.detalle}</span>}
            </button>
            {/* Los pasos cerrados se OCULTAN, no se desmontan: un texto a medio escribir en
                «Texto para el cliente» no puede perderse por abrir «Tarifas». */}
            <div hidden={!esAbierto} className="space-y-3 border-t px-3 pb-3 pt-3">{p.contenido}</div>
          </section>
        )
      })}

      {/* En celular, un paso por pantalla y «Siguiente» fijo abajo. */}
      {siguiente && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-2 sm:hidden">
          <button
            type="button"
            onClick={() => {
              setAbierto(siguiente.id)
              if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            className="w-full rounded-lg bg-[#1A1A1A] py-2.5 text-sm font-medium text-white"
          >
            Siguiente: {siguiente.titulo}
          </button>
        </div>
      )}
    </div>
  )
}

function MarcaEstado({ estado, problemas, activo }: { estado: EstadoPaso; problemas?: number; activo: boolean }) {
  if (estado === 'hecho') {
    return (
      <span className={`inline-flex items-center ${activo ? 'text-white' : 'text-[#10B981]'}`} title="Hecho">
        <Check className="h-3.5 w-3.5" aria-label="Hecho" />
      </span>
    )
  }
  if (estado === 'error') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 text-[10px] font-semibold text-red-700" title="Requiere atención">
        <AlertCircle className="h-3 w-3" aria-hidden />
        {problemas ?? '!'}
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center ${activo ? 'text-white/70' : 'text-[#6B7280]'}`} title="Pendiente">
      <Circle className="h-3 w-3" aria-label="Pendiente" />
    </span>
  )
}
