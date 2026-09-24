'use client'

import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type ReactNode, type Ref } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { toast } from 'sonner'

import { detectarCaptura } from '@/app/(app)/negocios/ranura-actions'
import {
  leerCapturaEnBorrador,
  quitarHabitacion,
  type BorradorParaAceptar,
  type LecturaDevuelta,
  type ComoEntro,
  type ResultadoAceptarCaptura,
} from '@/app/(app)/negocios/tarifa-pax-actions'
import {
  leerCaptura,
  procesarCaptura,
  type Borrador,
  type ComoQueda,
  type DependenciasDeProceso,
  type EstadoDeProceso,
  type Pistas,
} from '@/lib/cotizaciones/proceso-captura'
import { esIdDeBorrador, revisarBorrador } from '@/lib/cotizaciones/revisar-borrador'
import { pantallazosEnCotizacion, type OpcionLeida } from '@/lib/cotizaciones/bandeja-capturas'
import {
  huellaDeImagen,
  mensajeMismaImagen,
  nombreDeOpcion,
  opcionConLaMismaImagen,
  type OpcionComparable,
  type Ubicacion,
} from '@/lib/cotizaciones/captura-repetida'
import {
  camposDeRevision,
  correccionesDeRevision,
  preguntaDeRevision,
  tituloDeCaptura,
  type CorreccionDeBandeja,
} from '@/lib/cotizaciones/revision-captura'
import { leidosPorSlug } from '@/lib/cotizaciones/correcciones'
import { definicionDeTipo, TIPOS_RANURA, type TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'
import type { Composicion, LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'
import { PREGUNTA_AL_SALIR, saleDeLaPagina } from '@/lib/cotizaciones/aviso-al-salir'
import { AlertaDecision } from '@/components/viaje/alerta-decision'
import { BTN, BTN_PRIM, BTN_X, INPUT, INPUT_DUDOSO, LINK, SPIN } from '@/components/viaje/estilo'
import { Miniatura, useVistaAmpliada } from '@/components/viaje/pantallazo'

/**
 * La bandeja de pantallazos (P7 del caso Providencia; forma y textos del prototipo de la
 * tarjeta aprobado por Mauricio el 2026-09-24,
 * `proyectos/trappvel/clarity/docs/diseno/prototipo-tarjeta-2026-09-24/`).
 *
 *  · Se pegan uno tras otro, los que hagan falta (Ctrl+V en cualquier parte de la cotización,
 *    arrastrar, o «Subir foto»), y cada uno se lee en segundo plano. Lo más nuevo va arriba.
 *
 * ## Lo que está en la bandeja todavía no entra a la cotización (H2)
 *
 * Mirar y leer NO crean ranura, opción ni habitación: la lectura vuelve como BORRADOR firmado
 * y vive en la fila. Solo «Aceptar» la lleva a Componentes, y es el servidor el que decide,
 * contra la cotización de ese momento, a dónde (`ubicarLectura`).
 *
 * ## La fila se revisa antes de aceptar (H4)
 *
 * Los campos leídos se ven y se corrigen en la misma fila; con un cambio el botón pasa a
 * «Aceptar con cambios» y lo corregido viaja como corrección de la opción
 * (`revision-captura.ts`). El costo se ve y no se toca aquí.
 *
 * ## Lo aceptado se queda a la vista (H3)
 *
 * «Agregada a Hotel en Providencia · Opción 1 · Ver»: la fila dice dónde quedó y «Ver» abre la
 * opción. Una habitación sumada se puede deshacer desde su fila.
 *
 * ## El pantallazo repetido (P10) y la habitación que sobra (R8, regla 6)
 *
 * La misma imagen no se procesa. Otra imagen con el mismo servicio y precio se pregunta; la
 * habitación de un hotel cuyo grupo ya está cubierto también («Esta habitación sobra… ¿La
 * descarto?»). Nunca se decide en silencio (`captura-repetida.ts`).
 *
 * Solo el flujo de viaje (Trappvel) la monta.
 */

/** Cómo quedó una captura aceptada: con eso la fila dice dónde está y si se puede deshacer. */
export interface Aceptacion {
  como: ComoEntro
  bloque: string
  opcion: number | null
  habitacionId: string | null
  habitacionNumero: number | null
  /** El estado de antes de aceptar: «Deshacer» una habitación vuelve a él. */
  antes: Estado
}

export type Estado =
  | EstadoDeProceso
  | { fase: 'aceptada' }
  /** R1 · «Aceptar» en camino: la fila lo dice en el acto y no se puede tocar dos veces. */
  | { fase: 'aceptando' }
  /**
   * Quitada por el asesor. `reanudar`: se quitó mientras se analizaba (P11), así que
   * «Deshacer» la vuelve a la cola. `motivo: 'descartada'`: la descartó al responder una
   * pregunta («Esta habitación sobra… ¿La descarto?»).
   */
  | { fase: 'borrada'; antes: Estado; reanudar?: boolean; motivo?: 'descartada' }
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
  /** A dónde va a ir («Otra opción de Hotel en Providencia»). */
  donde: string | null
  /** Cómo va a entrar (pronóstico): una habitación no se revisa campo por campo. */
  como?: ComoQueda | null
  /** La opción como quedaría: con ella se compara (P10). */
  leida: OpcionLeida | null
  /** Heredado del recorrido (`proceso-captura`): la fila ya no se pliega. */
  abierta?: boolean
  error: string | null
  /** Huella del archivo (`huellaDeImagen`), para reconocer la misma imagen pegada otra vez. */
  huella?: string | null
  /** El nombre visible de la ranura donde quedó. */
  etiqueta?: string | null
  /** Dónde y cómo quedó al aceptarse. */
  aceptada?: Aceptacion | null
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

/**
 * Los pantallazos de una opción eliminada desde su tarjeta («Sus habitaciones vuelven a la
 * bandeja»). `clave` identifica la devolución: la bandeja la recibe una sola vez. `itemId` es la
 * opción que se fue: mientras la página no se refresque sigue en `items`, y compararse contra
 * ella las haría ver repetidas.
 */
export interface DevolucionABandeja {
  clave: string
  itemId: string
  lecturas: LecturaDevuelta[]
}

/** Lo que la bandeja expone para recibir los pantallazos de una opción eliminada. */
export interface ReceptorDeBandeja {
  recibir: (d: DevolucionABandeja) => void
}

/**
 * Las opciones de hotel con un pantallazo esperando la decisión de si sobra (R8, regla 6):
 * `itemId → id de la captura`. La tarjeta pinta su ⚠ con esto y «Ir a la bandeja» va a la fila.
 */
export function pendientesPorOpcion(capturas: readonly Pick<Captura, 'id' | 'estado'>[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of capturas) {
    const e = c.estado
    if (e.fase === 'parecida' && e.habitacion && !esIdDeBorrador(e.conItemId) && !(e.conItemId in out)) out[e.conItemId] = c.id
  }
  return out
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
  | {
      tipo: 'aceptada'
      itemId: string
      donde: string
      pendiente: string | null
      como: ComoEntro
      bloque: string
      opcion: number | null
      habitacionId: string | null
      habitacionNumero: number | null
      correccionesFallidas: string[]
    }
  | { tipo: 'sobra'; conItemId: string; mensaje: string }
  | { tipo: 'error'; mensaje: string } {
  if (!r) return { tipo: 'error', mensaje: 'No se pudo agregar la captura. Inténtalo otra vez.' }
  if (r.ok) {
    return {
      tipo: 'aceptada',
      itemId: r.itemId,
      donde: r.donde,
      pendiente: r.pendiente,
      como: r.como ?? 'hermana',
      bloque: r.bloque ?? r.donde,
      opcion: r.opcion ?? null,
      habitacionId: r.habitacionId ?? null,
      habitacionNumero: r.habitacionNumero ?? null,
      correccionesFallidas: r.correccionesFallidas ?? [],
    }
  }
  if (r.codigo === 'SOBRA' && 'conItemId' in r) return { tipo: 'sobra', conItemId: r.conItemId, mensaje: r.mensaje }
  return { tipo: 'error', mensaje: r.mensaje || 'No se pudo agregar la captura. Inténtalo otra vez.' }
}

/**
 * «Agregada a Hotel en Providencia · Opción 1», «Agregada a un bloque nuevo: Vuelo 2 · San
 * Andrés → Providencia», «Agregada a Hotel en Providencia · Opción 2 como habitación 4».
 *
 * Con el nombre que la opción tiene AHORA en la página (`ubicaciones`); si la página todavía
 * no la trae, con el que dijo el servidor al aceptar.
 */
export function textoDeAceptada(c: Pick<Captura, 'itemId' | 'aceptada'>, ubicaciones: Readonly<Record<string, Ubicacion>>): string {
  const a = c.aceptada
  const u = c.itemId ? ubicaciones[c.itemId] : undefined
  const bloque = u?.bloque ?? a?.bloque ?? 'Componentes'
  const opcion = u?.opcion ?? a?.opcion ?? null
  if (a?.como === 'nueva') return `Agregada a un bloque nuevo: ${bloque}`
  const lugar = opcion ? `${bloque} · Opción ${opcion}` : bloque
  if (a?.como === 'habitacion') return `Agregada a ${lugar} como habitación${a.habitacionNumero ? ` ${a.habitacionNumero}` : ''}`
  return `Agregada a ${lugar}`
}

/** «Otros 5 pantallazos ya están en la cotización.» `null` si no hay otros. */
export function textoDelPie(otros: number): string | null {
  if (otros <= 0) return null
  return otros === 1 ? 'Otro pantallazo ya está en la cotización.' : `Otros ${otros} pantallazos ya están en la cotización.`
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
  enMarco = false,
  receptor,
  onPendientes,
}: {
  cotizacionId: string
  /** Las líneas de la cotización: contra ellas se dice a dónde irá cada captura. */
  items: ItemDeBandeja[]
  composicion: Composicion | null
  /** Abre la opción en su bloque: solo cuando el asesor toca «Ver» (H3). */
  onOpcionCreada?: (itemId: string) => void
  /** Dónde vive cada opción de la página, para nombrarla («Opción 2 de Vuelo 1»). */
  ubicaciones?: Record<string, Ubicacion>
  /** Dentro del marco del negocio: salir por un enlace con trabajo sin aceptar pregunta antes. */
  enMarco?: boolean
  /** Por aquí la tarjeta devuelve los pantallazos de una opción eliminada. */
  receptor?: Ref<ReceptorDeBandeja>
  /** Qué opciones de hotel tienen un pantallazo esperando decisión (`pendientesPorOpcion`). */
  onPendientes?: (porOpcion: Record<string, string>) => void
}) {
  const router = useRouter()
  const idEntrada = useId()
  const [capturas, setCapturas] = useState<Captura[]>([])
  const { ampliar, vista } = useVistaAmpliada()
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
        itemId: null, donde: null, leida: null, error: null, huella,
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
        setCapturas(cs => [{ ...base, estado: { fase: 'repetida', mensaje } }, ...cs])
        // Se quita sola; mientras tanto «Deshacer» la procesa igual.
        ocultar.current.set(id, setTimeout(() => {
          ocultar.current.delete(id)
          actualizar(id, { estado: { fase: 'descartada' } })
        }, ESPERA_REPETIDA_MS))
        return
      }
      if (huella) huellas.current.set(huella, id)
      setCapturas(cs => [base, ...cs])
      void procesar(id, dataUrl)
    })()
    lector.readAsDataURL(archivo)
  }, [actualizar, procesar])

  // Lo que devuelve una opción eliminada entra como recién leído: con su borrador firmado, y se
  // revisa contra la cotización de ahora (sin la opción que se fue).
  const recibidas = useRef(new Set<string>())
  const recibirDevolucion = useCallback((d: DevolucionABandeja) => {
    {
      if (recibidas.current.has(d.clave)) return
      recibidas.current.add(d.clave)
      const lineas = itemsVivos.current.filter(i => i.id !== d.itemId)
      const nuevas: Captura[] = []
      for (const l of d.lecturas) {
        let lectura: LecturaCasilla
        try { lectura = JSON.parse(l.lecturaJson) as LecturaCasilla } catch { continue }
        const id = nuevoId()
        const borrador: Borrador = { tipo: l.tipo, lectura, lecturaJson: l.lecturaJson, firma: l.firma, pistas: l.pistas }
        const r = revisarBorrador({
          capId: id,
          borrador,
          lineas,
          comparables: opcionesParaComparar(lineas, [...nuevas, ...vigentes.current], id),
          composicion: composicionViva.current,
          ubicaciones: ubicacionesVivas.current,
          comparar: true,
        })
        const alertas = lectura.alertas ?? []
        if (l.huella) huellas.current.set(l.huella, id)
        const dataUrl = l.imagen ?? ''
        nuevas.push({
          id, preview: dataUrl, dataUrl,
          estado: r.pregunta ? { ...r.pregunta, alertas } : { fase: 'lista', alertas },
          tipo: l.tipo, pistas: l.pistas, borrador, itemId: null, donde: r.donde, como: r.como ?? null,
          leida: r.leida, error: null, huella: l.huella, ...(r.pregunta ? { abierta: true } : {}),
        })
      }
      if (nuevas.length > 0) setCapturas(cs => [...nuevas, ...cs])
    }
  }, [])
  useImperativeHandle(receptor, () => ({ recibir: recibirDevolucion }), [recibirDevolucion])

  // La tarjeta de cada opción de hotel pinta su ⚠ cuando aquí hay una habitación que sobra.
  const ultimosPendientes = useRef('')
  useEffect(() => {
    if (!onPendientes) return
    const porOpcion = pendientesPorOpcion(capturas)
    const firma = JSON.stringify(porOpcion)
    if (firma === ultimosPendientes.current) return
    ultimosPendientes.current = firma
    onPendientes(porOpcion)
  }, [capturas, onPendientes])

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
    if (!enMarco || !enElAire) return
    function alTocar(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const enlace = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!enlace || !saleDeLaPagina(enlace.href, window.location.href, enlace.target)) return
      if (!window.confirm(PREGUNTA_AL_SALIR)) e.preventDefault()
    }
    document.addEventListener('click', alTocar, true)
    return () => document.removeEventListener('click', alTocar, true)
  }, [enMarco, enElAire])

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

  /** «×» y «Descartar» de una fila que se revisa: quitarla es solo quitarla (H2). */
  function borrar(c: Captura, motivo?: 'descartada') {
    if (enProceso(c.estado)) {
      // Se quita a mitad del análisis (P11): lo que devuelva la pasada en vuelo se descarta.
      // «Deshacer» la vuelve a la cola.
      nuevoTurno(c.id)
      actualizar(c.id, {
        estado: { fase: 'borrada', antes: { fase: 'mirando' }, reanudar: true },
        borrador: null, leida: null, donde: null, error: null,
      })
      return
    }
    actualizar(c.id, { estado: { fase: 'borrada', antes: c.estado, ...(motivo ? { motivo } : {}) }, error: null })
  }

  async function deshacer(c: Captura) {
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
    if (c.estado.fase === 'aceptada') {
      // Solo una habitación sumada se deshace desde la fila: sale de su opción y la captura
      // vuelve a la pregunta (o a la revisión) de antes.
      const a = c.aceptada
      if (a?.como !== 'habitacion' || !a.habitacionId || !c.itemId) return
      const r = await quitarHabitacion(c.itemId, a.habitacionId)
      if (!r.success) {
        actualizar(c.id, { error: r.error ?? null })
        return
      }
      actualizar(c.id, { estado: a.antes, aceptada: null, itemId: null, error: null })
      router.refresh()
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
   * «Aceptar» (H2/H3/H4). Va por `fetch` y no por la server action (ver la ruta), en fila con
   * las demás aceptaciones. La fila cambia en el acto; al volver dice dónde quedó.
   */
  async function aceptar(
    c: Captura,
    decision: BorradorParaAceptar['decision'],
    destinoId?: string | null,
    correcciones: CorreccionDeBandeja[] = [],
  ) {
    const b = c.borrador
    if (!b || aceptando.current.has(c.id)) return
    aceptando.current.add(c.id)
    const antes = c.estado
    actualizar(c.id, { estado: { fase: 'aceptando' }, error: null })
    const cuerpo: BorradorParaAceptar = {
      tipo: b.tipo, lecturaJson: b.lecturaJson, firma: b.firma, pistas: b.pistas, decision,
      destinoId: destinoId ?? null, imagen: c.dataUrl || null,
      correcciones: correcciones.length > 0 ? correcciones : null,
    }
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
      })
      router.refresh()
      return
    }
    actualizar(c.id, {
      estado: { fase: 'aceptada' },
      itemId: d.itemId,
      donde: d.donde,
      error: d.correccionesFallidas[0] ?? null,
      aceptada: {
        como: d.como, bloque: d.bloque, opcion: d.opcion,
        habitacionId: d.habitacionId, habitacionNumero: d.habitacionNumero, antes,
      },
    })
    // H3 · la fila dice dónde quedó; un faltante de la tarifa se avisa aparte.
    const ver = onOpcionCreada ? { label: 'Ver', onClick: () => onOpcionCreada(d.itemId) } : undefined
    if (d.pendiente) toast.warning(`Quedó un pendiente en ${d.donde}: ${d.pendiente}`, ver ? { action: ver } : undefined)
    router.refresh()
  }

  /** «Agregar igual» / «Agregar como otra opción» / «Es una habitación más». */
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
  // cambiarlo (de ranura nueva a otra opción, o a habitación).
  const pronostico = useMemo(() => {
    const m = new Map<string, { donde: string; como: ComoQueda | null }>()
    for (const c of capturas) {
      if (c.estado.fase !== 'lista' || !c.borrador) continue
      const r = revisarBorrador({
        capId: c.id, borrador: c.borrador, lineas: items, comparables: [], composicion, ubicaciones, comparar: false,
      })
      m.set(c.id, { donde: r.donde, como: r.como ?? null })
    }
    return m
  }, [capturas, items, composicion, ubicaciones])

  const visibles = capturas.filter(c => c.estado.fase !== 'descartada')

  // El pie: los pantallazos que ya están en la cotización y la bandeja no muestra aceptados.
  const otros = useMemo(() => {
    const aceptadas = new Set(capturas.filter(c => c.estado.fase === 'aceptada' && c.huella).map(c => c.huella as string))
    return pantallazosEnCotizacion(items).filter(k => !aceptadas.has(k)).length
  }, [capturas, items])
  const pie = textoDelPie(otros)

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-[#E2DED5] bg-white p-3.5 text-sm text-[#191713]"
      aria-labelledby={`${idEntrada}-titulo`}
      data-bandeja-capturas
      {...(enMarco ? { 'data-bandeja-marco': '' } : {})}
      {...alArrastrar}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${idEntrada}-titulo`} className="m-0 text-base font-bold">Pantallazos</h2>
        <p className="m-0 text-[13px] text-[#6E6A62]">Lo que está aquí todavía no entra a la cotización. Pasa a los bloques cuando lo aceptas.</p>
      </div>
      <label
        htmlFor={idEntrada}
        className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-[10px] border-[1.5px] border-dashed px-3.5 py-3 ${arrastrando ? 'border-[#0E5C43] bg-[#EAF1EE]' : 'border-[#CFCAC0] bg-[#F8F7F3]'}`}
        data-zona-pegar
      >
        <svg className="shrink-0 text-[#6E6A62]" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="8" y="3" width="8" height="4" rx="1" />
          <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
          <path d="M12 11v6M9 14l3-3 3 3" />
        </svg>
        <p className="m-0 min-w-[180px] flex-1">
          Pega aquí tus pantallazos con Ctrl+V o arrástralos
          <small className="block text-xs text-[#6E6A62]">Vuelos y hoteles. ONE los lee y te dice dónde van.</small>
        </p>
        <span className={BTN}>Subir foto</span>
        <input
          id={idEntrada}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={e => {
            const archivos = Array.from(e.target.files ?? [])
            e.target.value = ''
            for (const a of archivos) agregar(a)
          }}
        />
      </label>
      {visibles.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0" aria-label="Pantallazos pegados" data-lista-capturas>
          {visibles.map(c => {
            const p = pronostico.get(c.id)
            return (
              <FilaCaptura
                key={c.id}
                captura={p ? { ...c, donde: p.donde, como: p.como } : c}
                ubicaciones={ubicaciones}
                onAceptar={correcciones => void aceptar(c, 'auto', null, correcciones)}
                onBorrar={() => borrar(c)}
                onDescartar={() => borrar(c, 'descartada')}
                onDeshacer={() => void deshacer(c)}
                onElegirTipo={t => void procesar(c.id, c.dataUrl, t)}
                onElegirOpcion={o => elegirOpcion(c, o)}
                onAgregarIgual={() => agregarIgual(c)}
                onReemplazarPrecio={() => reemplazarPrecio(c)}
                onVer={onOpcionCreada}
                onAmpliar={ampliar}
              />
            )
          })}
        </ul>
      )}
      {pie && <p className="m-0 text-xs text-[#6E6A62]" data-bandeja-pie>{pie}</p>}
      {vista}
    </section>
  )
}

