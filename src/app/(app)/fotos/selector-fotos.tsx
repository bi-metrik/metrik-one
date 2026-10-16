'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, Globe, ImagePlus, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { comprimirFotoHotel } from '@/lib/cotizaciones/foto-hotel-navegador'
import { esDeAgenciaDeViajes, MENSAJE_AGENCIA } from '@/lib/fotos/agencias'
import type { PedidoAutorizacion } from '@/lib/fotos/autorizacion'
import { fuentesDelSelector, OPCIONES_POR_PAGINA, type FuenteFoto, type TipoFoto } from '@/lib/fotos/clave'
import { fondoDeMiniatura, type EleccionFoto, type ElementoVista, type OpcionFoto } from '@/lib/fotos/vista'
import {
  elegirFoto,
  fotosDelHotel,
  marcarFotoPrincipal,
  quitarFotoDeBiblioteca,
  opcionesDeFoto,
  opcionesDeHotel,
  paginaOficialSugerida,
  subirFotoABiblioteca,
  traerImagenPegada,
  type ImagenPegada,
  type OpcionesDeFoto,
  type PaginaSugerida,
  type ResultadoElemento,
} from './actions'
import { AutorizacionFoto } from './autorizacion-foto'
import { AvisoPaginaSinFotos, type AvisoPagina } from './aviso-pagina'
import SelectorHotel, { type AccionesHotel } from './selector-hotel'
import { useImagenPegada } from './usar-imagen-pegada'

export interface PedidoFoto {
  tipo: TipoFoto
  nombre: string
  ciudad: string | null
}

/** Las acciones del selector (inyectables para verlo con datos de muestra). */
export interface AccionesSelector {
  opciones: (p: PedidoFoto, fuente: 'wikimedia' | 'sitio_oficial', siguiente: string | null, pagina?: string | null) => Promise<OpcionesDeFoto>
  sugerida: (p: PedidoFoto) => Promise<PaginaSugerida>
  elegir: (p: PedidoFoto, e: EleccionFoto, reemplaza?: string | null) => Promise<ResultadoElemento>
  subir: (p: PedidoFoto, dataUrl: string, reemplaza?: string | null, categoria?: string | null, autorizacion?: PedidoAutorizacion) => Promise<ResultadoElemento>
  /** Baja en el servidor una imagen pegada que llegó solo como `<img src>`. */
  traerPegada?: (url: string) => Promise<ImagenPegada>
  /** Las del selector de hotel por categoría (sin ellas, las de ONE). */
  hotel?: AccionesHotel
}

const ACCIONES_HOTEL: AccionesHotel = {
  opciones: opcionesDeHotel,
  fotos: fotosDelHotel,
  elegir: elegirFoto,
  subir: subirFotoABiblioteca,
  principal: marcarFotoPrincipal,
  quitar: quitarFotoDeBiblioteca,
  traerPegada: traerImagenPegada,
}

const ACCIONES: AccionesSelector = {
  opciones: opcionesDeFoto,
  sugerida: paginaOficialSugerida,
  elegir: elegirFoto,
  subir: subirFotoABiblioteca,
  traerPegada: traerImagenPegada,
  hotel: ACCIONES_HOTEL,
}

type PropsSelector = {
  pedido: PedidoFoto | null
  reemplaza?: string | null
  sitioOficial: boolean
  abierto: boolean
  onCerrar: () => void
  onElegida: (elemento: ElementoVista | null) => void
  acciones?: AccionesSelector
  fuenteInicial?: FuenteFoto
}

/**
 * El selector de fotos. Un HOTEL se elige por categoría (Fachada · Habitaciones · Zonas comunes,
 * `SelectorHotel`, Mauricio 2026-10-16); una ciudad o una actividad, por fuente (`SelectorPorFuente`).
 */
