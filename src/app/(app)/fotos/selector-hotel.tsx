'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Globe, ImagePlus, Loader2, Search, Star } from 'lucide-react'
import { toast } from 'sonner'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { comprimirFotoHotel } from '@/lib/cotizaciones/foto-hotel-navegador'
import { esDeAgenciaDeViajes, MENSAJE_AGENCIA } from '@/lib/fotos/agencias'
import type { PedidoAutorizacion } from '@/lib/fotos/autorizacion'
import { NOMBRE_CATEGORIA } from '@/lib/fotos/categoria'
import { MAX_FOTOS_POR_ELEMENTO } from '@/lib/fotos/clave'
import {
  cabeOtraMarca,
  categoriaAlMarcar,
  cuadrosDelHotel,
  cuadrosDeLaPestana,
  MENSAJE_TRES_MARCADAS,
  PESTANAS_GALERIA,
  portadaDeLaPestana,
  type CuadroGaleria,
  type PestanaGaleria,
} from '@/lib/fotos/galeria'
import { fondoDeMiniatura, type EleccionFoto, type ElementoVista, type OpcionFoto } from '@/lib/fotos/vista'
import type { OpcionesDeHotel, ResultadoElemento } from './actions'
import { AutorizacionFoto } from './autorizacion-foto'

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
  subir: (p: PedidoHotel, dataUrl: string, reemplaza?: string | null, categoria?: string | null, autorizacion?: PedidoAutorizacion) => Promise<ResultadoElemento>
  principal: (id: string) => Promise<ResultadoElemento>
  quitar: (id: string) => Promise<ResultadoElemento>
}

const NOMBRE_PESTANA: Record<PestanaGaleria, string> = { ...NOMBRE_CATEGORIA, todas: 'Todas' }

const VACIO: Record<PestanaGaleria, string> = {
  fachada: 'No encontramos fotos de la fachada de este hotel: súbela o pégala.',
  habitacion: 'No encontramos fotos de las habitaciones de este hotel: súbela o pégala.',
  zonas_comunes: 'No encontramos fotos de las zonas comunes de este hotel: súbela o pégala.',
  todas: 'No encontramos fotos de este hotel: súbela o pégala.',
}

/** El azul de la marca (el de la referencia de Mauricio). */
const AZUL = '#0071C2'

/**
 * La galería de fotos de un HOTEL (Mauricio, 2026-10-16, referencia: la galería de Booking): fotos
 * grandes en cuadrícula, con pestañas Fachada · Habitaciones · Zonas comunes · Todas. La asesora
 * MARCA hasta 3, de cualquier categoría: el número es el orden en la propuesta y la 1 es la
 * principal («Hacer principal» la cambia). Marcar guarda la foto en la biblioteca; desmarcar la
 * quita. Las opciones son de ESE hotel (Commons y, con el interruptor, la página oficial).
 *
 * Subir o pegar (Ctrl+V) pide antes la casilla «Tengo autorización para usar esta foto» (Emilio).
 * Un enlace de Booking, Expedia, Despegar u otra agencia en línea se rechaza.
 */
