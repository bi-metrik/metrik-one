'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Camera, Check, ChevronDown, ChevronRight, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  agregarOpcionARanura,
  crearRanuraConOpcion,
  detectarCaptura,
  type RanuraConLugar,
} from '@/app/(app)/negocios/ranura-actions'
import { confirmarTarifaPorPasajero, leerCasillaDeItem } from '@/app/(app)/negocios/tarifa-pax-actions'
import { deleteItem, recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
import { ubicarCaptura, type CapturaDetectada, type RanuraCandidata } from '@/lib/cotizaciones/bandeja-capturas'
import { fichaDeOpcion } from '@/lib/cotizaciones/opcion-viaje'
import { definicionDeTipo, TIPOS_RANURA, type TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'
import type { Composicion } from '@/lib/cotizaciones/tarifa-pasajero'

/**
 * La bandeja de capturas (P7 del caso Providencia, versión de Mauricio del 2026-09-23):
 * primero se capturan todos los pantallazos, los detalles después.
 *
 *  · Se pegan uno tras otro, los que hagan falta, y cada uno se procesa en segundo plano: no
 *    hay que esperar a que termine uno para pegar el siguiente. Ctrl/Cmd+V funciona en
 *    cualquier parte de la cotización; en el escritorio la zona queda fija arriba y en el
 *    celular es un botón flotante «Pegar / Subir foto».
 *  · ONE decide dónde va cada uno (`ubicarCaptura`): mismo tipo y misma ruta (o lugar) →
 *    opción hermana; cualquier otra cosa → ranura nueva, que suma aparte.
 *  · Cada captura queda como una fila contraída con «Aceptar» y una × directa («Borrada ·
 *    Deshacer»). Abierta antes de aceptar muestra SOLO lo que se confirma; al aceptar se abre
 *    la opción en su bloque, con la nota, los adicionales y el precio.
 *
 * ⚠️ Detectar y leer van en paralelo, pero UBICAR va en fila: dos capturas del mismo vuelo
 * nuevo pegadas a la vez crearían dos ranuras si las dos preguntaran al mismo tiempo. La
 * fila recuerda la ruta de las ranuras que ella misma creó, porque la lectura de la primera
 * opción puede no haber terminado cuando llega la segunda captura.
 *
 * Solo el flujo de viaje (Trappvel) la monta. La imagen no se guarda.
 */

type Estado =
  | { fase: 'mirando' }
  | { fase: 'ubicando' }
  | { fase: 'leyendo' }
  | { fase: 'lista'; alertas: string[] }
  | { fase: 'eligiendo_tipo'; motivo: string }
  | { fase: 'eligiendo_opcion'; mensaje: string; opciones: { nombre: string; precio: string | null }[] }
  | { fase: 'rechazada'; mensaje: string; detalle?: string }
  | { fase: 'aceptada' }
  | { fase: 'borrada'; antes: Estado }

interface Captura {
  id: string
  preview: string
  dataUrl: string
  estado: Estado
  itemId: string | null
  donde: string | null
  tipo: TipoRanura | null
  abierta: boolean
  error: string | null
}

export interface ItemDeBandeja {
  id: string
  nombre?: string | null
  grupo?: string | null
  tarifa_pax?: unknown
  tramos?: unknown
  cargo_destino_valor?: number | string | null
  cargo_destino_moneda?: string | null
}

/** Cuánto espera una captura borrada antes de borrar su opción: la ventana de «Deshacer». */
const ESPERA_BORRADO_MS = 6000

let contador = 0
const nuevoId = () => `cap-${Date.now()}-${++contador}`

export default function BandejaCapturas({
  cotizacionId,
  items,
  composicion,
  onOpcionCreada,
}: {
  cotizacionId: string
  /** Las líneas de la cotización, para mostrar lo leído de cada captura antes de aceptarla. */
  items: ItemDeBandeja[]
  composicion: Composicion | null
  /** La opción aceptada, para abrirla en su bloque. */
  onOpcionCreada?: (itemId: string) => void
}) {
  const router = useRouter()
  const [capturas, setCapturas] = useState<Captura[]>([])
  const entrada = useRef<HTMLInputElement>(null)
  // La fila de ubicación y lo que ella misma creó (ver la cabecera).
  const filaUbicar = useRef<Promise<void>>(Promise.resolve())
  const creadasAqui = useRef<RanuraCandidata[]>([])
  const borrados = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const actualizar = useCallback((id: string, cambio: Partial<Captura>) => {
    setCapturas(cs => cs.map(c => (c.id === id ? { ...c, ...cambio } : c)))
  }, [])

  const leer = useCallback(async (id: string, itemId: string, dataUrl: string, enfoque: { nombre: string; precio: string | null } | null) => {
    actualizar(id, { estado: { fase: 'leyendo' } })
    const lectura = await leerCasillaDeItem(itemId, 'grupo_completo', dataUrl, null, enfoque)
    if (!lectura.ok) {
      if (!enfoque && (lectura.opciones ?? []).length > 0) {
        actualizar(id, { estado: { fase: 'eligiendo_opcion', mensaje: lectura.mensaje, opciones: lectura.opciones ?? [] }, abierta: true })
        return
      }
      // La opción nació para esta captura: si la captura no sirve, se va con ella.
      await deleteItem(itemId)
      await recalcularTotales(cotizacionId)
      actualizar(id, { estado: { fase: 'rechazada', mensaje: lectura.mensaje, detalle: lectura.detalle }, itemId: null })
      router.refresh()
      return
    }
    actualizar(id, { estado: { fase: 'lista', alertas: lectura.alertas } })
    router.refresh()
  }, [actualizar, cotizacionId, router])

  /** Crea la opción donde corresponde. Corre dentro de la fila: nunca dos a la vez. */
  const ubicar = useCallback((id: string, dataUrl: string, captura: CapturaDetectada, ranuras: RanuraConLugar[]) => {
    const tarea = filaUbicar.current.then(async () => {
      actualizar(id, { estado: { fase: 'ubicando' }, tipo: captura.tipo })
      // Lo que la base sabe de cada ranura, completado con lo que esta bandeja recuerda de las
      // que creó: la lectura de su primera opción puede no haber terminado todavía.
      const candidatas: RanuraCandidata[] = [
        ...ranuras.map(r => {
          const aqui = creadasAqui.current.find(c => c.grupo === r.grupo)
          return {
            grupo: r.grupo,
            tipo: captura.tipo,
            lugar: r.lugar ?? aqui?.lugar ?? null,
            origen: r.origen ?? aqui?.origen ?? null,
            destino: r.destino ?? aqui?.destino ?? null,
          }
        }),
        ...creadasAqui.current.filter(c => !ranuras.some(r => r.grupo === c.grupo)),
      ]
      const u = ubicarCaptura(captura, candidatas)
      const creada = u.como === 'hermana'
        ? await agregarOpcionARanura(cotizacionId, u.grupo)
        : await crearRanuraConOpcion(cotizacionId, captura.tipo, { lugar: captura.lugar, origen: captura.origen, destino: captura.destino })
      if (!creada.success) {
        actualizar(id, { estado: { fase: 'rechazada', mensaje: creada.error } })
        return null
      }
      if (u.como === 'nueva') {
        creadasAqui.current.push({ grupo: creada.grupo, tipo: captura.tipo, lugar: captura.lugar, origen: captura.origen, destino: captura.destino })
      }
      const etiqueta = ranuras.find(r => r.grupo === creada.grupo)?.etiqueta ?? definicionDeTipo(captura.tipo).label
      actualizar(id, { itemId: creada.itemId, donde: u.como === 'hermana' ? `Otra opción de ${etiqueta}` : `${definicionDeTipo(captura.tipo).label} nuevo` })
      return creada.itemId
    })
    filaUbicar.current = tarea.then(() => undefined, () => undefined)
    return tarea
  }, [actualizar, cotizacionId])

  const procesar = useCallback(async (id: string, dataUrl: string, tipoElegido?: TipoRanura) => {
    let captura: CapturaDetectada
    let ranuras: RanuraConLugar[] = []
    if (tipoElegido) {
      captura = { tipo: tipoElegido, lugar: null, origen: null, destino: null }
    } else {
      actualizar(id, { estado: { fase: 'mirando' } })
      const r = await detectarCaptura(cotizacionId, dataUrl)
      if (!r.ok) {
        actualizar(id, r.codigo === 'SIN_TIPO' || r.codigo === 'LECTURA'
          ? { estado: { fase: 'eligiendo_tipo', motivo: r.mensaje }, abierta: true }
          : { estado: { fase: 'rechazada', mensaje: r.mensaje } })
        return
      }
      captura = { tipo: r.tipo, lugar: r.lugar, origen: r.origen, destino: r.destino }
      ranuras = r.ranuras
    }
    const itemId = await ubicar(id, dataUrl, captura, ranuras)
    if (itemId) await leer(id, itemId, dataUrl, null)
  }, [actualizar, cotizacionId, leer, ubicar])

  const agregar = useCallback((archivo: File) => {
    if (!archivo.type.startsWith('image/')) {
      toast.error('Eso no es una imagen. Pega o sube el pantallazo del proveedor.')
      return
    }
    const lector = new FileReader()
    lector.onload = ev => {
      const dataUrl = ev.target?.result as string
      const id = nuevoId()
      setCapturas(cs => [...cs, {
        id, preview: dataUrl, dataUrl, estado: { fase: 'mirando' }, itemId: null, donde: null, tipo: null, abierta: false, error: null,
      }])
      void procesar(id, dataUrl)
    }
    lector.readAsDataURL(archivo)
  }, [procesar])

  // Ctrl/Cmd+V en cualquier parte de la cotización. Lo que pegue una zona propia (la lectura
  // de una línea) ya viene con `defaultPrevented`, y en un campo de texto se pega texto.
  useEffect(() => {
    function alPegar(e: ClipboardEvent) {
      if (e.defaultPrevented) return
      const destino = e.target as HTMLElement | null
      if (destino && (destino.tagName === 'INPUT' || destino.tagName === 'TEXTAREA' || destino.isContentEditable)) return
      const imagenes = Array.from(e.clipboardData?.items ?? []).filter(i => i.type.startsWith('image/'))
      if (imagenes.length === 0) return
      e.preventDefault()
      for (const i of imagenes) {
        const archivo = i.getAsFile()
        if (archivo) agregar(archivo)
      }
    }
    window.addEventListener('paste', alPegar)
    return () => window.removeEventListener('paste', alPegar)
  }, [agregar])

  useEffect(() => {
    const pendientes = borrados.current
    return () => { for (const t of pendientes.values()) clearTimeout(t) }
  }, [])

  function borrar(c: Captura) {
    actualizar(c.id, { estado: { fase: 'borrada', antes: c.estado }, abierta: false })
    if (!c.itemId) return
    const itemId = c.itemId
    borrados.current.set(c.id, setTimeout(() => {
      borrados.current.delete(c.id)
      void (async () => {
        await deleteItem(itemId)
        await recalcularTotales(cotizacionId)
        router.refresh()
      })()
    }, ESPERA_BORRADO_MS))
  }

  function deshacer(c: Captura) {
    const t = borrados.current.get(c.id)
    if (t) clearTimeout(t)
    borrados.current.delete(c.id)
    if (c.estado.fase === 'borrada') actualizar(c.id, { estado: c.estado.antes })
  }

  async function aceptar(c: Captura) {
    if (!c.itemId) return
    const r = await confirmarTarifaPorPasajero(c.itemId, null)
    if (!r.success) {
      // No se pudo confirmar solo (falta una captura, la moneda o la tasa): la opción se abre
      // en su bloque, donde está lo que falta.
      actualizar(c.id, { error: r.error ?? 'No se pudo confirmar' })
      onOpcionCreada?.(c.itemId)
      return
    }
    actualizar(c.id, { estado: { fase: 'aceptada' }, error: null, abierta: false })
    onOpcionCreada?.(c.itemId)
    router.refresh()
  }

  const visibles = capturas.filter(c => c.estado.fase !== 'aceptada')
  const enCurso = capturas.filter(c => ['mirando', 'ubicando', 'leyendo'].includes(c.estado.fase)).length

  return (
    <>
      <div className="rounded-xl border-2 border-dashed border-[#10B981]/40 bg-[#F5F4F2] p-3 sm:sticky sm:top-2 sm:z-10" data-bandeja-capturas>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#1A1A1A]">Pantallazos del proveedor</p>
            <p className="text-[11px] text-[#6B7280]">
              Pega los que tengas, uno tras otro (Ctrl+V / Cmd+V en cualquier parte). ONE ve qué es cada
              uno y lo agrupa: mismo tipo y misma ruta es otra opción; lo demás, otro componente.
            </p>
          </div>
          <button
            type="button"
            onClick={() => entrada.current?.click()}
            className="hidden items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs font-medium text-[#1A1A1A] hover:bg-accent sm:inline-flex"
          >
            <Camera className="h-3.5 w-3.5" />
            Subir foto
          </button>
        </div>
        <div
          tabIndex={0}
          role="button"
          aria-label="Pegar pantallazos"
          className="mt-2 hidden min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-dashed bg-background p-2 text-[11px] text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#10B981]/30 sm:flex"
        >
          <ImageIcon className="h-4 w-4" />
          {enCurso > 0 ? `Procesando ${enCurso}… puedes seguir pegando` : 'Pega aquí con Ctrl+V / Cmd+V'}
        </div>
        <input
          ref={entrada}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label="Subir pantallazos"
          onChange={e => {
            const archivos = Array.from(e.target.files ?? [])
            e.target.value = ''
            for (const a of archivos) agregar(a)
          }}
        />

        {visibles.length > 0 && (
          <ul className="mt-2 space-y-1.5" aria-label="Capturas pegadas">
            {visibles.map(c => (
              <FilaCaptura
                key={c.id}
                captura={c}
                item={items.find(i => i.id === c.itemId) ?? null}
                composicion={composicion}
                onAlternar={() => actualizar(c.id, { abierta: !c.abierta })}
                onAceptar={() => void aceptar(c)}
                onBorrar={() => borrar(c)}
                onDeshacer={() => deshacer(c)}
                onElegirTipo={t => { actualizar(c.id, { abierta: false }); void procesar(c.id, c.dataUrl, t) }}
                onElegirOpcion={o => { if (c.itemId) void leer(c.id, c.itemId, c.dataUrl, o) }}
              />
            ))}
          </ul>
        )}
      </div>

      {/* En el celular pegar es difícil: un botón flotante abre la galería o la cámara. */}
      <button
        type="button"
        onClick={() => entrada.current?.click()}
        className="fixed bottom-20 right-4 z-30 inline-flex items-center gap-1.5 rounded-full bg-[#10B981] px-4 py-2.5 text-sm font-medium text-white shadow-lg sm:hidden"
      >
        <Camera className="h-4 w-4" />
        Pegar / Subir foto
      </button>
    </>
  )
}

function FilaCaptura({
  captura: c,
  item,
  composicion,
  onAlternar,
  onAceptar,
  onBorrar,
  onDeshacer,
  onElegirTipo,
  onElegirOpcion,
}: {
  captura: Captura
  item: ItemDeBandeja | null
  composicion: Composicion | null
  onAlternar: () => void
  onAceptar: () => void
  onBorrar: () => void
  onDeshacer: () => void
  onElegirTipo: (t: TipoRanura) => void
  onElegirOpcion: (o: { nombre: string; precio: string | null }) => void
}) {
  if (c.estado.fase === 'borrada') {
    return (
      <li className="flex items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] text-[#6B7280]">
        <span>Borrada</span>
        <button type="button" onClick={onDeshacer} className="font-medium text-primary underline underline-offset-2">
          Deshacer
        </button>
      </li>
    )
  }
  const e = c.estado
  const trabajando = e.fase === 'mirando' || e.fase === 'ubicando' || e.fase === 'leyendo'
  const ficha = item ? fichaDeOpcion({ ...item, nombre: item.nombre ?? null, grupo: item.grupo ?? null }, composicion) : []
  const titulo = item?.nombre || (c.tipo ? definicionDeTipo(c.tipo).label : 'Pantallazo')
  const linea = e.fase === 'mirando' ? 'Mirando qué es…'
    : e.fase === 'ubicando' ? 'Ubicándolo…'
      : e.fase === 'leyendo' ? `Leyendo${c.donde ? ` · ${c.donde}` : ''}…`
        : e.fase === 'lista' ? (c.donde ?? 'Leído')
          : e.fase === 'eligiendo_tipo' ? 'No se reconoce qué es'
            : e.fase === 'eligiendo_opcion' ? '¿Cuál de estas?'
              : e.fase === 'rechazada' ? e.mensaje
                : ''

  return (
    <li className="rounded-lg border bg-background" data-captura={c.id}>
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button type="button" onClick={onAlternar} aria-expanded={c.abierta} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {c.abierta ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL del portapapeles */}
          <img src={c.preview} alt="" className="h-8 w-12 shrink-0 rounded object-cover" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-[#1A1A1A]">{titulo}</span>
            <span className={`flex items-center gap-1 truncate text-[10px] ${e.fase === 'rechazada' ? 'text-red-700' : 'text-[#6B7280]'}`}>
              {trabajando && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
              {linea}
            </span>
          </span>
        </button>
        {e.fase === 'lista' && (
          <button
            type="button"
            onClick={onAceptar}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#10B981] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#059669]"
          >
            <Check className="h-3 w-3" />
            Aceptar
          </button>
        )}
        <button
          type="button"
          onClick={onBorrar}
          disabled={trabajando}
          aria-label="Borrar esta captura"
          className="shrink-0 rounded p-1 text-[#6B7280] hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {c.error && <p className="px-2.5 pb-1.5 text-[10px] font-medium text-amber-700">{c.error}</p>}

      {/* Abierta antes de aceptar: SOLO lo que se confirma. */}
      {c.abierta && (
        <div className="border-t px-2.5 py-2 text-xs">
          {e.fase === 'lista' && (
            <>
              {ficha.length > 0 ? (
                <ul className="space-y-0.5 text-[#1A1A1A]">{ficha.map((r, i) => <li key={i}>{r}</li>)}</ul>
              ) : (
                <p className="text-[11px] text-[#6B7280]">La lectura no dejó datos para la ficha.</p>
              )}
              {e.alertas.map(a => (
                <p key={a} className="mt-1 flex items-start gap-1 text-[11px] font-medium text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {a}
                </p>
              ))}
            </>
          )}
          {e.fase === 'eligiendo_tipo' && (
            <>
              <p className="text-[11px] text-amber-900">{e.motivo}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {TIPOS_RANURA.map(t => (
                  <button key={t} type="button" onClick={() => onElegirTipo(t)} className="rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent">
                    Es {definicionDeTipo(t).label.toLowerCase()}
                  </button>
                ))}
              </div>
            </>
          )}
          {e.fase === 'eligiendo_opcion' && (
            <>
              <p className="text-[11px] text-amber-900">{e.mensaje}</p>
              <div className="mt-1.5 space-y-1">
                {e.opciones.map(o => (
                  <button
                    key={`${o.nombre}|${o.precio ?? ''}`}
                    type="button"
                    onClick={() => onElegirOpcion(o)}
                    className="flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[11px] hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate">{o.nombre}</span>
                    {o.precio && <span className="shrink-0 tabular-nums font-medium">{o.precio}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          {e.fase === 'rechazada' && e.detalle && <p className="text-[11px] text-red-800">{e.detalle}</p>}
          {trabajando && <p className="text-[11px] text-[#6B7280]">Todavía se está procesando.</p>}
        </div>
      )}
    </li>
  )
}