export default function SelectorFotos(props: PropsSelector) {
  if (props.pedido?.tipo === 'hotel') {
    return (
      <SelectorHotel
        pedido={{ tipo: 'hotel', nombre: props.pedido.nombre, ciudad: props.pedido.ciudad }}
        reemplaza={props.reemplaza}
        sitioOficial={props.sitioOficial}
        abierto={props.abierto}
        onCerrar={props.onCerrar}
        onElegida={props.onElegida}
        acciones={props.acciones?.hotel ?? ACCIONES_HOTEL}
      />
    )
  }
  return <SelectorPorFuente {...props} />
}

const NOMBRE_FUENTE: Record<FuenteFoto, string> = {
  sitio_oficial: 'Página oficial',
  wikimedia: 'Wikimedia Commons',
  subida: 'Subir la mía',
}

const TIPO: Record<TipoFoto, string> = { hotel: 'Hotel', actividad: 'Tour o plan', ciudad: 'Ciudad' }

/**
 * El selector de 12 opciones (decisión de Mauricio del 2026-10-16): la persona ve una cuadrícula
 * por fuente y elige UNA; «Ver más» trae 12 más. Orden de fuentes: la página oficial (solo con el
 * interruptor del workspace), Wikimedia Commons (licencias libres, con crédito) y «Subir la mía».
 * Las opciones no se guardan: solo la elegida, en la biblioteca.
 *
 * `reemplaza` = el id de la foto que se cambia; sin él, la elegida se agrega (hasta 3).
 */
