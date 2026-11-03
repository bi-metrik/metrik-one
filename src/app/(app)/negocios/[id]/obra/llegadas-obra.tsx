'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MapPinCheck, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { todayBogotaISO } from '@/lib/dates/bogota'
import { fechaLegible, horaLegible, horaParaCampo, pesos } from '@/lib/obras/formato'
import { textoFraccion, type JornadaDia } from '@/lib/obras/llegadas'
import type { ColaboradorParaLlegada, ObraParaLlegada } from '@/lib/obras/servidor'
import { borrarLlegada, guardarLlegada } from '../../obra-actions'
import { botonPrimario, cabecera, campo, etiqueta, tarjeta } from './ui'

interface Borrador {
  id: string | null
  collaborator_id: string
  negocio_id: string
  fecha: string
  hora: string
}

/**
 * Las llegadas a esta obra (C7), por día. La oficina agrega, corrige o borra una (canal `app`, la
 * hora la pone ella). Si ese día la persona ya tiene dos obras, la base no deja agregar una
 * tercera y aquí se muestra el motivo. El reparto completa/media lo calcula `v_jornadas_dia`.
 */
export function LlegadasObra({
  negocioId,
  jornadas,
  colaboradores,
  obras,
  puedeEditar,
}: {
  negocioId: string
  jornadas: JornadaDia[]
  colaboradores: ColaboradorParaLlegada[]
  obras: ObraParaLlegada[]
  puedeEditar: boolean
}) {
  const router = useRouter()
  const [pendiente, startTransition] = useTransition()
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [errorBorrador, setErrorBorrador] = useState<string | null>(null)
  const [verTodas, setVerTodas] = useState(false)

  const porDia = useMemo(() => {
    const m = new Map<string, JornadaDia[]>()
    for (const j of jornadas) m.set(j.fecha, [...(m.get(j.fecha) ?? []), j])
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [jornadas])
  const dias = verTodas ? porDia : porDia.slice(0, 14)
  const totalJornadas = jornadas.reduce((s, j) => s + j.fraccion, 0)

  // Una obra cerrada no figura entre las abiertas, pero la llegada que se corrige sí es de esta.
  const opcionesObra = obras.some((o) => o.id === negocioId) ? obras : [{ id: negocioId, codigo: null, nombre: 'Esta obra' }, ...obras]
  const activos = [...colaboradores].sort((a, b) => (a.tipo === b.tipo ? a.name.localeCompare(b.name) : a.tipo === 'operario' ? -1 : 1))
  // Al corregir la llegada de alguien que ya no está activo, su nombre tiene que seguir en la lista.
  const ajeno = borrador?.id ? jornadas.find((j) => j.id === borrador.id) : null
  const opcionesColaborador =
    ajeno && !activos.some((c) => c.id === ajeno.collaborator_id)
      ? [{ id: ajeno.collaborator_id, name: ajeno.colaborador, tipo: 'operario' as const }, ...activos]
      : activos

  const guardar = () =>
    startTransition(async () => {
      if (!borrador) return
      const r = await guardarLlegada(borrador.id, borrador)
      if (!r.ok) return void setErrorBorrador(r.error)
      toast.success(borrador.id ? 'Llegada corregida' : 'Llegada agregada')
      setBorrador(null)
      setErrorBorrador(null)
      router.refresh()
    })

  const quitar = (j: JornadaDia) =>
    startTransition(async () => {
      if (!window.confirm(`¿Borrar la llegada de ${j.colaborador} del ${fechaLegible(j.fecha)}?`)) return
      const r = await borrarLlegada(j.id)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Llegada borrada')
      router.refresh()
    })

  return (
    <section className={tarjeta} data-llegadas-obra>
      <div className={cabecera}>
        <div className="flex items-center gap-1.5">
          <MapPinCheck className="h-4 w-4 text-tinta-suave" />
          <h3 className="text-sm font-semibold text-foreground">Llegadas</h3>
          {jornadas.length > 0 && <span className="text-[11px] text-muted-foreground">· {String(Math.round(totalJornadas * 100) / 100).replace('.', ',')} jornadas</span>}
        </div>
        {puedeEditar && !borrador && colaboradores.length > 0 && (
          <button
            type="button"
            className={botonPrimario}
            onClick={() => {
              setErrorBorrador(null)
              setBorrador({ id: null, collaborator_id: opcionesColaborador[0]?.id ?? '', negocio_id: negocioId, fecha: todayBogotaISO(), hora: '07:00' })
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Agregar llegada
          </button>
        )}
      </div>

      {borrador && (
        <div className="grid gap-3 border-b bg-muted/30 p-4 sm:grid-cols-2" data-borrador-llegada>
          <label className={etiqueta}>
            Quién llegó
            <select className={campo} value={borrador.collaborator_id} onChange={(e) => setBorrador({ ...borrador, collaborator_id: e.target.value })}>
              {opcionesColaborador.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.tipo === 'operario' ? '' : ' (equipo)'}
                </option>
              ))}
            </select>
          </label>
          <label className={etiqueta}>
            Obra
            <select className={campo} value={borrador.negocio_id} onChange={(e) => setBorrador({ ...borrador, negocio_id: e.target.value })}>
              {opcionesObra.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.codigo ? `${o.codigo} — ${o.nombre}` : o.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className={etiqueta}>
            Día
            <input type="date" className={campo} max={todayBogotaISO()} value={borrador.fecha} onChange={(e) => setBorrador({ ...borrador, fecha: e.target.value })} />
          </label>
          <label className={etiqueta}>
            Hora de llegada
            <input type="time" className={campo} value={borrador.hora} onChange={(e) => setBorrador({ ...borrador, hora: e.target.value })} />
          </label>
          {errorBorrador && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 sm:col-span-2" role="alert" data-error-llegada>
              {errorBorrador}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={botonPrimario} disabled={pendiente} onClick={guardar}>
              {pendiente && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
            </button>
            <button type="button" className="h-9 px-2 text-xs text-muted-foreground" onClick={() => (setBorrador(null), setErrorBorrador(null))}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {puedeEditar && colaboradores.length === 0 && (
        <p className="border-b px-4 py-2 text-[11px] text-muted-foreground">
          Para agregar llegadas, registra primero a los colaboradores en Configuración → Colaboradores de WhatsApp.
        </p>
      )}

      {porDia.length === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">Nadie ha marcado llegada a esta obra todavía.</p>
      ) : (
        <div className="divide-y">
          {dias.map(([fecha, filas]) => (
            <div key={fecha} className="px-4 py-2.5">
              <p className="text-[11px] font-semibold text-muted-foreground">{fechaLegible(fecha)}</p>
              <ul className="mt-1 space-y-1">
                {filas.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="font-medium text-foreground">{j.colaborador}</span>
                    <span className="text-muted-foreground">llegó a las {horaLegible(j.hora)}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${j.fraccion < 1 ? 'bg-sky-50 text-sky-800' : 'bg-muted text-foreground'}`}>
                      {textoFraccion(j.fraccion)}
                    </span>
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {j.costo === null ? <span className="text-[#9A5F0C]">Sin valor de jornada</span> : pesos(j.costo)}
                    </span>
                    {puedeEditar && (
                      <span className="flex gap-0.5">
                        <button
                          type="button"
                          aria-label="Corregir llegada"
                          className="rounded p-1.5 hover:bg-accent"
                          onClick={() => {
                            setErrorBorrador(null)
                            setBorrador({ id: j.id, collaborator_id: j.collaborator_id, negocio_id: j.negocio_id, fecha: j.fecha, hora: horaParaCampo(j.hora) || '07:00' })
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" aria-label="Borrar llegada" className="rounded p-1.5 hover:bg-accent" disabled={pendiente} onClick={() => quitar(j)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {porDia.length > dias.length && (
            <button type="button" className="w-full px-4 py-2 text-xs font-medium text-acento hover:underline" onClick={() => setVerTodas(true)}>
              Ver los {porDia.length - dias.length} días anteriores
            </button>
          )}
        </div>
      )}
    </section>
  )
}
