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
import { leerCaptura, procesarCaptura, type DependenciasDeProceso, type EstadoDeProceso } from '@/lib/cotizaciones/proceso-captura'
import { crearUbicador, type Ubicador } from '@/lib/cotizaciones/ubicador-capturas'
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
 * ⚠️ Detectar y leer van en paralelo, pero UBICAR va en fila (`ubicador-capturas.ts`): dos
 * capturas del mismo vuelo nuevo pegadas a la vez crearían dos ranuras si las dos preguntaran
 * al mismo tiempo. La fila recuerda las ranuras que ella misma creó, y las OLVIDA cuando su
 * última opción se borra: si no, un hotel pegado después iba a una ranura muerta.
 *
 * ⚠️ La ficha de cada fila sale de lo que devolvió la lectura (`OpcionLeida`), no de las líneas
 * de la página: el refresco que las trae puede llegar tarde, y la fila decía «La lectura no
 * dejó datos» sobre una lectura completa (COT-2026-0011).
 *
 * Solo el flujo de viaje (Trappvel) la monta. La imagen no se guarda.
 */

export type Estado =
  | EstadoDeProceso
  | { fase: 'aceptada' }
  /**
   * Quitada por el asesor. `reanudar`: se quitó mientras se analizaba (P11), así que
   * «Deshacer» no devuelve un estado viejo: la vuelve a la cola y se analiza de nuevo.
   */
  | { fase: 'borrada'; antes: Estado; reanudar?: boolean }

export interface Captura {
  id: string
  preview: string
  dataUrl: string
  estado: Estado
  itemId: string | null
  donde: string | null
  tipo: TipoRanura | null
  /** El nombre visible de la ranura donde quedó («Vuelo San Andrés–Providencia»). */
  etiqueta: string | null
  /** La opción como la dejó la lectura: la ficha se pinta con esto, sin esperar el refresco. */
  leida: ItemDeBandeja | null
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

/**
 * ¿Hay trabajo de esta captura que se perdería al recargar? Lo que se está procesando, y la
 * opción que espera a que se elija cuál leer (existe en su bloque y todavía está vacía).
 */
export function enElAireCaptura(c: Pick<Captura, 'estado' | 'itemId'>): boolean {
  const f = c.estado.fase
  return f === 'mirando' || f === 'ubicando' || f === 'leyendo' || (f === 'eligiendo_opcion' && c.itemId !== null)
}

/** ¿Se está analizando? La × también vale aquí (P11): la lectura en vuelo se descarta. */
export function enProceso(e: Estado): boolean {
  return e.fase === 'mirando' || e.fase === 'ubicando' || e.fase === 'leyendo'
}

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
  // La fila de ubicación (ver la cabecera). Se crea al primer uso: una sola por bandeja.
  const ubicadorRef = useRef<Ubicador | null>(null)
  const ubicador = useCallback((): Ubicador => {
    if (!ubicadorRef.current) {
      ubicadorRef.current = crearUbicador({
        agregar: grupo => agregarOpcionARanura(cotizacionId, grupo),
        crear: captura => crearRanuraConOpcion(cotizacionId, captura.tipo, { lugar: captura.lugar, origen: captura.origen, destino: captura.destino }),
      })
    }
    return ubicadorRef.current
  }, [cotizacionId])
  // Borrados en su ventana de «Deshacer»: el reloj y lo que hay que ejecutar si nadie deshace.
  const borrados = useRef(new Map<string, { reloj: ReturnType<typeof setTimeout>; ejecutar: () => void }>())
  // Las capturas vigentes, para la limpieza al salir (el efecto no ve el estado de ese momento).
  const vigentes = useRef<Captura[]>([])
  useEffect(() => { vigentes.current = capturas }, [capturas])

  const actualizar = useCallback((id: string, cambio: Partial<Captura>) => {
    setCapturas(cs => cs.map(c => (c.id === id ? { ...c, ...cambio } : c)))
  }, [])

  /**
   * Retira la opción que nació para una captura que no sirvió. Si era la última de su ranura,
   * `deleteItem` retira también la ranura y la fila deja de ofrecerla. Nunca lanza: un fallo aquí
   * no puede dejar la fila colgada.
   */
  const descartarOpcion = useCallback(async (itemId: string) => {
    try {
      await deleteItem(itemId)
      ubicador().olvidarOpcion(itemId)
      await recalcularTotales(cotizacionId)
      return true
    } catch {
      return false
    }
  }, [cotizacionId, ubicador])