export default function SelectorHotel({
  pedido,
  reemplaza = null,
  sitioOficial,
  abierto,
  onCerrar,
  onElegida,
  acciones,
  pestanaInicial = 'todas',
}: {
  pedido: PedidoHotel | null
  reemplaza?: string | null
  sitioOficial: boolean
  abierto: boolean
  onCerrar: () => void
  onElegida: (elemento: ElementoVista | null) => void
  acciones: AccionesHotel
  pestanaInicial?: PestanaGaleria
}) {
  const [pestana, setPestana] = useState<PestanaGaleria>(pestanaInicial)
  const [opciones, setOpciones] = useState<OpcionFoto[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clasificadas, setClasificadas] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [elemento, setElemento] = useState<ElementoVista | null>(null)
  const [cambio, setCambio] = useState(false)
  const [paginaUrl, setPaginaUrl] = useState('')
  const [paginaLeida, setPaginaLeida] = useState<string | null>(null)
  const [siguiente, setSiguiente] = useState<string | null>(null)
  const [sugerida, setSugerida] = useState<'biblioteca' | 'wikidata' | null>(null)
  const [porSubir, setPorSubir] = useState<Blob | null>(null)
  // Cada foto nueva remonta la casilla (sin marcar), aunque se pegue otra con una pendiente.
  const [subidaN, setSubidaN] = useState(0)
  const [reemplazo, setReemplazo] = useState<string | null>(reemplaza)
  const zonaSubir = useRef<HTMLDivElement | null>(null)

  // Al abrir: las fotos que ya tiene el hotel y las opciones de Commons (clasificadas).
  useEffect(() => {
    if (!abierto || !pedido) return
    setPestana(pestanaInicial)
    setOpciones([])
    setError(null)
    setCambio(false)
    setPaginaLeida(null)
    setSiguiente(null)
    setSugerida(null)
    setPorSubir(null)
    setReemplazo(reemplaza)
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
      if (esDeAgenciaDeViajes(paginaUrl)) {
        toast.error(MENSAJE_AGENCIA)
        return
      }
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
    return true
  }

  const fotos = elemento?.fotos ?? []
  const cuadros = cuadrosDelHotel(opciones, fotos)
  const { propios, sinClasificar } = cuadrosDeLaPestana(cuadros, pestana)

  /** Clic en un cuadro: marca (guarda en la biblioteca) o desmarca (la quita). */
  const alternar = async (c: CuadroGaleria) => {
    if (!pedido || ocupado) return
    if (c.fotoId) {
      if (c.origen === 'asesora' && !window.confirm('Esta foto la subieron a mano: si la desmarcas, sale de la biblioteca. ¿Quitarla?')) return
      setOcupado(c.clave)
      try {
        quedo(await acciones.quitar(c.fotoId))
      } catch {
        toast.error('No se pudo quitar. Vuelve a intentarlo.')
      } finally {
        setOcupado(null)
      }
      return
    }
    const o = c.opcion
    if (!o) return
    if (!reemplazo && !cabeOtraMarca(fotos)) {
      toast.error(MENSAJE_TRES_MARCADAS)
      return
    }
    const eleccion: EleccionFoto =
      o.fuente === 'wikimedia' ? { fuente: 'wikimedia', titulo: o.titulo } : { fuente: 'sitio_oficial', pagina: o.pagina, imagen: o.imagen ?? o.titulo }
    setOcupado(c.clave)
    try {
      if (quedo(await acciones.elegir(pedido, eleccion, reemplazo, categoriaAlMarcar(c, pestana)))) setReemplazo(null)
    } catch {
      toast.error('No se pudo guardar. Vuelve a intentarlo.')
    } finally {
      setOcupado(null)
    }
  }

  const hacerPrincipal = async (id: string) => {
    setOcupado(`principal:${id}`)
    try {
      quedo(await acciones.principal(id))
    } catch {
      toast.error('No se pudo cambiar la principal.')
    } finally {
      setOcupado(null)
    }
  }

  /** Una foto subida o pegada: primero la casilla de autorización. */
  const pedirAutorizacion = (archivo: Blob) => {
    if (!reemplazo && !cabeOtraMarca(fotos)) {
      toast.error(MENSAJE_TRES_MARCADAS)
      return
    }
    setPorSubir(archivo)
    setSubidaN((n) => n + 1)
    requestAnimationFrame(() => zonaSubir.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  const subir = async (permiso: PedidoAutorizacion) => {
    if (!pedido || !porSubir) return
    setOcupado('subir')
    try {
      const foto = await comprimirFotoHotel(porSubir)
      if (!foto) {
        toast.error('Ese archivo no es una foto. Usa un JPG o un PNG.')
        return
      }
      const categoria = categoriaAlMarcar(null, pestana)
      if (quedo(await acciones.subir(pedido, foto.dataUrl, reemplazo, categoria, permiso))) {
        toast.success('Foto guardada en la biblioteca.')
        setPorSubir(null)
        setReemplazo(null)
      }
    } catch {
      toast.error('No se pudo subir. Vuelve a intentarlo.')
    } finally {
      setOcupado(null)
    }
  }

  const cerrar = () => (cambio ? onElegida(elemento) : onCerrar())

  const cuadro = (c: CuadroGaleria) => {
    const marcada = c.marca !== null
    const trabajando = ocupado === c.clave || ocupado === `principal:${c.fotoId}`
    return (
      <li key={c.clave} className="group relative" data-cuadro={c.clave} data-marca={c.marca ?? undefined}>
        <button
          type="button"
          onClick={() => void alternar(c)}
          disabled={!!ocupado}
          aria-pressed={marcada}
          aria-label={marcada ? `Desmarcar (es la ${c.marca} en la propuesta)` : 'Marcar para la propuesta'}
          className={`relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted bg-cover bg-center transition disabled:cursor-wait ${marcada ? 'ring-[3px] ring-[#0071C2] ring-offset-2' : 'hover:brightness-95'}`}
          style={c.imagen ? { backgroundImage: fondoDeMiniatura(c.imagen) } : undefined}
        >
          {/* Autor y licencia (Commons) o la página: al pasar el mouse; en el celular, siempre. */}
          {c.credito && (
            <span
              className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1 text-left text-[10px] text-white opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              title={c.credito}
              data-credito
            >
              {c.origen === 'wikimedia' ? `© ${c.credito}` : c.origen === 'sitio_oficial' ? `Página oficial · ${c.credito}` : c.credito}
            </span>
          )}
          {!c.credito && c.origen === 'asesora' && (
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pt-4 pb-1 text-left text-[10px] text-white">Subida por la agencia</span>
          )}
        </button>
        {marcada ? (
          <span
            className="pointer-events-none absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white shadow"
            style={{ backgroundColor: AZUL }}
            data-numero
          >
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : c.marca}
          </span>
        ) : (
          <span className="pointer-events-none absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-black/20 text-white opacity-0 shadow transition group-hover:opacity-100">
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </span>
        )}
        {marcada && c.fotoId && (
          c.principal ? (
            <span className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold shadow" style={{ color: AZUL }}>
              <Star className="h-3 w-3 fill-current" /> Principal
            </span>
          ) : (
            <button
              type="button"
              disabled={!!ocupado}
              onClick={() => c.fotoId && void hacerPrincipal(c.fotoId)}
              className="absolute top-2 right-2 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-medium shadow hover:bg-white disabled:opacity-60"
              style={{ color: AZUL }}
              data-hacer-principal
            >
              Hacer principal
            </button>
          )
        )}
        {c.pagina && (
          <a
            href={c.pagina}
            target="_blank"
            rel="noreferrer"
            className="absolute right-2 bottom-6 hidden rounded-full bg-white/90 p-1 text-foreground shadow group-hover:block"
            title={c.origen === 'wikimedia' ? 'Ver en Wikimedia Commons' : 'Ver la página'}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </li>
    )
  }

  const cuadricula = (lista: CuadroGaleria[]) => <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">{lista.map(cuadro)}</ul>

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && cerrar()}>
      <DialogContent
        className="flex max-h-[94vh] flex-col gap-3 p-4 sm:max-w-5xl sm:p-5"
        data-selector-hotel
        onPaste={(e) => {
          const archivo = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
          if (archivo) {
            e.preventDefault()
            if (!ocupado) pedirAutorizacion(archivo)
            return
          }
          const texto = e.clipboardData.getData('text')
          if (texto && esDeAgenciaDeViajes(texto)) {
            e.preventDefault()
            toast.error(MENSAJE_AGENCIA)
          }
        }}
      >
        <div className="space-y-0.5 border-b pr-6 pb-2 text-center">
          <DialogTitle className="text-base font-bold">{pedido?.nombre}</DialogTitle>
          <DialogDescription className="text-xs">
            {pedido?.ciudad ? `${pedido.ciudad} · ` : ''}Marca hasta {MAX_FOTOS_POR_ELEMENTO}: el número es el orden en la propuesta y la 1 es la principal.
          </DialogDescription>
        </div>

        {/* Las pestañas, con su portada (como la galería de Booking). */}
        <div className="flex gap-3 overflow-x-auto pb-1" role="tablist">
          {PESTANAS_GALERIA.map((p) => {
            const portada = portadaDeLaPestana(cuadros, p)
            const n = cuadrosDeLaPestana(cuadros, p).propios.length
            const activa = pestana === p
            return (
              <button key={p} type="button" role="tab" aria-selected={activa} data-pestana-galeria={p} onClick={() => setPestana(p)} className="w-24 shrink-0 text-left sm:w-28">
                <span
                  className={`block aspect-[4/3] w-full rounded-lg bg-muted bg-cover bg-center ${activa ? 'ring-2 ring-[#0071C2] ring-offset-1' : 'opacity-90 hover:opacity-100'}`}
                  style={portada ? { backgroundImage: fondoDeMiniatura(portada) } : undefined}
                />
                <span className={`mt-1 block text-xs ${activa ? 'font-semibold' : 'text-foreground'}`} style={activa ? { color: AZUL } : undefined}>
                  {NOMBRE_PESTANA[p]}
                  {!cargando && n > 0 ? <span className="ml-1 font-normal text-muted-foreground">{n}</span> : null}
                </span>
              </button>
            )
          })}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" data-pestana={pestana} data-opciones={propios.length}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{pestana === 'todas' ? 'Fotos del alojamiento' : NOMBRE_PESTANA[pestana]}</p>
            <p className="text-[11px] text-muted-foreground" data-marcadas={fotos.length}>
              {fotos.length} de {MAX_FOTOS_POR_ELEMENTO} marcadas
            </p>
          </div>
          {reemplazo && <p className="text-[11px]" style={{ color: AZUL }}>La que marques reemplaza la foto que querías cambiar.</p>}
          {cargando && propios.length === 0 ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i} className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
              ))}
            </ul>
          ) : propios.length > 0 ? (
            cuadricula(propios)
          ) : (
            <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground" data-vacia>
              {error ?? VACIO[pestana]}
              {!error && sitioOficial ? ' O pega abajo el enlace de la página del hotel.' : ''}
            </div>
          )}

          {!cargando && sinClasificar.length > 0 && (
            <div className="space-y-1.5" data-sin-clasificar>
              <p className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {clasificadas ? 'ONE no pudo mirar estas fotos.' : 'ONE no pudo revisar las fotos.'} Son de este hotel por su nombre: revisa qué muestran antes de marcarlas.
              </p>
              {cuadricula(sinClasificar)}
            </div>
          )}

          <div ref={zonaSubir} className="space-y-2 rounded-lg bg-muted/40 p-2" data-zona-subir>
            {porSubir ? (
              <AutorizacionFoto
                key={subidaN}
                archivo={porSubir}
                guardando={ocupado === 'subir'}
                onCancelar={() => setPorSubir(null)}
                onConfirmar={(permiso) => void subir(permiso)}
                destino={pestana === 'todas' ? 'Queda en la biblioteca del hotel.' : `Queda en ${NOMBRE_PESTANA[pestana]}.`}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <label className={`inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent ${ocupado ? 'pointer-events-none opacity-60' : ''}`}>
                  <ImagePlus className="h-3.5 w-3.5" /> Subir la mía
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const a = e.target.files?.[0]
                      e.target.value = ''
                      if (a) pedirAutorizacion(a)
                    }}
                  />
                </label>
                <span className="text-[11px] text-muted-foreground">o pega una imagen aquí (Ctrl+V). Te pedimos confirmar que tienes autorización para usarla.</span>
              </div>
            )}
            {sitioOficial && !porSubir && (
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
                    placeholder="Pega el enlace de la página oficial del hotel (https://…)"
                    className="h-8 w-full rounded-md border bg-background pr-2 pl-7 text-xs"
                    inputMode="url"
                  />
                </div>
                <button type="submit" disabled={cargando || !paginaUrl.trim()} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50">
                  <Search className="h-3.5 w-3.5" /> Buscar en la página
                </button>
              </form>
            )}
            {sitioOficial && sugerida && !paginaLeida && !porSubir && (
              <p className="text-[11px] text-muted-foreground">
                {sugerida === 'wikidata' ? 'ONE encontró esta página oficial en Wikidata: revisa que sea la del hotel y busca.' : 'Es la página oficial que ya se usó para este hotel.'}
              </p>
            )}
            {siguiente && !cargando && !porSubir && (
              <button type="button" onClick={() => void buscarEnPagina(siguiente)} className="rounded-md border bg-background px-3 py-1 text-xs hover:bg-accent">
                Más fotos de la página
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">Toca una foto para marcarla; tócala otra vez para quitarla.</span>
          <button type="button" onClick={cerrar} className="rounded-md px-4 py-1.5 text-xs font-medium text-white" style={{ backgroundColor: AZUL }}>
            {cambio ? 'Listo' : 'Cerrar'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

