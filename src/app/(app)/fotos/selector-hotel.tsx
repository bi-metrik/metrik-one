'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Globe, ImagePlus, Loader2, Search, Star } from 'lucide-react'
import { toast } from 'sonner'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { comprimirFotoHotel } from '@/lib/cotizaciones/foto-hotel-navegador'
import { CATEGORIAS_HOTEL, fotosPorCategoria, NOMBRE_CATEGORIA, NOMBRE_CATEGORIA_SINGULAR, type CategoriaHotel } from '@/lib/fotos/categoria'
import { fondoDeMiniatura, opcionesDeLaPestana, type EleccionFoto, type ElementoVista, type OpcionFoto } from '@/lib/fotos/vista'
import type { OpcionesDeHotel, ResultadoElemento } from './actions'

export interface PedidoHotel {
  tipo: 'hotel'
  nombre: string
  ciudad: string | null
}

/** Las acciones del selector de hotel (inyectables para verlo con datos de muestra). */
export interface AccionesHotel {
  opciones: (p: PedidoHotel, paginaUrl?: string | null, siguiente?: string | null) => Promise<OpcionesDeHotel>
  fotos: (p: PedidoHotel) => Promise<ResultadoElemento>
  elegir: (p: PedidoHotel, e: EleccionFoto, reemplaza?: string | null, categoria?: string | null) => Promise<ResultadoElemento>
  subir: (p: PedidoHotel, dataUrl: string, reemplaza?: string | null, categoria?: string | null) => Promise<ResultadoElemento>
  principal: (id: string) => Promise<ResultadoElemento>
}

const VACIO: Record<CategoriaHotel, string> = {
  fachada: 'No encontramos fotos de este hotel: súbela.',
  habitacion: 'No encontramos fotos de las habitaciones de este hotel: súbela o pégala.',
  zonas_comunes: 'No encontramos fotos de las zonas comunes de este hotel: súbela o pégala.',
}

/**
 * El selector de fotos de un HOTEL por categoría (Mauricio, 2026-10-16): pestañas Fachada ·
 * Habitaciones · Zonas comunes y, en cada una, las opciones que ONE encontró de ESE hotel (Commons
 * y, con el interruptor, la página oficial), ya clasificadas. La asesora elige; la foto queda en la
 * biblioteca con su categoría. La propuesta lleva hasta 3, de preferencia una de cada categoría:
 * elegir otra de una categoría que ya tiene foto la reemplaza. La principal la marca la asesora.
 *
 * Mejor cero opciones que una equivocada: si no hay, la pestaña lo dice y ofrece subir, pegar
 * (Ctrl+V) o, con el interruptor, el enlace de la página del hotel.
 */