  /**
   * Cada pasada de una captura lleva un turno. Quitarla (o volverla a la cola) cambia el
   * turno, y la pasada vieja deja de ser vigente: lo que devuelva se descarta al llegar (P11).
   */
  const turnos = useRef(new Map<string, number>())
  const nuevoTurno = useCallback((id: string) => {
    const t = (turnos.current.get(id) ?? 0) + 1
    turnos.current.set(id, t)
    return t
  }, [])

  /** Las acciones reales para una pasada de la captura `id`. */
  const dependencias = useCallback((id: string, dataUrl: string): DependenciasDeProceso => {
    const turno = turnos.current.get(id) ?? nuevoTurno(id)
    return {
      detectar: () => detectarCaptura(cotizacionId, dataUrl),
      // `RanuraConLugar` y `RanuraExistente` son la misma forma vista desde dos módulos.
      ubicar: (captura, ranuras) => ubicador().ubicar(captura, ranuras as RanuraConLugar[]),
      leer: async (itemId, enfoque) => {
        try {
          return await leerCasillaDeItem(itemId, 'grupo_completo', dataUrl, null, enfoque)
        } catch {
          // La acción se cayó (tiempo agotado, red). Antes la fila quedaba en «Leyendo…» para
          // siempre, sin poder borrarse, y la opción vacía se quedaba en su bloque (COT-2026-0011).
          return { ok: false, mensaje: 'No se pudo leer el pantallazo. Vuelve a pegarlo.' }
        }
      },
      descartar: descartarOpcion,
      vigente: () => turnos.current.get(id) === turno,
      informar: cambio => actualizar(id, cambio),
      refrescar: () => router.refresh(),
    }
  }, [actualizar, cotizacionId, descartarOpcion, nuevoTurno, router, ubicador])

  const procesar = useCallback(async (id: string, dataUrl: string, tipoElegido?: TipoRanura) => {
    await procesarCaptura(dependencias(id, dataUrl), tipoElegido)
  }, [dependencias])

  const leer = useCallback(async (id: string, itemId: string, dataUrl: string, enfoque: { nombre: string; precio: string | null } | null) => {
    await leerCaptura(dependencias(id, dataUrl), itemId, enfoque)
  }, [dependencias])

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
        id, preview: dataUrl, dataUrl, estado: { fase: 'mirando' }, itemId: null, donde: null, tipo: null, etiqueta: null, leida: null, abierta: false, error: null,
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

  // Al salir de la cotización (navegar dentro de la app) nada se queda a medias: los borrados en
  // su ventana de «Deshacer» se ejecutan ya, y la opción que esperaba a que se eligiera cuál
  // leer se retira. Antes el reloj se cancelaba y la opción se quedaba vacía en su bloque.
  useEffect(() => {
    const pendientes = borrados.current
    const actuales = vigentes
    return () => {
      for (const { reloj, ejecutar } of pendientes.values()) { clearTimeout(reloj); ejecutar() }
      pendientes.clear()
      for (const c of actuales.current) {
        if (c.itemId && c.estado.fase === 'eligiendo_opcion') void descartarOpcion(c.itemId)
      }
    }
  }, [descartarOpcion])

