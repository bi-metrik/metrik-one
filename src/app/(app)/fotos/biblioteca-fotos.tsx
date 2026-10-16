'use client'

import { useMemo, useState } from 'react'
import { ImagePlus, Loader2, Plus, RefreshCw, Search, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { MAX_FOTOS_POR_ELEMENTO, nombreLlano, type TipoFoto } from '@/lib/fotos/clave'
import type { ElementoVista, FotoVista } from '@/lib/fotos/vista'
import { marcarFotoPrincipal, quitarFotoDeBiblioteca, type ResultadoElemento } from './actions'
import SelectorFotos, { type AccionesSelector, type PedidoFoto } from './selector-fotos'

const FILTROS: { tipo: TipoFoto | null; nombre: string }[] = [
  { tipo: null, nombre: 'Todo' },
  { tipo: 'hotel', nombre: 'Hoteles' },
  { tipo: 'actividad', nombre: 'Tours y planes' },
  { tipo: 'ciudad', nombre: 'Ciudades' },
]
const TIPO: Record<TipoFoto, string> = { hotel: 'Hotel', actividad: 'Tour o plan', ciudad: 'Ciudad' }
const ORIGEN: Record<FotoVista['origen'], string> = { wikimedia: 'Commons', asesora: 'Propia', sitio_oficial: 'Página oficial' }

export interface AccionesBiblioteca {
  principal: (id: string) => Promise<ResultadoElemento>
  quitar: (id: string) => Promise<ResultadoElemento>
}

const ACCIONES: AccionesBiblioteca = { principal: marcarFotoPrincipal, quitar: quitarFotoDeBiblioteca }

/**
 * La biblioteca de fotos del espacio: cada hotel, tour/plan y ciudad con sus fotos (hasta 3, una
 * principal). Se busca y se filtra aquí mismo; «Agregar» precarga un elemento que todavía no está
 * en ninguna cotización. La propuesta usa la principal y, si caben, las otras dos.
 */
export default function BibliotecaFotosVista({
  inicial,
  editable,
  sitioOficial,
  acciones = ACCIONES,
  accionesSelector,
}: {
  inicial: ElementoVista[]
  editable: boolean
  sitioOficial: boolean
  acciones?: AccionesBiblioteca
  accionesSelector?: AccionesSelector
}) {
  const [elementos, setElementos] = useState(inicial)
  const [tipo, setTipo] = useState<TipoFoto | null>(null)
  const [buscar, setBuscar] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [selector, setSelector] = useState<{ pedido: PedidoFoto; reemplaza: string | null } | null>(null)
  const [nuevo, setNuevo] = useState<PedidoFoto | null>(null)

  const visibles = useMemo(() => {
    const q = nombreLlano(buscar)
    return elementos.filter((e) => (!tipo || e.tipo === tipo) && (!q || `${nombreLlano(e.nombre)} ${nombreLlano(e.ciudad)}`.includes(q)))
  }, [elementos, tipo, buscar])

  const poner = (clave: string, tipoEl: TipoFoto, el: ElementoVista | null) =>
    setElementos((antes) => {
      const sin = antes.filter((e) => !(e.tipo === tipoEl && e.clave === clave))
      return el ? [el, ...sin.filter((e) => !(e.tipo === el.tipo && e.clave === el.clave))] : sin
    })

  const correr = async (e: ElementoVista, id: string, accion: (id: string) => Promise<ResultadoElemento>) => {
    if (ocupado) return
    setOcupado(id)
    try {
      const r = await accion(id)
      if (!r.ok) toast.error(r.error)
      else poner(e.clave, e.tipo, r.elemento)
    } catch {
      toast.error('No se pudo. Vuelve a intentarlo.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6" data-biblioteca-fotos>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Biblioteca de fotos</h1>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Las fotos de hoteles, tours y ciudades que salen en las propuestas. Hasta {MAX_FOTOS_POR_ELEMENTO} por elemento: la
            principal sale siempre y las otras solo si caben sin agregar hojas. Los hoteles los eliges tú, nunca se ponen solos.
          </p>
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => setNuevo({ tipo: 'hotel', nombre: '', ciudad: '' })}
            className="inline-flex items-center gap-1 rounded-md bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#059669]"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar
          </button>
        )}
      </div>

      {nuevo && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3"
          onSubmit={(ev) => {
            ev.preventDefault()
            if (!nuevo.nombre.trim()) return
            setSelector({ pedido: { ...nuevo, nombre: nuevo.nombre.trim(), ciudad: nuevo.ciudad?.trim() || null }, reemplaza: null })
          }}
        >
          <label className="space-y-0.5 text-[11px] text-muted-foreground">
            Qué es
            <select value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value as TipoFoto })} className="block h-8 rounded-md border bg-background px-2 text-xs text-foreground">
              <option value="hotel">Hotel</option>
              <option value="actividad">Tour o plan</option>
              <option value="ciudad">Ciudad</option>
            </select>
          </label>
          <label className="min-w-48 flex-1 space-y-0.5 text-[11px] text-muted-foreground">
            Nombre (como sale en la cotización)
            <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className="block h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" placeholder="H10 Metropolitan" />
          </label>
          {nuevo.tipo !== 'ciudad' && (
            <label className="w-40 space-y-0.5 text-[11px] text-muted-foreground">
              Ciudad
              <input value={nuevo.ciudad ?? ''} onChange={(e) => setNuevo({ ...nuevo, ciudad: e.target.value })} className="block h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" placeholder="Barcelona" />
            </label>
          )}
          <button type="submit" className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent">Buscar fotos</button>
          <button type="button" onClick={() => setNuevo(null)} className="h-8 px-2 text-xs text-muted-foreground">Cancelar</button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre o ciudad" className="h-8 w-full rounded-md border bg-background pr-2 pl-7 text-xs" />
        </div>
        <div className="flex gap-1">
          {FILTROS.map((f) => (
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
          {elementos.length === 0 ? 'Todavía no hay fotos. Agrega un hotel, un tour o una ciudad, o ponlas desde una cotización.' : 'Nada coincide con la búsqueda.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visibles.map((e) => (
            <li key={`${e.tipo}:${e.clave}`} className="rounded-lg border p-3" data-elemento={`${e.tipo}:${e.clave}`}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">{e.nombre}</span>
                {e.ciudad && e.tipo !== 'ciudad' && <span className="text-xs text-muted-foreground">{e.ciudad}</span>}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{TIPO[e.tipo]}</span>
                <span className="text-[10px] text-muted-foreground">{e.fotos.length} de {MAX_FOTOS_POR_ELEMENTO}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {e.fotos.map((f) => (
                  <div key={f.id} className={`overflow-hidden rounded-md border ${f.principal ? 'border-[#10B981]' : ''}`} data-foto={f.id} data-principal={f.principal || undefined}>
                    <div
                      className="relative aspect-[4/3] bg-gradient-to-br from-[#e63380] via-[#8b4fa0] to-[#1fa7bd] bg-cover bg-center"
                      style={f.url ? { backgroundImage: `url(${f.url})` } : undefined}
                    >
                      {f.principal && (
                        <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-[#10B981] px-1.5 py-0.5 text-[10px] font-medium text-white">
                          <Star className="h-2.5 w-2.5 fill-current" /> Principal
                        </span>
                      )}
                      {!f.seImprime && (
                        <span className="absolute right-1 bottom-1 left-1 rounded bg-black/65 px-1 py-0.5 text-[10px] text-white">No sale en la propuesta</span>
                      )}
                    </div>
                    <div className="space-y-1 p-1.5">
                      <p className="truncate text-[10px] text-muted-foreground" title={f.fuente ?? undefined}>
                        {ORIGEN[f.origen]}{f.fuente ? ` · ${f.fuente}` : ''}{f.origen === 'wikimedia' && !f.revisada ? ' · sugerida' : ''}
                      </p>
                      {editable && (
                        <div className="flex flex-wrap gap-0.5">
                          {!f.principal && (
                            <button type="button" disabled={!!ocupado} onClick={() => void correr(e, f.id, acciones.principal)} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] hover:bg-accent disabled:opacity-50">
                              <Star className="h-3 w-3" /> Principal
                            </button>
                          )}
                          <button type="button" disabled={!!ocupado} onClick={() => setSelector({ pedido: { tipo: e.tipo, nombre: e.nombre, ciudad: e.ciudad }, reemplaza: f.id })} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] hover:bg-accent disabled:opacity-50">
                            <RefreshCw className="h-3 w-3" /> Cambiar
                          </button>
                          <button type="button" disabled={!!ocupado} onClick={() => void correr(e, f.id, acciones.quitar)} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-accent disabled:opacity-50">
                            {ocupado === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Quitar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {editable && e.admiteOtra && (
                  <button
                    type="button"
                    onClick={() => setSelector({ pedido: { tipo: e.tipo, nombre: e.nombre, ciudad: e.ciudad }, reemplaza: null })}
                    className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-[11px] text-muted-foreground hover:bg-accent/40"
                  >
                    <ImagePlus className="h-4 w-4" /> Agregar foto
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <SelectorFotos
        pedido={selector?.pedido ?? null}
        reemplaza={selector?.reemplaza ?? null}
        sitioOficial={sitioOficial}
        abierto={!!selector}
        onCerrar={() => setSelector(null)}
        acciones={accionesSelector}
        onElegida={(el) => {
          if (el) poner(el.clave, el.tipo, el)
          setSelector(null)
          setNuevo(null)
        }}
      />
    </div>
  )
}
