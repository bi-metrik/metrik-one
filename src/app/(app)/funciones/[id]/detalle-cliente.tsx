'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { FuncionDelDia } from '@/lib/funciones/datos'
import { ETIQUETA_ESTADO_FUNCION, ETIQUETA_ESTADO_RESERVA, ETIQUETA_PAGO, fechaBogota, horaBogota } from '@/lib/funciones/reglas'
import { apartarEquipoAction, editarFuncionAction } from '../actions'
import { AccionesReserva } from '../acciones-reserva'

/**
 * El detalle de la función: cupo (total, ocupadas, libres), las reservas activas con lo que pidió cada cliente, y las
 * acciones del equipo (reserva tomada por el equipo, pago verificado a mano, cancelar, cupo y estado). Sin mapa.
 */
export function DetalleCliente({ funcion, puedeEditar }: { funcion: FuncionDelDia; puedeEditar: boolean }) {
  const { ocupacion: o, reservas } = funcion
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/funciones" className="text-xs text-[#6B7280] hover:underline">
            ← Funciones
          </Link>
          <h1 className="text-xl font-semibold text-[#1A1A1A]">{o.experiencia}</h1>
          <p className="text-sm text-[#6B7280] first-letter:uppercase">
            {fechaBogota(o.inicia_at)} · {horaBogota(o.inicia_at)} · {ETIQUETA_ESTADO_FUNCION[o.estado]}
          </p>
        </div>
        <div className="flex gap-3 text-center">
          {[
            ['Cupo', o.cupo_total],
            ['Ocupadas', o.ocupadas],
            ['Libres', o.libres],
          ].map(([t, n]) => (
            <div key={t} className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-2">
              <div className="text-lg font-semibold text-[#1A1A1A]">{n}</div>
              <div className="text-xs text-[#6B7280]">{t}</div>
            </div>
          ))}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[1fr_300px]">
        <section className="rounded-lg border border-[#E5E7EB] bg-white">
          <h2 className="border-b border-[#E5E7EB] px-4 py-2 text-sm font-medium">Reservas activas ({reservas.length})</h2>
          {reservas.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[#6B7280]">Sin reservas activas.</p>
          ) : (
            <ul className="divide-y divide-[#E5E7EB]">
              {reservas.map((r) => (
                <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-[#1A1A1A]">
                      {r.nombre ?? '(sin nombre)'} · {r.personas} {r.personas === 1 ? 'persona' : 'personas'}
                    </span>
                    {puedeEditar && <AccionesReserva funcionId={o.funcion_id} reservaId={r.id} estado={r.estado} nombre={r.nombre} />}
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    {ETIQUETA_ESTADO_RESERVA[r.estado]} · {ETIQUETA_PAGO[r.pago_estado]} · {r.canal}
                    {r.telefono ? ` · ${r.telefono}` : ''}
                  </div>
                  {r.solicitud_cliente && <div className="text-xs">Pidió: {r.solicitud_cliente}</div>}
                  <div className="text-xs">{r.autorizada ? `Restricciones: ${r.restricciones ?? '—'}` : <span className="text-[#6B7280]">Restricciones: sin autorización</span>}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="space-y-4">
          {puedeEditar && o.estado === 'abierta' && <NuevaReserva funcionId={o.funcion_id} />}
          {puedeEditar && <EditarFuncion o={o} />}
        </aside>
      </div>
    </div>
  )
}

function NuevaReserva({ funcionId }: { funcionId: string }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  // Una clave por formulario abierto: un doble clic en «Apartar» no aparta dos veces.
  const [clave, setClave] = useState<string | null>(null)
  if (clave === null) {
    return (
      <button
        type="button"
        onClick={() => setClave(`equipo-${crypto.randomUUID()}`)}
        className="w-full rounded-lg border border-dashed border-[#E5E7EB] px-3 py-2 text-sm text-[#6B7280] hover:bg-gray-50"
      >
        + Reserva tomada por el equipo
      </button>
    )
  }
  return (
    <form
      className="space-y-2 rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm"
      action={(f) =>
        empezar(async () => {
          const r = await apartarEquipoAction(funcionId, {
            personas: Number(f.get('personas')),
            nombre: String(f.get('nombre') ?? ''),
            telefono: String(f.get('telefono') ?? ''),
            solicitud_cliente: String(f.get('solicitud') ?? ''),
            clave,
          })
          if (r.ok) {
            toast.success('Reserva apartada.')
            setClave(null)
            router.refresh()
          } else toast.error(r.error)
        })
      }
    >
      <input name="nombre" placeholder="Nombre" required className="w-full rounded border px-2 py-1" />
      <div className="flex gap-2">
        <input name="personas" type="number" min={1} defaultValue={2} required className="w-20 rounded border px-2 py-1" aria-label="Personas" />
        <input name="telefono" placeholder="Teléfono" className="flex-1 rounded border px-2 py-1" />
      </div>
      <input name="solicitud" placeholder="Lo que pide el cliente (opcional)" className="w-full rounded border px-2 py-1" />
      <p className="text-xs text-[#6B7280]">Queda apartada hasta que se verifique el pago. Sin autorización por chat no se guardan restricciones alimentarias.</p>
      <div className="flex gap-2">
        <button disabled={pendiente} className="rounded bg-[#10B981] px-3 py-1 text-white disabled:opacity-50">
          Apartar
        </button>
        <button type="button" onClick={() => setClave(null)} className="rounded border px-3 py-1">
          Cerrar
        </button>
      </div>
    </form>
  )
}

function EditarFuncion({ o }: { o: FuncionDelDia['ocupacion'] }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  return (
    <form
      className="space-y-2 rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm"
      action={(f) =>
        empezar(async () => {
          const r = await editarFuncionAction({
            id: o.funcion_id,
            cupo_total: Number(f.get('cupo')),
            estado: f.get('estado') as 'abierta' | 'cerrada' | 'cancelada',
            cierra_venta_at: o.cierra_venta_at,
          })
          if (r.ok) {
            toast.success('Función actualizada.')
            router.refresh()
          } else toast.error(r.error)
        })
      }
    >
      <h2 className="font-medium">Cupo y estado</h2>
      <div className="flex gap-2">
        <input name="cupo" type="number" min={1} defaultValue={o.cupo_total} className="w-24 rounded border px-2 py-1" aria-label="Cupo total" />
        <select name="estado" defaultValue={o.estado} className="flex-1 rounded border px-2 py-1">
          <option value="abierta">Abierta</option>
          <option value="cerrada">Venta cerrada</option>
          <option value="cancelada">Cancelada</option>
        </select>
      </div>
      <button disabled={pendiente} className="rounded border px-3 py-1 disabled:opacity-50">
        Guardar
      </button>
    </form>
  )
}