  // Recargar o cerrar la pestaña corta todo lo que está en el aire: el navegador pregunta antes.
  const enElAire = capturas.some(c => enElAireCaptura(c)) || capturas.some(c => c.estado.fase === 'borrada' && c.itemId)
  useEffect(() => {
    if (!enElAire) return
    function alSalir(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [enElAire])

  function borrar(c: Captura) {
    if (enProceso(c.estado)) {
      // Se quita a mitad del análisis (P11): la pasada en vuelo deja de ser vigente y, si ya
      // había creado la opción, la borra ella misma al llegar. «Deshacer» la vuelve a la cola.
      nuevoTurno(c.id)
      actualizar(c.id, {
        estado: { fase: 'borrada', antes: { fase: 'mirando' }, reanudar: true },
        itemId: null, leida: null, donde: null, error: null, abierta: false,
      })
      if (c.itemId) void descartarOpcion(c.itemId).then(() => router.refresh())
      return
    }
    actualizar(c.id, { estado: { fase: 'borrada', antes: c.estado }, abierta: false })
    if (!c.itemId) return
    const itemId = c.itemId
    const ejecutar = () => {
      borrados.current.delete(c.id)
      void descartarOpcion(itemId).then(() => router.refresh())
    }
    borrados.current.set(c.id, { reloj: setTimeout(ejecutar, ESPERA_BORRADO_MS), ejecutar })
  }

  function deshacer(c: Captura) {
    const b = borrados.current.get(c.id)
    if (b) clearTimeout(b.reloj)
    borrados.current.delete(c.id)
    if (c.estado.fase !== 'borrada') return
    if (c.estado.reanudar) {
      // Vuelve a la cola: se analiza de nuevo desde cero, con un turno propio.
      nuevoTurno(c.id)
      actualizar(c.id, { estado: { fase: 'mirando' } })
      void procesar(c.id, c.dataUrl)
      return
    }
    actualizar(c.id, { estado: c.estado.antes })
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
                onRevisar={() => { if (c.itemId) onOpcionCreada?.(c.itemId) }}
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

/** Exportada para la prueba de render: es donde vive la ficha. */
export function FilaCaptura({
  captura: c,
  item,
  composicion,
  onAlternar,
  onAceptar,
  onRevisar,
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
  /** Abre la opción en su bloque: la salida cuando la ficha no tiene nada que confirmar. */
  onRevisar?: () => void
  onBorrar: () => void
  onDeshacer: () => void
  onElegirTipo: (t: TipoRanura) => void
  onElegirOpcion: (o: { nombre: string; precio: string | null }) => void
}) {
  if (c.estado.fase === 'borrada') {
    return (
      <li className="flex items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] text-[#6B7280]">
        <span>{c.estado.reanudar ? 'Quitada · se dejó de analizar' : 'Borrada'}</span>
        <button type="button" onClick={onDeshacer} className="font-medium text-primary underline underline-offset-2">
          Deshacer
        </button>
      </li>
    )
  }
  const e = c.estado
  const trabajando = e.fase === 'mirando' || e.fase === 'ubicando' || e.fase === 'leyendo'
  // Lo que devolvió la lectura manda sobre la lista de la página, que puede venir de antes de
  // la lectura (la opción recién creada, vacía).
  const opcion = c.leida ?? item
  const ficha = opcion ? fichaDeOpcion({ ...opcion, nombre: opcion.nombre ?? null, grupo: opcion.grupo ?? null }, composicion) : []
  // La ficha todavía no llega: ni la lectura la trajo ni la página la tiene.
  const preparando = e.fase === 'lista' && !opcion
  // Con la ficha vacía no se ofrece «Aceptar» como si todo estuviera bien: se manda al bloque.
  const confirmable = e.fase === 'lista' && ficha.length > 0
  const titulo = opcion?.nombre || c.etiqueta || (c.tipo ? definicionDeTipo(c.tipo).label : 'Pantallazo')
  const linea = e.fase === 'mirando' ? 'Mirando qué es…'
    : e.fase === 'ubicando' ? 'Ubicándolo…'
      : e.fase === 'leyendo' ? `Leyendo${c.donde ? ` · ${c.donde}` : ''}…`
        : e.fase === 'lista' ? (preparando ? 'Preparando la ficha…' : (c.donde ?? 'Leído'))
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
        {e.fase === 'lista' && !confirmable && !preparando && onRevisar && (
          <button
            type="button"
            onClick={onRevisar}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-[#1A1A1A] hover:bg-accent"
          >
            Revisar en su bloque
          </button>
        )}
        {confirmable && (
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
          aria-label={trabajando ? 'Quitar esta captura (se deja de analizar)' : 'Borrar esta captura'}
          data-quitar-captura
          className="shrink-0 rounded p-1 text-[#6B7280] hover:bg-red-50 hover:text-red-600"
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
              {preparando ? (
                <p className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  Preparando la ficha…
                </p>
              ) : ficha.length > 0 ? (
                <ul className="space-y-0.5 text-[#1A1A1A]">{ficha.map((r, i) => <li key={i}>{r}</li>)}</ul>
              ) : (
                <p className="text-[11px] text-[#6B7280]">La lectura no dejó datos para la ficha: revísala en su bloque.</p>
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
