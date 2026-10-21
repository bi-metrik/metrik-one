'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { FuncionDelDia, MesaOcupacion, ReservaVista } from '@/lib/funciones/datos'
import { ETIQUETA_ESTADO_FUNCION, ETIQUETA_ESTADO_RESERVA, ETIQUETA_PAGO, fechaBogota, horaBogota } from '@/lib/funciones/reglas'
import { apartarEquipoAction, asignarMesasAction, editarFuncionAction } from '../actions'
import { AccionesReserva } from '../acciones-reserva'

type Reparto = Record<string, number>

/**
 * El mapa de la función. Elegir una reserva y tocar (o soltar sobre) una mesa la sienta ahí entera; «Repartir»
 * deja escribir cuántas personas van en cada mesa. Mover es sentarla en otra; liberar, quitarle la mesa. Si no cabe,
 * la base responde `mesa_llena` y no se asigna nada a medias.
 */
export function MapaCliente({ funcion, puedeEditar }: { funcion: FuncionDelDia; puedeEditar: boolean }) {
  const { ocupacion: o, reservas } = funcion
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [elegida, setElegida] = useState<string | null>(null)
  const [reparto, setReparto] = useState<Reparto | null>(null)
  const [zoom, setZoom] = useState(1)

  const mesas = o.mesas ?? []
  const reserva = reservas.find((r) => r.id === elegida) ?? null
  const sinMesa = reservas.filter((r) => r.mesas.length === 0)
  const sentadas = reservas.filter((r) => r.mesas.length > 0)
  const sumaReparto = reparto ? Object.values(reparto).reduce((s, n) => s + (n || 0), 0) : 0

  const guardar = (r: ReservaVista, asignaciones: Array<{ mesa_id: string; personas: number }>, ok: string) =>
    empezar(async () => {
      const res = await asignarMesasAction(o.funcion_id, r.id, asignaciones)
      if (res.ok) {
        toast.success(ok)
        setElegida(null)
        setReparto(null)
        router.refresh()
      } else toast.error(res.error)
    })

  const tocarMesa = (m: MesaOcupacion, reservaId: string | null = elegida) => {
    const r = reservas.find((x) => x.id === reservaId)
    if (!puedeEditar || !r) return
    if (reparto) {
      setReparto({ ...reparto, [m.mesa_id]: reparto[m.mesa_id] ?? Math.max(0, r.personas - sumaReparto) })
      return
    }
    guardar(r, [{ mesa_id: m.mesa_id, personas: r.personas }], `${r.nombre ?? 'Reserva'} en ${m.etiqueta}.`)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
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

      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        <section className="space-y-2">
          {o.montaje_id === null ? (
            <p className="rounded-lg border border-dashed border-[#E5E7EB] p-6 text-sm text-[#6B7280]">
              Esta función no tiene plano del salón. El cupo y las reservas funcionan igual.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-[#6B7280]">
                <span>{reserva ? (reparto ? 'Toca las mesas para repartir.' : `Toca una mesa para sentar a ${reserva.nombre ?? 'la reserva'}.`) : 'Elige una reserva para sentarla.'}</span>
                <span className="flex gap-1">
                  <button type="button" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))} className="rounded border px-2" aria-label="Alejar">
                    −
                  </button>
                  <button type="button" onClick={() => setZoom((z) => Math.min(2.4, z + 0.2))} className="rounded border px-2" aria-label="Acercar">
                    +
                  </button>
                </span>
              </div>
              <div className="overflow-auto rounded-lg border border-[#E5E7EB] bg-[#FAFAFA]">
                <div className="relative" style={{ width: `${100 * zoom}%`, aspectRatio: '16 / 10', minWidth: 320 * zoom }}>
                  {mesas.map((m) => (
                    <Mesa
                      key={m.mesa_id}
                      m={m}
                      enReparto={!!reparto && m.mesa_id in reparto}
                      activa={!!reserva}
                      onTocar={() => tocarMesa(m)}
                      onSoltar={(rid) => tocarMesa(m, rid)}
                    />
                  ))}
                </div>
              </div>
              {mesas.some((m) => m.condicion) && (
                <ul className="space-y-0.5 text-xs text-[#6B7280]">
                  {mesas
                    .filter((m) => m.condicion)
                    .map((m) => (
                      <li key={m.mesa_id}>
                        <strong>{m.etiqueta}</strong>
                        {m.zona ? ` (${m.zona})` : ''}: {m.condicion}
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}
        </section>

        <aside className="space-y-4">
          {reserva && reparto && (
            <div className="space-y-2 rounded-lg border border-[#10B981] bg-white p-3 text-sm">
              <p className="font-medium">
                Repartir {reserva.personas} de {reserva.nombre ?? 'la reserva'}
              </p>
              {Object.keys(reparto).length === 0 && <p className="text-xs text-[#6B7280]">Toca las mesas en el mapa.</p>}
              {Object.entries(reparto).map(([mid, n]) => (
                <label key={mid} className="flex items-center justify-between gap-2">
                  <span>{mesas.find((m) => m.mesa_id === mid)?.etiqueta}</span>
                  <input
                    type="number"
                    min={0}
                    value={n}
                    onChange={(e) => setReparto({ ...reparto, [mid]: Number(e.target.value) })}
                    className="w-16 rounded border px-1 py-0.5 text-right"
                  />
                </label>
              ))}
              <p className={`text-xs ${sumaReparto === reserva.personas ? 'text-[#059669]' : 'text-amber-700'}`}>
                Suman {sumaReparto} de {reserva.personas}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pendiente || sumaReparto !== reserva.personas}
                  onClick={() =>
                    guardar(
                      reserva,
                      Object.entries(reparto)
                        .filter(([, n]) => n > 0)
                        .map(([mesa_id, personas]) => ({ mesa_id, personas })),
                      'Reserva repartida.',
                    )
                  }
                  className="rounded bg-[#10B981] px-3 py-1 text-white disabled:opacity-50"
                >
                  Guardar
                </button>
                <button type="button" onClick={() => setReparto(null)} className="rounded border px-3 py-1">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <ListaReservas
            titulo={`Sin mesa (${sinMesa.length})`}
            reservas={sinMesa}
            elegida={elegida}
            puedeEditar={puedeEditar}
            conMapa={o.montaje_id !== null}
            funcionId={o.funcion_id}
            onElegir={(id) => {
              setElegida(id === elegida ? null : id)
              setReparto(null)
            }}
            onRepartir={(id) => {
              setElegida(id)
              setReparto({})
            }}
            onLiberar={null}
          />
          <ListaReservas
            titulo={`Sentadas (${sentadas.length})`}
            reservas={sentadas}
            elegida={elegida}
            puedeEditar={puedeEditar}
            conMapa={o.montaje_id !== null}
            funcionId={o.funcion_id}
            onElegir={(id) => {
              setElegida(id === elegida ? null : id)
              setReparto(null)
            }}
            onRepartir={(id) => {
              setElegida(id)
              setReparto({})
            }}
            onLiberar={(r) => guardar(r, [], `${r.nombre ?? 'Reserva'} sin mesa.`)}
          />
          {puedeEditar && o.estado === 'abierta' && <NuevaReserva funcionId={o.funcion_id} />}
          {puedeEditar && <EditarFuncion o={o} />}
        </aside>
      </div>
    </div>
  )
}

function Mesa(p: { m: MesaOcupacion; enReparto: boolean; activa: boolean; onTocar: () => void; onSoltar: (reservaId: string) => void }) {
  const { m } = p
  const [sobre, setSobre] = useState(false)
  const llena = m.libres === 0
  return (
    <button
      type="button"
      onClick={p.onTocar}
      onDragOver={(e) => {
        e.preventDefault()
        setSobre(true)
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault()
        setSobre(false)
        const rid = e.dataTransfer.getData('text/reserva')
        if (rid) p.onSoltar(rid)
      }}
      title={[m.etiqueta, m.zona, m.condicion].filter(Boolean).join(' · ')}
      className={`absolute flex flex-col items-center justify-center gap-0.5 overflow-hidden border p-1 text-[10px] leading-tight shadow-sm transition ${
        m.forma === 'redonda' ? 'rounded-full' : 'rounded-md'
      } ${p.enReparto || sobre ? 'border-[#10B981] ring-2 ring-[#10B981]/30' : llena ? 'border-gray-300' : 'border-[#E5E7EB]'} ${
        llena ? 'bg-gray-100' : 'bg-white'
      } ${p.activa ? 'cursor-pointer hover:border-[#10B981]' : ''}`}
      style={{ left: `${m.x}%`, top: `${m.y}%`, width: `${m.ancho}%`, height: `${m.alto * 1.6}%` }}
    >
      <span className="font-semibold text-[#1A1A1A]">{m.etiqueta}</span>
      <span className="flex flex-wrap justify-center gap-0.5" aria-label={`${m.ocupados} de ${m.puestos} puestos ocupados`}>
        {Array.from({ length: m.puestos }, (_, i) => (
          <span key={i} className={`inline-block h-1.5 w-1.5 rounded-full ${i < m.ocupados ? 'bg-[#10B981]' : 'border border-gray-400'}`} />
        ))}
      </span>
      {m.reservas.map((r) => (
        <span key={r.reserva_id} className="max-w-full truncate text-[#6B7280]">
          {r.nombre ?? '—'} ({r.personas})
        </span>
      ))}
    </button>
  )
}

function ListaReservas(p: {
  titulo: string
  reservas: ReservaVista[]
  elegida: string | null
  puedeEditar: boolean
  conMapa: boolean
  funcionId: string
  onElegir: (id: string) => void
  onRepartir: (id: string) => void
  onLiberar: ((r: ReservaVista) => void) | null
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white">
      <h2 className="border-b border-[#E5E7EB] px-3 py-2 text-sm font-medium">{p.titulo}</h2>
      {p.reservas.length === 0 ? (
        <p className="px-3 py-2 text-xs text-[#6B7280]">Ninguna.</p>
      ) : (
        <ul className="divide-y divide-[#E5E7EB]">
          {p.reservas.map((r) => (
            <li
              key={r.id}
              draggable={p.puedeEditar && p.conMapa}
              onDragStart={(e) => e.dataTransfer.setData('text/reserva', r.id)}
              className={`space-y-1 px-3 py-2 text-sm ${p.elegida === r.id ? 'bg-emerald-50' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <button type="button" disabled={!p.puedeEditar || !p.conMapa} onClick={() => p.onElegir(r.id)} className="text-left font-medium text-[#1A1A1A] disabled:cursor-default">
                  {r.nombre ?? '(sin nombre)'} · {r.personas}
                </button>
                <span className="text-xs text-[#6B7280]">{r.mesas.map((m) => `${m.etiqueta} (${m.personas})`).join(', ')}</span>
              </div>
              <div className="text-xs text-[#6B7280]">
                {ETIQUETA_ESTADO_RESERVA[r.estado]} · {ETIQUETA_PAGO[r.pago_estado]}
                {r.preferencia_mesa ? ` · Pidió: ${r.preferencia_mesa}` : ''}
              </div>
              {p.puedeEditar && (
                <div className="flex flex-wrap gap-1">
                  {p.conMapa && (
                    <>
                      <button type="button" onClick={() => p.onElegir(r.id)} className="rounded border px-2 py-0.5 text-xs">
                        {r.mesas.length ? 'Mover' : 'Sentar'}
                      </button>
                      <button type="button" onClick={() => p.onRepartir(r.id)} className="rounded border px-2 py-0.5 text-xs">
                        Repartir
                      </button>
                    </>
                  )}
                  {p.onLiberar && (
                    <button type="button" onClick={() => p.onLiberar!(r)} className="rounded border px-2 py-0.5 text-xs">
                      Liberar mesa
                    </button>
                  )}
                  <AccionesReserva funcionId={p.funcionId} reservaId={r.id} estado={r.estado} nombre={r.nombre} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NuevaReserva({ funcionId }: { funcionId: string }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  // Una clave por formulario abierto: un doble clic en «Apartar» no aparta dos veces.
  const [clave, setClave] = useState<string | null>(null)
  const abierta = clave !== null
  const setAbierta = (si: boolean) => setClave(si ? `equipo-${crypto.randomUUID()}` : null)
  if (!abierta) {
    return (
      <button type="button" onClick={() => setAbierta(true)} className="w-full rounded-lg border border-dashed border-[#E5E7EB] px-3 py-2 text-sm text-[#6B7280] hover:bg-gray-50">
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
            preferencia_mesa: String(f.get('preferencia') ?? ''),
            clave: clave!,
          })
          if (r.ok) {
            toast.success('Reserva apartada.')
            setAbierta(false)
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
      <input name="preferencia" placeholder="Preferencia de mesa (opcional)" className="w-full rounded border px-2 py-1" />
      <p className="text-xs text-[#6B7280]">Queda apartada hasta que se verifique el pago. Sin autorización por chat no se guardan restricciones alimentarias.</p>
      <div className="flex gap-2">
        <button disabled={pendiente} className="rounded bg-[#10B981] px-3 py-1 text-white disabled:opacity-50">
          Apartar
        </button>
        <button type="button" onClick={() => setAbierta(false)} className="rounded border px-3 py-1">
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
