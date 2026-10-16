'use client'

import { useMemo, useState } from 'react'
import { ImagePlus, Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'

import { MAX_FOTOS_POR_ELEMENTO, nombreLlano, type TipoFoto } from '@/lib/fotos/clave'
import type { DudaVista, ElementoVista } from '@/lib/fotos/vista'
import { contestarMismoPerfil, crearPerfil, type PedidoFoto, type ResultadoElemento } from './actions'
import PerfilFotos, { textoAgregarFotos, type AccionesPerfil } from './perfil-fotos'
import PreguntaMismo from './pregunta-mismo'

const TIPO: Record<TipoFoto, string> = { hotel: 'Hotel', actividad: 'Tour o plan', ciudad: 'Ciudad' }

export interface AccionesPantalla {
  crear: (p: PedidoFoto) => Promise<ResultadoElemento | { ok: true; elemento: null; duda: DudaVista }>
  contestar: (p: PedidoFoto, clavePerfil: string, mismo: boolean) => Promise<ResultadoElemento>
}

const ACCIONES: AccionesPantalla = { crear: crearPerfil, contestar: contestarMismoPerfil }

const llave = (e: Pick<ElementoVista, 'tipo' | 'clave'>) => `${e.tipo}:${e.clave}`

/**
 * «Hoteles y tours» (Mauricio, 2026-10-16): cada hotel y cada tour que ha pasado por una cotización,
 * con sus fotos. Se abre un perfil para pegar, subir, ordenar o quitar fotos con calma; las fotos
 * entran solas en las propuestas. «Agregar» precarga uno que todavía no llegó a una cotización.
 * Las ciudades solo aparecen si alguna tiene fotos (de antes): nada de filtros vacíos.
 */
export default function HotelesYToursVista({
  inicial,
  editable,
  acciones = ACCIONES,
  accionesPerfil,
}: {
  inicial: ElementoVista[]
  editable: boolean
  acciones?: AccionesPantalla
  accionesPerfil?: AccionesPerfil
}) {
  const [elementos, setElementos] = useState(inicial)
  const [tipo, setTipo] = useState<TipoFoto | null>(null)
  const [buscar, setBuscar] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState<PedidoFoto | null>(null)
  const [duda, setDuda] = useState<{ pedido: PedidoFoto; duda: DudaVista } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const filtros = useMemo(() => {
    const hay = new Set(elementos.map((e) => e.tipo))
    return [
      { tipo: null, nombre: 'Todo' },
      { tipo: 'hotel' as const, nombre: 'Hoteles' },
      { tipo: 'actividad' as const, nombre: 'Tours y planes' },
      ...(hay.has('ciudad') ? [{ tipo: 'ciudad' as const, nombre: 'Ciudades' }] : []),
    ]
  }, [elementos])

  const visibles = useMemo(() => {
    const q = nombreLlano(buscar)
    return elementos.filter(
      (e) => (!tipo || e.tipo === tipo) && (!q || `${nombreLlano(e.nombre)} ${nombreLlano(e.ciudad)} ${e.alias.map((a) => nombreLlano(a.nombre)).join(' ')}`.includes(q)),
    )
  }, [elementos, tipo, buscar])

  const poner = (antes: string | null, el: ElementoVista | null) =>
    setElementos((lista) => {
      const sin = lista.filter((e) => llave(e) !== antes && (!el || llave(e) !== llave(el)))
      return el ? [el, ...sin] : sin
    })

  const abiertoEl = elementos.find((e) => llave(e) === abierto) ?? null

  const terminarAlta = (r: ResultadoElemento | { ok: true; elemento: null; duda: DudaVista }, pedido: PedidoFoto) => {
    if (!r.ok) return void toast.error(r.error)
    if ('duda' in r) return setDuda({ pedido, duda: r.duda })
    setDuda(null)
    setNuevo(null)
    if (r.elemento) {
      poner(null, r.elemento)
      setAbierto(llave(r.elemento))
    }
  }

  const correr = async (fn: () => Promise<void>) => {
    if (ocupado) return
    setOcupado(true)
    try {
      await fn()
    } catch {
      toast.error('No se pudo. Vuelve a intentarlo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6" data-hoteles-y-tours>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Hoteles y tours</h1>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Las fotos de cada hotel y tour, hasta {MAX_FOTOS_POR_ELEMENTO}. Entran solas en la propuesta cada vez que una cotización los
            nombra. Un hotel o un tour aparece aquí la primera vez que entra a una cotización.
          </p>
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => {
              setNuevo({ tipo: 'hotel', nombre: '', ciudad: '' })
              setDuda(null)
            }}
            className="inline-flex items-center gap-1 rounded-md bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#059669]"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar
          </button>
        )}
      </div>

      {nuevo && (
        <form
          className="space-y-2 rounded-lg border bg-muted/30 p-3"
          onSubmit={(ev) => {
            ev.preventDefault()
            const pedido = { ...nuevo, nombre: nuevo.nombre.trim(), ciudad: nuevo.ciudad?.trim() || null }
            if (!pedido.nombre) return
            void correr(async () => terminarAlta(await acciones.crear(pedido), pedido))
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-0.5 text-[11px] text-muted-foreground">
              Qué es
              <select
                value={nuevo.tipo}
                onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value as TipoFoto })}
                className="block h-8 rounded-md border bg-background px-2 text-xs text-foreground"
              >
                <option value="hotel">Hotel</option>
                <option value="actividad">Tour o plan</option>
              </select>
            </label>
            <label className="min-w-48 flex-1 space-y-0.5 text-[11px] text-muted-foreground">
              Nombre (como sale en la cotización)
              <input
                value={nuevo.nombre}
                onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                className="block h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                placeholder="Catalonia Puerta del Sol"
              />
            </label>
            <label className="w-40 space-y-0.5 text-[11px] text-muted-foreground">
              Ciudad
              <input
                value={nuevo.ciudad ?? ''}
                onChange={(e) => setNuevo({ ...nuevo, ciudad: e.target.value })}
                className="block h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                placeholder="Madrid"
              />
            </label>
            <button type="submit" disabled={ocupado || !nuevo.nombre.trim()} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50">
              {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Agregar
            </button>
            <button type="button" onClick={() => (setNuevo(null), setDuda(null))} className="h-8 px-2 text-xs text-muted-foreground">
              Cancelar
            </button>
          </div>
          {duda && (
            <PreguntaMismo
              tipo={duda.pedido.tipo}
              duda={duda.duda}
              editable={editable}
              ocupado={ocupado}
              onContestar={(mismo) => void correr(async () => terminarAlta(await acciones.contestar(duda.pedido, duda.duda.clave, mismo), duda.pedido))}
            />
          )}
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar por nombre o ciudad"
            className="h-8 w-full rounded-md border bg-background pr-2 pl-7 text-xs"
          />
        </div>
        <div className="flex gap-1">
          {filtros.map((f) => (
            <button
              key={f.nombre}
              type="button"
              onClick={() => setTipo(f.tipo)}
              className={`rounded-full px-3 py-1 text-xs ${tipo === f.tipo ? 'bg-foreground text-background' : 'border text-muted-foreground hover:bg-accent'}`}
            >
              {f.nombre}
            </button>
          ))}
        </div>
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          {elementos.length === 0
            ? 'Todavía no hay hoteles ni tours. Aparecen solos cuando entran a una cotización, o agrégalos con «Agregar».'
            : 'Nada coincide con la búsqueda.'}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-lista-perfiles>
          {visibles.map((e) => (
            <li key={llave(e)}>
              <button
                type="button"
                onClick={() => setAbierto(llave(e))}
                className="flex w-full gap-3 rounded-lg border p-2 text-left hover:border-foreground/30 hover:bg-accent/30"
                data-perfil={llave(e)}
              >
                {e.fotos.length > 0 ? (
                  <span className="flex shrink-0 gap-1">
                    {e.fotos.map((f) => (
                      <span
                        key={f.id}
                        className={`block rounded bg-gradient-to-br from-[#e63380] via-[#8b4fa0] to-[#1fa7bd] bg-cover bg-center ${f.principal ? 'h-14 w-20' : 'h-14 w-9'}`}
                        style={f.url ? { backgroundImage: `url(${JSON.stringify(f.url)})` } : undefined}
                      />
                    ))}
                  </span>
                ) : (
                  <span className="flex h-14 w-20 shrink-0 flex-col items-center justify-center rounded border-2 border-dashed text-muted-foreground" aria-hidden>
                    <ImagePlus className="h-4 w-4" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.nombre}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[TIPO[e.tipo], e.tipo !== 'ciudad' ? e.ciudad : null].filter(Boolean).join(' · ')}
                    {e.alias.length > 0 ? ` · también «${e.alias[0].nombre}»${e.alias.length > 1 ? ` y ${e.alias.length - 1} más` : ''}` : ''}
                  </span>
                  <span className={`block text-[11px] ${e.fotos.length === 0 ? 'font-medium text-[#E63380]' : 'text-muted-foreground'}`}>
                    {e.fotos.length === 0 ? textoAgregarFotos(e.tipo) : `${e.fotos.length} de ${MAX_FOTOS_POR_ELEMENTO} fotos`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {abiertoEl && (
        <PerfilFotos
          elemento={abiertoEl}
          pedido={{ tipo: abiertoEl.tipo, nombre: abiertoEl.nombre, ciudad: abiertoEl.ciudad }}
          abierto
          editable={editable}
          acciones={accionesPerfil}
          onCerrar={() => setAbierto(null)}
          onCambio={(el) => {
            poner(llave(abiertoEl), el ?? { ...abiertoEl, fotos: [], admiteOtra: true })
          }}
        />
      )}
    </div>
  )
}
