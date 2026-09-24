'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Camera, Check, ChevronDown, ChevronRight, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import { detectarCaptura } from '@/app/(app)/negocios/ranura-actions'
import { leerCapturaEnBorrador, type BorradorParaAceptar, type ResultadoAceptarCaptura } from '@/app/(app)/negocios/tarifa-pax-actions'
import { leerCaptura, procesarCaptura, type Borrador, type DependenciasDeProceso, type EstadoDeProceso, type Pistas } from '@/lib/cotizaciones/proceso-captura'
import { esIdDeBorrador, revisarBorrador } from '@/lib/cotizaciones/revisar-borrador'
import type { OpcionLeida } from '@/lib/cotizaciones/bandeja-capturas'
import {
  huellaDeImagen,
  mensajeMismaImagen,
  nombreDeOpcion,
  opcionConLaMismaImagen,
  type OpcionComparable,
  type Ubicacion,
} from '@/lib/cotizaciones/captura-repetida'
import { fichaDeOpcion } from '@/lib/cotizaciones/opcion-viaje'
import { definicionDeTipo, TIPOS_RANURA, type TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'
import type { Composicion } from '@/lib/cotizaciones/tarifa-pasajero'
import { VAR_ALTO_ENCABEZADO } from '@/app/(app)/negocios/marco-cotizacion-contexto'
import { PREGUNTA_AL_SALIR, saleDeLaPagina } from '@/lib/cotizaciones/aviso-al-salir'

/**
 * La bandeja de capturas (P7 del caso Providencia, versión de Mauricio del 2026-09-23):
 * primero se capturan todos los pantallazos, los detalles después.
 *
 *  · Se pegan uno tras otro, los que hagan falta, y cada uno se lee en segundo plano: no hay
 *    que esperar a que termine uno para pegar el siguiente. Ctrl/Cmd+V funciona en cualquier
 *    parte de la cotización; en el escritorio la zona queda fija arriba y en el celular es un
 *    botón flotante «Pegar / Subir foto».
 *
 * ## Lo que sigue en la bandeja no toca Componentes (H2, prueba del 2026-09-24)
 *
 * Mirar y leer NO crean ranura, opción ni habitación: la lectura vuelve como BORRADOR firmado
 * y vive en la fila. Solo «Aceptar» la lleva a Componentes, y es el servidor el que decide,
 * contra la cotización de ese momento, a dónde (`ubicarLectura`): la ranura del mismo destino
 * y fechas como otra opción (H1), una habitación del mismo hotel, o una ranura nueva. Quitar
 * una fila es solo quitarla: no hay nada que borrar en Componentes.
 *
 * ## «Aceptar» no salta a Componentes (H3)
 *
 * Confirma con un aviso discreto («Agregada a Hotel en Providencia · Opción 2») con un «Ver»
 * que abre la opción solo si se toca. Las aceptaciones van en fila: dos hoteles con las mismas
 * fechas aceptados seguidos no pueden abrir cada uno su ranura.
 *
 * ## El pantallazo repetido (P10)
 *
 * La misma imagen (misma huella) no se procesa: la fila dice dónde está ya y se quita sola;
 * «Deshacer» la procesa igual. Otra imagen con el mismo servicio y precio se lee y pregunta
 * («Descartar» por defecto, o «Agregar igual»). El mismo servicio con otro precio se ofrece
 * reemplazar o dejar como otra opción. Nunca se decide en silencio (`captura-repetida.ts`).
 *
 * Solo el flujo de viaje (Trappvel) la monta. La imagen no se guarda; su huella, sí.
 */

export type Estado =
  | EstadoDeProceso
  | { fase: 'aceptada' }
  /** R1 · «Aceptar» en camino: la fila lo dice en el acto y no se puede tocar dos veces. */
  | { fase: 'aceptando' }
  /**
   * Quitada por el asesor. `reanudar`: se quitó mientras se analizaba (P11), así que
   * «Deshacer» no devuelve un estado viejo: la vuelve a la cola y se analiza de nuevo.
   */
  | { fase: 'borrada'; antes: Estado; reanudar?: boolean }
  /** P10 · la misma imagen ya se había pegado: no se procesa. */
  | { fase: 'repetida'; mensaje: string }
  /** La repetida se quitó sola: no se pinta. */
  | { fase: 'descartada' }

export interface Captura {
  id: string
  preview: string
  dataUrl: string
  estado: Estado
  tipo: TipoRanura | null
  /** Lo que dijo el detector: la segunda lectura («¿Cuál de estas?») lo necesita. */
  pistas: Pistas | null
  /** La lectura firmada, todavía fuera de Componentes. Solo «Aceptar» la lleva. */
  borrador: Borrador | null
  /** La opción donde quedó, una vez aceptada. Antes, `null`: nada existe en Componentes. */
  itemId: string | null
  /** A dónde va a ir («Otra opción de Hotel en Providencia»); aceptada, dónde quedó. */
  donde: string | null
  /** La opción como quedaría: la ficha se pinta con esto. */
  leida: OpcionLeida | null
  abierta: boolean
  error: string | null
  /** Huella del archivo (`huellaDeImagen`), para reconocer la misma imagen pegada otra vez. */
  huella?: string | null
  /** El nombre visible de la ranura donde quedó. */
  etiqueta?: string | null
}

export interface ItemDeBandeja {
  id: string
  nombre?: string | null
  grupo?: string | null
  tarifa_pax?: unknown
  tramos?: unknown
  cargo_destino_valor?: number | string | null
  cargo_destino_moneda?: string | null
  es_ajuste?: boolean | null
}

/** Cuánto se queda a la vista una repetida antes de quitarse sola: la ventana de «Deshacer». */
const ESPERA_REPETIDA_MS = 6000

const FASES_CON_BORRADOR = new Set(['lista', 'parecida', 'otro_precio'])

/**
 * ¿Hay trabajo de esta captura que se perdería al recargar? Lo que se está procesando o
 * aceptando, lo que espera a que se elija cuál leer, y toda lectura que todavía no se aceptó:
 * el borrador vive solo en esta pestaña.
 */
export function enElAireCaptura(c: Pick<Captura, 'estado' | 'borrador'>): boolean {
  const f = c.estado.fase
  return f === 'mirando' || f === 'leyendo' || f === 'aceptando' || f === 'eligiendo_opcion'
    || (FASES_CON_BORRADOR.has(f) && !!c.borrador)
}

/**
 * Las opciones contra las que se compara una captura (P10): las de la página y las que dejaron
 * las otras capturas de la bandeja. Una aceptada se compara con su id real (se puede reemplazar
 * su precio); una todavía en borrador, con su id de borrador (`revisarBorrador` no ofrece
 * reemplazar lo que aún no está en Componentes).
 */
export function opcionesParaComparar(items: readonly ItemDeBandeja[], capturas: readonly Captura[], excepto: string): OpcionComparable[] {
  const porId = new Map<string, OpcionComparable>()
  for (const i of items) if (i.es_ajuste !== true) porId.set(i.id, i)
  for (const c of capturas) {
    if (c.id === excepto || !c.leida) continue
    const f = c.estado.fase
    if (f === 'aceptada' && c.itemId) {
      porId.set(c.itemId, { ...c.leida, id: c.itemId })
    } else if ((FASES_CON_BORRADOR.has(f) || f === 'aceptando') && c.borrador) {
      porId.set(c.leida.id, c.leida)
    }
  }
  return [...porId.values()]
}

/** ¿Se está analizando? La × también vale aquí (P11): la lectura en vuelo se descarta. */
export function enProceso(e: Estado): boolean {
  return e.fase === 'mirando' || e.fase === 'leyendo'
}

/** Lo que dice el servidor al aceptar, en el idioma de la fila. */
export function desenlaceDeAceptacion(r: ResultadoAceptarCaptura | null):
  | { tipo: 'aceptada'; itemId: string; donde: string; pendiente: string | null }
  | { tipo: 'sobra'; conItemId: string; mensaje: string }
  | { tipo: 'error'; mensaje: string } {
  if (!r) return { tipo: 'error', mensaje: 'No se pudo agregar la captura. Inténtalo otra vez.' }
  if (r.ok) return { tipo: 'aceptada', itemId: r.itemId, donde: r.donde, pendiente: r.pendiente }
  if (r.codigo === 'SOBRA' && 'conItemId' in r) return { tipo: 'sobra', conItemId: r.conItemId, mensaje: r.mensaje }
  return { tipo: 'error', mensaje: r.mensaje || 'No se pudo agregar la captura. Inténtalo otra vez.' }
}

let contador = 0
const SIN_UBICACIONES: Record<string, Ubicacion> = {}
const nuevoId = () => `cap-${Date.now()}-${++contador}`

export default function BandejaCapturas({
  cotizacionId,
  items,
  composicion,
  onOpcionCreada,
  ubicaciones = SIN_UBICACIONES,
  fija = false,
}: {
  cotizacionId: string
  /** Las líneas de la cotización: contra ellas se dice a dónde irá cada captura. */
  items: ItemDeBandeja[]
  composicion: Composicion | null
  /** Abre la opción en su bloque: solo cuando el asesor toca «Ver» (H3). */
  onOpcionCreada?: (itemId: string) => void
  /** Dónde vive cada opción de la página, para nombrarla («Opción 2 de Vuelo 1»). */
  ubicaciones?: Record<string, Ubicacion>
  /**
   * R3 (layout del 2026-09-23): dentro del marco del negocio la zona de pegado es una
   * franja de una línea, fija bajo el encabezado, y la lista de capturas queda en el flujo
   * de la página debajo de ella: se desplaza con la página y nunca tapa un bloque (R2).
   */
  fija?: boolean
}) {
  const router = useRouter()
  const [capturas, setCapturas] = useState<Captura[]>([])
  const entrada = useRef<HTMLInputElement>(null)
  // Las capturas vigentes: la pasada asíncrona tiene que ver las de ESE momento.
  const vigentes = useRef<Captura[]>([])
  useEffect(() => { vigentes.current = capturas }, [capturas])
  // Lo mismo para las líneas de la página, sus nombres y el grupo del viaje.
  const itemsVivos = useRef(items)
  const ubicacionesVivas = useRef(ubicaciones)
  const composicionViva = useRef(composicion)
  useEffect(() => {
    itemsVivos.current = items
    ubicacionesVivas.current = ubicaciones
    composicionViva.current = composicion
  }, [items, ubicaciones, composicion])
  // Qué captura trajo cada huella primero. Se escribe al pegar, sin esperar al render: dos
  // pegadas seguidas de la misma imagen se reconocen aunque la primera no se haya pintado.
  const huellas = useRef(new Map<string, string>())
  // Capturas que el asesor pidió procesar igual: no se comparan (P10).
  const forzadas = useRef(new Set<string>())
  // Repetidas en su ventana de «Deshacer», antes de quitarse solas.
  const ocultar = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // Aceptaciones: una a la vez (H1), y un segundo toque no manda otra (R1).
  const aceptando = useRef(new Set<string>())
  const colaAceptar = useRef<Promise<unknown>>(Promise.resolve())

  const actualizar = useCallback((id: string, cambio: Partial<Captura>) => {
    setCapturas(cs => cs.map(c => (c.id === id ? { ...c, ...cambio } : c)))
  }, [])

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
      leer: (tipo, enfoque) => leerCapturaEnBorrador(cotizacionId, tipo, dataUrl, enfoque),
      revisar: borrador => revisarBorrador({
        capId: id,
        borrador,
        lineas: itemsVivos.current,
        comparables: opcionesParaComparar(itemsVivos.current, vigentes.current, id),
        composicion: composicionViva.current,
        ubicaciones: ubicacionesVivas.current,
        comparar: !forzadas.current.has(id),
      }),
      vigente: () => turnos.current.get(id) === turno,
      informar: cambio => actualizar(id, cambio),
    }
  }, [actualizar, cotizacionId, nuevoTurno])

  const procesar = useCallback(async (id: string, dataUrl: string, tipoElegido?: TipoRanura) => {
    await procesarCaptura(dependencias(id, dataUrl), tipoElegido)
  }, [dependencias])

  const agregar = useCallback((archivo: File) => {
    if (!archivo.type.startsWith('image/')) {
      toast.error('Eso no es una imagen. Pega o sube el pantallazo del proveedor.')
      return
    }
    const lector = new FileReader()
    lector.onload = ev => void (async () => {
      const dataUrl = ev.target?.result as string
      const id = nuevoId()
      const huella = await huellaDeImagen(dataUrl)
      const base: Captura = {
        id, preview: dataUrl, dataUrl, estado: { fase: 'mirando' }, tipo: null, pistas: null, borrador: null,
        itemId: null, donde: null, leida: null, abierta: false, error: null, huella,
      }
      // P10 · ¿esta imagen ya se pegó? En la página (la huella quedó con su lectura) o en esta
      // misma bandeja, mientras esa captura siga viva.
      const enPagina = opcionConLaMismaImagen(huella, itemsVivos.current)
      const previaId = huella ? huellas.current.get(huella) : undefined
      const previa = previaId ? vigentes.current.find(x => x.id === previaId) : undefined
      const previaViva = !!previaId && (!previa || !['borrada', 'rechazada', 'descartada'].includes(previa.estado.fase))
      if (enPagina || previaViva) {
        const itemId = enPagina?.id ?? previa?.itemId ?? null
        const mensaje = mensajeMismaImagen(itemId, ubicacionesVivas.current, previa?.etiqueta)
        setCapturas(cs => [...cs, { ...base, estado: { fase: 'repetida', mensaje } }])
        // Se quita sola; mientras tanto «Deshacer» la procesa igual.
        ocultar.current.set(id, setTimeout(() => {
          ocultar.current.delete(id)
          actualizar(id, { estado: { fase: 'descartada' } })
        }, ESPERA_REPETIDA_MS))
        return
      }
      if (huella) huellas.current.set(huella, id)
      setCapturas(cs => [...cs, base])
      void procesar(id, dataUrl)
    })()
    lector.readAsDataURL(archivo)
  }, [actualizar, procesar])

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

  // Al salir no hay nada que limpiar en Componentes (H2): solo los relojes de las repetidas.
  useEffect(() => {
    const repetidas = ocultar.current
    return () => {
      for (const reloj of repetidas.values()) clearTimeout(reloj)
      repetidas.clear()
    }
  }, [])

  // Recargar o cerrar la pestaña pierde lo que no se ha aceptado: el navegador pregunta antes.
  const enElAire = capturas.some(c => enElAireCaptura(c))
  useEffect(() => {
    if (!enElAire) return
    function alSalir(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [enElAire])

  // Dentro del marco del negocio, la MISMA condición pregunta antes de salir por un enlace
  // (otra cotización del panel, el encabezado, el menú). Escucha en captura sobre el
  // documento: corre antes que el `Link`, que respeta `defaultPrevented`.
  useEffect(() => {
    if (!fija || !enElAire) return
    function alTocar(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const enlace = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!enlace || !saleDeLaPagina(enlace.href, window.location.href, enlace.target)) return
      if (!window.confirm(PREGUNTA_AL_SALIR)) e.preventDefault()
    }
    document.addEventListener('click', alTocar, true)
    return () => document.removeEventListener('click', alTocar, true)
  }, [fija, enElAire])

  // Arrastrar y soltar: las imágenes entran por el mismo camino que el pegado.
  const [arrastrando, setArrastrando] = useState(false)
  const alArrastrar = {
    onDragOver: (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
      e.preventDefault()
      if (!arrastrando) setArrastrando(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setArrastrando(false)
    },
    onDrop: (e: DragEvent) => {
      const imagenes = Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'))
      setArrastrando(false)
      if (imagenes.length === 0) return
      e.preventDefault()
      for (const f of imagenes) agregar(f)
    },
  }

  /** Quitar una fila es solo quitarla: nada de ella está en Componentes (H2). */
  function borrar(c: Captura) {
    if (enProceso(c.estado)) {
      // Se quita a mitad del análisis (P11): lo que devuelva la pasada en vuelo se descarta.
      // «Deshacer» la vuelve a la cola.
      nuevoTurno(c.id)
      actualizar(c.id, {
        estado: { fase: 'borrada', antes: { fase: 'mirando' }, reanudar: true },
        borrador: null, leida: null, donde: null, error: null, abierta: false,
      })
      return
    }
    actualizar(c.id, { estado: { fase: 'borrada', antes: c.estado }, abierta: false })
  }

  function deshacer(c: Captura) {
    if (c.estado.fase === 'repetida') {
      // Procesarla igual: el asesor ya vio que se repetía, no se le vuelve a preguntar.
      const reloj = ocultar.current.get(c.id)
      if (reloj) clearTimeout(reloj)
      ocultar.current.delete(c.id)
      forzadas.current.add(c.id)
      nuevoTurno(c.id)
      actualizar(c.id, { estado: { fase: 'mirando' } })
      void procesar(c.id, c.dataUrl)
      return
    }
    if (c.estado.fase !== 'borrada') return
    if (c.estado.reanudar) {
      nuevoTurno(c.id)
      actualizar(c.id, { estado: { fase: 'mirando' } })
      void procesar(c.id, c.dataUrl)
      return
    }
    actualizar(c.id, { estado: c.estado.antes })
  }

  /** «¿Cuál de estas?»: la segunda lectura, con el tipo y el lugar que ya se sabían. */
  function elegirOpcion(c: Captura, o: { nombre: string; precio: string | null }) {
    if (!c.tipo) return
    void leerCaptura(dependencias(c.id, c.dataUrl), c.tipo, c.pistas ?? { lugar: null, origen: null, destino: null }, o)
  }

  /**
   * «Aceptar» (H2/H3). Va por `fetch` y no por la server action (ver la ruta), en fila con las
   * demás aceptaciones. La fila cambia en el acto; al volver, un aviso dice dónde quedó.
   */
  async function aceptar(c: Captura, decision: BorradorParaAceptar['decision'], destinoId?: string | null) {
    const b = c.borrador
    if (!b || aceptando.current.has(c.id)) return
    aceptando.current.add(c.id)
    const antes = c.estado
    actualizar(c.id, { estado: { fase: 'aceptando' }, error: null, abierta: false })
    const cuerpo: BorradorParaAceptar = { tipo: b.tipo, lecturaJson: b.lecturaJson, firma: b.firma, pistas: b.pistas, decision, destinoId: destinoId ?? null, imagen: c.dataUrl || null }
    const turno = colaAceptar.current.then(async () => {
      try {
        const res = await fetch(`/api/cotizaciones/${encodeURIComponent(cotizacionId)}/aceptar-captura`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
        })
        return (await res.json()) as ResultadoAceptarCaptura
      } catch {
        return null
      }
    })
    colaAceptar.current = turno.catch(() => undefined)
    const d = desenlaceDeAceptacion(await turno)
    aceptando.current.delete(c.id)
    if (d.tipo === 'error') {
      actualizar(c.id, { estado: antes, error: d.mensaje })
      return
    }
    if (d.tipo === 'sobra') {
      // R8, regla 6: al llegar, el grupo ya estaba cubierto. Se pregunta, nunca se decide solo.
      const alertas = 'alertas' in antes ? antes.alertas : []
      actualizar(c.id, {
        estado: { fase: 'parecida', conItemId: d.conItemId, donde: nombreDeOpcion(d.conItemId, ubicacionesVivas.current), alertas, habitacion: true },
        abierta: true,
      })
      router.refresh()
      return
    }
    actualizar(c.id, { estado: { fase: 'aceptada' }, itemId: d.itemId, donde: d.donde, error: null })
    const ver = onOpcionCreada ? { label: 'Ver', onClick: () => onOpcionCreada(d.itemId) } : undefined
    // H3 · se queda donde está: un aviso discreto, y la opción solo se abre si se toca «Ver».
    toast.success(`Agregada a ${d.donde}`, ver ? { action: ver } : undefined)
    if (d.pendiente) toast.warning(`Quedó un pendiente en ${d.donde}: ${d.pendiente}`, ver ? { action: ver } : undefined)
    router.refresh()
  }

  /** «Agregar igual» / «Agregar como otra opción» / «Agregar como habitación». */
  function agregarIgual(c: Captura) {
    const e = c.estado
    if (e.fase === 'parecida' && e.habitacion) return void aceptar(c, 'habitacion', e.conItemId)
    if (e.fase === 'parecida' || e.fase === 'otro_precio') return void aceptar(c, 'opcion')
  }

  /** «Reemplazar el precio de Opción 2»: la lectura nueva queda sobre la opción que ya estaba. */
  function reemplazarPrecio(c: Captura) {
    if (c.estado.fase !== 'otro_precio' || esIdDeBorrador(c.estado.conItemId)) return
    void aceptar(c, 'reemplazar', c.estado.conItemId)
  }

  // A dónde irá cada captura lista, contra la cotización que se ve AHORA: aceptar otra puede
  // cambiarlo («Hotel en Providencia · nuevo» pasa a «Otra opción de Hotel en Providencia»).
  const dondeVivo = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of capturas) {
      if (c.estado.fase !== 'lista' || !c.borrador) continue
      m.set(c.id, revisarBorrador({
        capId: c.id, borrador: c.borrador, lineas: items, comparables: [], composicion, ubicaciones, comparar: false,
      }).donde)
    }
    return m
  }, [capturas, items, composicion, ubicaciones])

  const visibles = capturas.filter(c => c.estado.fase !== 'aceptada' && c.estado.fase !== 'descartada')
  const enCurso = capturas.filter(c => enProceso(c.estado)).length

  const entradaArchivos = (
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
  )

  // R2 (2026-09-23): con muchas filas la lista tapaba los bloques de abajo. Tiene tope de alto
  // y se desplaza por dentro. Con el marco (`fija`) va en el flujo de la página.
  const listaCapturas = visibles.length > 0 ? (
    <ul className={fija ? 'space-y-1.5 rounded-xl border bg-[#F5F4F2] p-2 sm:max-h-[40vh] sm:overflow-y-auto' : 'mt-2 space-y-1.5 sm:max-h-[40vh] sm:overflow-y-auto'} aria-label="Capturas pegadas" data-lista-capturas>
      {visibles.map(c => (
        <FilaCaptura
          key={c.id}
          captura={dondeVivo.has(c.id) ? { ...c, donde: dondeVivo.get(c.id) ?? c.donde } : c}
          composicion={composicion}
          onAlternar={() => actualizar(c.id, { abierta: !c.abierta })}
          onAceptar={() => void aceptar(c, 'auto')}
          onBorrar={() => borrar(c)}
          onDeshacer={() => deshacer(c)}
          onElegirTipo={t => { actualizar(c.id, { abierta: false }); void procesar(c.id, c.dataUrl, t) }}
          onElegirOpcion={o => elegirOpcion(c, o)}
          onAgregarIgual={() => agregarIgual(c)}
          onReemplazarPrecio={() => reemplazarPrecio(c)}
        />
      ))}
    </ul>
  ) : null

  if (fija) {
    return (
      <>
        <div
          data-bandeja-capturas
          data-bandeja-fija
          {...alArrastrar}
          className="sticky z-10 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur"
          style={{ top: `var(${VAR_ALTO_ENCABEZADO}, 0px)` }}
        >
          <div className="flex items-center gap-2">
            <div
              tabIndex={0}
              role="button"
              aria-label="Pegar pantallazos"
              className={`hidden min-h-[40px] min-w-0 flex-1 items-center gap-1.5 rounded-lg border-2 border-dashed px-3 text-[11px] focus:outline-none focus:ring-2 focus:ring-[#10B981]/30 sm:flex ${arrastrando ? 'border-[#10B981] bg-[#10B981]/10 text-[#1A1A1A]' : 'border-[#10B981]/40 bg-[#F5F4F2] text-[#6B7280]'}`}
            >
              <ImageIcon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">
                {arrastrando
                  ? 'Suelta aquí los pantallazos'
                  : enCurso > 0
                    ? `Procesando ${enCurso}… puedes seguir pegando`
                    : 'Pantallazos del proveedor: pega (Ctrl+V / Cmd+V), arrástralos aquí o súbelos'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => entrada.current?.click()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#10B981] px-3 py-2 text-xs font-medium text-white sm:hidden"
            >
              <Camera className="h-4 w-4" aria-hidden />
              {enCurso > 0 ? `Procesando ${enCurso}… · Subir otra` : 'Pegar / Subir foto'}
            </button>
            <button
              type="button"
              onClick={() => entrada.current?.click()}
              className="hidden shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs font-medium text-[#1A1A1A] hover:bg-accent sm:inline-flex"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden />
              Subir foto
            </button>
            {visibles.length > 0 && (
              <button
                type="button"
                onClick={() => document.querySelector('[data-lista-capturas]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-primary hover:underline"
              >
                {visibles.length} en la bandeja
              </button>
            )}
          </div>
          {entradaArchivos}
        </div>
        {listaCapturas}
      </>
    )
  }

  return (
    <>
      <div className="rounded-xl border-2 border-dashed border-[#10B981]/40 bg-[#F5F4F2] p-3 sm:sticky sm:top-2 sm:z-10" data-bandeja-capturas {...alArrastrar}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#1A1A1A]">Pantallazos del proveedor</p>
            <p className="text-[11px] text-[#6B7280]">
              Pega los que tengas, uno tras otro (Ctrl+V / Cmd+V en cualquier parte). ONE ve qué es cada
              uno y lo lee; al aceptarlo lo agrupa: mismo destino y fechas es otra opción; lo demás, otro componente.
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
        {entradaArchivos}

        {listaCapturas}
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
  composicion,
  onAlternar,
  onAceptar,
  onBorrar,
  onDeshacer,
  onElegirTipo,
  onElegirOpcion,
  onAgregarIgual,
  onReemplazarPrecio,
}: {
  captura: Captura
  composicion: Composicion | null
  onAlternar: () => void
  onAceptar: () => void
  onBorrar: () => void
  onDeshacer: () => void
  onElegirTipo: (t: TipoRanura) => void
  onElegirOpcion: (o: { nombre: string; precio: string | null }) => void
  /** P10 · «Agregar igual» / «Agregar como otra opción» / «Agregar como habitación». */
  onAgregarIgual?: () => void
  /** P10 · «Reemplazar el precio de Opción N». */
  onReemplazarPrecio?: () => void
}) {
  if (c.estado.fase === 'borrada') {
    return (
      <li className="flex items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] text-[#6B7280]">
        <span>{c.estado.reanudar ? 'Quitada · se dejó de analizar' : 'Quitada de la bandeja'}</span>
        <button type="button" onClick={onDeshacer} className="font-medium text-primary underline underline-offset-2">
          Deshacer
        </button>
      </li>
    )
  }
  if (c.estado.fase === 'repetida') {
    return (
      <li className="flex items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] text-[#6B7280]" data-captura-repetida>
        <span className="flex min-w-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL del portapapeles */}
          <img src={c.preview} alt="" className="h-6 w-9 shrink-0 rounded object-cover" />
          <span className="truncate">{c.estado.mensaje} · no se volvió a procesar</span>
        </span>
        <button type="button" onClick={onDeshacer} className="shrink-0 font-medium text-primary underline underline-offset-2">
          Deshacer
        </button>
      </li>
    )
  }
  const e = c.estado
  const trabajando = enProceso(e)
  const enviandoAceptar = e.fase === 'aceptando'
  const opcion = c.leida
  const ficha = opcion ? fichaDeOpcion({ ...opcion, nombre: opcion.nombre ?? null, grupo: opcion.grupo ?? null }, composicion) : []
  // Solo lo que tiene lectura firmada se puede aceptar: nada sin leer llega a Componentes.
  const confirmable = e.fase === 'lista' && !!c.borrador
  const titulo = opcion?.nombre || c.etiqueta || (c.tipo ? definicionDeTipo(c.tipo).label : 'Pantallazo')
  const linea = e.fase === 'aceptando' ? `Agregando${c.donde ? ` · ${c.donde}` : ''}…`
    : e.fase === 'mirando' ? 'Mirando qué es…'
      : e.fase === 'leyendo' ? 'Leyendo…'
        : e.fase === 'lista' ? (c.donde ? `Va a: ${c.donde}` : 'Leído')
          : e.fase === 'eligiendo_tipo' ? 'No se reconoce qué es'
            : e.fase === 'eligiendo_opcion' ? '¿Cuál de estas?'
              : e.fase === 'rechazada' ? e.mensaje
                : e.fase === 'parecida' ? (e.habitacion ? `El grupo ya está cubierto en ${e.donde}` : `Parece igual a ${e.donde}`)
                  : e.fase === 'otro_precio' ? `El mismo servicio que ${e.donde}, con otro precio`
                    : ''
  // «Reemplazar el precio» necesita una opción que ya esté en Componentes.
  const puedeReemplazar = e.fase === 'otro_precio' && !esIdDeBorrador(e.conItemId)

  return (
    <li className="rounded-lg border bg-background" data-captura={c.id}>
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button type="button" onClick={onAlternar} aria-expanded={c.abierta} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {c.abierta ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL del portapapeles */}
          <img src={c.preview} alt="" className="h-8 w-12 shrink-0 rounded object-cover" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-[#1A1A1A]">{titulo}</span>
            <span className={`flex items-center gap-1 truncate text-[10px] ${e.fase === 'rechazada' ? 'text-red-700' : e.fase === 'parecida' || e.fase === 'otro_precio' ? 'font-medium text-amber-700' : 'text-[#6B7280]'}`}>
              {(trabajando || enviandoAceptar) && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
              {linea}
            </span>
          </span>
        </button>
        {e.fase === 'parecida' && (
          <>
            {/* «Descartar» es la opción por defecto: la captura sale de la bandeja (con Deshacer). */}
            <button
              type="button"
              onClick={onBorrar}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#10B981] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#059669]"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={onAgregarIgual}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-[#1A1A1A] hover:bg-accent"
            >
              {e.habitacion ? 'Agregar como habitación' : 'Agregar igual'}
            </button>
          </>
        )}
        {e.fase === 'otro_precio' && (
          <>
            {puedeReemplazar && (
              <button
                type="button"
                onClick={onReemplazarPrecio}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#10B981] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#059669]"
              >
                Reemplazar el precio de {e.corta}
              </button>
            )}
            <button
              type="button"
              onClick={onAgregarIgual}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-[#1A1A1A] hover:bg-accent"
            >
              Agregar como otra opción
            </button>
          </>
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
        {!enviandoAceptar && <button
          type="button"
          onClick={onBorrar}
          aria-label={trabajando ? 'Quitar esta captura (se deja de analizar)' : 'Quitar esta captura'}
          data-quitar-captura
          className="shrink-0 rounded p-1 text-[#6B7280] hover:bg-red-50 hover:text-red-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>}
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
                <p className="text-[11px] text-[#6B7280]">La lectura no dejó datos para la ficha: al aceptarla, revísala en su bloque.</p>
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
          {(e.fase === 'parecida' || e.fase === 'otro_precio') && (
            <>
              <p className="mb-1 text-[11px] text-amber-900">
                {e.fase === 'parecida' && e.habitacion
                  ? `Las habitaciones de ${e.donde} ya cubren a todo el grupo, o esta misma imagen ya está ahí. Descártala si la pegaste de más, o agrégala como otra habitación.`
                  : e.fase === 'parecida'
                  ? `Mismo servicio, mismas fechas y mismo precio que ${e.donde}. Descártala si la pegaste dos veces.`
                  : puedeReemplazar
                    ? `Mismo servicio que ${e.donde}, pero el precio cambió. Reemplaza el de la opción que ya estaba o déjala como otra opción.`
                    : `Mismo servicio que ${e.donde}, con otro precio. Acepta primero esa, o agrega esta como otra opción.`}
              </p>
              {ficha.length > 0 && <ul className="space-y-0.5 text-[#1A1A1A]">{ficha.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            </>
          )}
          {trabajando && <p className="text-[11px] text-[#6B7280]">Todavía se está procesando.</p>}
        </div>
      )}
    </li>
  )
}