export default function SelectorHotel({
  pedido,
  reemplaza = null,
  sitioOficial,
  abierto,
  onCerrar,
  onElegida,
  acciones,
  categoriaInicial = 'fachada',
}: {
  pedido: PedidoHotel | null
  reemplaza?: string | null
  sitioOficial: boolean
  abierto: boolean
  onCerrar: () => void
  onElegida: (elemento: ElementoVista | null) => void
  acciones: AccionesHotel
  categoriaInicial?: CategoriaHotel
}) {
  const [pestana, setPestana] = useState<CategoriaHotel>(categoriaInicial)
  const [opciones, setOpciones] = useState<OpcionFoto[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clasificadas, setClasificadas] = useState(true)
  const [elegida, setElegida] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [elemento, setElemento] = useState<ElementoVista | null>(null)
  const [cambio, setCambio] = useState(false)
  const [paginaUrl, setPaginaUrl] = useState('')
  const [paginaLeida, setPaginaLeida] = useState<string | null>(null)
  const [siguiente, setSiguiente] = useState<string | null>(null)
  const [sugerida, setSugerida] = useState<'biblioteca' | 'wikidata' | null>(null)
  const pendienteReemplazo = useRef<string | null>(reemplaza)

  // Al abrir: las fotos que ya tiene el hotel y las opciones de Commons (clasificadas).
  useEffect(() => {
    if (!abierto || !pedido) return
    setPestana(categoriaInicial)
    setOpciones([])
    setElegida(null)
    setError(null)
    setCambio(false)
    setPaginaLeida(null)
    setSiguiente(null)
    setSugerida(null)
    pendienteReemplazo.current = reemplaza
    let vigente = true
    void acciones.fotos(pedido).then((r) => vigente && r.ok && setElemento(r.elemento)).catch(() => {})
    setCargando(true)
    acciones
      .opciones(pedido)
      .then((r) => {
        if (!vigente) return
        if (!r.ok) {
          setError(r.error)
          return
        }
        setOpciones(r.opciones)
        setClasificadas(r.clasificadas)
        if (r.paginaSugerida) {
          setPaginaUrl(r.paginaSugerida.url)
          setSugerida(r.paginaSugerida.desde)
        }
      })
      .catch(() => vigente && setError('No se pudo buscar. Vuelve a intentarlo.'))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, pedido?.nombre, pedido?.ciudad])

  const buscarEnPagina = useCallback(
    async (desde: string | null) => {
      if (!pedido || !paginaUrl.trim()) return
      setCargando(true)
      setError(null)
      try {
        const r = await acciones.opciones(pedido, desde ? paginaLeida ?? paginaUrl : paginaUrl, desde)
        if (!r.ok) {
          toast.error(r.error)
          return
        }
        // Las de la página se suman a las de Commons (sin repetir).
        setOpciones((antes) => [...antes.filter((o) => !r.opciones.some((x) => x.id === o.id)), ...r.opciones])
        setSiguiente(r.siguiente)
        if (r.pagina) setPaginaLeida(r.pagina)
        if (r.opciones.length === 0 && !desde) toast.message('Esa página no tiene fotos del hotel que sirvan.')
      } catch {
        toast.error('No se pudo leer la página. Vuelve a intentarlo.')
      } finally {
        setCargando(false)
      }
    },
    [acciones, pedido, paginaUrl, paginaLeida],
  )

  const quedo = (r: ResultadoElemento) => {
    if (!r.ok) {
      toast.error(r.error)
      return false
    }
    setElemento(r.elemento)
    setCambio(true)
    pendienteReemplazo.current = null
    return true
  }

  const usar = async () => {
    if (!pedido || !elegida) return
    const o = opciones.find((x) => x.id === elegida)
    if (!o) return
    const eleccion: EleccionFoto =
      o.fuente === 'wikimedia' ? { fuente: 'wikimedia', titulo: o.titulo } : { fuente: 'sitio_oficial', pagina: o.pagina, imagen: o.imagen ?? o.titulo }
    setGuardando(true)
    try {
      if (quedo(await acciones.elegir(pedido, eleccion, pendienteReemplazo.current, pestana))) {
        toast.success(`Foto de ${NOMBRE_CATEGORIA_SINGULAR[pestana]} guardada en la biblioteca.`)
        setElegida(null)
      }
    } catch {
      toast.error('No se pudo guardar. Vuelve a intentarlo.')
    } finally {
      setGuardando(false)
    }
  }

  const subir = async (archivo: Blob) => {
    if (!pedido) return
    setGuardando(true)
    try {
      const foto = await comprimirFotoHotel(archivo)
      if (!foto) {
        toast.error('Ese archivo no es una foto. Usa un JPG o un PNG.')
        return
      }
      if (quedo(await acciones.subir(pedido, foto.dataUrl, pendienteReemplazo.current, pestana))) {
        toast.success(`Foto de ${NOMBRE_CATEGORIA_SINGULAR[pestana]} guardada en la biblioteca.`)
      }
    } catch {
      toast.error('No se pudo subir. Vuelve a intentarlo.')
    } finally {
      setGuardando(false)
    }
  }

  const hacerPrincipal = async (id: string) => {
    setGuardando(true)
    try {
      quedo(await acciones.principal(id))
    } catch {
      toast.error('No se pudo cambiar la principal.')
    } finally {
      setGuardando(false)
    }
  }

  const cerrar = () => (cambio ? onElegida(elemento) : onCerrar())

  const puestos = fotosPorCategoria(elemento?.fotos ?? [])
  const { propias, sinClasificar } = opcionesDeLaPestana(opciones, pestana)
  const ocupada = puestos[pestana]
  const elegidaOpcion = opciones.find((x) => x.id === elegida) ?? null

  const cuadricula = (lista: OpcionFoto[]) => (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {lista.map((o) => {
        const activa = elegida === o.id
        return (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => setElegida(o.id)}
              className={`relative block w-full overflow-hidden rounded-md border text-left transition ${activa ? 'ring-2 ring-[#10B981] ring-offset-1' : 'hover:border-foreground/40'}`}
              aria-pressed={activa}
              data-opcion={o.id}
            >
              <div className="aspect-[4/3] w-full bg-muted bg-cover bg-center" style={{ backgroundImage: fondoDeMiniatura(o.miniatura) }} />
              {activa && (
                <span className="absolute top-1 right-1 rounded-full bg-[#10B981] p-0.5 text-white">
                  <Check className="h-3 w-3" />
                </span>
              )}
              <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground" title={o.credito ?? undefined}>
                {o.fuente === 'sitio_oficial' ? 'Página oficial' : 'Commons'} · {o.credito ?? '—'}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && cerrar()}>
      <DialogContent
        className="flex max-h-[92vh] flex-col gap-3 sm:max-w-3xl"
        data-selector-hotel
        onPaste={(e) => {
          const archivo = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
          if (archivo && !guardando) {
            e.preventDefault()
            void subir(archivo)
          }
        }}
      >
        <div className="space-y-0.5 pr-6">
          <DialogTitle className="text-base">Fotos del hotel · {pedido?.nombre}</DialogTitle>
          <DialogDescription className="text-xs">
            {pedido?.ciudad ? `${pedido.ciudad}. ` : ''}
            Elige por categoría: la propuesta lleva hasta 3, de preferencia una de cada una. ONE nunca la pone sola.
          </DialogDescription>
        </div>

        {/* Lo que el hotel ya tiene, por categoría; la principal la marca la asesora. */}
        <div className="grid grid-cols-3 gap-2" data-puestos>
          {CATEGORIAS_HOTEL.map((c) => {
            const f = puestos[c]
            return (
              <div key={c} className={`flex items-center gap-2 rounded-md border p-1.5 ${pestana === c ? 'border-foreground/40' : ''}`} data-puesto={c}>
                <div className="h-10 w-14 shrink-0 rounded bg-muted bg-cover bg-center" style={f?.url ? { backgroundImage: fondoDeMiniatura(f.url) } : undefined} />
                <div className="min-w-0 text-[11px] leading-tight">
                  <div className="font-medium">{NOMBRE_CATEGORIA[c]}</div>
                  {!f ? (
                    <div className="text-muted-foreground">Sin foto</div>
                  ) : f.principal ? (
                    <div className="inline-flex items-center gap-0.5 text-[#059669]">
                      <Star className="h-3 w-3 fill-current" /> Principal
                    </div>
                  ) : (
                    <button type="button" disabled={guardando} onClick={() => void hacerPrincipal(f.id)} className="text-muted-foreground underline hover:text-foreground disabled:opacity-50">
                      Hacer principal
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {puestos.sin.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {puestos.sin.length === 1 ? 'Tiene 1 foto sin categoría' : `Tiene ${puestos.sin.length} fotos sin categoría`} (de antes). Una nueva ocupa su lugar si no hay espacio.
          </p>
        )}

        <div className="flex flex-wrap gap-1 border-b pb-2" role="tablist">
          {CATEGORIAS_HOTEL.map((c) => {
            const n = opcionesDeLaPestana(opciones, c).propias.length
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={pestana === c}
                data-categoria={c}
                onClick={() => {
                  setPestana(c)
                  setElegida(null)
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${pestana === c ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {NOMBRE_CATEGORIA[c]}
                {!cargando && n > 0 ? <span className="ml-1 opacity-70">{n}</span> : null}
              </button>
            )
          })}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto" data-pestana={pestana} data-opciones={propias.length}>
          {ocupada && (
            <p className="text-[11px] text-muted-foreground">
              Ya tiene una foto de {NOMBRE_CATEGORIA_SINGULAR[pestana]}: la que elijas la reemplaza.
            </p>
          )}
          {cargando && propias.length === 0 ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i} className="aspect-[4/3] animate-pulse rounded-md bg-muted" />
              ))}
            </ul>
          ) : propias.length > 0 ? (
            cuadricula(propias)
          ) : (
            <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground" data-vacia>
              {error ?? VACIO[pestana]}
              {!error && sitioOficial ? ' O pega abajo el enlace de la página del hotel.' : ''}
            </div>
          )}

          {!cargando && sinClasificar.length > 0 && (
            <div className="space-y-1.5" data-sin-clasificar>
              <p className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {clasificadas ? 'ONE no pudo mirar estas fotos.' : 'ONE no pudo revisar las fotos.'} Son de este hotel por su nombre: revisa que sean de {NOMBRE_CATEGORIA_SINGULAR[pestana]}.
              </p>
              {cuadricula(sinClasificar)}
            </div>
          )}

          <div className="space-y-2 rounded-md bg-muted/40 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className={`inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent ${guardando ? 'pointer-events-none opacity-60' : ''}`}>
                {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Subir la mía
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a) void subir(a) }} />
              </label>
              <span className="text-[11px] text-muted-foreground">o pega una imagen aquí (Ctrl+V). Queda como {NOMBRE_CATEGORIA_SINGULAR[pestana]}. Úsala solo si tienes permiso para publicarla.</span>
            </div>
            {sitioOficial && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void buscarEnPagina(null)
                }}
              >
                <div className="relative flex-1">
                  <Globe className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={paginaUrl}
                    onChange={(e) => setPaginaUrl(e.target.value)}
                    placeholder="Pega el enlace de la página del hotel (https://…)"
                    className="h-8 w-full rounded-md border bg-background pr-2 pl-7 text-xs"
                    inputMode="url"
                  />
                </div>
                <button type="submit" disabled={cargando || !paginaUrl.trim()} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50">
                  <Search className="h-3.5 w-3.5" /> Buscar en la página
                </button>
              </form>
            )}
            {sitioOficial && sugerida && !paginaLeida && (
              <p className="text-[11px] text-muted-foreground">
                {sugerida === 'wikidata' ? 'ONE encontró esta página oficial en Wikidata: revisa que sea la del hotel y busca.' : 'Es la página oficial que ya se usó para este hotel.'}
              </p>
            )}
            {siguiente && !cargando && (
              <button type="button" onClick={() => void buscarEnPagina(siguiente)} className="rounded-md border bg-background px-3 py-1 text-xs hover:bg-accent">
                Más fotos de la página
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {elegidaOpcion ? (
              <a href={elegidaOpcion.pagina} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                {elegidaOpcion.fuente === 'wikimedia' ? 'Ver en Wikimedia Commons' : 'Ver la página'} <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              'Toca una foto para elegirla.'
            )}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={cerrar} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">
              {cambio ? 'Listo' : 'Cerrar'}
            </button>
            <button
              type="button"
              disabled={!elegida || guardando}
              onClick={() => void usar()}
              className="inline-flex items-center gap-1 rounded-md bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#059669] disabled:opacity-50"
            >
              {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Usar como {NOMBRE_CATEGORIA_SINGULAR[pestana]}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