const NADA = () => {}

/** Exportada para la prueba de render. */
export function FilaCaptura({
  captura: c,
  ubicaciones = SIN_UBICACIONES,
  onAceptar = NADA,
  onBorrar = NADA,
  onDescartar = NADA,
  onDeshacer = NADA,
  onElegirTipo = NADA,
  onElegirOpcion = NADA,
  onAgregarIgual = NADA,
  onReemplazarPrecio = NADA,
  onVer,
  onAmpliar,
}: {
  captura: Captura
  ubicaciones?: Readonly<Record<string, Ubicacion>>
  /** Con lo que la persona corrigió en la fila (H4). */
  onAceptar?: (correcciones: CorreccionDeBandeja[]) => void
  /** «×» o «Descartar» de una fila que se revisa: «Quitaste este pantallazo». */
  onBorrar?: () => void
  /** «Descartar» al responder una pregunta: «Descartada». */
  onDescartar?: () => void
  onDeshacer?: () => void
  onElegirTipo?: (t: TipoRanura) => void
  onElegirOpcion?: (o: { nombre: string; precio: string | null }) => void
  /** P10 · «Agregar igual» / «Agregar como otra opción» / «Es una habitación más». */
  onAgregarIgual?: () => void
  /** P10 · «Reemplazar el precio de Opción N». */
  onReemplazarPrecio?: () => void
  onVer?: (itemId: string) => void
  onAmpliar?: (src: string, caption: string) => void
}) {
  // Lo que la persona escribió en los campos de la fila. Lo que no tocó sigue siendo lo leído.
  const [escritos, setEscritos] = useState<Record<string, string>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})

  const e = c.estado
  const lectura = c.borrador?.lectura ?? null
  const tipo = c.borrador?.tipo ?? c.tipo
  const sobra = e.fase === 'parecida' && e.habitacion === true
  const titulo = (tipo && tituloDeCaptura(tipo, lectura, sobra)) || c.etiqueta || 'Pantallazo pegado'
  const caption = titulo === 'Pantallazo pegado' ? titulo : `Pantallazo · ${titulo}`
  const miniatura = <Miniatura src={c.preview} caption={caption} onAmpliar={onAmpliar} />
  const vacia = <Miniatura src={null} caption="" />
  const quitar = (
    <button type="button" onClick={onBorrar} aria-label="Quitar este pantallazo" className={BTN_X} data-quitar-captura>
      <X className="h-4 w-4" aria-hidden />
    </button>
  )
  const alertas = 'alertas' in e ? e.alertas : []
  const alerta = alertas.length > 0 ? (
    <AlertaDecision tip={alertas[0]}>
      {alertas.map(a => <p key={a} className="m-0">{a}</p>)}
    </AlertaDecision>
  ) : null
  const errorFila = c.error ? <span className="text-xs font-medium text-[#9A5F0C]">{c.error}</span> : null

  const fila = (izq: ReactNode, cuerpo: ReactNode, der: ReactNode, extra: Record<string, string> = {}) => (
    <li
      className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-start gap-3 border-t border-[#E2DED5] py-3 first:border-t-0 first:pt-1 max-sm:grid-cols-[64px_minmax(0,1fr)_auto] max-sm:gap-2.5"
      data-captura={c.id}
      {...extra}
    >
      {izq}
      <div className="flex min-w-0 flex-col gap-1">{cuerpo}</div>
      <div className="flex items-start gap-0.5">{der}</div>
    </li>
  )
  const tituloFila = <span className="font-semibold">{titulo}</span>
  const estado = (texto: ReactNode, clase = 'text-[#6E6A62]') => <span className={`text-[13px] ${clase}`}>{texto}</span>
  const deshacer = <button type="button" onClick={onDeshacer} className={LINK}>Deshacer</button>

  if (e.fase === 'borrada') {
    if (e.motivo === 'descartada') {
      return fila(miniatura, <>{tituloFila}{estado('Descartada. No entró a la cotización.')}</>, deshacer)
    }
    return fila(vacia, estado('Quitaste este pantallazo. No entró a la cotización.'), deshacer)
  }
  if (e.fase === 'repetida') {
    return fila(miniatura, estado(`${e.mensaje} · no se volvió a procesar`), deshacer, { 'data-captura-repetida': '' })
  }
  if (e.fase === 'mirando' || e.fase === 'leyendo') {
    return fila(miniatura, <>{tituloFila}{estado(<><span className={SPIN} aria-hidden />Leyendo…</>)}</>, quitar)
  }
  if (e.fase === 'aceptando') {
    return fila(miniatura, <>{tituloFila}{estado(<><span className={SPIN} aria-hidden />{`Agregando${c.donde ? ` · ${c.donde}` : ''}…`}</>)}</>, null)
  }
  if (e.fase === 'aceptada') {
    const itemId = c.itemId
    return fila(
      miniatura,
      <>
        {tituloFila}
        {estado(
          <>
            {textoDeAceptada(c, ubicaciones)}
            {itemId && onVer && <> · <button type="button" onClick={() => onVer(itemId)} className={LINK}>Ver</button></>}
          </>,
          'text-[#0E5C43]',
        )}
        {errorFila}
      </>,
      c.aceptada?.como === 'habitacion' && c.aceptada.habitacionId ? deshacer : null,
    )
  }
  if (e.fase === 'eligiendo_tipo') {
    return fila(
      miniatura,
      <>
        {tituloFila}
        {estado('No se reconoce qué es')}
        <span className="text-[13px] text-[#6E6A62]">{e.motivo}</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {TIPOS_RANURA.map(t => (
            <button key={t} type="button" onClick={() => onElegirTipo(t)} className={BTN}>
              Es {definicionDeTipo(t).label.toLowerCase()}
            </button>
          ))}
        </div>
      </>,
      quitar,
    )
  }
  if (e.fase === 'eligiendo_opcion') {
    return fila(
      miniatura,
      <>
        {tituloFila}
        {estado('¿Cuál de estas?')}
        <span className="text-[13px] text-[#6E6A62]">{e.mensaje}</span>
        <div className="mt-1 flex flex-col gap-1.5">
          {e.opciones.map(o => (
            <button key={`${o.nombre}|${o.precio ?? ''}`} type="button" onClick={() => onElegirOpcion(o)} className={`${BTN} justify-between text-left`}>
              <span className="min-w-0 flex-1 truncate">{o.nombre}</span>
              {o.precio && <span className="shrink-0 tabular-nums">{o.precio}</span>}
            </button>
          ))}
        </div>
      </>,
      quitar,
    )
  }
  if (e.fase === 'rechazada') {
    return fila(
      miniatura,
      <>
        {tituloFila}
        {estado(e.mensaje, 'text-[#B3382C]')}
        {e.detalle && <span className="text-xs text-[#6E6A62]">{e.detalle}</span>}
      </>,
      quitar,
    )
  }
  if (e.fase === 'parecida' || e.fase === 'otro_precio') {
    const hotel = sobra && lectura && tipo ? (leidosPorSlug(definicionDeTipo(tipo), lectura.campos).hotel ?? null) : null
    const puedeReemplazar = e.fase === 'otro_precio' && !esIdDeBorrador(e.conItemId)
    const pregunta = sobra
      ? `Esta habitación sobra: el grupo ya está cubierto en ${hotel ?? e.donde}. ¿La descarto?`
      : e.fase === 'parecida'
        ? `Mismo servicio, mismas fechas y mismo precio que ${e.donde}. Descártala si la pegaste dos veces.`
        : puedeReemplazar
          ? `Mismo servicio que ${e.donde}, pero el precio cambió. Reemplaza el de la opción que ya estaba o déjala como otra opción.`
          : `Mismo servicio que ${e.donde}, con otro precio. Acepta primero esa, o agrega esta como otra opción.`
    return fila(
      miniatura,
      <>
        {tituloFila}
        <span className="text-sm">{pregunta}</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {e.fase === 'parecida' ? (
            <>
              <button type="button" onClick={onDescartar} className={BTN_PRIM}>Descartar</button>
              <button type="button" onClick={onAgregarIgual} className={BTN}>{sobra ? 'Es una habitación más' : 'Agregar igual'}</button>
            </>
          ) : (
            <>
              {puedeReemplazar && (
                <button type="button" onClick={onReemplazarPrecio} className={BTN_PRIM}>Reemplazar el precio de {e.corta}</button>
              )}
              <button type="button" onClick={onAgregarIgual} className={puedeReemplazar ? BTN : BTN_PRIM}>Agregar como otra opción</button>
            </>
          )}
        </div>
        {errorFila}
      </>,
      <>{alerta}</>,
      sobra ? { 'data-habitacion-sobra': '' } : {},
    )
  }

  // ── Lista para aceptar: se revisa en la fila (H4) ──
  const confirmable = !!c.borrador
  const campos = lectura && tipo && c.como !== 'habitacion' ? camposDeRevision(tipo, lectura) : []
  const pregunta = tipo ? preguntaDeRevision(tipo, campos) : null
  const valorDe = (slug: string, leido: string) => (slug in escritos ? escritos[slug] : leido)
  const conCambios = campos.some(f => f.editable && valorDe(f.slug, f.valor).trim() !== f.valor.trim())
  const sinDatos = campos.length > 0 && campos.every(f => !f.editable || f.valor === '')

  function aceptarFila() {
    if (!tipo) return
    const r = correccionesDeRevision(tipo, campos, escritos)
    if (!r.ok) { setErrores(r.errores); return }
    setErrores({})
    onAceptar(r.correcciones)
  }

  return fila(
    miniatura,
    <>
      {tituloFila}
      {pregunta && <span className="text-sm">{pregunta}</span>}
      {sinDatos && <span className="text-[13px] text-[#6E6A62]">La lectura no dejó datos para la ficha: al aceptarla, revísala en su bloque.</span>}
      {campos.length > 0 && (
        <div className="mt-1 grid grid-cols-3 gap-2 max-sm:grid-cols-2">
          {campos.map(f => (
            <label key={f.slug} className={`flex flex-col gap-0.5 text-xs ${f.dudoso ? 'text-[#9A5F0C]' : 'text-[#6E6A62]'}`}>
              <span>{f.label}</span>
              <input
                value={valorDe(f.slug, f.valor)}
                readOnly={!f.editable}
                placeholder={f.placeholder ?? undefined}
                onChange={ev => setEscritos(prev => ({ ...prev, [f.slug]: ev.target.value }))}
                className={f.dudoso ? INPUT_DUDOSO : `${INPUT} read-only:bg-[#F8F7F3]`}
                data-campo-revision={f.slug}
              />
              {errores[f.slug] && <span className="text-xs text-[#B3382C]">{errores[f.slug]}</span>}
            </label>
          ))}
        </div>
      )}
      {confirmable && (
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="button" onClick={aceptarFila} className={BTN_PRIM}>{conCambios ? 'Aceptar con cambios' : 'Aceptar'}</button>
          <button type="button" onClick={onBorrar} className={BTN}>Descartar</button>
        </div>
      )}
      {errorFila}
    </>,
    <>{alerta}{!confirmable && quitar}</>,
  )
}