function SelectorPorFuente({
  pedido,
  reemplaza = null,
  sitioOficial,
  abierto,
  onCerrar,
  onElegida,
  acciones = ACCIONES,
  fuenteInicial,
}: PropsSelector) {
  const fuentes = fuentesDelSelector(sitioOficial)
  const [fuente, setFuente] = useState<FuenteFoto>(fuenteInicial ?? fuentes[0])
  const [opciones, setOpciones] = useState<OpcionFoto[]>([])
  const [siguiente, setSiguiente] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elegida, setElegida] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [paginaUrl, setPaginaUrl] = useState('')
  const [paginaLeida, setPaginaLeida] = useState<string | null>(null)
  const [sugerencia, setSugerencia] = useState<PaginaSugerida | null>(null)
  const [porSubir, setPorSubir] = useState<Blob | null>(null)
  const [aviso, setAviso] = useState<AvisoPagina | null>(null)
  // Ctrl+V de una imagen en cualquier pestaña: a la casilla de autorización (Emilio, 2026-10-16).
  const { trayendo } = useImagenPegada({ abierto, ocupado: guardando, onImagen: setPorSubir, traerPegada: acciones.traerPegada })

  const cargar = useCallback(
    async (f: 'wikimedia' | 'sitio_oficial', desde: string | null, url?: string | null) => {
      if (!pedido) return
      setCargando(true)
      setError(null)
      setAviso(null)
      try {
        const r = await acciones.opciones(pedido, f, desde, url)
        if (!r.ok) {
          // Página oficial bloqueada, sin fotos o sin red: el aviso con la salida (pegar la foto).
          if (r.motivo) setAviso({ motivo: r.motivo, pagina: r.pagina ?? url?.trim() ?? null })
          else setError(r.error)
          if (!desde) setOpciones([])
          return
        }
        setOpciones((antes) => (desde ? [...antes, ...r.opciones] : r.opciones))
        setSiguiente(r.siguiente)
        if (r.pagina) setPaginaLeida(r.pagina)
        if (!desde && r.opciones.length === 0) {
          if (f === 'wikimedia') setError('Wikimedia Commons no tiene fotos con licencia libre para esto.')
          else setAviso({ motivo: 'sin_fotos', pagina: r.pagina ?? url?.trim() ?? null })
        }
      } catch {
        if (f === 'sitio_oficial') setAviso({ motivo: 'red', pagina: url?.trim() ?? null })
        else setError('No se pudo buscar. Vuelve a intentarlo.')
      } finally {
        setCargando(false)
      }
    },
    [acciones, pedido],
  )

  // Al abrir o cambiar de fuente: Commons busca solo; la página oficial propone la URL (la
  // persona la confirma antes de bajar fotos).
  useEffect(() => {
    if (!abierto || !pedido) return
    setOpciones([])
    setSiguiente(null)
    setElegida(null)
    setError(null)
    setPaginaLeida(null)
    setPorSubir(null)
    setAviso(null)
    if (fuente === 'wikimedia') void cargar('wikimedia', null)
    if (fuente === 'sitio_oficial') {
      setSugerencia(null)
      void acciones.sugerida(pedido).then((s) => {
        setSugerencia(s)
        if (s.ok && s.url) setPaginaUrl(s.url)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, fuente, pedido?.tipo, pedido?.nombre, pedido?.ciudad])

  const usar = async () => {
    if (!pedido || !elegida) return
    const o = opciones.find((x) => x.id === elegida)
    if (!o) return
    const eleccion: EleccionFoto =
      o.fuente === 'wikimedia' ? { fuente: 'wikimedia', titulo: o.titulo } : { fuente: 'sitio_oficial', pagina: o.pagina, imagen: o.imagen ?? o.titulo }
    setGuardando(true)
    try {
      const r = await acciones.elegir(pedido, eleccion, reemplaza)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Foto guardada en la biblioteca.')
      onElegida(r.elemento)
    } catch {
      toast.error('No se pudo guardar. Vuelve a intentarlo.')
    } finally {
      setGuardando(false)
    }
  }

  /** La foto subida, después de la casilla «Tengo autorización» (Emilio, 2026-10-16). */
  const subir = async (permiso: PedidoAutorizacion) => {
    if (!pedido || !porSubir) return
    setGuardando(true)
    try {
      const foto = await comprimirFotoHotel(porSubir)
      if (!foto) {
        toast.error('Ese archivo no es una foto. Usa un JPG o un PNG.')
        return
      }
      const r = await acciones.subir(pedido, foto.dataUrl, reemplaza, null, permiso)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Foto guardada en la biblioteca.')
      setPorSubir(null)
      onElegida(r.elemento)
    } catch {
      toast.error('No se pudo subir. Vuelve a intentarlo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-3xl" data-selector-fotos>
        <div className="space-y-0.5 pr-6">
          <DialogTitle className="text-base">
            {reemplaza ? 'Cambiar foto' : 'Elegir foto'} · {pedido?.nombre}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {pedido ? `${TIPO[pedido.tipo]}${pedido.ciudad && pedido.tipo !== 'ciudad' ? ` · ${pedido.ciudad}` : ''}. ` : ''}
            {pedido?.tipo === 'hotel' ? 'La foto de un hotel la eliges tú: ONE nunca la pone sola. ' : ''}
            Solo se guarda la que elijas.
          </DialogDescription>
        </div>

        <div className="flex flex-wrap gap-1 border-b pb-2" role="tablist">
          {fuentes.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={fuente === f}
              data-fuente={f}
              onClick={() => setFuente(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${fuente === f ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent'}`}
            >
              {NOMBRE_FUENTE[f]}
            </button>
          ))}
        </div>

        {fuente === 'sitio_oficial' && (
          <div className="space-y-1.5">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (esDeAgenciaDeViajes(paginaUrl)) {
                  toast.error(MENSAJE_AGENCIA)
                  return
                }
                setElegida(null)
                void cargar('sitio_oficial', null, paginaUrl)
              }}
            >
              <div className="relative flex-1">
                <Globe className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={paginaUrl}
                  onChange={(e) => setPaginaUrl(e.target.value)}
                  placeholder="https://… la galería del hotel o la ficha del tour"
                  className="h-8 w-full rounded-md border bg-background pr-2 pl-7 text-xs"
                  inputMode="url"
                />
              </div>
              <button type="submit" disabled={cargando || !paginaUrl.trim()} className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium hover:bg-accent disabled:opacity-50">
                <Search className="h-3.5 w-3.5" /> Buscar fotos
              </button>
            </form>
            <p className="text-[11px] text-muted-foreground">
              {sugerencia === null
                ? 'Buscando la página oficial…'
                : sugerencia.ok && sugerencia.desde === 'wikidata'
                  ? 'ONE encontró esta página oficial en Wikidata (mismo nombre y misma ciudad). Revisa que sea la correcta y busca.'
                  : sugerencia.ok && sugerencia.desde === 'biblioteca'
                    ? 'Es la página oficial que ya se usó para este elemento.'
                    : 'ONE no encontró una página oficial confiable: pega la dirección.'}
              {paginaLeida ? <> Fotos de <b>{new URL(paginaLeida).hostname.replace(/^www\./, '')}</b>.</> : null}
            </p>
          </div>
        )}

        {trayendo && (
          <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Trayendo la imagen que pegaste…
          </p>
        )}
        {fuente === 'sitio_oficial' && aviso && !porSubir && (
          <AvisoPaginaSinFotos
            aviso={aviso}
            etiqueta={pedido?.tipo === 'hotel' ? 'Abrir la página del hotel' : 'Abrir la página'}
            onReintentar={() => void cargar('sitio_oficial', null, paginaUrl)}
          />
        )}

        {porSubir ? (
          <AutorizacionFoto archivo={porSubir} guardando={guardando} onCancelar={() => setPorSubir(null)} onConfirmar={(permiso) => void subir(permiso)} />
        ) : fuente === 'subida' ? (
          <label className={`flex min-h-48 flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm text-muted-foreground hover:bg-accent/40 ${guardando ? 'pointer-events-none opacity-60' : ''}`}>
            {guardando ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
            <span>Elige una foto de tu equipo (JPG o PNG) o pégala aquí (Ctrl+V)</span>
            <span className="text-[11px]">Antes de guardarla te pedimos confirmar que tienes autorización para usarla.</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a) setPorSubir(a) }} />
          </label>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && <p className="py-2 text-xs text-muted-foreground">{error}</p>}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-opciones={opciones.length}>
              {opciones.map((o) => {
                const activa = elegida === o.id
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setElegida(o.id)}
                      className={`group relative block w-full overflow-hidden rounded-md border text-left transition ${activa ? 'ring-2 ring-[#10B981] ring-offset-1' : 'hover:border-foreground/40'}`}
                      aria-pressed={activa}
                    >
                      <div className="aspect-[4/3] w-full bg-muted bg-cover bg-center" style={{ backgroundImage: fondoDeMiniatura(o.miniatura) }} />
                      {activa && (
                        <span className="absolute top-1 right-1 rounded-full bg-[#10B981] p-0.5 text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                      <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground" title={o.credito ?? undefined}>
                        {o.credito ?? '—'} · {o.ancho}×{o.alto}
                      </span>
                    </button>
                  </li>
                )
              })}
              {cargando &&
                Array.from({ length: opciones.length === 0 ? OPCIONES_POR_PAGINA : 4 }).map((_, i) => (
                  <li key={`c-${i}`} className="aspect-[4/3] animate-pulse rounded-md bg-muted" />
                ))}
            </ul>
            {siguiente && !cargando && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => void cargar(fuente === 'sitio_oficial' ? 'sitio_oficial' : 'wikimedia', siguiente, paginaLeida ?? paginaUrl)}
                  className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
                >
                  Ver más
                </button>
              </div>
            )}
          </div>
        )}

        {fuente !== 'subida' && !porSubir && (
          <div className="flex items-center justify-between gap-2 border-t pt-2">
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {(() => {
                const o = opciones.find((x) => x.id === elegida)
                if (!o) return 'Toca una foto para elegirla.'
                return (
                  <a href={o.pagina} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                    {o.fuente === 'wikimedia' ? 'Ver en Wikimedia Commons' : 'Ver la página'} <ExternalLink className="h-3 w-3" />
                  </a>
                )
              })()}
            </span>
            <button
              type="button"
              disabled={!elegida || guardando}
              onClick={() => void usar()}
              className="inline-flex items-center gap-1 rounded-md bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#059669] disabled:opacity-50"
            >
              {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Usar esta foto
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
