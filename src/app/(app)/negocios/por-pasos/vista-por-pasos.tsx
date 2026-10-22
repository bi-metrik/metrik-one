'use client'

import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { BarraPasos } from './barra-pasos'
import { clasesLoQueSuma, LoQueSuma, usePreferenciaLoQueSuma } from './lo-que-suma'
import { MarcoCotizacionContexto } from '@/app/(app)/negocios/marco-cotizacion-contexto'
import { ServicioPorPasos, ServicioProvisional } from './servicio-por-pasos'
import { TarifasPorPasos, type AutorizacionVista, type ServicioConOpciones } from './tarifas-por-pasos'
import { RevisarPorPasos } from './revisar-por-pasos'
import { useDeshacer } from './deshacer'
import {
  deshacerPorPasos,
  elegirOpcionEnTarifa,
  enviarPorPasos,
  estadoDeServicioPorPasos,
  juntarServicioPorPasos,
  mandarTarifa,
  margenDeLaCotizacionEnOpciones,
  margenPorPasos,
  moverOpcionPorPasos,
  pedirAutorizacionPorPasos,
  retirarAutorizacionPorPasos,
  separarOpcionPorPasos,
  agregarOpcionPorPasos,
} from '@/app/(app)/negocios/por-pasos-actions'
import { borrarOpcionesPorPasos, reponerOpcionesPorPasos, soltarImagenesPorPasos } from '@/app/(app)/negocios/por-pasos-borrar-actions'
import { autorizarBajoElMinimo } from '@/app/(app)/negocios/margen-salida-actions'
import { eliminarItinerario, guardarMotivoDeTarifa, renombrarItinerario } from '@/app/(app)/negocios/itinerario-actions'
import type { LecturaDevuelta } from '@/app/(app)/negocios/tarifa-pax-actions'
import type { SalidaVista } from '@/app/(app)/negocios/margen-salida-actions'
import { ItemMenu, SeparadorMenu } from '@/components/viaje/menu-acciones'
import type { FilaAdicional } from '@/lib/cotizaciones/adicionales'
import type { ParametrosCascada } from '@/lib/cotizaciones/totales'
import { ranurasConAlternativas } from '@/lib/cotizaciones/itinerarios'
import { lineasConMargenPropio } from '@/lib/cotizaciones/margen-propio'
import { estadosPermitidos, type EstadoServicio } from '@/lib/cotizaciones/estado-servicio'
import { YA_CAMBIO } from '@/lib/cotizaciones/deshacer-por-pasos'
import { textoCortoDeOpcion, tiposSinPrecio } from '@/lib/cotizaciones/precio-que-falta'
import { leerTarifaPax, monedaDeTarifa, type Composicion } from '@/lib/cotizaciones/tarifa-pasajero'
import { nombreVisibleDeLinea } from '@/lib/cotizaciones/nombre-visible'
import { resumenDeOpcion } from '@/lib/cotizaciones/opcion-viaje'
import { provisionalesVigentes, type Provisional } from '@/lib/cotizaciones/aceptar-optimista'
import type { ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
import type { DestinoDeIr, ListaUnica } from '@/lib/cotizaciones/lista-unica'
import { ListaUnicaPorPasos } from './lista-unica-por-pasos'
import { autorizacionDeLaSalida } from '@/lib/cotizaciones/autorizacion-vista'
import { PrecioQueFaltaPorPasos } from './precio-que-falta'
import { DocumentoEnRevisar } from './documento-en-revisar'
import {
  cascadaDelTotal,
  estadoDeLosPasos,
  lineasParaLaCascada,
  loQueSuma,
  preciosDeLasOpciones,
  sigue,
  tarifasCalculadas,
  viajeEnOrden,
  type FilaDeLinea,
  type NumeroDePaso,
  type TarifaDeLaPantalla,
} from '@/lib/cotizaciones/por-pasos-vista'

/**
 * LA COTIZACIÓN POR PASOS (pieza C4 de la cotización integrada). Solo se monta con el interruptor
 * encendido (`por-pasos.ts`, decidido en el servidor); apagado, el editor de siempre.
 *
 * «Pego todo lo que coticé, escojo qué va en cada tarifa y reviso lo que le llega al cliente.»
 *
 *  · La barra de los tres pasos y «Sigue:» arriba; «Lo que suma» a la izquierda.
 *  · Paso 1: la bandeja de siempre y el viaje en orden (vuelos, y luego cada destino), un
 *    servicio por tarjeta y, adentro, la tarjeta de siempre de cada opción.
 *  · Paso 2: las tarifas, calculadas aquí (`por-pasos-vista.ts`): cambiar una opción se ve en el
 *    acto y la escritura va detrás.
 *  · Paso 3: lo que hay que resolver, el documento y la barra de envío.
 *
 * Todo cambio se escribe en el acto y deja «Deshacer (8)» (D1 y D2). Las acciones son las de
 * siempre o las nuevas de `por-pasos-actions.ts`, que releen el interruptor en el servidor.
 */

export interface PropsVistaPorPasos {
  cotizacionId: string
  editable: boolean
  enviada: boolean
  filas: (FilaDeLinea & ItemConLectura)[]
  adicionalesPorItem: Record<string, FilaAdicional[]>
  tarifasDelServidor: TarifaDeLaPantalla[]
  params: ParametrosCascada
  margenPct: number
  umbrales: { pisoPct: number; avisoPct: number }
  composicionViaje: Composicion | null
  fechasViaje: { inicio: string | null; fin: string | null } | null
  destinoViaje: string | null
  salida: SalidaVista | null
  pedido: { por: string | null; en: string } | null
  texto: 'nada' | 'sinrevisar' | 'ok' | 'viejo'
  pantallazosPorAceptar: number
  leyendo: number
  pasoInicial: NumeroDePaso
  /** Por qué no se envía (lo de siempre): pantallazos de otros pasajeros, margen, costo. */
  motivoBotonEnviar: string | null
  /** Cuántas cosas rojas y ámbar muestra la lista de Revisar (C6 la vuelve única). */
  conteoLista: { rojos: number; ambar: number }
  bandeja: ReactNode
  agregarSinPantallazo: ReactNode
  tarjetaDeOpcion: (itemId: string, porPasos: { enTarifas: string[] | null; menuExtra: (cerrar: () => void) => ReactNode; onEliminar: () => void }) => ReactNode
  revisarLista: ReactNode
  /**
   * C6 · la lista única (pieza `lista_unica`): reemplaza a `revisarLista` y su primer renglón rojo
   * es el motivo del botón «Enviar». `null` = los avisos de siempre.
   */
  listaUnica?: ListaUnica | null
  revisarDocumento: ReactNode
  verElCalculo: ReactNode
  rastro: ReactNode
  onDescargar: () => void
  onAceptarTodos: () => void
  onPegar: () => void
  onAbrirOpcion: (itemId: string) => void
  onRecibirEnBandeja: (itemId: string, lecturas: LecturaDevuelta[]) => void
  refrescar: () => void
  /**
   * V2 · los servicios nuevos que se están aceptando: su bloque se pinta ya, con «Guardando…» en
   * el precio, y no entran al total hasta que el servidor responde (`aceptar-optimista.ts`).
   */
  provisionales?: readonly Provisional[]
}

type Override = { seleccion?: string[]; va?: boolean }

export default function VistaPorPasos(p: PropsVistaPorPasos) {
  const [paso, setPaso] = useState<NumeroDePaso>(p.pasoInicial)
  // «Lo que suma» se puede ocultar (brief del 2026-10-16); cerrada, su pastilla va al encabezado.
  const sumaVisible = usePreferenciaLoQueSuma()
  const marco = useContext(MarcoCotizacionContexto)
  const [tarifasVistas, setTarifasVistas] = useState(p.pasoInicial === 2)
  // H8 · el ✓ de «Tarifas» se perdía al recargar: queda anotado en esta pestaña, por cotización.
  const claveTarifasVistas = `one:tarifas-vistas:${p.cotizacionId}`
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(claveTarifasVistas) === '1') setTarifasVistas(true)
    } catch { /* sin almacenamiento: como antes */ }
  }, [claveTarifasVistas])
  useEffect(() => {
    if (!tarifasVistas) return
    try { window.sessionStorage.setItem(claveTarifasVistas, '1') } catch { /* sin almacenamiento */ }
  }, [tarifasVistas, claveTarifasVistas])
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(() => new Set())
  const [ocupado, setOcupado] = useState(false)
  // Lo que la asesora acaba de tocar y el servidor todavía no confirma: la pantalla lo muestra ya
  // (V3: < 300 ms, sin pedir nada). Se borra cuando llega la versión del servidor.
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [margenLocal, setMargenLocal] = useState<number | null>(null)
  const [ocultos, setOcultos] = useState<ReadonlySet<string>>(() => new Set())
  // D2 (H5) · las opciones que «Deshacer» acaba de reponer, mientras el servidor no las trae: sin
  // ellas, la tarifa se calculaba un momento sin la opción repuesta (una cifra que no existe).
  const [repuestas, setRepuestas] = useState<PropsVistaPorPasos['filas']>([])
  // Lo optimista se borra cuando llega la versión del servidor, cada cosa con SU parte: la
  // elección de las tarifas con las tarifas, lo oculto con las líneas. Hasta H5 una sola clave
  // borraba todo en cuanto llegaban las líneas (la vista fresca, antes que el refresco de las
  // tarifas), y la tarifa se pintaba un momento con la elección vieja del servidor.
  const claveTarifas = JSON.stringify(p.tarifasDelServidor) + p.margenPct
  const claveFilas = p.filas.map(f => `${f.id}:${f.grupo}:${f.entra_al_precio}`).join(',')
  const [claveVistaTarifas, setClaveVistaTarifas] = useState(claveTarifas)
  if (claveVistaTarifas !== claveTarifas) {
    setClaveVistaTarifas(claveTarifas)
    setOverrides({})
    setMargenLocal(null)
  }
  const [claveVistaFilas, setClaveVistaFilas] = useState(claveFilas)
  if (claveVistaFilas !== claveFilas) {
    setClaveVistaFilas(claveFilas)
    setOcultos(new Set())
  }
  if (repuestas.length > 0 && repuestas.every(r => p.filas.some(f => f.id === r.id))) setRepuestas([])
  const filasDeLaVista = useMemo(
    () => (repuestas.length === 0 ? p.filas : [...p.filas, ...repuestas.filter(r => !p.filas.some(f => f.id === r.id))]),
    [p.filas, repuestas],
  )

  const { ofrecer, aviso } = useDeshacer(p.refrescar)

  // ── Lo calculado en el navegador ──
  const filasVivas = useMemo(() => filasDeLaVista.filter(f => !ocultos.has(f.id)), [filasDeLaVista, ocultos])
  const params = useMemo(() => (margenLocal === null ? p.params : { ...p.params, margenPct: margenLocal }), [p.params, margenLocal])
  const lineas = useMemo(() => lineasParaLaCascada(filasVivas, p.adicionalesPorItem), [filasVivas, p.adicionalesPorItem])
  const tarifasPantalla = useMemo(
    () => p.tarifasDelServidor.map(t => ({ ...t, ...(overrides[t.id] ?? {}), vaEnPropuesta: overrides[t.id]?.va ?? t.vaEnPropuesta })),
    [p.tarifasDelServidor, overrides],
  )
  const tarifas = useMemo(() => tarifasCalculadas(lineas, params, tarifasPantalla), [lineas, params, tarifasPantalla])
  const total = useMemo(() => cascadaDelTotal(lineas, params, tarifasPantalla), [lineas, params, tarifasPantalla])
  const precios = useMemo(() => preciosDeLasOpciones(lineas, params), [lineas, params])
  // V2 · los bloques que se están aceptando se pintan en el viaje; al total y a las tarifas no
  // entran (no tienen precio todavía).
  const provisionales = useMemo(() => {
    const ids = new Set(p.filas.map(f => f.id))
    return provisionalesVigentes(p.provisionales ?? [], ids).map(x => x.fila)
  }, [p.provisionales, p.filas])
  const idsProvisionales = useMemo(() => new Set(provisionales.map(f => f.id)), [provisionales])
  const tramos = useMemo(
    () => viajeEnOrden(filasVivas, { destino: p.destinoViaje, fechaInicio: p.fechasViaje?.inicio ?? null }),
    [filasVivas, p.destinoViaje, p.fechasViaje],
  )
  // Lo que pinta «El viaje, en orden»: los de verdad y, en su lugar del viaje, los provisionales.
  const tramosDelPaso1 = useMemo(
    () => (provisionales.length === 0 ? tramos : viajeEnOrden([...filasVivas, ...provisionales], { destino: p.destinoViaje, fechaInicio: p.fechasViaje?.inicio ?? null })),
    [tramos, filasVivas, provisionales, p.destinoViaje, p.fechasViaje],
  )
  const servicios = tramos.flatMap(t => t.servicios)
  const serviciosDelPaso1 = tramosDelPaso1.flatMap(t => t.servicios)
  const porId = useMemo(() => new Map([...filasDeLaVista, ...provisionales].map(f => [f.id, f])), [filasDeLaVista, provisionales])
  const nombreDeOpcion = useCallback((id: string) => {
    const f = porId.get(id)
    return f ? nombreVisibleDeLinea(f) || f.nombre || 'Opción' : 'Opción'
  }, [porId])
  const faltaPrecio = useCallback((id: string) => {
    const f = porId.get(id)
    if (!f) return null
    return textoCortoDeOpcion({ grupo: f.grupo ?? null, tarifa_pax: f.tarifa_pax }, p.composicionViaje)
  }, [porId, p.composicionViaje])
  const candidatasPorServicio = useMemo(() => new Map(ranurasConAlternativas(lineas).map(r => [r.grupo, r.candidatos])), [lineas])
  const conOpciones: ServicioConOpciones[] = servicios
    .filter(s => s.estado === 'incluido' && (candidatasPorServicio.get(s.grupo)?.length ?? 0) > 1)
    .map(s => ({ ...s, candidatas: candidatasPorServicio.get(s.grupo) ?? [] }))
  const renglones = loQueSuma(tramos, tarifas, precios)
  const vanAlCliente = tarifas.filter(t => t.esPrincipal || (t.vaEnPropuesta && !t.igualA))
  const bajoMinimo = vanAlCliente.filter(t => t.margenReal !== null && t.margenReal < p.umbrales.pisoPct)
  const autorizacionVigente = !!p.salida?.excepcion
  const sinCosto = renglones
    .filter(r => !r.noSuma && (r.sinCosto || (r.opcionId && faltaPrecio(r.opcionId))))
    .map(r => ({ servicio: r.nombre, motivo: r.sinCosto ? 'Falta el costo' : faltaPrecio(r.opcionId!)! }))

  const entradaPasos = {
    servicios: servicios.length,
    conOpciones: conOpciones.length,
    pantallazosPorAceptar: p.pantallazosPorAceptar,
    leyendo: p.leyendo,
    sinCosto,
    bajoMinimo: autorizacionVigente ? [] : bajoMinimo.map(t => t.nombre ?? 'Tarifa'),
    tarifasVistas,
    vanAlCliente: vanAlCliente.map(t => t.nombre ?? 'Tarifa'),
    // D8 (H7) · un solo conteo: con la lista única, la barra cuenta sus renglones rojos, que ya traen
    // el precio por pasajero que falta y la línea sin costo. Sumarle `sinCosto` contaba dos veces lo
    // mismo («2 cosas impiden enviar» con una sola en la lista). Sin la lista, como siempre.
    rojos: p.listaUnica ? p.listaUnica.impide.length : p.conteoLista.rojos + (sinCosto.length > 0 ? 1 : 0),
    ambar: p.conteoLista.ambar + p.pantallazosPorAceptar,
    texto: p.texto,
    enviada: p.enviada,
  }
  const estados = estadoDeLosPasos(entradaPasos)
  const siguiente = sigue({ ...entradaPasos, pasoActual: paso })
  const irAPaso = (n: NumeroDePaso) => {
    setPaso(n)
    if (n === 2) setTarifasVistas(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  /** «Ir» de la lista única: la tarjeta, la tarifa, la bandeja o el párrafo exacto. */
  const irDesdeLaLista = (d: DestinoDeIr) => {
    if (d.a === 'opcion') { setPaso(1); p.onAbrirOpcion(d.itemId); return }
    if (d.a === 'tarifas') { irAPaso(2); return }
    if (d.a === 'bandeja' || d.a === 'viaje') { irAPaso(1); return }
    if (typeof document !== 'undefined') document.getElementById('doc')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Acciones: se escriben en el acto y dejan «Deshacer» ──
  const correr = async <T,>(accion: () => Promise<T>): Promise<T | null> => {
    setOcupado(true)
    try {
      return await accion()
    } catch {
      toast.error('No se pudo guardar: revisa la conexión y vuelve a intentarlo.')
      return null
    } finally {
      setOcupado(false)
    }
  }
  const deshacerCon = (op: Parameters<typeof deshacerPorPasos>[0]) => async () => {
    const r = await deshacerPorPasos(op)
    if (!r.success && r.error === YA_CAMBIO) return { success: false, error: YA_CAMBIO }
    return r
  }

  const elegir = (tarifaId: string, grupo: string, itemId: string) => {
    const t = p.tarifasDelServidor.find(x => x.id === tarifaId)
    const candidatas = candidatasPorServicio.get(grupo) ?? []
    const base = overrides[tarifaId]?.seleccion ?? t?.seleccion ?? []
    setOverrides(o => ({ ...o, [tarifaId]: { ...o[tarifaId], seleccion: [...base.filter(id => !candidatas.includes(id)), itemId] } }))
    void correr(async () => {
      const r = await elegirOpcionEnTarifa(tarifaId, grupo, itemId)
      if (!r.success) {
        toast.error(r.error)
        setOverrides(o => { const n = { ...o }; delete n[tarifaId]; return n })
        return
      }
      const servicio = servicios.find(s => s.grupo === grupo)?.nombre ?? 'El servicio'
      ofrecer(`${servicio}: en la ${t?.nombre ?? 'tarifa'} va ${nombreDeOpcion(itemId)}.`, deshacerCon({ tipo: 'eleccion', cotizacionId: p.cotizacionId, itinerarioId: tarifaId, grupo, escrita: itemId, anterior: r.anterior }))
      p.refrescar()
    })
  }

  const mandar = (tarifaId: string, va: boolean) => {
    setOverrides(o => ({ ...o, [tarifaId]: { ...o[tarifaId], va } }))
    void correr(async () => {
      const r = await mandarTarifa(tarifaId, va)
      if (!r.success) {
        toast.error(r.error)
        setOverrides(o => { const n = { ...o }; if (n[tarifaId]) delete n[tarifaId].va; return n })
        return
      }
      ofrecer('Cambiaste qué tarifas van en la propuesta.', deshacerCon({ tipo: 'mandar', cotizacionId: p.cotizacionId, itinerarioId: tarifaId, escrita: va, anterior: r.anterior }))
      p.refrescar()
    })
  }

  // Punto 2 (reunión del 2026-10-22): las opciones Netas que no siguen el margen de la cotización.
  const propios = useMemo(
    () => lineasConMargenPropio(lineas, Number(params.margenPct) || 0, params.convencionMargen)
      .map(l => ({ id: l.id, margen: Number(l.margen_porcentaje) })),
    [lineas, params],
  )
  const seguirMargen = () => {
    void correr(async () => {
      const r = await margenDeLaCotizacionEnOpciones(p.cotizacionId, propios.map(x => x.id))
      if (!r.success) { toast.error(r.error); return }
      toast.success(r.cambiadas === 1 ? 'Esa opción ya usa el margen de la cotización.' : `Esas ${r.cambiadas} opciones ya usan el margen de la cotización.`)
      p.refrescar()
    })
  }

  const margen = (pct: number) => {
    setMargenLocal(pct)
    void correr(async () => {
      const r = await margenPorPasos(p.cotizacionId, pct)
      if (!r.success) { toast.error(r.error); setMargenLocal(null); return }
      ofrecer('Cambiaste el margen de la cotización: vale para las tres tarifas.', deshacerCon({ tipo: 'margen', cotizacionId: p.cotizacionId, escrito: pct, anterior: r.anterior }))
      p.refrescar()
    })
  }

  const cambiarEstado = (grupo: string, estado: EstadoServicio) => {
    void correr(async () => {
      const r = await estadoDeServicioPorPasos(p.cotizacionId, grupo, estado)
      if (!r.success) { toast.error(r.error); return }
      const nombre = servicios.find(s => s.grupo === grupo)?.nombre ?? 'El servicio'
      const texto = estado === 'no' ? `${nombre} no va.` : estado === 'opcional' ? `${nombre} queda Opcional.` : `${nombre} va incluido.`
      ofrecer(texto, deshacerCon({ tipo: 'estado', cotizacionId: p.cotizacionId, grupo, escrito: estado, anterior: r.anterior }))
      p.refrescar()
    })
  }

  const borrar = (itemIds: string[], mensaje: string) => {
    // D2 · lo que hay que volver a pintar si se deshace: las opciones y la elección de cada tarifa.
    const filasBorradas = p.filas.filter(f => itemIds.includes(f.id))
    const eleccionAntes: Record<string, Override> = Object.fromEntries(tarifasPantalla.map(t => [t.id, { seleccion: [...t.seleccion], va: t.vaEnPropuesta }]))
    setRepuestas(r => r.filter(f => !itemIds.includes(f.id)))
    setOcultos(o => new Set([...o, ...itemIds]))
    void correr(async () => {
      const r = await borrarOpcionesPorPasos(p.cotizacionId, itemIds)
      if (!r.success) {
        toast.error(r.error)
        setOcultos(o => { const n = new Set(o); itemIds.forEach(id => n.delete(id)); return n })
        return
      }
      const devolverALaBandeja = () => {
        for (const [id, lecturas] of Object.entries(r.devueltas)) if (lecturas.length > 0) p.onRecibirEnBandeja(id, lecturas)
        void soltarImagenesPorPasos(p.cotizacionId, r.fotos)
      }
      ofrecer(mensaje, async () => {
        const repuesto = await reponerOpcionesPorPasos(p.cotizacionId, r.fotos, r.marcas)
        if (repuesto.success) {
          // Se pinta ya como quedó en la base (la opción y la tarifa de antes), sin esperar el refresco.
          setRepuestas(filasBorradas)
          setOverrides(eleccionAntes)
          setOcultos(o => { const n = new Set(o); itemIds.forEach(id => n.delete(id)); return n })
        }
        return repuesto
      }, devolverALaBandeja)
      p.refrescar()
    })
  }

  const juntar = (origen: string, destino: string) => {
    void correr(async () => {
      const r = await juntarServicioPorPasos(p.cotizacionId, origen, destino)
      if (!r.success) { toast.error(r.error); return }
      const nombre = servicios.find(s => s.grupo === destino)?.nombre ?? 'el servicio'
      ofrecer(`Quedó como opción de ${nombre}.`, deshacerCon({ tipo: 'juntar', cotizacionId: p.cotizacionId, movidas: r.movidas, grupoEscrito: destino, grupoAnterior: r.grupoAnterior }))
      p.refrescar()
    })
  }

  const mover = (itemId: string, destino: string | null) => {
    void correr(async () => {
      const r = destino ? await moverOpcionPorPasos(itemId, destino) : await separarOpcionPorPasos(itemId)
      if (!r.success) { toast.error(r.error); return }
      ofrecer(destino ? `Moviste ${nombreDeOpcion(itemId)}.` : `${nombreDeOpcion(itemId)} quedó como servicio aparte.`,
        deshacerCon({ tipo: 'mover', cotizacionId: p.cotizacionId, itemId, grupoEscrito: r.grupo, grupoAnterior: r.grupoAnterior ?? '' }))
      p.refrescar()
    })
  }

  const otraOpcion = (grupo: string) => {
    void correr(async () => {
      const r = await agregarOpcionPorPasos(p.cotizacionId, grupo)
      if (!r.success) { toast.error(r.error); return }
      setAbiertos(a => new Set([...a, grupo]))
      p.onAbrirOpcion(r.itemId)
      ofrecer('Otra opción: pégale su pantallazo.', async () => {
        const b = await borrarOpcionesPorPasos(p.cotizacionId, [r.itemId])
        return b.success ? { success: true } : b
      })
      p.refrescar()
    })
  }

  // P6 · con la excepción vigente, el dueño la puede retirar (`autorizacion-vista.ts`, H6).
  const autorizacion: AutorizacionVista | null = autorizacionDeLaSalida(p.salida, p.pedido)

  const alternar = (grupo: string) => setAbiertos(a => {
    const n = new Set(a)
    if (n.has(grupo)) n.delete(grupo)
    else n.add(grupo)
    return n
  })

  // ── Paso 1 ──
  const paso1 = (
    <div className="flex flex-col gap-3" data-paso-armar>
      <h2 className="m-0 text-base font-bold">1 · Armar el viaje</h2>
      <p className="m-0 text-[13px] text-[#6E6A62]">Pega los pantallazos de lo que cotizaste, en el orden que quieras. ONE lee cada uno y te dice a dónde va.</p>
      {p.editable && p.bandeja}
      {serviciosDelPaso1.length === 0 ? (
        <p className="m-0 rounded-xl border border-[#E2DED5] bg-white p-6 text-center text-[13px] text-[#6E6A62]">
          Todavía no hay servicios. Cada pantallazo que aceptes aparece aquí, en el orden del viaje.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="m-0 text-[15px] font-bold">El viaje, en orden</h3>
            <p className="m-0 text-[13px] text-[#6E6A62]">Todo servicio suma. Las opciones compiten: en cada tarifa va una sola.</p>
            <button
              type="button"
              className="ml-auto border-0 bg-transparent p-0 text-[13px] font-semibold text-[#0E5C43] underline underline-offset-2"
              onClick={() => setAbiertos(abiertos.size === servicios.length ? new Set() : new Set(servicios.map(s => s.grupo)))}
            >
              {abiertos.size === servicios.length ? 'Contraer todo' : 'Expandir todo'}
            </button>
          </div>
          {tramosDelPaso1.map(tr => (
            <div key={tr.clave} className="flex flex-col gap-2" data-tramo={tr.clave}>
              <div className="flex items-baseline gap-2">
                <h4 className="m-0 text-[13px] font-bold uppercase tracking-wide text-[#6E6A62]">{tr.titulo}</h4>
                <span className="h-px flex-1 bg-[#E2DED5]" />
              </div>
              {tr.servicios.map(s => {
                if (s.opciones.every(id => idsProvisionales.has(id))) {
                  const resumenProv = resumenDeOpcion(porId.get(s.opciones[0])!) ?? nombreDeOpcion(s.opciones[0])
                  return <ServicioProvisional key={s.grupo} servicio={s} resumen={resumenProv} />
                }
                const renglon = renglones.find(r => r.grupo === s.grupo)
                const resumen = s.opciones.length > 1
                  ? `${s.opciones.length} opciones · ${s.opciones.map(nombreDeOpcion).join(' · ')}`
                  : resumenDeOpcion(porId.get(s.opciones[0])!) ?? nombreDeOpcion(s.opciones[0])
                const avisoServicio = s.opciones.map(faltaPrecio).find(Boolean) ?? (renglon?.sinCosto ? 'Falta el costo' : null)
                return (
                  <ServicioPorPasos
                    key={s.grupo}
                    servicio={s}
                    precio={renglon?.precio ?? 0}
                    sinCosto={renglon?.sinCosto ?? false}
                    resumen={resumen}
                    abierto={abiertos.has(s.grupo)}
                    editable={p.editable}
                    ocupado={ocupado}
                    estados={estadosPermitidos(s.grupo)}
                    juntables={servicios.filter(x => x.tipo === s.tipo && x.grupo !== s.grupo).map(x => ({ grupo: x.grupo, nombre: x.nombre }))}
                    aviso={avisoServicio}
                    onAlternar={() => alternar(s.grupo)}
                    onEstado={e => cambiarEstado(s.grupo, e)}
                    onJuntar={destino => juntar(s.grupo, destino)}
                    onBorrar={() => borrar(s.opciones, `Borraste ${s.nombre}. Sus pantallazos vuelven a la bandeja.`)}
                    onOtraOpcion={() => otraOpcion(s.grupo)}
                  >
                    {s.opciones.map(id => {
                      const en = s.opciones.length > 1 && s.estado !== 'no'
                        ? tarifas.filter(t => t.opcionPorServicio[s.grupo] === id && (t.esPrincipal || (t.vaEnPropuesta && !t.igualA))).map(t => t.nombre ?? 'Tarifa')
                        : null
                      const mismos = servicios.filter(x => x.tipo === s.tipo && x.grupo !== s.grupo)
                      return (
                        <div key={id}>
                          {p.tarjetaDeOpcion(id, {
                            enTarifas: en,
                            onEliminar: () => borrar([id], `Eliminaste ${nombreDeOpcion(id)}. Su pantallazo vuelve a la bandeja.`),
                            menuExtra: cerrar => (
                              <>
                                {s.opciones.length > 1 && (
                                  <ItemMenu onClick={() => { cerrar(); mover(id, null) }}>Separar como servicio aparte</ItemMenu>
                                )}
                                {mismos.length > 0 && (
                                  <>
                                    <SeparadorMenu />
                                    <span className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[#6E6A62]">Mover esta opción a</span>
                                    {mismos.map(x => (
                                      <ItemMenu key={x.grupo} onClick={() => { cerrar(); mover(id, x.grupo) }}>{x.nombre}</ItemMenu>
                                    ))}
                                  </>
                                )}
                              </>
                            ),
                          })}
                          {p.editable && (() => {
                            const f = porId.get(id)
                            const tipos = f ? tiposSinPrecio({ grupo: f.grupo ?? null, tarifa_pax: f.tarifa_pax }, p.composicionViaje) : []
                            return tipos.length > 0 ? (
                              <PrecioQueFaltaPorPasos
                                itemId={id}
                                nombre={nombreDeOpcion(id)}
                                tipos={tipos}
                                moneda={monedaDeTarifa(leerTarifaPax(f?.tarifa_pax)).moneda}
                                onGuardado={p.refrescar}
                              />
                            ) : null
                          })()}
                        </div>
                      )
                    })}
                  </ServicioPorPasos>
                )
              })}
            </div>
          ))}
        </>
      )}
      {p.editable && p.agregarSinPantallazo}
      {servicios.length > 0 && (
        <div className="flex justify-end">
          <button type="button" className="rounded-lg border border-[#0E5C43] bg-[#0E5C43] px-3 py-1.5 text-[13px] font-semibold text-white" onClick={() => irAPaso(2)}>
            Seguir a Tarifas →
          </button>
        </div>
      )}
    </div>
  )

  const iguales = servicios
    .filter(s => s.estado === 'incluido' && (candidatasPorServicio.get(s.grupo)?.length ?? 0) <= 1)
    .map(s => {
      const id = s.opciones.find(o => precios.has(o)) ?? s.opciones[0]
      return { grupo: s.grupo, nombre: s.nombre, opcion: nombreDeOpcion(id), precio: precios.get(id)?.precio ?? 0 }
    })

  const paso2 = (
    <TarifasPorPasos
      tarifas={tarifas}
      servicios={conOpciones}
      iguales={iguales}
      opcionales={servicios.filter(s => s.estado === 'opcional').map(s => ({ grupo: s.grupo, nombre: s.nombre }))}
      noVan={servicios.filter(s => s.estado === 'no').map(s => ({ grupo: s.grupo, nombre: s.nombre }))}
      nombreDeOpcion={nombreDeOpcion}
      detalleDeOpcion={id => (porId.get(id) ? resumenDeOpcion(porId.get(id)!) : null)}
      precioDeOpcion={id => precios.get(id)?.precio ?? 0}
      margenPct={margenLocal ?? p.margenPct}
      pisoPct={p.umbrales.pisoPct}
      avisoPct={p.umbrales.avisoPct}
      editable={p.editable}
      ocupado={ocupado}
      autorizacion={autorizacion}
      verElCalculo={p.verElCalculo}
      rastro={p.rastro}
      onElegir={elegir}
      onMandar={mandar}
      onMargen={margen}
      propios={propios.map(x => ({ ...x, nombre: nombreDeOpcion(x.id) }))}
      onSeguirMargen={seguirMargen}
      onPedir={() => void correr(async () => {
        const r = await pedirAutorizacionPorPasos(p.cotizacionId)
        if (!r.success) { toast.error(r.error); return }
        // P7 · solo se promete la notificación si se escribió; si no, queda en la actividad del negocio.
        if (r.notificado) toast.success(`Quedó pedido a ${r.a ?? 'quien autoriza'}: le llega en sus notificaciones.`)
        else toast.warning(`Quedó pedido en la actividad del negocio, pero no le llegó la notificación a ${r.a ?? 'quien autoriza'}: avísale tú.`)
        p.refrescar()
      })}
      onAutorizar={motivo => {
        if (!motivo) { toast.error('Escribe el motivo: es obligatorio.'); return }
        void correr(async () => {
          const r = await autorizarBajoElMinimo(p.cotizacionId, motivo)
          if (!r.success) { toast.error(r.error); return }
          toast.success('Autorizado. Si cambia el margen o un costo, se pierde.')
          p.refrescar()
        })
      }}
      onRetirar={() => void correr(async () => {
        const r = await retirarAutorizacionPorPasos(p.cotizacionId)
        if (!r.success) { toast.error(r.error); return }
        toast.success('Retiraste la autorización.')
        p.refrescar()
      })}
      onReponer={grupo => cambiarEstado(grupo, 'incluido')}
      onVerEnElViaje={(grupo, itemId) => {
        setAbiertos(a => new Set([...a, grupo]))
        irAPaso(1)
        p.onAbrirOpcion(itemId)
      }}
      onRenombrar={(id, nombre) => void correr(async () => {
        const r = await renombrarItinerario(id, nombre)
        if (!r.success) toast.error(r.error)
        p.refrescar()
      })}
      onEliminarTarifa={id => void correr(async () => {
        const r = await eliminarItinerario(id)
        if (!r.success) { toast.error(r.error); return }
        toast.success('Eliminaste la tarifa.')
        p.refrescar()
      })}
      onMotivo={(id, codigo) => void correr(async () => {
        const r = await guardarMotivoDeTarifa(id, codigo, null)
        if (!r.success) toast.error(r.error)
        else toast.success(codigo ? 'Quedó el motivo de esta combinación.' : 'Quitaste el motivo.')
      })}
      onSeguir={irAPaso}
    />
  )

  // D7 · el documento de Revisar se vuelve a pedir cuando cambia lo que imprime: las líneas (costo,
  // precio, grupo, si suman), las tarifas, el margen y el estado del texto.
  // Armada aparte (no con la clave de lo optimista de arriba): es la del documento, y cambia con él.
  const claveDelDocumento = [
    total.precioVenta,
    p.texto,
    p.margenPct,
    JSON.stringify(p.tarifasDelServidor),
    p.filas.map(f => `${f.id}:${f.grupo}:${f.entra_al_precio}:${f.subtotal ?? ''}:${f.precio_venta ?? ''}`).join(','),
  ].join('|')
  const paso3 = (
    <RevisarPorPasos
      total={total.precioVenta}
      enviada={p.enviada}
      editable={p.editable}
      ocupado={ocupado}
      motivoParaNoEnviar={p.listaUnica
        ? (p.listaUnica.impide[0]?.texto ?? null)
        : p.motivoBotonEnviar ?? (sinCosto.length > 0 ? `${sinCosto[0].motivo}: ${sinCosto[0].servicio}.` : null)}
      lista={p.listaUnica ? <ListaUnicaPorPasos lista={p.listaUnica} onIr={irDesdeLaLista} /> : p.revisarLista}
      documento={(
        <>
          <DocumentoEnRevisar cotizacionId={p.cotizacionId} clave={claveDelDocumento} />
          {p.revisarDocumento}
        </>
      )}
      onDescargar={p.onDescargar}
      onEnviar={() => void correr(async () => {
        const r = await enviarPorPasos(p.cotizacionId)
        if (!r.success) { toast.error(r.error); return }
        toast.success('Cotización enviada')
        p.refrescar()
      })}
      onSeguir={() => irAPaso(2)}
    />
  )

  return (
    <div className="flex flex-col gap-3" data-cotizacion-por-pasos>
      <BarraPasos
        paso={paso}
        estados={estados}
        sigue={siguiente}
        onPaso={irAPaso}
        onSigue={() => {
          const a = siguiente.accion
          if (a.tipo === 'paso') irAPaso(a.paso)
          else if (a.tipo === 'aceptar') p.onAceptarTodos()
          else if (a.tipo === 'pegar') p.onPegar()
        }}
      />
      <div className={`grid grid-cols-1 gap-4 ${clasesLoQueSuma(sumaVisible.preferencia).rejilla}`}>
        <LoQueSuma
          preferencia={sumaVisible.preferencia}
          onElegir={sumaVisible.elegir}
          encabezado={marco ? (marco.encabezado ?? null) : undefined}
          datos={{
            renglones,
            nombreDeOpcion,
            faltaPrecio,
            total: total.precioVenta,
            costo: total.costoDeVenta,
            margenPct: total.margenRealPct,
            otrasQueVan: vanAlCliente.filter(t => !t.esPrincipal).map(t => ({ nombre: t.nombre ?? 'Tarifa', precio: t.precio })),
            pantallazosEnBandeja: p.pantallazosPorAceptar,
            incompleto: sinCosto.length > 0,
            rojos: entradaPasos.rojos,
          }}
        />
        <div className="min-w-0 pb-36 lg:pb-4">{paso === 1 ? paso1 : paso === 2 ? paso2 : paso3}</div>
      </div>
      {aviso}
    </div>
  )
}
