'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Send, Copy, Plus, Trash2, Pencil, Percent, FileDown,
  ChevronDown, ChevronRight, Lock, BookOpen, Loader2, Calculator, AlertTriangle, FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  updateCotizacion, enviarCotizacion, duplicarCotizacion,
  addItem, updateItem, deleteItem,
  addRubro, updateRubro, deleteRubro, recalcularTotales,
  addItemFromServicio, aplicarAIU,
} from '@/app/(app)/negocios/cotizacion-actions'
import { getServiciosActivos } from '@/app/(app)/config/servicios-actions'
import { generateCotizacionPDF } from '@/app/(app)/negocios/cotizacion-pdf-actions'
import PanelMargenSalida from '@/app/(app)/negocios/panel-margen-salida'
import type { SalidaVista } from '@/app/(app)/negocios/margen-salida-actions'
import { ESTADO_COTIZACION_CONFIG, TIPOS_RUBRO, etiquetaTipoRubro } from '@/lib/catalogos/constants'
import { formatCOP } from '@/lib/contacts/constants'
import { CONVENCION_MARGEN_POR_DEFECTO, margenParaPrecio, type ConvencionMargen } from '@/lib/cotizaciones/precio-item'
import { margenDeLineaSegunConvencion } from '@/lib/cotizaciones/margen-proveedor'
import { calcularCascada, type Cascada } from '@/lib/cotizaciones/totales'
import {
  nombreDelMargen,
  nivelDeMargen,
  UMBRALES_MARGEN_POR_DEFECTO,
  type NivelMargen,
  type UmbralesMargen,
} from '@/lib/cotizaciones/convencion-margen'
import { origenDelMargen, etiquetaOrigenMargen, formatMargenPct, claseNivelMargen } from '@/lib/cotizaciones/margen-vista'
import RastroMargen from '@/app/(app)/negocios/rastro-margen-panel'
import TablaCombinaciones from '@/app/(app)/negocios/tabla-combinaciones'
import { agregarOpcionAItem, actualizarRanuraDeItem, actualizarDiaDeItem, type EstadoItinerarios } from '@/app/(app)/negocios/itinerario-actions'

import {
  avisoSugeridosQueCobran,
  diaDeItem,
  fueraDelPrecio,
  hayDiasAsignados,
  itemsSugeridos,
  puedeLlevarDia,
  puedeSerSugerido,
} from '@/lib/cotizaciones/dia-relativo'
import SelectorRanura from '@/app/(app)/negocios/selector-ranura'
import TarifaPasajeroItem from '@/app/(app)/negocios/tarifa-pasajero-item'
import CostoManualItem from '@/app/(app)/negocios/costo-manual-item'
import AdicionalesItem from '@/app/(app)/negocios/adicionales-item'
import DocumentoClientePanel from '@/app/(app)/negocios/documento-cliente-panel'
import type { FilaAdicional } from '@/lib/cotizaciones/adicionales'
import { estadoDelTexto, type PanelTextoCliente } from '@/lib/cotizaciones/documento-cliente'

/**
 * Sin adicionales y sin poder guardarlos: lo que recibe toda cotización que no es de
 * viaje, y toda base sin la migración aplicada. La constante vive fuera del componente
 * para que su identidad no cambie en cada render.
 */
const ADICIONALES_VACIOS = { disponible: false, porItem: {} as Record<string, FilaAdicional[]> }
import {
  etiquetaDeRanura,
  gruposCanonicos,
  ranuraDeGrupo,
  ranuraPorSlug,
  siguienteGrupoDeTipo,
} from '@/lib/cotizaciones/ranuras-pantallazo'
import { nombreProvisionalDeGrupo } from '@/lib/cotizaciones/nombre-linea'
import {
  composicionDeLinea,
  confirmacionDesactualizada,
  confirmadaVigente,
  leerTarifaPax,
  lineaPorPasajero,
  precioPorPasajero,
  type Composicion,
} from '@/lib/cotizaciones/tarifa-pasajero'
import { lineasDesactualizadas, motivoParaNoEnviar } from '@/lib/cotizaciones/captura-desactualizada'
import { etiquetaDeMotivo } from '@/lib/cotizaciones/motivos-borrador'
import { aplicarRecargo } from '@/app/(app)/negocios/recargo-actions'
import {
  estadoDelRecargo,
  lineaDeRecargo,
  RECARGO_POR_DEFECTO,
  type PoliticaRecargo,
} from '@/lib/cotizaciones/recargo-linea'
import {
  itemsDelItinerario,
  itemsQueAportanAlTotal,
  ranurasPorSupuesto,
} from '@/lib/cotizaciones/itinerarios'
import { avisosDeCobertura } from '@/lib/cotizaciones/cobertura-opciones'
import {
  costoDeRubrosConfirmados,
  soloConfirmados,
  soloSugeridos,
} from '@/lib/cotizaciones/rubros-sugeridos'
import { nombreMostrable } from '@/lib/cotizaciones/nombre-cotizacion'
import { aMayusculas } from '@/lib/negocios/mayusculas'
import { isEditable } from '@/lib/cotizaciones/state-machine'
import { generarResumenFiscal } from '@/lib/fiscal/calculos-fiscales'
import {
  CONFIG_IVA_POR_DEFECTO,
  esBaseIvaLinea,
  ivaIncluidoEnElPrecio,
  ivaSobreIngresoPropio,
  lineasParaIva,
  liquidarIva,
  motivoIvaSinCalcular,
  tarifaIvaDelVendedor,
  TEXTO_IVA_SIN_CALCULAR,
  ETIQUETA_BASE_IVA,
  BASES_IVA_LINEA,
  type BaseIvaLinea,
  type ConfigIvaCotizacion,
  type MetaDeLineaParaIva,
} from '@/lib/fiscal/iva-cotizacion'
import type { EstadoCotizacion } from '@/lib/catalogos/constants'
import type { FiscalProfile, Client } from '@/types/database'

interface RubroRow {
  id: string
  tipo: string | null
  descripcion: string | null
  cantidad: number | null
  unidad: string | null
  valor_unitario: number | null
  valor_total: number | null
  /**
   * Propuesto por la lectura de un pantallazo y sin confirmar. Llega `undefined`
   * mientras la migración `20260914230000` no esté aplicada, y eso vale lo mismo que
   * `false`: cuenta al costo, que es el comportamiento de siempre.
   */
  sugerido?: boolean | null
}

interface ItemRow {
  id: string
  nombre: string | null
  subtotal: number | null
  orden: number | null
  precio_venta?: number | null
  descuento_porcentaje?: number | null
  descripcion?: string | null
  es_ajuste?: boolean
  cantidad?: number | null
  margen_porcentaje?: number | null
  precio_manual?: boolean | null
  /**
   * Ranura en la que compite la linea. Llega `undefined` mientras la migracion
   * `20260914200000` no este aplicada, y eso vale lo mismo que `null`: sin grupo.
   */
  grupo?: string | null
  /** Titular del que esta linea es alternativa. `null`/ausente = es el titular. */
  opcion_de?: string | null
  /** Unidad de cara al cliente: pax, noche, trayecto. */
  unidad?: string | null
  /**
   * Día del viaje al que pertenece la línea (1 = primer día). Llega `undefined`
   * mientras la migración `20260915000000` no esté aplicada, y eso vale lo mismo que
   * `null`: sin día, o sea el comportamiento de hoy.
   */
  dia_relativo?: number | null
  /** ¿La sugerencia se le muestra al cliente? Ausente cuenta como sí. */
  mostrar_en_sugeridos?: boolean | null
  /** ¿La línea cobra? `false` = sugerencia con precio a la vista que no suma. Ausente = sí. */
  entra_al_precio?: boolean | null
  /**
   * Tarifa por tipo de pasajero (`20260916231500`): composición propia, lecturas por
   * casilla y costo por pasajero confirmado. Ausente = la línea se ve como hoy.
   */
  tarifa_pax?: unknown
  /**
   * Sobre qué va el IVA de la línea (`items.base_iva`). Ausente o `null` = sigue al
   * workspace. Solo cuenta donde el workspace liquida el IVA sobre el ingreso propio.
   */
  base_iva?: string | null
  rubros: RubroRow[]
}

interface CotizacionData {
  id: string
  codigo: string | null
  consecutivo: string | null
  modo: string | null
  estado: string | null
  descripcion: string | null
  valor_total: number | null
  margen_porcentaje: number | null
  costo_total: number | null
  fecha_envio: string | null
  fecha_validez: string | null
  descuento_porcentaje?: number | null
  descuento_valor?: number | null
  aiu_admin_pct?: number | null
  aiu_imprevistos_pct?: number | null
  /** Margen configurado para la línea de negocio. Respalda al de la cotización. */
  margen_default_pct?: number | null
  terminos_condiciones?: string | null
  /** Que significa `margen_porcentaje` aqui. Ausente vale `markup`, como antes. */
  convencion_margen?: ConvencionMargen | null
}

interface ClientFiscal {
  person_type: string | null
  tax_regime: string | null
  gran_contribuyente: boolean
  agente_retenedor: boolean
}

interface StaffMember {
  id: string
  nombre: string
  tarifa_hora: number
}

interface Props {
  oportunidadId: string
  cotizacion: CotizacionData
  initialItems: ItemRow[]
  fiscalProfile?: FiscalProfile | null
  clientFiscal?: ClientFiscal | null
  backUrl?: string
  staffMembers?: StaffMember[]
  frozen?: boolean
  lineaId?: string | null
  /**
   * Piso (rojo) y aviso (ámbar) del margen, YA resueltos por el servidor: manda lo
   * que la cotización congeló al nacer y la política de su línea solo entra donde la
   * cotización no diga nada. La pantalla no repite esa precedencia — si la repitiera,
   * el día que cambie quedarían dos reglas.
   */
  umbrales?: UmbralesMargen
  /**
   * ¿La etapa donde el negocio está parado declara el gate `margen_sobre_piso`?
   *
   * Decide el TEXTO del rojo, no el color: donde el gate está declarado, bajo el
   * piso no se avanza; donde no, el rojo sigue siendo una marca. Prometer un bloqueo
   * que no existe enseña a ignorar el aviso, y negar el que sí existe deja a alguien
   * descubriéndolo cuando le rebota el avance.
   */
  pisoBloqueaAvance?: boolean
  /**
   * El recargo fijo que declara la línea (Regla 2 del 2026-09-14).
   *
   * Ausente vale APAGADO: un recargo que aparece solo en un workspace que no lo pidió
   * es una línea de más en un documento que sale a un cliente.
   */
  politicaRecargo?: PoliticaRecargo
  /**
   * Las combinaciones de esta cotizacion, ya calculadas por el servidor.
   *
   * Opcional a proposito: el editor se monta desde dos rutas y la que no lo pase
   * —o una cotizacion sin opciones— simplemente no pinta la tabla, que es R6 en la
   * pantalla.
   */
  itinerarios?: EstadoItinerarios
  /**
   * Quiénes viajan, de la etapa 1 del negocio. Cada línea con pantallazo la hereda como
   * punto de partida (tarifa por pasajero §4). `null` o ausente: la línea pide escribirla.
   */
  composicionViaje?: Composicion | null
  /**
   * La línea del negocio cotiza por TIPO (`lineas-por-tipo.ts`): en vez de «nombre + Item»
   * se ofrecen «+ Vuelo», «+ Hotel», «+ Actividad», «+ Traslado» y «+ Otro». Ausente vale
   * `false`, que es la pantalla de siempre.
   */
  lineasPorTipo?: boolean
  /**
   * Los adicionales de cada variante, leídos por el servidor (`adicional-actions.ts`).
   *
   * Opcional a propósito, y `disponible: false` por defecto: el editor se monta desde dos
   * rutas, y una cotización sin adicionales —o una base sin la migración— no pinta nada.
   * Es el mismo corte que `itinerarios`.
   */
  adicionales?: { disponible: boolean; porItem: Record<string, FilaAdicional[]> }
  /**
   * El margen mínimo en la SALIDA (`margen-salida-actions.ts`): si la cotización puede
   * enviarse, la autorización del dueño y quién puede darla. Ausente = la línea no exige
   * el piso en la salida y la pantalla es la de siempre.
   */
  salida?: SalidaVista | null
  /**
   * El texto para el cliente (titular, intro, «Incluido», «Antes de viajar»), leído por el
   * servidor (`documento-cliente-actions.ts`). Solo llega con la plantilla que lo imprime:
   * ausente o `null`, el editor no muestra el botón ni el panel.
   */
  textoCliente?: PanelTextoCliente | null
  /**
   * Sobre qué va el IVA (`iva-cotizacion.ts`), ya leído del `config_extra` del workspace.
   * Ausente = IVA sobre el total, lo de siempre.
   */
  configIva?: ConfigIvaCotizacion | null
}

export default function CotizacionEditor({ oportunidadId, cotizacion, initialItems, fiscalProfile, clientFiscal, backUrl, staffMembers, frozen, lineaId, umbrales = UMBRALES_MARGEN_POR_DEFECTO, itinerarios, pisoBloqueaAvance = false, politicaRecargo = RECARGO_POR_DEFECTO, composicionViaje = null, lineasPorTipo = false, adicionales = ADICIONALES_VACIOS, salida = null, textoCliente = null, configIva = CONFIG_IVA_POR_DEFECTO }: Props) {
  // Abierto de entrada solo si hay un borrador de ONE esperando revisión: es lo único que
  // el equipo tiene que hacer aquí, y cerrado no lo vería.
  const [verTextoCliente, setVerTextoCliente] = useState(() => estadoDelTexto(textoCliente?.documento ?? null) === 'borrador')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const estado = cotizacion.estado as EstadoCotizacion
  const editable = isEditable(estado) && !frozen
  const estadoConfig = ESTADO_COTIZACION_CONFIG[estado]
  // Que significa el numero del campo de margen en ESTA cotizacion. Ausente vale
  // `markup`, que es como se calculo todo lo anterior a esa columna.
  const convencionMargen: ConvencionMargen = cotizacion.convencion_margen ?? CONVENCION_MARGEN_POR_DEFECTO
  // Discount state
  // Terminos y condiciones al final de la cotizacion
  const [terminos, setTerminos] = useState(cotizacion.terminos_condiciones ?? '')

  // Detallada mode state
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(initialItems.map(i => i.id)))

  // New item
  const [newItemName, setNewItemName] = useState('')
  // Con líneas por tipo, el campo de nombre libre solo aparece al pedir «+ Otro».
  const [mostrarOtro, setMostrarOtro] = useState(false)
  // La línea cuyo grupo se está cambiando desde «Mover a otra opción» (flujo de viaje).
  const [moverGrupoDe, setMoverGrupoDe] = useState<string | null>(null)

  // Catalog
  const [showCatalog, setShowCatalog] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogItems, setCatalogItems] = useState<{ id: string; nombre: string; precio_estandar: number | null; rubros_template: unknown }[]>([])

  const loadCatalog = async () => {
    if (catalogItems.length > 0) { setShowCatalog(true); return }
    setCatalogLoading(true)
    try {
      const data = await getServiciosActivos(lineaId)
      setCatalogItems(data as { id: string; nombre: string; precio_estandar: number | null; rubros_template: unknown }[])
      setShowCatalog(true)
    } finally {
      setCatalogLoading(false)
    }
  }

  const handleAddFromCatalog = (servicioId: string) => {
    startTransition(async () => {
      const res = await addItemFromServicio(cotizacion.id, servicioId)
      if (res.success) {
        await recalcularTotales(cotizacion.id)
        setShowCatalog(false)
        toast.success('Servicio agregado con costos')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  // New / edit rubro
  const [addingRubroFor, setAddingRubroFor] = useState<string | null>(null)
  const [editingRubroId, setEditingRubroId] = useState<string | null>(null)
  const [newRubro, setNewRubro] = useState({
    tipo: 'mo_propia',
    descripcion: '',
    cantidad: '1',
    unidad: 'horas',
    valor_unitario: '',
  })

  const toggleItem = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // El item de ajuste no se abre nunca (no tiene detalle que mostrar), asi que no
  // cuenta para decidir si "todos" estan abiertos: si contara, el boton se quedaria
  // diciendo "Expandir todo" con todo ya abierto.
  const itemsVisibles = initialItems.filter(i => !i.es_ajuste)
  const todosExpandidos = itemsVisibles.length > 0 && itemsVisibles.every(i => expandedItems.has(i.id))
  const toggleTodos = () => {
    setExpandedItems(todosExpandidos ? new Set() : new Set(itemsVisibles.map(i => i.id)))
  }

  const handleEnviar = () => {
    startTransition(async () => {
      const res = await enviarCotizacion(cotizacion.id)
      if (res.success) {
        toast.success('Cotización enviada')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDuplicar = () => {
    startTransition(async () => {
      const res = await duplicarCotizacion(cotizacion.id)
      if (res.success) {
        toast.success('Cotización duplicada')
        router.push(backUrl ?? `/negocios/${oportunidadId}/cotizacion/${res.id}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDescargarPDF = () => {
    startTransition(async () => {
      const res = await generateCotizacionPDF(cotizacion.id)
      if (res.success && res.pdf) {
        // Convert base64 to blob and trigger download
        const byteChars = atob(res.pdf)
        const byteArray = new Uint8Array(byteChars.length)
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
        const blob = new Blob([byteArray], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.filename || `${cotizacion.consecutivo}.pdf`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        const aviso = (res as { aviso?: string | null }).aviso
        if ((res as { borrador?: boolean }).borrador) {
          // Bajo el margen mínimo sin autorización, o con pantallazos de otros pasajeros:
          // el PDF lleva marca de agua y no se guardó. Se dice en ámbar y se queda en
          // pantalla, no como un «listo».
          toast.warning(aviso ?? 'PDF de borrador: no se puede enviar.', { duration: Infinity, closeButton: true })
        } else {
          toast.success('PDF descargado')
          // Almacenamiento externo: el PDF se descargó pero no quedó guardado en el
          // proyecto del cliente. El servidor dice por qué; aquí solo se muestra.
          if (aviso) toast.error(aviso)
        }
        // §4.3 · qué cubre cada opción. Sale AQUÍ y no solo en el banner porque quien
        // imprime no siempre es quien cargó: el PDF ya salió (avisa, no bloquea) y el
        // aviso se queda en pantalla hasta que alguien lo cierre.
        for (const a of (res as { avisosCobertura?: string[] }).avisosCobertura ?? []) {
          toast.warning(a, { duration: Infinity, closeButton: true })
        }
        // Brief del 2026-09-22 · líneas con el pantallazo de otros pasajeros. El PDF salió
        // como borrador (marca de agua, sin guardar); cada línea dice qué la dejó vieja.
        for (const a of (res as { avisosCaptura?: string[] }).avisosCaptura ?? []) {
          toast.error(`Pantallazo desactualizado en ${a}`, { duration: Infinity, closeButton: true })
        }
        // Un borrador de ONE sin revisar no sale en el PDF. Avisa, no bloquea: el PDF ya
        // salió con el texto de siempre.
        const avisoTexto = (res as { avisoTexto?: string | null }).avisoTexto
        if (avisoTexto) toast.warning(avisoTexto, { duration: 10000, closeButton: true })
      } else {
        toast.error(res.error || 'Error generando PDF')
      }
    })
  }

  /**
   * En el flujo de viaje los nombres se GUARDAN en mayúscula (ver `mayusculas.ts`): el
   * nombre de una línea sale impreso al cliente y distingue una alternativa de otra, así
   * que se escribe una sola vez ya convertido y no se maquilla en cada superficie.
   */
  const comoSeGuarda = (texto: string) => (lineasPorTipo ? aMayusculas(texto) : texto)

  const handleAddItem = () => {
    if (!newItemName.trim()) return
    startTransition(async () => {
      const res = await addItem(cotizacion.id, comoSeGuarda(newItemName))
      if (res.success) {
        setNewItemName('')
        // El campo de «Otro» se cierra al agregar: dejarlo abierto con el texto ya
        // consumido invita a volver a darle al botón sobre un campo vacío.
        setMostrarOtro(false)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  // «+ Vuelo», «+ Hotel»…: la línea nace con su grupo y un nombre provisional (la etiqueta),
  // y ABIERTA, para que se vea la casilla del pantallazo. Al confirmar el costo, el nombre
  // leído reemplaza al provisional (`nombre-linea.ts`).
  /**
   * «+ Vuelo» sobre una cotización que YA tiene un vuelo crea **Vuelo 2**, otra ranura
   * que SUMA. Antes creaba una línea en la misma ranura, o sea una opción que compite, y
   * era el error silencioso que costó el tramo a Providencia: el PDF salía sin él.
   *
   * La ranura que compite sigue existiendo y tiene su propio botón dentro de la línea
   * («Agregar otra opción de vuelo»). Son dos cosas distintas y ahora hay un botón para
   * cada una.
   */
  const handleAddItemDeGrupo = (g: { grupo: string; label: string; ranura: string }) => {
    startTransition(async () => {
      const def = ranuraPorSlug(g.ranura)
      // El grupo se calcula con lo que hay EN PANTALLA porque es lo mismo que el servidor
      // vería: `addItem` no puede resolverlo por su cuenta sin releer la cotización, y el
      // peor caso de una carrera (dos «+ Vuelo» a la vez) es que las dos caigan en la
      // misma ranura — visible y corregible desde el grupo de la línea.
      const grupo = def
        ? siguienteGrupoDeTipo(def, initialItems.map(i => i.grupo ?? null))
        : g.grupo
      // El provisional también se guarda en mayúscula, para que la lista no alterne
      // «Vuelo» con «LATAM BOGOTÁ–PUNTA CANA». `esNombreDeRelleno` normaliza a
      // minúscula antes de comparar, así que sigue reconociéndolo como relleno.
      const res = await addItem(cotizacion.id, comoSeGuarda(nombreProvisionalDeGrupo(g.label)), undefined, undefined, grupo)
      if (res.success && 'id' in res && res.id) {
        const nuevoId = res.id
        setExpandedItems(prev => new Set(prev).add(nuevoId))
        router.refresh()
      } else {
        toast.error('error' in res ? res.error : 'No se pudo agregar la línea')
      }
    })
  }

  const handleDeleteItem = (itemId: string) => {
    startTransition(async () => {
      const res = await deleteItem(itemId)
      if (res.success) {
        await recalcularTotales(cotizacion.id)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleAddRubro = (itemId: string) => {
    startTransition(async () => {
      const res = await addRubro(itemId, {
        tipo: newRubro.tipo,
        descripcion: newRubro.descripcion || undefined,
        cantidad: Number(newRubro.cantidad),
        unidad: newRubro.unidad,
        valor_unitario: Number(newRubro.valor_unitario),
      })
      if (res.success) {
        await recalcularTotales(cotizacion.id)
        setAddingRubroFor(null)
        setNewRubro({ tipo: 'mo_propia', descripcion: '', cantidad: '1', unidad: 'horas', valor_unitario: '' })
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const startEditRubro = (r: RubroRow, itemId: string) => {
    setEditingRubroId(r.id)
    setAddingRubroFor(itemId)
    setNewRubro({
      tipo: r.tipo ?? 'mo_propia',
      descripcion: r.descripcion ?? '',
      cantidad: r.cantidad?.toString() ?? '1',
      unidad: r.unidad ?? 'horas',
      valor_unitario: r.valor_unitario?.toString() ?? '',
    })
  }

  const handleUpdateRubro = (rubroId: string) => {
    startTransition(async () => {
      const res = await updateRubro(rubroId, {
        tipo: newRubro.tipo,
        descripcion: newRubro.descripcion?.trim() || null,
        cantidad: Number(newRubro.cantidad),
        unidad: newRubro.unidad,
        valor_unitario: Number(newRubro.valor_unitario),
      })
      if (res.success) {
        await recalcularTotales(cotizacion.id)
        setAddingRubroFor(null)
        setEditingRubroId(null)
        setNewRubro({ tipo: 'mo_propia', descripcion: '', cantidad: '1', unidad: 'horas', valor_unitario: '' })
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDeleteRubro = (rubroId: string) => {
    startTransition(async () => {
      const res = await deleteRubro(rubroId)
      if (res.success) {
        await recalcularTotales(cotizacion.id)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  // El margen de la cotización, con el default de la línea de negocio como respaldo:
  // una cotización recién creada todavía no tiene el suyo, y sin este respaldo el pie
  // mostraría 0% sobre un negocio que sí tiene margen configurado.
  const margenCotizacion = cotizacion.margen_porcentaje ?? Number(cotizacion.margen_default_pct) ?? 0

  // Los números de la cotización salen de la MISMA cascada que aplica el servidor al
  // guardar. Calcularlos aquí por separado fue exactamente el defecto anterior: la
  // pantalla mostraba un total y la base guardaba otro.
  const paraCascada = initialItems.map(item => {
    const rubros = item.rubros ?? []
    return {
      id: item.id,
      es_ajuste: item.es_ajuste,
      cantidad: item.cantidad,
      subtotal: item.subtotal,
      // R-P1 · los SUGERIDOS no entran al costo hasta que alguien confirme.
      ...costoDeRubrosConfirmados(rubros),
      descuento_porcentaje: item.descuento_porcentaje,
      margen_porcentaje: item.margen_porcentaje,
      precio_venta: item.precio_venta,
      precio_manual: item.precio_manual,
    }
  })
  const paramsCascada = {
    administrativosPct: (Number(cotizacion.aiu_admin_pct) || 0) + (Number(cotizacion.aiu_imprevistos_pct) || 0),
    margenPct: margenCotizacion,
    descuentoComercialPct: cotizacion.descuento_porcentaje,
    convencionMargen,
  }

  // Por LÍNEA: sobre todas, porque una alternativa que no aporta al total igual
  // necesita su precio — es el número con el que se la compara contra la otra.
  const cascada = calcularCascada(paraCascada, paramsCascada)

  // R-A1 · el TOTAL suma cada ranura una sola vez. Es el mismo helper y la misma
  // cascada que aplica `recalcularTotales` al guardar: si la pantalla tuviera su
  // propia regla, el total de arriba y el de la base volverían a discrepar, que fue
  // exactamente el defecto que obligó a compartir `calcularCascada`.
  const itemsParaRanuras = initialItems.map(i => ({
    id: i.id,
    grupo: i.grupo ?? null,
    opcion_de: i.opcion_de ?? null,
    es_ajuste: i.es_ajuste ?? false,
    orden: i.orden ?? 0,
    // El segundo interruptor: una sugerencia fuera del precio no aporta al total.
    // Sin estos dos, la pantalla sumaría lo que `recalcularTotales` ya no suma.
    dia_relativo: i.dia_relativo ?? null,
    entra_al_precio: i.entra_al_precio ?? null,
  }))
  /**
   * Con principal, la decisión está tomada y el total sale de ÉL (R5): no hay supuesto
   * que anunciar, y el pie tiene que mostrar su precio. Antes mostraba la suma de
   * todas las líneas mientras la base guardaba la del principal — dos cifras del
   * mismo dinero en la misma pantalla.
   *
   * La tabla de combinaciones ya avisa el caso «itinerarios armados y ninguno
   * principal», así que el aviso de abajo solo cubre el hueco que quedaba:
   * alternativas cargadas y NINGUNA combinación construida.
   */
  const seleccionPrincipal = (itinerarios?.itinerarios ?? []).find(i => i.esPrincipal)?.seleccion ?? null
  const hayPrincipal = seleccionPrincipal !== null

  const aportanAlTotal = new Set(
    seleccionPrincipal
      ? itemsDelItinerario(itemsParaRanuras, seleccionPrincipal)
      : itemsQueAportanAlTotal(itemsParaRanuras),
  )
  const cascadaTotal = calcularCascada(
    paraCascada.filter(i => aportanAlTotal.has(i.id) || i.es_ajuste === true),
    paramsCascada,
  )
  /**
   * Los supuestos que TODAVÍA aplican.
   *
   * Un supuesto de vuelo u hotel se levanta marcando un itinerario principal, así que
   * con principal desaparece. El de un tour o un traslado **no se levanta nunca**: esos
   * grupos no abren columna en la tabla (decisión del 2026-09-14) y nadie va a elegir
   * por ellos, así que el aviso se queda mientras haya dos alternativas cargadas. Sin
   * esa distinción, marcar la principal ocultaría un supuesto que sigue decidiendo qué
   * traslado se cobra.
   */
  /**
   * Regla 2 · en qué estado está el recargo fijo de esta cotización.
   *
   * Se deriva de lo que hay en pantalla, no se guarda: un estado guardado quedaría
   * contradiciendo la línea el día que alguien le cambie el precio, que es justo el
   * caso que esto existe para hacer visible.
   */
  const recargo = estadoDelRecargo(
    initialItems.map(i => ({
      id: i.id,
      nombre: i.nombre,
      grupo: i.grupo ?? null,
      precio_venta: i.precio_venta,
      cantidad: i.cantidad,
      es_ajuste: i.es_ajuste ?? false,
      // De dónde a dónde va el vuelo, para cuando el recargo aplica solo a internacionales.
      tarifa_pax: i.tarifa_pax,
    })),
    politicaRecargo,
  )

  /**
   * El IVA sobre el INGRESO PROPIO (`iva-cotizacion.ts`, regla de Felipe del 2026-09-22).
   *
   * Solo donde el workspace lo declara. Sale de la MISMA cascada que la pantalla ya
   * muestra, con las mismas funciones que usan el PDF y «Aprobar»: por eso las tres
   * superficies dicen la misma cifra. `ivaPorLinea` cubre todas las líneas (también las
   * alternativas, que necesitan su marca); `ivaVigente`, lo que la cotización cobra hoy.
   *
   * Con la base apagada las dos quedan en `null` y el resumen fiscal es el de siempre.
   *
   * `ivaAdentro`: el workspace cotiza con el IVA DENTRO del precio (`precio: 'iva_incluido'`).
   * El cliente paga lo mismo; el IVA se saca de lo que gana la agencia en vez de sumarse.
   */
  const configIvaEfectiva = configIva ?? CONFIG_IVA_POR_DEFECTO
  const conIvaSobreIngresoPropio = ivaSobreIngresoPropio(configIvaEfectiva)
  const ivaAdentro = conIvaSobreIngresoPropio && ivaIncluidoEnElPrecio(configIvaEfectiva)
  const recargoId = conIvaSobreIngresoPropio
    ? lineaDeRecargo(initialItems.map(i => ({ id: i.id, nombre: i.nombre, es_ajuste: i.es_ajuste ?? false })), politicaRecargo)?.id ?? null
    : null
  const itemPorIdParaIva = new Map(initialItems.map(i => [i.id, i]))
  const metaIva = (id: string): MetaDeLineaParaIva | undefined => {
    const item = itemPorIdParaIva.get(id)
    if (!item) return undefined
    return {
      nombre: item.nombre,
      baseIva: esBaseIvaLinea(item.base_iva) ? item.base_iva : null,
      esDeLaAgencia: item.id === recargoId || item.es_ajuste === true,
    }
  }
  const opcionesIva = {
    tarifaPct: tarifaIvaDelVendedor(fiscalProfile),
    descuentoComercialPct: cotizacion.descuento_porcentaje,
    precio: configIvaEfectiva.precio,
  }
  const ivaPorLinea = conIvaSobreIngresoPropio
    ? new Map(liquidarIva(lineasParaIva(cascada.lineas, metaIva), opcionesIva).lineas.map(l => [l.id, l]))
    : null
  const ivaVigente = conIvaSobreIngresoPropio
    ? liquidarIva(lineasParaIva(cascadaTotal.lineas, metaIva), opcionesIva)
    : null

  const supuestos = ranurasPorSupuesto(itemsParaRanuras).filter(s => s.combinable ? !hayPrincipal : true)
  const hayCombinable = supuestos.some(s => s.combinable)
  const nombrePorItem = new Map(initialItems.map(i => [i.id, i.nombre ?? 'Sin nombre']))

  /**
   * §4.3 · ¿Las opciones de una ranura cubren lo mismo?
   *
   * El aviso NO depende de que haya o no itinerario principal: el daño que para es
   * cargar como opción un tramo que en realidad se suma, y eso ya está mal desde antes
   * de que alguien arme una combinación. Avisa, no bloquea: dos opciones distintas
   * pueden ser legítimas y quien decide es la persona.
   */
  /**
   * Las líneas con el pantallazo o el costo de OTROS pasajeros (brief del 2026-09-22).
   *
   * El cambio que las deja viejas casi nunca pasa aquí: pasa en el negocio, cuando alguien
   * corrige los pasajeros del viaje. Por eso el aviso va arriba y nombra cada línea: con la
   * lista cerrada, la alerta de cada una no se ve.
   *
   * Y mientras haya alguna, «Enviar» se deshabilita con `motivoEnvio` (decisión de Mauricio
   * del 2026-09-22). Es el MISMO texto con que el servidor rechaza el envío
   * (`captura-desactualizada-datos.ts`): el botón es solo la puerta visible, el control es
   * del servidor. El PDF se descarga, pero sale como borrador con marca de agua.
   */
  const desactualizadas = lineasDesactualizadas(
    initialItems.map(i => ({
      id: i.id,
      nombre: i.nombre ?? null,
      grupo: i.grupo ?? null,
      es_ajuste: i.es_ajuste ?? false,
      tarifa_pax: i.tarifa_pax,
    })),
    composicionViaje,
  )
  const motivoEnvio = motivoParaNoEnviar(desactualizadas)

  const avisosCobertura = avisosDeCobertura(
    initialItems.map(i => ({
      id: i.id,
      nombre: i.nombre ?? null,
      grupo: i.grupo ?? null,
      opcion_de: i.opcion_de ?? null,
      es_ajuste: i.es_ajuste ?? false,
      orden: i.orden ?? 0,
      dia_relativo: i.dia_relativo ?? null,
      entra_al_precio: i.entra_al_precio ?? null,
      tarifa_pax: i.tarifa_pax,
    })),
  )

  /**
   * El DÍA: un solo interruptor para dos superficies del documento.
   *
   * Mientras nadie asigne un día, `porDias` es `false` y nada de esto existe: ni
   * sección de itinerario, ni paquete de sugeridos, ni aviso. El PDF sale como hoy.
   */
  const itemsParaDia = initialItems.map(i => ({
    id: i.id,
    grupo: i.grupo ?? null,
    dia_relativo: i.dia_relativo ?? null,
    mostrar_en_sugeridos: i.mostrar_en_sugeridos ?? null,
    entra_al_precio: i.entra_al_precio ?? null,
    es_ajuste: i.es_ajuste ?? false,
    orden: i.orden ?? 0,
    precio_venta: i.precio_venta ?? 0,
    cantidad: i.cantidad ?? 1,
  }))
  const porDias = hayDiasAsignados(itemsParaDia)
  const idsSugeridos = new Set(itemsSugeridos(itemsParaDia))

  /**
   * ⚠️⚠️ EL AVISO DE DINERO, y es el punto de plata del frente.
   *
   * Una línea sin día, con grupo no combinable y con precio se imprime en el PDF como
   * «actividad adicional NO INCLUIDA» mientras está sumando al total que el cliente
   * paga. El documento dice una cosa y la factura cobra otra, y lo ve el cliente.
   *
   * No se arregla solo ni se bloquea en silencio: se nombra, con su plata, y con las
   * dos salidas. Descontarlo aquí le cambiaría el precio a una cotización que alguien
   * ya revisó; bloquear el PDF dejaría a la comercial sin saber qué mover.
   *
   * Se alimenta de `aportanAlTotal`, que es el MISMO juego que escribe `valor_total`:
   * una alternativa que la ranura ya descartó no la está pagando nadie y no avisa.
   */
  const avisoSugeridos = avisoSugeridosQueCobran(itemsParaDia, aportanAlTotal)
  const plataEnAviso = avisoSugeridos.reduce((s, a) => s + a.precioLinea, 0)

  const lineaPorItem = new Map(cascada.lineas.map(l => [l.id, l]))
  const costoTotal = cascadaTotal.costoDirecto

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => backUrl ? router.push(backUrl) : router.back()}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">{cotizacion.codigo || cotizacion.consecutivo || 'Sin codigo'}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estadoConfig?.chipClass}`}>
              {estadoConfig?.label}
            </span>
          </div>
          {/* El nombre con el que se distingue esta variante de las otras del mismo
              negocio. Vacío es válido: la lista cae a la etiqueta genérica del modo. */}
          {editable ? (
            <input
              type="text"
              defaultValue={cotizacion.descripcion ?? ''}
              placeholder="Nombre de esta cotización (ej. España, 7 días)"
              maxLength={120}
              aria-label="Nombre de esta cotización"
              className="mt-0.5 w-full truncate border-0 bg-transparent p-0 text-xs text-muted-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0"
              onBlur={e => {
                // Se guarda null y no cadena vacía: el vacío tiene que llegar a la
                // base de UNA sola forma, o la lista pinta un nombre en blanco.
                const nombre = comoSeGuarda(e.target.value.trim()) || null
                // La casilla pinta lo que se guardó. Sin esto el campo queda con lo
                // tecleado y la base con otra cosa: una pantalla sana que miente.
                e.target.value = nombre ?? ''
                if (nombre === (cotizacion.descripcion ?? null)) return
                startTransition(async () => {
                  const res = await updateCotizacion(cotizacion.id, { descripcion: nombre })
                  if (res.success) router.refresh()
                  else toast.error(res.error)
                })
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            />
          ) : (
            nombreMostrable(cotizacion.descripcion) && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {nombreMostrable(cotizacion.descripcion)}
              </p>
            )
          )}
        </div>
        <div className="flex gap-1.5">
          {editable && (
            <button
              onClick={handleEnviar}
              disabled={isPending || motivoEnvio !== null}
              title={motivoEnvio ?? undefined}
              aria-describedby={motivoEnvio ? 'aviso-captura-desactualizada' : undefined}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3 w-3" />
              Enviar
            </button>
          )}
          <button
            onClick={handleDescargarPDF}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <FileDown className="h-3 w-3" />
            PDF
          </button>
          {textoCliente && (
            <button
              type="button"
              onClick={() => setVerTextoCliente(v => !v)}
              aria-expanded={verTextoCliente}
              className={`relative inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent ${verTextoCliente ? 'bg-accent' : ''}`}
            >
              <FileText className="h-3 w-3" />
              Texto
              {estadoDelTexto(textoCliente.documento) === 'borrador' && (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500" aria-label="Borrador sin revisar" />
              )}
            </button>
          )}
          <button
            onClick={handleDuplicar}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Copy className="h-3 w-3" />
            Duplicar
          </button>
        </div>
      </div>

      <PanelMargenSalida cotizacionId={cotizacion.id} salida={salida} />

      {textoCliente && verTextoCliente && (
        <DocumentoClientePanel cotizacionId={cotizacion.id} inicial={textoCliente} />
      )}

      {frozen && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 dark:bg-blue-950/20 dark:border-blue-900/30 dark:text-blue-300">
          <Lock className="h-4 w-4 shrink-0" />
          Esta cotización está congelada porque ya hay una cotización aprobada en este negocio.
        </div>
      )}

      {!editable && !frozen && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <Lock className="h-4 w-4" />
          Esta cotización está en estado <strong>{estadoConfig?.label}</strong> y no se puede editar. Puedes duplicarla.
        </div>
      )}

      {/* Brief del 2026-09-22 · el precio de estas líneas no corresponde a los pasajeros de
          hoy. En borrador, se reemplaza el pantallazo; fuera de borrador la regla de
          Mauricio es otra cotización, y el aviso lo dice así. */}
      {desactualizadas.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {desactualizadas.length === 1
              ? 'Una línea tiene el pantallazo de otros pasajeros: su precio no corresponde al viaje de hoy.'
              : `${desactualizadas.length} líneas tienen el pantallazo de otros pasajeros: su precio no corresponde al viaje de hoy.`}
          </p>
          <ul className="mt-1.5 space-y-1 pl-5">
            {desactualizadas.map(l => (
              <li key={l.itemId}>
                <span className="font-medium">«{l.nombre}»</span>: {l.motivos.join(' ')}
              </li>
            ))}
          </ul>
          <p id="aviso-captura-desactualizada" className="mt-1.5 pl-5">
            {editable
              ? `${motivoEnvio} Hasta entonces no se puede enviar ni aprobar, y el PDF sale como borrador, con la marca «${etiquetaDeMotivo('pantallazos')}».`
              : 'Esta cotización ya no se edita: duplícala para cotizar con los pasajeros de hoy.'}
          </p>
        </div>
      )}

      {/* Items editor */}
      <div className="space-y-3">
          {/* Abrir o cerrar todos los items de una. Con una cotizacion larga, abrir
              uno por uno para ver los costos es el trabajo entero. El boton dice la
              accion que va a ejecutar, no el estado en que esta. */}
          {itemsVisibles.length > 1 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={toggleTodos}
                className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
              >
                {todosExpandidos ? (
                  <><ChevronRight className="h-3 w-3" /> Contraer todo</>
                ) : (
                  <><ChevronDown className="h-3 w-3" /> Expandir todo</>
                )}
              </button>
            </div>
          )}
          {/* Items */}
          {initialItems.filter(i => !i.es_ajuste).map(item => {
            const itemCantidad = Number(item.cantidad) || 1
            const itemPrecio = Number(item.precio_venta) || 0
            const itemDescPct = Number(item.descuento_porcentaje) || 0
            const isAjuste = item.es_ajuste === true
            const isNegativo = itemPrecio < 0
            // El segundo interruptor. `esFueraDelPrecio` es la regla completa (la misma
            // que saca la línea del total); `puedeSalirDelPrecio` dice si el interruptor
            // tiene sentido en esta línea: una sugerencia, o sea grupo no combinable y
            // sin día. En cualquier otra línea no se ofrece, porque el servidor lo
            // rechazaría.
            const lineaDelInterruptor = {
              id: item.id,
              grupo: item.grupo ?? null,
              es_ajuste: item.es_ajuste ?? false,
              dia_relativo: item.dia_relativo ?? null,
              entra_al_precio: item.entra_al_precio ?? null,
            }
            const esFueraDelPrecio = fueraDelPrecio(lineaDelInterruptor)
            const puedeSalirDelPrecio =
              puedeSerSugerido(lineaDelInterruptor) && diaDeItem(lineaDelInterruptor) === null
            const rubrosConfirmados = soloConfirmados(item.rubros ?? [])
            const rubrosSugeridos = soloSugeridos(item.rubros ?? [])
            const tieneRubros = rubrosConfirmados.length > 0
            const costoUnitario = rubrosConfirmados.reduce((s: number, r: RubroRow) => s + (r.valor_total ?? 0), 0)
            // Costo del ítem que no se desglosa: vive en `subtotal`, escrito a mano.
            const costoManual = tieneRubros ? 0 : Number(item.subtotal) || 0
            const costoDelItem = tieneRubros ? costoUnitario : costoManual
            // La línea ya calculada por la cascada. Es la misma que guarda el servidor.
            const linea = lineaPorItem.get(item.id)
            const costoLinea = linea?.costoLinea ?? 0
            // El costo con su parte de los administrativos: es contra ESTE número contra
            // el que la cascada aplica el margen, así que es contra el que hay que
            // despejarlo cuando alguien escribe el precio al cliente. Usar `costoLinea`
            // pelado daría un margen que no reproduce el precio pedido.
            const costoDeVentaLinea = linea?.costoDeVentaLinea ?? 0
            const precioLinea = linea?.precioLinea ?? Math.round(itemPrecio * itemCantidad)
            // El margen propio es una EXCEPCIÓN declarada, no un campo vacío: `null`
            // quiere decir "usa el de la cotización", y 0 quiere decir "esta línea va
            // a costo". Leer los dos como 0 borraría la diferencia.
            const margenPropio = item.margen_porcentaje !== null && item.margen_porcentaje !== undefined
            const itemMargen = linea?.margenAplicado ?? margenCotizacion
            const precioFijadoAMano = item.precio_manual === true || (costoLinea <= 0 && itemPrecio > 0)
            // Cuándo esta línea tiene algo propio que contar. Si no, su precio es el
            // reflejo del margen general y no aporta nada repetirlo aquí.
            const lineaDecideSuPrecio = margenPropio || precioFijadoAMano
            // El margen REAL de la línea sale de la cascada, no se recalcula aquí: es
            // la misma aritmética que aplica el servidor al guardar, y ya trae la parte
            // de los administrativos que le toca a esta línea.
            const margenRealPct = linea?.margenRealPct ?? null
            const margenTexto = formatMargenPct(margenRealPct)
            // Ni bloquean ni avisan lo mismo: bajo el piso es ROJO, entre piso y aviso
            // es ámbar. Ninguno de los dos frena el envío — el rechazo en servidor
            // llega con los itinerarios.
            const nivelMargen = nivelDeMargen(margenRealPct, umbrales)
            // Lo que se leyó del pantallazo de esta línea. Se resuelve ANTES del origen del
            // margen porque el origen depende de lo que la captura haya fijado.
            const tarifaDelItem = leerTarifaPax(item.tarifa_pax)
            // El margen que puso el pantallazo, si esta línea se costeó con uno que traía
            // los dos precios. Vive en `items.tarifa_pax` desde que se confirmó, así que
            // sobrevive a cualquier edición posterior del margen: es el único número que
            // permite decir «me moví tanto de lo que el proveedor me daba».
            const margenDelPantallazo = tarifaDelItem.confirmada?.margenProveedor
              ? margenDeLineaSegunConvencion(tarifaDelItem.confirmada.margenProveedor, convencionMargen)
              : null
            const margenEscrito = margenPropio ? Number(item.margen_porcentaje) : null
            const origenMargen = origenDelMargen({
              margenPropio,
              precioManual: precioFijadoAMano,
              margenDelPantallazo,
              margenActual: margenEscrito,
            })
            // El número del pantallazo se enseña al lado del editado, nunca en su lugar.
            // Solo cuando difieren: repetirlo idéntico haría dudar de si son dos cifras.
            const pantallazoDecia = margenDelPantallazo !== null && origenMargen !== 'proveedor'
              ? formatMargenPct(margenDelPantallazo)
              : null
            // La ranura de captura se DERIVA del grupo. `null` es respuesta legítima
            // y frecuente: el método día a día y los componentes propios no tienen
            // contrato de pantallazo y se costean a mano, como hoy.
            const ranuraDeItem = ranuraDeGrupo(item.grupo)
            // El precio por pasajero de la línea (P6): el precio que ya calculó la
            // cascada, repartido en proporción al costo confirmado de cada tipo. Solo si
            // ese costo sigue siendo el de la línea: si alguien editó los rubros después,
            // el reparto describiría otra versión.
            // Tampoco si la confirmación es de OTROS pasajeros u otra moneda (brief del
            // 2026-09-22): repartir entre 2 adultos un precio que la línea ya dice que es
            // para 3 es exactamente el precio mal que la alerta de la línea denuncia.
            const precioPorPax = tarifaDelItem.confirmada
              && confirmadaVigente(tarifaDelItem.confirmada, costoUnitario)
              && !confirmacionDesactualizada(tarifaDelItem, composicionDeLinea(tarifaDelItem, composicionViaje))
              ? precioPorPasajero(tarifaDelItem.confirmada, precioLinea / itemCantidad)
              : null

            // EL BOTÓN DICE LO QUE HACE (§4.2). Se llamaba «Agregar alternativa a esta
            // línea», y «alternativa» no dice ninguna de las dos cosas que importan: que
            // COMPITE y que solo una entra al precio. Con la ranura resuelta el botón la
            // nombra («otra opción de vuelo»), que es el vocabulario con el que la persona
            // está pensando. Dónde se pinta lo decide el flujo (§2.2), no este bloque.
            const botonOtraOpcion = (
              <>
                {/* La opción nace VACÍA de costo: es otro proveedor, no una variante del
                    mismo precio. Copiarle los rubros dejaría a WINGO costando lo que
                    AVIANCA sin que se note. */}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => {
                      const res = await agregarOpcionAItem(item.id, '')
                      if (!res.success) { toast.error(res.error); return }
                      toast.success(`Otra opción en «${res.grupo}». Solo una entra al precio: cárgale su costo.`)
                      router.refresh()
                    })
                  }}
                  className="flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" />
                  {ranuraDeItem
                    ? `Agregar otra opción de ${ranuraDeItem.label.toLowerCase()}`
                    : 'Agregar otra opción a esta línea'}
                </button>
                {/* El apaño de la §6 del diseño, y es requisito mientras una opción no
                    pueda tener varias líneas que sumen (§4.1, sin construir): el segundo
                    tramo de un mismo viaje NO va aquí. Cargado como opción, el motor se
                    queda con uno solo y el PDF sale sin el otro — con el precio incompleto
                    y buen aspecto. */}
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Solo una opción entra al precio final. Las demás quedan para comparar.
                  {' '}Un tramo adicional del mismo viaje no es una opción: va como componente aparte.
                </p>
              </>
            )

            return (
            <div key={item.id} className={`rounded-lg border ${isAjuste ? 'border-amber-200 bg-amber-50/30' : ''}`}>
              <div
                className={`flex ${isAjuste ? '' : 'cursor-pointer'} items-center justify-between px-4 py-3`}
                onClick={() => !isAjuste && toggleItem(item.id)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {!isAjuste && (expandedItems.has(item.id) ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />)}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{item.nombre || 'Item sin nombre'}</span>
                      {isAjuste && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Auto</span>
                      )}
                      {/* La ranura, visible sin abrir la linea: con nueve lineas en
                          pantalla, saber cuales compiten entre si es la unica forma de
                          leer la lista. «opción» se dice aparte porque una opcion
                          no se suma al total salvo que un itinerario la elija.
                          ⚠️ Se pinta la ETIQUETA de la ranura, no el grupo crudo: con dos
                          vuelos, «vuelo» y «vuelo 2: san andrés a providencia» se leen
                          como dos cosas sin relación, y el chip existe justo para que se
                          vea de un vistazo cuáles son del mismo tipo y cuáles compiten. */}
                      {!isAjuste && item.grupo && (
                        <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {etiquetaDeRanura(item.grupo)}{item.opcion_de ? ' · opción' : ''}
                        </span>
                      )}
                      {/* El día y la sugerencia, visibles SIN abrir la línea: con nueve
                          líneas en pantalla, en qué sección del documento sale cada una
                          es justo lo que hay que poder leer de un vistazo. Solo se
                          pintan cuando la cotización ya usa días, para no meterle ruido
                          a una cotización que no es un viaje. */}
                      {!isAjuste && porDias && item.dia_relativo != null && (
                        <span className="inline-flex items-center rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                          Día {item.dia_relativo}
                        </span>
                      )}
                      {!isAjuste && idsSugeridos.has(item.id) && (
                        <span
                          title={
                            esFueraDelPrecio
                              ? 'Se imprime al final como actividad adicional no incluida, con su precio a la vista. No suma al total.'
                              : 'Sin día: se imprime al final como actividad adicional no incluida'
                          }
                          className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          Sugerida{esFueraDelPrecio ? ' · fuera del precio' : ''}{item.mostrar_en_sugeridos === false ? ' · oculta' : ''}
                        </span>
                      )}
                      {!isAjuste && costoDelItem === 0 && (
                        <span
                          title="Este item no tiene costo, así que no suma al costo total ni deja medir margen"
                          className="inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          Sin costo
                        </span>
                      )}
                    </div>
                    {!isAjuste && (item.descripcion || costoDelItem > 0) && (
                      <span className="text-[10px] text-muted-foreground truncate block">
                        {costoDelItem > 0 && <span>Costo unit. {formatCOP(costoDelItem)}</span>}
                        {costoDelItem > 0 && item.descripcion && <span> · </span>}
                        {item.descripcion}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    {itemCantidad > 1 && (
                      <span className="text-[10px] text-muted-foreground mr-1">{itemCantidad} x</span>
                    )}
                    <span className={`text-xs font-medium ${isNegativo ? 'text-red-600' : ''} ${esFueraDelPrecio ? 'text-muted-foreground' : ''}`}>{formatCOP(precioLinea)}</span>
                    {/* Fuera del precio la cifra sigue a la vista (es la que el cliente
                        lee en el documento), pero se dice que no suma: una columna de
                        precios donde una no cuenta, sin decirlo, se lee mal. */}
                    {esFueraDelPrecio && (
                      <span className="block text-[10px] text-muted-foreground">No suma al total</span>
                    )}
                    {/* El descuento del ítem ya está dentro del costo: repetirlo aquí
                        como rebaja del precio lo contaría dos veces. */}
                    {!isAjuste && costoLinea > 0 && (
                      <span className="block text-[10px] text-muted-foreground">Costo {formatCOP(costoLinea)}</span>
                    )}
                    {/* El margen de la línea, SIEMPRE que se pueda medir — también
                        cuando lo hereda de la cotización. Antes solo aparecía en las
                        líneas con excepción propia, así que armar un viaje entero sin
                        una sola excepción dejaba la pantalla sin un solo margen a la
                        vista: exactamente lo que hay que poder ver mientras se arma. */}
                    {!isAjuste && margenTexto && (
                      <span
                        className={`block text-[10px] font-medium tabular-nums ${claseNivelMargen(nivelMargen)}`}
                        title={tituloNivelMargen(nivelMargen, umbrales, origenMargen, pisoBloqueaAvance)}
                      >
                        Margen {margenTexto}
                      </span>
                    )}
                    {/* Precio sin costo con el IVA sobre el ingreso propio: no se inventa
                        una base. Se dice en la línea, que es donde se arregla. */}
                    {!isAjuste && !esFueraDelPrecio && ivaPorLinea?.get(item.id)?.sinCosto && (
                      <span className="block text-[10px] font-medium text-amber-700">{TEXTO_IVA_SIN_CALCULAR}</span>
                    )}
                  </div>
                  {editable && !isAjuste && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteItem(item.id) }}
                      className="rounded p-1 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {!isAjuste && expandedItems.has(item.id) && (
                <div className="border-t px-4 pb-3 pt-2">
                  {/* La FICHA de la línea: cómo se llama, en qué ranura compite y en
                      qué unidad se vende.

                      · El NOMBRE no tenía input en ninguna parte: se pintaba como
                        texto en el encabezado. Una alternativa nace llamándose
                        «Vuelo BOG-PUJ (alternativa)» y no había forma de renombrarla a
                        «WINGO», que es justo lo que distingue una opción de otra en la
                        tabla de combinaciones y en el PDF. Va aquí y no en el
                        encabezado porque ese renglón alterna la línea al hacer clic.
                      · El GRUPO pasa de texto libre a lista: ver `SelectorRanura`. */}
                  {editable && (
                    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="col-span-2">
                        <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                          Nombre de la línea
                        </label>
                        <input
                          type="text"
                          defaultValue={item.nombre ?? ''}
                          placeholder="AVIANCA BOG–PUJ, Hard Rock Punta Cana…"
                          maxLength={200}
                          aria-label="Nombre de la línea"
                          className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                          onBlur={e => {
                            const val = comoSeGuarda(e.target.value.trim())
                            // La casilla pinta lo que se guardó (ver `comoSeGuarda`).
                            e.target.value = val
                            if (val === (item.nombre ?? '')) return
                            startTransition(async () => {
                              const res = await updateItem(item.id, { nombre: val })
                              if (!res.success) { toast.error(res.error); return }
                              router.refresh()
                            })
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Es lo que distingue una alternativa de otra y lo que imprime el PDF
                        </p>
                      </div>
                      {/* EL GRUPO ya lo fijó el botón que se apretó («+ Vuelo») y el chip
                          del encabezado lo repite. En el flujo de viaje deja la primera
                          fila y pasa a una acción secundaria: volver a preguntarlo en cada
                          línea es preguntar lo que el sistema ya sabe. Fuera de ese flujo
                          (Termotech, Arca, WMC) el campo se queda donde estaba. */}
                      {!lineasPorTipo && (
                        <SelectorRanura
                          valor={item.grupo ?? null}
                          gruposEnUso={initialItems.map(i => i.grupo ?? '').filter(Boolean)}
                          disabled={isPending}
                          onCambio={val => {
                            startTransition(async () => {
                              const res = await actualizarRanuraDeItem(item.id, { grupo: val })
                              if (!res.success) { toast.error(res.error); return }
                              router.refresh()
                            })
                          }}
                        />
                      )}
                      {/* LA UNIDAD no se teclea en el flujo de viaje.
                          La escribe la propia ranura al leer el pantallazo
                          (`ranura.unidadPorDefecto`), y al confirmar la tarifa por
                          pasajero el servidor la deja en `null` a propósito: la línea es
                          el grupo y el reparto lo dicen los rubros. Teclear «pax» aquí
                          era pedir a mano un dato que el flujo escribe solo y que
                          además borra un minuto después. */}
                      {!lineasPorTipo && (
                        <div>
                          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                            Unidad
                          </label>
                          <input
                            type="text"
                            defaultValue={item.unidad ?? ''}
                            placeholder="pax, noches, trayectos…"
                            className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                            onBlur={e => {
                              const val = e.target.value.trim()
                              if (val === (item.unidad ?? '')) return
                              startTransition(async () => {
                                const res = await actualizarRanuraDeItem(item.id, { unidad: val })
                                if (!res.success) { toast.error(res.error); return }
                                router.refresh()
                              })
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          />
                          {/* La unidad se imprime TAL CUAL en la cotización: el sistema no
                              pluraliza. «5 noche» se ve mal y «1 noches» también, y adivinar
                              morfología del español sobre texto libre acierta a veces. Por eso
                              el marcador sugiere la forma en plural, que es la del caso común. */}
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            Se imprime tal cual al cliente
                          </p>
                        </div>
                      )}
                      {/* EL DÍA. Un solo interruptor: con día la línea imprime en el
                          itinerario día por día; sin día, y si declara un grupo que no
                          se combina, cae al paquete de «actividades adicionales no
                          incluidas». No hay un segundo desplegable de sección.

                          Los vuelos y hoteles no lo muestran: se comparan en la tabla
                          de combinaciones y su sitio lo decide el itinerario elegido.
                          Ofrecer un campo que el servidor va a rechazar es peor que no
                          ofrecerlo. */}
                      {puedeLlevarDia({ id: item.id, grupo: item.grupo ?? null, es_ajuste: item.es_ajuste ?? false }) && (
                        <div>
                          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                            Día del viaje
                          </label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            defaultValue={item.dia_relativo ?? ''}
                            placeholder="Sin día"
                            aria-label="Día del viaje"
                            // Fuera del precio no lleva día: con día entraría al
                            // itinerario, o sea incluida. El servidor lo rechaza, así
                            // que la pantalla no lo ofrece.
                            disabled={esFueraDelPrecio}
                            className="w-full rounded border bg-background px-2 py-1.5 text-sm disabled:opacity-60"
                            onBlur={e => {
                              const txt = e.target.value.trim()
                              const val = txt === '' ? null : Number(txt)
                              if (val === (item.dia_relativo ?? null)) return
                              startTransition(async () => {
                                const res = await actualizarDiaDeItem(item.id, { dia_relativo: val })
                                if (!res.success) { toast.error(res.error); return }
                                router.refresh()
                              })
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          />
                          {/* El día es RELATIVO: el itinerario se arma antes de que la
                              salida tenga fecha. */}
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {esFueraDelPrecio
                              ? 'Fuera del precio: márcala para que entre al precio antes de darle un día'
                              : idsSugeridos.has(item.id)
                                ? 'Sin día: sale como actividad adicional no incluida'
                                : 'Relativo a la salida (1 = primer día). Vacío = sugerida'}
                          </p>
                        </div>
                      )}
                      {/* EL SEGUNDO INTERRUPTOR: ¿entra al precio? Separa MOSTRAR el
                          precio de COBRARLO. Solo se ofrece en una sugerencia (grupo que
                          no se combina, sin día): en cualquier otra línea sacarla del
                          precio la haría desaparecer del documento sin sumar, y el
                          servidor lo rechaza. No es el check de mostrar: aquel es
                          visibilidad, este es plata, y por eso recalcula el total. */}
                      {puedeSalirDelPrecio && (
                        <label className="col-span-2 flex items-start gap-2 sm:col-span-4">
                          <input
                            type="checkbox"
                            defaultChecked={!esFueraDelPrecio}
                            disabled={isPending}
                            aria-label="Entra al precio de la cotización"
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            onChange={e => {
                              const val = e.target.checked
                              startTransition(async () => {
                                const res = await actualizarDiaDeItem(item.id, { entra_al_precio: val })
                                if (!res.success) { toast.error(res.error); return }
                                router.refresh()
                              })
                            }}
                          />
                          <span className="text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground">Entra al precio de la cotización.</span>{' '}
                            {esFueraDelPrecio
                              ? 'Fuera del precio: se ofrece con su valor a la vista y no suma ni al total, ni al costo, ni al margen.'
                              : 'Desmárcala para ofrecerla como actividad adicional: el cliente ve su precio y no suma al total.'}
                          </span>
                        </label>
                      )}
                      {/* El check de la sugerencia. Solo aparece cuando la línea ES una
                          sugerencia: un interruptor que no aplica confunde más que
                          ayudar, y aquí «no aplica» se sabe con certeza. */}
                      {idsSugeridos.has(item.id) && (
                        <label className="col-span-2 flex items-start gap-2 sm:col-span-4">
                          <input
                            type="checkbox"
                            defaultChecked={item.mostrar_en_sugeridos !== false}
                            disabled={isPending}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            onChange={e => {
                              const val = e.target.checked
                              startTransition(async () => {
                                const res = await actualizarDiaDeItem(item.id, { mostrar_en_sugeridos: val })
                                if (!res.success) { toast.error(res.error); return }
                                router.refresh()
                              })
                            }}
                          />
                          <span className="text-[11px] text-muted-foreground">
                            Mostrarla al cliente entre las actividades sugeridas.{' '}
                            {esFueraDelPrecio ? (
                              <span>Fuera del precio: oculta, ni se ve ni se cobra.</span>
                            ) : (
                              <span className="text-amber-700">
                                Ocultarla NO la saca del total: para eso, desmarca «Entra al precio».
                              </span>
                            )}
                          </span>
                        </label>
                      )}
                      {/* Fuera del flujo de viaje el botón se queda donde estaba: el
                          bloque de Termotech, Arca y WMC no cambia. */}
                      {!lineasPorTipo && <div className="col-span-2 sm:col-span-4">{botonOtraOpcion}</div>}
                      {/* MOVER LA LÍNEA A OTRA OPCIÓN. El grupo decide con quién compite:
                          es el caso raro de querer que dos líneas se comparen entre sí, y
                          por eso vive detrás de un clic en vez de en la primera fila. */}
                      {lineasPorTipo && (
                        <div className="col-span-2 sm:col-span-4">
                          {moverGrupoDe === item.id ? (
                            <SelectorRanura
                              valor={item.grupo ?? null}
                              gruposEnUso={initialItems.map(i => i.grupo ?? '').filter(Boolean)}
                              disabled={isPending}
                              onCambio={val => {
                                startTransition(async () => {
                                  const res = await actualizarRanuraDeItem(item.id, { grupo: val })
                                  if (!res.success) { toast.error(res.error); return }
                                  setMoverGrupoDe(null)
                                  router.refresh()
                                })
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setMoverGrupoDe(item.id)}
                              className="text-[10px] text-primary underline underline-offset-2 hover:opacity-80"
                            >
                              Mover a otra opción
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* El cargue de pantallazo SOLO existe si la ranura de la línea tiene
                      contrato de captura (§3.1). Un ítem sin grupo, o con un grupo propio
                      como «día-1», no lo ofrece: sin contrato el modelo devuelve lo que le
                      parezca y ese número acaba dentro de un costo. */}
                  {editable && ranuraDeItem && (
                    <TarifaPasajeroItem
                      itemId={item.id}
                      ranura={ranuraDeItem}
                      composicionViaje={composicionViaje}
                      tarifaPax={item.tarifa_pax}
                      costoUnitarioLinea={costoUnitario}
                      sugeridosGuardados={rubrosSugeridos}
                      onCambio={() => router.refresh()}
                    />
                  )}
                  {/* Los adicionales DE ESTA VARIANTE (`adicionales.ts`). Se ofrecen donde
                      se ofrece el cargue de pantallazo —líneas con ranura del catálogo—
                      porque es donde la pregunta significa algo: una línea de Termotech no
                      gana una sección al abrir su cotización, que es R6 en la pantalla.
                      ⚠️ NO se condiciona a `editable`: una cotización ya enviada tiene que
                      poder MOSTRAR sus adicionales; lo que se apaga es escribirlos. */}
                  {ranuraDeItem && (
                    <AdicionalesItem
                      itemId={item.id}
                      filas={adicionales.porItem[item.id] ?? []}
                      disponible={adicionales.disponible}
                      editable={editable}
                    />
                  )}
                  {/* Item sale fields */}
                  {editable && (
                    <div className="mb-3 space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {/* La captura de un ítem es COSTO, nada más: cuánto cuesta la
                            unidad, cuántas van, y qué descuento da el proveedor. El
                            precio no se escribe aquí, se calcula abajo con el margen.
                            Mientras costo y precio se vieron como dos casillas iguales,
                            nadie supo cuál mandaba: la cotización de la bomba quedó con
                            el precio lleno, el costo en cero y `costo_total` sin nada
                            que sumar. */}
                        <div>
                          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                            {tieneRubros ? 'Costo unit. (rubros)' : 'Costo unitario'}
                          </label>
                          {tieneRubros ? (
                            <>
                              <div className="rounded border border-dashed bg-muted/40 px-2 py-1.5 text-sm tabular-nums text-muted-foreground">
                                {formatCOP(costoUnitario)}
                              </div>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                Suma de {rubrosConfirmados.length} rubro{rubrosConfirmados.length === 1 ? '' : 's'}
                              </p>
                            </>
                          ) : lineasPorTipo ? (
                            /* En un viaje el proveedor puede cobrar en otra moneda: el costo a
                               mano la declara, COP por defecto (brief del 2026-09-22). Guarda
                               pesos en `subtotal` y anota lo escrito. Fuera del flujo de viaje,
                               la casilla en pesos de siempre. */
                            <CostoManualItem
                              itemId={item.id}
                              subtotalPesos={costoManual}
                              tarifaPax={item.tarifa_pax}
                              onCambio={() => router.refresh()}
                            />
                          ) : (
                            <>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="Costo"
                                  defaultValue={costoManual ? costoManual.toLocaleString('es-CO') : ''}
                                  onBlur={e => {
                                    const raw = e.target.value.replace(/[^0-9]/g, '')
                                    const val = Number(raw) || 0
                                    if (val === costoManual) return
                                    e.target.value = val ? val.toLocaleString('es-CO') : ''
                                    startTransition(async () => {
                                      const res = await updateItem(item.id, { subtotal: val })
                                      if (!res.success) { toast.error(res.error); return }
                                      await recalcularTotales(cotizacion.id)
                                      router.refresh()
                                    })
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                  className="w-full rounded border bg-background py-1.5 pr-2 pl-7 text-sm tabular-nums"
                                />
                              </div>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">Lo que le pagas al proveedor</p>
                            </>
                          )}
                        </div>

                        <div>
                          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Cantidad</label>
                          <input
                            type="number"
                            defaultValue={itemCantidad}
                            placeholder="1"
                            min="0.01"
                            step="0.01"
                            className="w-full rounded border bg-background px-2 py-1.5 text-sm tabular-nums"
                            onBlur={e => {
                              const val = Math.max(0.01, Number(e.target.value) || 1)
                              if (val === itemCantidad) return
                              startTransition(async () => {
                                await updateItem(item.id, { cantidad: val })
                                await recalcularTotales(cotizacion.id)
                                router.refresh()
                              })
                            }}
                          />
                        </div>

                        {/* Descuento de COMPRA. Se llama así a propósito: baja el costo,
                            no el precio. El que baja el precio es el descuento comercial
                            y vive al final de la cotización. */}
                        <div>
                          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Desc. compra %</label>
                          <input
                            type="number"
                            defaultValue={itemDescPct || ''}
                            placeholder="0"
                            min="0"
                            max="100"
                            className="w-full rounded border bg-background px-2 py-1.5 text-sm tabular-nums"
                            onBlur={e => {
                              const pct = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                              if (pct === itemDescPct) return
                              startTransition(async () => {
                                await updateItem(item.id, { descuento_porcentaje: pct })
                                await recalcularTotales(cotizacion.id)
                                router.refresh()
                              })
                            }}
                          />
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Del proveedor</p>
                        </div>

                        {/* Costo de la línea: el resultado de las tres casillas de la
                            izquierda. Es lo que suma al costo total de la cotización. */}
                        <div>
                          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Costo de la línea</label>
                          <div className="rounded border bg-muted/40 px-2 py-1.5 text-sm font-medium tabular-nums">
                            {formatCOP(costoLinea)}
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Suma al costo total</p>
                        </div>
                      </div>

                      {/* PRECIO DE LA LÍNEA — resultado, no captura.
                          El margen lo pone la cotización completa. Una línea puede
                          marginar distinto, pero como excepción declarada y marcada: un
                          equipo que el cliente puede cotizar aparte no aguanta el mismo
                          margen que la ingeniería, y con un único porcentaje para todo se
                          sale caro donde te comparan y barato donde no. */}
                      <div className="rounded-md border bg-muted/20 px-3 py-2">
                        {/* La línea solo enseña precio cuando ELLA decide algo: margen
                            propio, o un precio viejo escrito a mano. Mientras el margen
                            lo ponga la cotización, repetirlo en cada ítem es el mismo
                            número doce veces y esconde cuál de las doce es la excepción. */}
                        {/* Cuando la línea hereda el margen NO se escribe ninguna frase
                            aquí: la fila de abajo ya dice «hereda el margen de la
                            cotización» al lado del porcentaje. Decirlo dos veces con
                            palabras distintas hace dudar de si son dos cosas. */}
                        {lineaDecideSuPrecio && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              {precioFijadoAMano
                                ? 'Precio de esta línea, escrito a mano'
                                : `Precio de esta línea: costo + ${itemMargen}% propio de la línea`}
                            </span>
                            <span className="text-sm font-semibold tabular-nums">{formatCOP(precioLinea)}</span>
                          </div>
                        )}

                        {/* El margen real de la línea y DE DÓNDE SALE.
                            Un "0,0%" no dice lo mismo si la línea va a costo por
                            decisión de alguien que si simplemente hereda el margen de
                            la cotización: sin el origen al lado, los dos casos se leen
                            igual y uno de los dos es un viaje regalado.
                            Una línea sin margen medible (recién capturada, sin costo o
                            sin precio) no muestra nada: regañar por no haber llegado
                            todavía enseña a ignorar el aviso. */}
                        {margenTexto && (
                          <p className={`mt-0.5 text-[10px] tabular-nums ${claseNivelMargen(nivelMargen)}`}>
                            Margen real {margenTexto}
                            <span className="ml-1 text-muted-foreground">· {etiquetaOrigenMargen(origenMargen)}</span>
                            {nivelMargen === 'bajo_piso' && (
                              <span className="ml-1 font-semibold">
                                · bajo el margen mínimo de {formatMargenPct(umbrales.pisoPct)}
                                {pisoBloqueaAvance && ' · no deja avanzar'}
                              </span>
                            )}
                            {nivelMargen === 'aviso' && (
                              <span className="ml-1 font-medium">
                                · bajo el aviso de {formatMargenPct(umbrales.avisoPct)}
                              </span>
                            )}
                          </p>
                        )}
                        {/* Lo que dijo la captura NO se pierde cuando alguien lo mueve.
                            Sin este renglón, una línea editada deja a la agencia sin saber
                            cuánto se separó de lo que el proveedor le daba, y el número
                            original no está en ninguna otra pantalla. */}
                        {pantallazoDecia && (
                          <p className="text-[10px] text-muted-foreground">
                            El pantallazo decía {pantallazoDecia}.
                          </p>
                        )}
                        {/* Sobre qué va el IVA de esta línea. Solo donde el workspace
                            liquida el IVA sobre el ingreso propio; en los demás no hay nada
                            que elegir. Cambiarla no mueve el precio: solo el IVA. */}
                        {ivaPorLinea && (() => {
                          const ivaLinea = ivaPorLinea.get(item.id)
                          const declarada: BaseIvaLinea | null = esBaseIvaLinea(item.base_iva) ? item.base_iva : null
                          return (
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                              <span className="text-muted-foreground">IVA de la línea:</span>
                              {editable ? (
                                <select
                                  aria-label="Base del IVA de la línea"
                                  value={declarada ?? ''}
                                  disabled={isPending}
                                  className="rounded border bg-background px-1 py-0.5 text-[10px]"
                                  onChange={e => {
                                    const valor = e.target.value
                                    const base = esBaseIvaLinea(valor) ? valor : null
                                    startTransition(async () => {
                                      const res = await updateItem(item.id, { base_iva: base })
                                      if (!res.success) toast.error(res.error ?? 'No se pudo guardar')
                                      router.refresh()
                                    })
                                  }}
                                >
                                  <option value="">
                                    {`Automático (${ivaLinea ? ETIQUETA_BASE_IVA[ivaLinea.base].split(':')[0].toLowerCase() : 'a nombre de un tercero'})`}
                                  </option>
                                  {BASES_IVA_LINEA.map(b => (
                                    <option key={b} value={b}>{ETIQUETA_BASE_IVA[b]}</option>
                                  ))}
                                </select>
                              ) : (
                                <span>{ivaLinea ? ETIQUETA_BASE_IVA[ivaLinea.base] : ''}</span>
                              )}
                              {ivaLinea && !ivaLinea.sinCosto && (
                                <span className="tabular-nums text-muted-foreground">· {formatCOP(ivaLinea.iva)}{ivaAdentro ? ' incluido' : ''}</span>
                              )}
                              {ivaLinea?.sinCosto && (
                                <span className="font-medium text-amber-700">· {TEXTO_IVA_SIN_CALCULAR}</span>
                              )}
                            </div>
                          )
                        })()}
                        {/* El descuento comercial vive al final de la cascada y NO se
                            reparte por línea, así que el margen de arriba está por
                            encima del que queda de verdad. Decirlo cuesta una línea;
                            callarlo deja una pantalla sana diciendo algo falso. */}
                        {margenTexto && (Number(cotizacion.descuento_porcentaje) || 0) > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            Antes del descuento comercial de {cotizacion.descuento_porcentaje}%.
                          </p>
                        )}
                        {/* Precio por pasajero: lo que ve el cliente en el PDF (P6). */}
                        {precioPorPax && precioPorPax.length > 0 && (
                          <p className="mt-0.5 text-[11px] tabular-nums">
                            <span className="text-muted-foreground">Precio por pasajero: </span>
                            <span className="font-medium">
                              {lineaPorPasajero(precioPorPax.map(p => ({ tipo: p.tipo, unitario: p.precioUnitario })), 'COP')}
                            </span>
                          </p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {!precioFijadoAMano && !margenPropio && (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                startTransition(async () => {
                                  await updateItem(item.id, { margen_porcentaje: margenCotizacion })
                                  await recalcularTotales(cotizacion.id)
                                  router.refresh()
                                })
                              }}
                              className="text-[10px] text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                            >
                              Marginar distinto
                            </button>
                          )}

                          {!precioFijadoAMano && margenPropio && (
                            <>
                              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                {nombreDelMargen(convencionMargen)}
                                <input
                                  key={`margen-${item.id}-${itemMargen}`}
                                  type="number"
                                  defaultValue={itemMargen}
                                  step="0.01"
                                  className="w-16 rounded border bg-background px-1.5 py-0.5 text-[11px] tabular-nums"
                                  onBlur={e => {
                                    const pct = Number(e.target.value) || 0
                                    if (pct === itemMargen) return
                                    startTransition(async () => {
                                      await updateItem(item.id, { margen_porcentaje: pct })
                                      await recalcularTotales(cotizacion.id)
                                      router.refresh()
                                    })
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                />
                                %
                              </label>
                              {/* La SEGUNDA puerta a la misma decisión: escribir el precio
                                  que va a pagar el cliente y dejar que el margen se
                                  acomode. Escribe el MISMO campo que la casilla de la
                                  izquierda (`margen_porcentaje`), no un precio aparte: con
                                  `precio_manual` la línea dejaría de reaccionar a un cambio
                                  de costo y el margen mostrado quedaría al día con un
                                  precio que ya no le corresponde.
                                  El margen se despeja contra el costo de la línea CON su
                                  parte de los administrativos, que es contra lo que la
                                  cascada calcula el precio. */}
                              {costoDeVentaLinea > 0 && (
                                <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                  Precio al cliente
                                  <div className="relative">
                                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">$</span>
                                    <input
                                      key={`precio-obj-${item.id}-${precioLinea}`}
                                      type="text"
                                      inputMode="numeric"
                                      defaultValue={precioLinea ? precioLinea.toLocaleString('es-CO') : ''}
                                      className="w-28 rounded border bg-background py-0.5 pr-1.5 pl-4 text-[11px] tabular-nums"
                                      onBlur={e => {
                                        const objetivo = Number(e.target.value.replace(/[^0-9]/g, '')) || 0
                                        if (objetivo === precioLinea) return
                                        const nuevo = margenParaPrecio(costoDeVentaLinea, objetivo, convencionMargen)
                                        if (nuevo === null) {
                                          // Un precio que no supera el costo pediría margen
                                          // negativo. Se dice y se devuelve la casilla a lo
                                          // que hay: escribirlo dejaría la línea a pérdida
                                          // sin que nadie lo haya pedido.
                                          e.target.value = precioLinea.toLocaleString('es-CO')
                                          toast.error(
                                            `El precio tiene que superar el costo de la línea (${formatCOP(costoDeVentaLinea)}).`,
                                          )
                                          return
                                        }
                                        startTransition(async () => {
                                          await updateItem(item.id, { margen_porcentaje: nuevo })
                                          await recalcularTotales(cotizacion.id)
                                          router.refresh()
                                        })
                                      }}
                                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                    />
                                  </div>
                                </label>
                              )}
                              {/* Volver al número del proveedor. Es la mitad que hace
                                  reversible la edición: sin esto, «no se pierde» sería
                                  solo poder leerlo. */}
                              {pantallazoDecia && margenDelPantallazo !== null && (
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => {
                                    startTransition(async () => {
                                      await updateItem(item.id, { margen_porcentaje: margenDelPantallazo })
                                      await recalcularTotales(cotizacion.id)
                                      router.refresh()
                                    })
                                  }}
                                  className="text-[10px] text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                                >
                                  Volver al del pantallazo
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => {
                                  startTransition(async () => {
                                    // `null`, no 0: 0 es "esta línea va a costo" y es una
                                    // decisión distinta a "usa el margen de la cotización".
                                    await updateItem(item.id, { margen_porcentaje: null })
                                    await recalcularTotales(cotizacion.id)
                                    router.refresh()
                                  })
                                }}
                                className="text-[10px] text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                              >
                                Usar el de la cotización
                              </button>
                            </>
                          )}

                          {/* Ya no hay forma de entrar a "precio a mano": para poner una
                              cifra exacta se escribe en el costo, con cantidad 1, sin
                              descuento y sin margen. Las líneas que YA quedaron fijadas
                              conservan su casilla y su salida de vuelta al cálculo. */}

                          {precioFijadoAMano && (
                            <>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">$</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="Valor unitario"
                                  defaultValue={itemPrecio ? itemPrecio.toLocaleString('es-CO') : ''}
                                  onBlur={e => {
                                    const raw = e.target.value.replace(/[^0-9]/g, '')
                                    const val = Number(raw) || 0
                                    if (val === itemPrecio) return
                                    e.target.value = val ? val.toLocaleString('es-CO') : ''
                                    startTransition(async () => {
                                      await updateItem(item.id, { precio_venta: val, precio_manual: true })
                                      await recalcularTotales(cotizacion.id)
                                      router.refresh()
                                    })
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                  className="w-32 rounded border bg-background py-0.5 pr-1.5 pl-5 text-[11px] tabular-nums"
                                />
                              </div>
                              {/* Sin costo contra el cual recalcular, "volver al cálculo"
                                  dejaría el precio en cero y la línea parecería borrada. */}
                              {costoLinea > 0 && (
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => {
                                    startTransition(async () => {
                                      await updateItem(item.id, { precio_manual: false })
                                      await recalcularTotales(cotizacion.id)
                                      router.refresh()
                                    })
                                  }}
                                  className="text-[10px] text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                                >
                                  Volver a calcularlo desde el costo
                                </button>
                              )}
                              {/* Con precio a mano el margen no gobierna nada, pero el
                                  número del pantallazo sigue siendo el punto de referencia
                                  y volver a él tiene que ser un clic: se suelta el precio
                                  fijado Y se repone el margen del proveedor, porque hacer
                                  solo lo primero devolvería la línea al margen de la
                                  cotización, que no es de donde salió. */}
                              {pantallazoDecia && margenDelPantallazo !== null && costoLinea > 0 && (
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => {
                                    startTransition(async () => {
                                      await updateItem(item.id, {
                                        precio_manual: false,
                                        margen_porcentaje: margenDelPantallazo,
                                      })
                                      await recalcularTotales(cotizacion.id)
                                      router.refresh()
                                    })
                                  }}
                                  className="text-[10px] text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                                >
                                  Volver al del pantallazo
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Descripción (visible al cliente)</label>
                        <input
                          defaultValue={item.descripcion ?? ''}
                          placeholder="Describe qué incluye este item..."
                          className="w-full rounded border bg-background px-2 py-1.5 text-xs"
                          onBlur={e => {
                            const val = comoSeGuarda(e.target.value)
                            // La casilla pinta lo que se guardó (ver `comoSeGuarda`).
                            e.target.value = val
                            if (val === (item.descripcion ?? '')) return
                            startTransition(async () => {
                              await updateItem(item.id, { descripcion: val })
                            })
                          }}
                        />
                      </div>

                      {/* AL PIE, DESPUÉS DEL COSTO Y LA DESCRIPCIÓN (§2.2). Un botón que
                          agrega algo va después de lo que agrega: arriba, entre el nombre
                          y el contenido, se leía como si aplicara a lo que venía abajo.
                          Solo en el flujo de viaje: fuera de él el bloque queda como hoy. */}
                      {lineasPorTipo && <div className="border-t pt-2">{botonOtraOpcion}</div>}
                    </div>
                  )}
                  {/* Rubros table (internal costs).
                      ⚠️ Solo los CONFIRMADOS. Los sugeridos por un pantallazo se
                      revisan en su propio panel, con la captura al lado: mezclarlos
                      aquí los haría ver como costo ya aceptado, que es lo que R-P1
                      prohíbe, y ademas el total de la tabla no cuadraría con el
                      costo del item. */}
                  {rubrosConfirmados.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="pb-1 pr-2">Tipo</th>
                            <th className="pb-1 pr-2">Descripción</th>
                            <th className="pb-1 pr-2">Cant.</th>
                            <th className="pb-1 pr-2">Unit.</th>
                            <th className="pb-1 pr-2 text-right">Vr. Unit.</th>
                            <th className="pb-1 text-right">Total</th>
                            {editable && <th className="pb-1 w-12" />}
                          </tr>
                        </thead>
                        <tbody>
                          {rubrosConfirmados.map((r: RubroRow) => (
                            <tr key={r.id} className="border-b border-dashed">
                              <td className="py-1.5 pr-2">
                                {etiquetaTipoRubro(r.tipo)}
                              </td>
                              <td className="py-1.5 pr-2 text-muted-foreground max-w-[120px] truncate">
                                {r.descripcion || '—'}
                              </td>
                              <td className="py-1.5 pr-2">{r.cantidad}</td>
                              <td className="py-1.5 pr-2">{r.unidad}</td>
                              <td className="py-1.5 pr-2 text-right">{formatCOP(r.valor_unitario ?? 0)}</td>
                              <td className="py-1.5 text-right font-medium">{formatCOP(r.valor_total ?? 0)}</td>
                              {editable && (
                                <td className="py-1.5">
                                  <div className="flex gap-0.5">
                                    <button
                                      onClick={() => startEditRubro(r, item.id)}
                                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteRubro(r.id)}
                                      className="rounded p-0.5 text-red-500 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add / Edit rubro */}
                  {editable && addingRubroFor === item.id ? (
                    <div className="mt-2 space-y-2 rounded-md bg-muted/30 p-2">
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={newRubro.tipo}
                          onChange={e => {
                            const t = TIPOS_RUBRO.find(r => r.value === e.target.value)
                            setNewRubro(p => ({ ...p, tipo: e.target.value, unidad: t?.unidadDefault ?? 'unidades' }))
                          }}
                          className="rounded border bg-background px-2 py-1.5 text-xs"
                        >
                          {TIPOS_RUBRO.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                          {/* Un rubro que escribió el sistema con un tipo fuera del selector
                              (la tarifa por pasajero escribe `tarifa`): sin esta opción el
                              select pintaría el primer tipo mientras guarda otro. */}
                          {!TIPOS_RUBRO.some(t => t.value === newRubro.tipo) && (
                            <option value={newRubro.tipo}>{etiquetaTipoRubro(newRubro.tipo)}</option>
                          )}
                        </select>
                        <input
                          placeholder="Descripción"
                          value={newRubro.descripcion}
                          onChange={e => {
                            const val = e.target.value
                            setNewRubro(p => {
                              const next = { ...p, descripcion: val }
                              // Auto-fill tarifa when selecting staff from datalist
                              if ((p.tipo === 'mo_propia' || p.tipo === 'mo_terceros') && staffMembers?.length) {
                                const match = staffMembers.find(s => s.nombre === val)
                                if (match && match.tarifa_hora > 0) {
                                  next.valor_unitario = Math.round(match.tarifa_hora).toString()
                                }
                              }
                              return next
                            })
                          }}
                          className="rounded border bg-background px-2 py-1.5 text-xs"
                          list={(newRubro.tipo === 'mo_propia' || newRubro.tipo === 'mo_terceros') && staffMembers?.length ? 'staff-list' : undefined}
                        />
                        <input
                          type="number"
                          placeholder="Cantidad"
                          value={newRubro.cantidad}
                          onChange={e => setNewRubro(p => ({ ...p, cantidad: e.target.value }))}
                          className="rounded border bg-background px-2 py-1.5 text-xs"
                        />
                        <input
                          placeholder="Unidad"
                          value={newRubro.unidad}
                          onChange={e => setNewRubro(p => ({ ...p, unidad: e.target.value }))}
                          className="rounded border bg-background px-2 py-1.5 text-xs"
                        />
                        <CalcInput
                          placeholder="Valor unitario"
                          value={newRubro.valor_unitario}
                          onChange={v => setNewRubro(p => ({ ...p, valor_unitario: v }))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setAddingRubroFor(null); setEditingRubroId(null); setNewRubro({ tipo: 'mo_propia', descripcion: '', cantidad: '1', unidad: 'horas', valor_unitario: '' }) }}
                          className="rounded border px-2 py-1 text-xs hover:bg-accent"
                        >
                          Cancelar
                        </button>
                        {editingRubroId ? (
                          <button
                            onClick={() => handleUpdateRubro(editingRubroId)}
                            disabled={isPending || !Number(newRubro.valor_unitario)}
                            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                          >
                            Guardar cambios
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAddRubro(item.id)}
                            disabled={isPending || !Number(newRubro.valor_unitario)}
                            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                          >
                            Agregar rubro
                          </button>
                        )}
                      </div>
                    </div>
                  ) : editable && !lineasPorTipo ? (
                    /* EN UN VIAJE NO SE AGREGAN RUBROS (§2.5). Un rubro es la forma
                       genérica de costear un ítem por partes (mano de obra por horas,
                       materiales) y nació para Termotech. En un viaje el desglose
                       equivalente —tarifa, tasas, fee— ya lo trae el pantallazo, y agregar
                       un rubro ANULA el costo escrito: es una trampa, no una opción. Quien
                       costea a mano escribe el costo y detalla en la descripción.
                       Los rubros que YA existen (los que escribe la tarifa por pasajero)
                       se siguen viendo y corrigiendo arriba. */
                    <button
                      onClick={() => {
                        // Desglosar anula el costo escrito a mano: con rubros, el costo lo
                        // mandan ellos. Avisarlo antes es lo unico que evita que el costo
                        // de la factura del proveedor desaparezca sin que nadie lo note.
                        if (!tieneRubros && costoManual > 0 &&
                            !window.confirm('Este item pasa a costearse por rubros. El costo que escribiste deja de aplicar. ¿Sigues?')) {
                          return
                        }
                        setEditingRubroId(null)
                        setAddingRubroFor(item.id)
                      }}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Plus className="h-3 w-3" />
                      Agregar rubro
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          )})}

          {/* Add item actions */}
          {editable && (
            <div className="space-y-2">
              {/* Single row: input + add button + catalog button. Con líneas por tipo, los
                  botones de tipo reemplazan al input; «+ Otro» lo abre debajo. */}
              <div className={lineasPorTipo ? 'relative flex flex-wrap gap-2' : 'relative flex gap-2'}>
                {lineasPorTipo ? (
                  <>
                    {gruposCanonicos().map(g => (
                      <button
                        key={g.grupo}
                        onClick={() => handleAddItemDeGrupo(g)}
                        disabled={isPending}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {g.label}
                      </button>
                    ))}
                    {/* EL BOTÓN DEL COMPONENTE SUELTO (§4.2). Se llamaba «Otro», que no
                        dice lo único que hay que saber para elegirlo: una línea sin
                        ranura SUMA SIEMPRE, no compite con nadie. */}
                    <button
                      onClick={() => setMostrarOtro(v => !v)}
                      disabled={isPending}
                      aria-expanded={mostrarOtro}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Otro componente del viaje
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      value={newItemName}
                      onChange={e => setNewItemName(e.target.value)}
                      placeholder="Nombre del item..."
                      className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
                      onKeyDown={e => e.key === 'Enter' && handleAddItem()}
                    />
                    <button
                      onClick={handleAddItem}
                      disabled={isPending || !newItemName.trim()}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Item
                    </button>
                  </>
                )}
                {/* EL CATÁLOGO no aplica al flujo de viaje.
                    Es una lista de servicios con precio fijo, y aquí el costo entra por
                    pantallazo del proveedor: no hay dos viajes con el mismo precio.
                    Medido el 2026-09-17 contra producción: el workspace de Trappvel tiene
                    CERO servicios, así que el botón solo abría un panel que decía que no
                    hay nada. Ocupaba el renglón de «+ Vuelo / + Hotel», que es el que se
                    usa. */}
                {!lineasPorTipo && (
                  <button
                    onClick={loadCatalog}
                    disabled={catalogLoading}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-blue-300 px-3 py-2 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50"
                  >
                    {catalogLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                    Desde catálogo
                  </button>
                )}

                {/* Catalog dropdown */}
                {!lineasPorTipo && showCatalog && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-80 rounded-lg border border-blue-200 bg-background shadow-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-blue-800">Agregar desde catálogo</span>
                      <button onClick={() => setShowCatalog(false)} className="text-xs text-blue-600 hover:underline">Cerrar</button>
                    </div>
                    {catalogItems.length === 0 ? (
                      <p className="py-3 text-center text-xs text-muted-foreground">
                        No tienes servicios en tu catálogo. Créalos en Config → Mis servicios.
                      </p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {catalogItems.map(s => {
                          const tpl = s.rubros_template as { tipo: string; cantidad: number; unidad: string; valor_unitario: number }[] | null
                          return (
                            <button
                              key={s.id}
                              onClick={() => handleAddFromCatalog(s.id)}
                              disabled={isPending}
                              className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
                            >
                              <div className="min-w-0">
                                <span className="font-medium">{s.nombre}</span>
                                {tpl && tpl.length > 0 && (
                                  <span className="ml-2 text-[10px] text-muted-foreground">{tpl.length} rubros</span>
                                )}
                              </div>
                              <span className="shrink-0 text-xs font-medium">{formatCOP(s.precio_estandar ?? 0)}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* QUÉ HACE CADA BOTÓN, en la pantalla donde se elige (§4.2).
                  ⚠️ Esta frase decía lo CONTRARIO hasta el 2026-09-21: «+ Vuelo» sobre una
                  cotización que ya tenía un vuelo creaba otra OPCIÓN en la misma ranura, y
                  solo una sumaba — el error silencioso que dejó el viaje a Providencia sin
                  el tramo a la isla. Ahora crea «Vuelo 2», que suma aparte, y la opción que
                  compite tiene su propio botón DENTRO de la línea. Son dos cosas distintas
                  y cada una tiene su botón, así que la frase ya puede explicar las dos. */}
              {lineasPorTipo && (
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Vuelo, Hotel, Actividad y Traslado</span>{' '}
                  agregan otro componente que <span className="font-medium">suma</span>: si ya hay un
                  vuelo, el nuevo es «Vuelo 2» y los dos van en el viaje (un segundo tramo va así).
                  {' '}Para una <span className="font-medium">alternativa</span> del mismo componente —otra
                  aerolínea, otro horario— se usa «Agregar otra opción de…» dentro de la línea: esas
                  compiten y solo una entra al precio.
                  {' '}<span className="font-medium text-foreground">Otro componente del viaje</span> es
                  una línea sin ranura: suma siempre y no compite con nadie.
                </p>
              )}
              {lineasPorTipo && mostrarOtro && (
                <div className="flex gap-2">
                  <input
                    value={newItemName}
                    onChange={e => setNewItemName(e.target.value)}
                    placeholder="Nombre de la línea..."
                    aria-label="Nombre de la línea"
                    autoFocus
                    className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddItem()
                      if (e.key === 'Escape') setMostrarOtro(false)
                    }}
                  />
                  <button
                    onClick={handleAddItem}
                    disabled={isPending || !newItemName.trim()}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agregar
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Las combinaciones, ANTES de la cascada: son la decisión de qué se le
              manda al cliente, y la cascada de abajo es el total del principal.
              Leerlas después dejaría el total sin contexto. No se pinta nada si la
              cotización no tiene opciones (R6). */}
          {itinerarios && (
            <TablaCombinaciones
              cotizacionId={cotizacion.id}
              estado={itinerarios}
              editable={editable}
              explicarVacio={lineasPorTipo}
            />
          )}

          {/* R-A1 · qué ranura se resolvió sola. Va ARRIBA de la cascada porque
              explica el número que sigue: sin esto el total se lee como si alguien
              hubiera elegido, y nadie eligió. Se nombra la opción tomada y las que
              quedaron fuera — «hay una suposición» sin decir cuál no se puede
              corregir. No aparece cuando hay itinerario principal: ahí la decisión
              está tomada y la toma la tabla de combinaciones. */}
          {/* Regla 2 · el recargo fijo. Se OFRECE donde corresponde y, cuando el
              número de la línea no es el vigente, se dicen los DOS. Lo que no se hace
              nunca es agregarlo solo: una línea de precio que aparece sin que nadie la
              pida es peor que una que falta, porque sale impresa al cliente. */}
          {recargo.estado === 'falta' && editable && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-300 bg-blue-50 p-3 text-xs text-blue-900">
              <div>
                <p>
                  <span className="font-medium">{recargo.etiqueta}</span> de{' '}
                  <span className="font-medium tabular-nums">{formatCOP(recargo.valor)}</span>: esta
                  {' '}cotización {politicaRecargo.vuelos === 'internacionales' ? 'lleva un vuelo internacional' : 'tiene un componente al que le corresponde'}
                  {' '}y todavía no lo lleva.
                </p>
                {/* Un origen o destino que no se reconoce cuenta como internacional: se
                    ofrece el recargo, pero se dice por qué, para que alguien lo mire. */}
                {recargo.dudosos.length > 0 && (
                  <p className="mt-1 text-amber-800">
                    Se contó como internacional sin poder confirmarlo: {recargo.dudosos.join('; ')}.
                    {' '}Revisa de dónde a dónde va antes de agregarlo.
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await aplicarRecargo(cotizacion.id)
                    if (!r.success) { toast.error(r.error); return }
                    await recalcularTotales(cotizacion.id)
                    toast.success(`${r.etiqueta} agregado por ${formatCOP(r.valor)}`)
                    router.refresh()
                  })
                }
                className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Agregar recargo
              </button>
            </div>
          )}

          {recargo.estado === 'distinto' && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-900">
              <span className="font-medium">{recargo.etiqueta}</span>: esta cotización lo lleva por{' '}
              <span className="font-medium tabular-nums">{formatCOP(recargo.valorEnLaLinea)}</span> y el
              {' '}vigente de la línea es{' '}
              <span className="font-medium tabular-nums">{formatCOP(recargo.valorVigente)}</span>. Se
              {' '}respeta el de la cotización; se cambia editando esa línea.
            </div>
          )}

          {/* ⚠️⚠️ El aviso de dinero: sugerencias que están sumando al total.
              Va ROJO y no ámbar, y va pegado a los totales, porque no es un supuesto
              que alguien pueda dejar pasar: el documento va a decir «no incluida»
              sobre una línea que el cliente está pagando. */}
          {avisoSugeridos.length > 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900">
              <p className="font-medium">
                {avisoSugeridos.length === 1
                  ? 'Una línea se va a imprimir como «no incluida» y está sumando al total.'
                  : `${avisoSugeridos.length} líneas se van a imprimir como «no incluidas» y están sumando al total.`}
              </p>
              <ul className="mt-1.5 space-y-1">
                {avisoSugeridos.map(a => (
                  <li key={a.id}>
                    <span className="font-medium">«{nombrePorItem.get(a.id)}»</span>: suma{' '}
                    <span className="font-medium tabular-nums">{formatCOP(a.precioLinea)}</span> al total
                    {a.oculta && (
                      <span className="font-medium"> y además está oculta, así que el cliente ni la ve</span>
                    )}
                    .
                  </li>
                ))}
              </ul>
              <p className="mt-1.5">
                Son{' '}
                <span className="font-medium tabular-nums">{formatCOP(plataEnAviso)}</span>{' '}
                que el cliente paga y el documento declara como no incluidos. Tres salidas:
                {' '}<span className="font-medium">asígnale un día</span> para que entre al itinerario,
                {' '}<span className="font-medium">desmarca «Entra al precio»</span> si es una sugerencia
                (el cliente sigue viendo su valor), o <span className="font-medium">déjala en cero</span>.
              </p>
            </div>
          )}

          {/* §4.3 · el aviso que le habría salvado el PDF a Alejandra.
              Va ANTES del de supuestos a propósito: aquel dice cuál opción cuenta, y
              este dice que las opciones no eran comparables en primer lugar — o sea que
              elegir una de las dos es la pregunta equivocada. El texto lo arma
              `cobertura-opciones.ts`, el mismo que se imprime al generar el PDF. */}
          {avisosCobertura.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium">
                {avisosCobertura.length === 1
                  ? 'Revisa qué cubre cada opción antes de imprimir.'
                  : `Revisa qué cubre cada opción en ${avisosCobertura.length} ranuras antes de imprimir.`}
              </p>
              <ul className="mt-1.5 space-y-1">
                {avisosCobertura.map(a => (
                  <li key={a.grupo}>{a.texto}</li>
                ))}
              </ul>
            </div>
          )}

          {supuestos.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium">
                {supuestos.length === 1
                  ? 'Una ranura no tiene elección: el total toma una opción por supuesto.'
                  : `${supuestos.length} ranuras no tienen elección: el total toma una opción por supuesto en cada una.`}
              </p>
              <ul className="mt-1.5 space-y-1">
                {supuestos.map(s => (
                  <li key={s.grupo}>
                    <span className="font-medium">{s.grupo}</span>: cuenta{' '}
                    <span className="font-medium">«{nombrePorItem.get(s.elegido)}»</span>
                    {s.descartados.length > 0 && (
                      <>
                        {' '}y queda fuera del total{' '}
                        {s.descartados.map(id => `«${nombrePorItem.get(id)}»`).join(', ')}
                      </>
                    )}
                    {!s.combinable && <span className="text-amber-800"> · no se cruza en la tabla</span>}.
                  </li>
                ))}
              </ul>
              <p className="mt-1.5">
                {hayCombinable
                  ? 'Arma las combinaciones y marca la principal para decidir los vuelos y hoteles.'
                  : 'Tours, traslados y planes no abren columna en la tabla: para cambiar cuál suma, borra la alternativa o reordena las líneas.'}
                {' '}Cada ranura aporta una sola vez: el total nunca suma las dos.
              </p>
            </div>
          )}

          {/* La cascada de la cotización: costo, administrativos, margen, descuento. */}
          <TotalesMargen
            cascada={cascadaTotal}
            margenPct={margenCotizacion}
            convencionMargen={convencionMargen}
            descuentoPct={Number(cotizacion.descuento_porcentaje) || 0}
            editable={editable}
            aiuAdminPct={cotizacion.aiu_admin_pct ?? null}
            aiuImprevPct={cotizacion.aiu_imprevistos_pct ?? null}
            umbrales={umbrales}
            pisoBloqueaAvance={pisoBloqueaAvance}
            ofrecerAdministrativos={!lineasPorTipo}
            onMargenChange={pct => {
              startTransition(async () => {
                await updateCotizacion(cotizacion.id, { margen_porcentaje: pct })
                await recalcularTotales(cotizacion.id)
                router.refresh()
              })
            }}
            onAIUChange={(adminPct, imprevPct) => {
              startTransition(async () => {
                await aplicarAIU(cotizacion.id, adminPct, imprevPct)
                router.refresh()
              })
            }}
            onDescuentoChange={pct => {
              startTransition(async () => {
                await updateCotizacion(cotizacion.id, { descuento_porcentaje: pct })
                await recalcularTotales(cotizacion.id)
                router.refresh()
              })
            }}
          />

          {/* Quién movió el margen y cuándo. Debajo de la cascada a propósito: se
              consulta cuando la cifra de arriba sorprende, no mientras se captura. */}
          <RastroMargen cotizacionId={cotizacion.id} />

          {/* Terminos y condiciones (van al final de la cotizacion) */}
          {(editable || terminos.trim()) && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Términos y condiciones
              </label>
              {editable ? (
                <textarea
                  value={terminos}
                  onChange={e => setTerminos(e.target.value)}
                  onBlur={() => {
                    const valor = terminos.trim()
                    if (valor === (cotizacion.terminos_condiciones ?? '')) return
                    startTransition(async () => {
                      const res = await updateCotizacion(cotizacion.id, {
                        terminos_condiciones: valor || null,
                      })
                      if (!res.success) toast.error(res.error)
                      router.refresh()
                    })
                  }}
                  rows={5}
                  placeholder="Validez de la oferta, garantía, alcance, condiciones de entrega…"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed"
                />
              ) : (
                <p className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {terminos}
                </p>
              )}
            </div>
          )}

          {/* Fiscal result */}
          {(() => {
            // `precioVenta` ya trae el descuento comercial aplicado: restarlo otra vez
            // aquí le bajaba el neto al vendedor sin que nada lo explicara.
            //
            // Sale de `cascadaTotal`, no de `cascada`: lo que el vendedor recibe es lo
            // que se cobra, y lo que se cobra suma cada ranura UNA vez (R-A1).
            const valor = cascadaTotal.precioVenta
            const hasFiscal = fiscalProfile?.is_complete && clientFiscal?.agente_retenedor != null
            if (!hasFiscal || valor === 0) {
              return (
                <div className="rounded-lg bg-green-50 p-4 text-center">
                  <p className="text-xs font-medium text-green-700">TÚ RECIBES</p>
                  <p className="text-2xl font-bold text-green-700">{formatCOP(valor)}</p>
                  <p className="mt-1 text-[10px] text-green-600">
                    {!fiscalProfile?.is_complete
                      ? 'Completa tu perfil fiscal en Configuración para ver el desglose'
                      : 'Completa el perfil fiscal del cliente para ver el desglose'}
                  </p>
                </div>
              )
            }
            // Con el IVA sobre el ingreso propio, el IVA ya viene liquidado por línea (el
            // mismo que imprime el PDF y fija «Aprobar») y las retenciones van sobre la
            // misma base. Sin esa configuración, lo de siempre: IVA sobre el total.
            // Con el IVA ADENTRO el cliente paga la cotización tal cual y el IVA sale de ahí.
            const resumen = generarResumenFiscal(
              fiscalProfile as FiscalProfile,
              clientFiscal as unknown as Client,
              valor,
              costoTotal,
              ivaVigente
                ? { iva: ivaVigente.iva, baseGravable: ivaVigente.baseGravable, incluido: ivaAdentro }
                : undefined,
            )
            // De la factura a la plata que de verdad queda, renglón por renglón. Antes
            // "tú recibes" repetía la cifra de "el cliente paga" porque contaba el IVA
            // como ingreso propio, y de ahí salía un margen neto MAYOR al de la
            // cotización, que es imposible.
            return (
              <div className="space-y-2">
                <div className="rounded-lg bg-blue-50 p-3">
                  <p className="text-center text-[10px] font-medium text-blue-600">EL CLIENTE TE FACTURA Y PAGA</p>
                  <p className="text-center text-lg font-bold text-blue-700">{formatCOP(resumen.total_paga_cliente)}</p>
                  {resumen.iva > 0 && (
                    <div className="mt-1 space-y-0.5 text-[10px] text-blue-600">
                      <div className="flex justify-between">
                        <span>{ivaAdentro ? 'Tu cotización, con el IVA adentro' : 'Tu cotización'}</span>
                        <span className="tabular-nums">{formatCOP(valor)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{ivaAdentro ? 'Incluye IVA sobre la tarifa de la agencia' : ivaVigente ? 'IVA sobre la tarifa de la agencia' : 'IVA que le cobras'}</span>
                        <span className="tabular-nums">{ivaAdentro ? '' : '+'}{formatCOP(resumen.iva)}</span>
                      </div>
                    </div>
                  )}
                  {/* Una línea con precio y sin costo deja el IVA incompleto: se dice aquí,
                      y el PDF sale como borrador hasta cargarlo. */}
                  {ivaVigente && !ivaVigente.calculable && (
                    <p className="mt-1 text-center text-[10px] font-medium text-amber-700">
                      {motivoIvaSinCalcular(ivaVigente.sinCosto)} El PDF sale como borrador, con la marca «{etiquetaDeMotivo('iva_sin_calcular')}», hasta entonces.
                    </p>
                  )}
                </div>

                <div className="rounded-lg bg-amber-50 p-3">
                  <p className="mb-1 text-center text-[10px] font-medium text-amber-700">DE ESO, NO TODO ES TUYO</p>
                  <div className="space-y-0.5 text-[10px] text-amber-700">
                    {resumen.iva_trasladado > 0 && (
                      <div className="flex justify-between">
                        <span>{ivaAdentro ? 'De tu ingreso propio, IVA que le entregas a la DIAN' : 'IVA: se lo entregas a la DIAN'}</span>
                        <span className="tabular-nums">-{formatCOP(resumen.iva_trasladado)}</span>
                      </div>
                    )}
                    {resumen.retefuente_valor > 0 && (
                      <div className="flex justify-between"><span>ReteFuente que te descuentan ({resumen.retefuente_pct}%)</span><span className="tabular-nums">-{formatCOP(resumen.retefuente_valor)}</span></div>
                    )}
                    {resumen.reteica_valor > 0 && (
                      <div className="flex justify-between"><span>ReteICA que te descuentan ({resumen.reteica_pct}‰)</span><span className="tabular-nums">-{formatCOP(resumen.reteica_valor)}</span></div>
                    )}
                    {resumen.iva_trasladado === 0 && resumen.retefuente_valor === 0 && resumen.reteica_valor === 0 && (
                      <p className="text-center">Sin IVA ni retenciones: te entra completo</p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg bg-green-50 p-3">
                  <p className="text-center text-[10px] font-medium text-green-600">TE QUEDA EN CAJA</p>
                  <p className="text-center text-xl font-bold text-green-700">{formatCOP(resumen.neto_recibido)}</p>
                  <div className="mt-1 space-y-0.5 text-[10px] text-green-700">
                    <div className="flex justify-between"><span>Menos lo que te cuestan los ítems</span><span className="tabular-nums">-{formatCOP(costoTotal)}</span></div>
                    {resumen.seguridad_social > 0 && (
                      <div className="flex justify-between"><span>Menos tu seguridad social</span><span className="tabular-nums">-{formatCOP(resumen.seguridad_social)}</span></div>
                    )}
                    <div className="flex justify-between border-t border-green-200 pt-0.5 font-semibold">
                      <span>Te ganas</span>
                      <span className="tabular-nums">{formatCOP(resumen.ganancia_real)} · {resumen.margen_real_neto_pct}%</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

      {/* Staff datalist for mano de obra rubros */}
      {staffMembers && staffMembers.length > 0 && (
        <datalist id="staff-list">
          {staffMembers.map(s => (
            <option key={s.id} value={s.nombre} />
          ))}
        </datalist>
      )}
    </div>
  )
}

// ── Cómo se pinta un margen ────────────────────────────────────

/**
 * El color de un margen según su nivel.
 *
 * `sin_dato` NO es gris de "apagado": es el color normal del texto, porque no hay
 * nada que juzgar todavía. `ok` tampoco se pinta de verde en la línea — con doce
 * ítems sanos, doce verdes dejan de distinguirse de nada.
 */
/**
 * Qué dice el ROJO, según si el piso bloquea o solo marca.
 *
 * ⚠️ Hasta el 2026-09-14 este texto decía *«Es una marca, no un bloqueo: la cotización
 * se puede enviar igual»* en todas partes. Con el gate `margen_sobre_piso` declarado
 * eso es FALSO —el negocio no avanza— y una pantalla sana que miente sobre una regla
 * de plata es peor que una rota, porque no se ve. Lo que decide es la etapa, así que
 * el texto entra por parámetro y no se afirma sin saber.
 *
 * El ÁMBAR no cambia: avisa y deja pasar, en los dos casos. Esa es la distinción que
 * el equipo tiene que poder leer sin preguntar.
 */
function textoPiso(pisoPct: number, bloqueaAvance: boolean): string {
  return bloqueaAvance
    ? `Está por debajo del margen mínimo de ${formatMargenPct(pisoPct)}: con este margen el negocio NO avanza de etapa. Sube el margen o el precio.`
    : `Está por debajo del margen mínimo de ${formatMargenPct(pisoPct)}. Aquí es una marca: la cotización se puede enviar igual.`
}

/** Qué explica el tooltip del margen, sin repetir lo que ya dice el texto. */
function tituloNivelMargen(
  nivel: NivelMargen,
  umbrales: UmbralesMargen,
  origen: ReturnType<typeof origenDelMargen>,
  bloqueaAvance = false,
): string {
  const deDonde = `El margen de esta línea ${etiquetaOrigenMargen(origen)}.`
  if (nivel === 'bajo_piso') {
    return `${deDonde} ${textoPiso(umbrales.pisoPct, bloqueaAvance)}`
  }
  if (nivel === 'aviso') {
    return `${deDonde} Está por debajo del ${formatMargenPct(umbrales.avisoPct)} de margen. Avisa, no bloquea.`
  }
  return deDonde
}

// ── Totales + Margen bidireccional ─────────────────────────────

/** Un renglón de la cascada: qué es, cuánto vale y de dónde sale. */
function Renglon({ etiqueta, valor, nota, fuerte, tono }: {
  etiqueta: string
  valor: number
  nota?: string
  fuerte?: boolean
  tono?: 'rojo' | 'verde'
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted-foreground">
        {etiqueta}
        {nota && <span className="ml-1 text-[10px]">{nota}</span>}
      </span>
      <span className={`tabular-nums ${fuerte ? 'font-bold' : 'font-medium'} ${tono === 'rojo' ? 'text-red-600' : tono === 'verde' ? 'text-green-600' : ''}`}>
        {tono === 'rojo' ? '-' : ''}{formatCOP(valor)}
      </span>
    </div>
  )
}

/**
 * El pie de la cotización: la cascada completa, de lo que cuesta a lo que se cobra.
 *
 * Se lee de arriba abajo y cada renglón dice de dónde sale el siguiente. Antes aquí se
 * escribía el valor de venta y el sistema inventaba un ítem de cuadre para que la suma
 * diera: el cliente veía una línea "Administración e imprevistos" que nadie había
 * cotizado, y el margen no se podía leer en ninguna parte.
 */
function TotalesMargen({ cascada, margenPct, convencionMargen, descuentoPct, editable, aiuAdminPct, aiuImprevPct, umbrales, pisoBloqueaAvance = false, ofrecerAdministrativos = true, onMargenChange, onAIUChange, onDescuentoChange }: {
  cascada: Cascada
  margenPct: number
  convencionMargen: ConvencionMargen
  descuentoPct: number
  editable: boolean
  aiuAdminPct: number | null
  aiuImprevPct: number | null
  umbrales: UmbralesMargen
  /** Ver el prop del mismo nombre en `Props`: decide el TEXTO del rojo, no el color. */
  pisoBloqueaAvance?: boolean
  /**
   * ¿Se OFRECE el AIU (administración e imprevistos)?
   *
   * Es una convención de obra pública colombiana: un segundo recargo sobre el mismo
   * costo, al lado del margen general. En una cotización de viaje son dos palancas para
   * lo mismo y la pregunta «¿cuál muevo?» no tiene respuesta. Medido el 2026-09-17: de
   * las 6 cotizaciones de Trappvel, NINGUNA lo usa.
   *
   * ⚠️ Solo se retira la INVITACIÓN. Una cotización que ya tenga valores sigue
   * mostrándolos y editándolos: esconder un porcentaje que ya está sumando sería
   * exactamente la pantalla que miente.
   */
  ofrecerAdministrativos?: boolean
  onMargenChange: (pct: number) => void
  onAIUChange: (adminPct: number | null, imprevPct: number | null) => void
  onDescuentoChange: (pct: number) => void
}) {
  const [adminPct, setAdminPct] = useState(aiuAdminPct ?? 0)
  const [imprevPct, setImprevPct] = useState(aiuImprevPct ?? 0)
  const hayAdministrativos = (aiuAdminPct ?? 0) > 0 || (aiuImprevPct ?? 0) > 0
  const [showAIU, setShowAIU] = useState(hayAdministrativos)

  // El margen real se separa del general cuando alguna línea margina distinto, trae
  // precio a mano, o cuando la cotización quedó en la convención vieja de recargo
  // sobre el costo. Si no pasa nada de eso, son el mismo número.
  const margenRealEsOtraCosa =
    cascada.margenRealPct !== null && Math.abs(cascada.margenRealPct - margenPct) >= 0.05

  const nivelConsolidado = nivelDeMargen(cascada.margenRealPct, umbrales)
  const margenConsolidado = formatMargenPct(cascada.margenRealPct)

  return (
    <div className="rounded-lg bg-muted/50 p-4 space-y-2">
      <Renglon etiqueta="Costo directo" valor={cascada.costoDirecto} nota="suma de los ítems" />

      {/* ADMINISTRATIVOS — lo que cuesta operar el contrato, sobre el costo directo. */}
      {editable && showAIU && (
        <div className="border-t pt-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Administrativos (sobre el costo)</span>
            <button
              onClick={() => {
                setAdminPct(0)
                setImprevPct(0)
                setShowAIU(false)
                onAIUChange(null, null)
              }}
              className="text-[10px] text-muted-foreground hover:text-red-500"
            >
              Quitar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-[10px] text-muted-foreground">Administración %</label>
              <div className="relative">
                <input
                  type="number"
                  value={adminPct || ''}
                  placeholder="0"
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-full rounded border bg-background px-2 py-1.5 pr-6 text-xs tabular-nums"
                  onChange={e => setAdminPct(Number(e.target.value) || 0)}
                  onBlur={() => onAIUChange(adminPct || null, imprevPct || null)}
                />
                <Percent className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              </div>
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] text-muted-foreground">Imprevistos %</label>
              <div className="relative">
                <input
                  type="number"
                  value={imprevPct || ''}
                  placeholder="0"
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-full rounded border bg-background px-2 py-1.5 pr-6 text-xs tabular-nums"
                  onChange={e => setImprevPct(Number(e.target.value) || 0)}
                  onBlur={() => onAIUChange(adminPct || null, imprevPct || null)}
                />
                <Percent className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              </div>
            </div>
          </div>
        </div>
      )}
      {editable && !showAIU && ofrecerAdministrativos && (
        <button
          onClick={() => setShowAIU(true)}
          className="text-[11px] text-muted-foreground hover:text-amber-600 hover:underline"
        >
          + Administración e imprevistos
        </button>
      )}
      {cascada.administrativos > 0 && (
        <Renglon
          etiqueta="Administrativos"
          valor={cascada.administrativos}
          nota={`${(aiuAdminPct ?? 0) + (aiuImprevPct ?? 0)}% sobre el costo`}
        />
      )}

      <div className="border-t pt-2">
        <Renglon etiqueta="Costo de venta" valor={cascada.costoDeVenta} nota="lo que hay que poner" fuerte />
      </div>

      {/* MARGEN — el de la cotización completa. Las líneas que traen el suyo lo dicen
          en su propia fila, así que el número de aquí no las alcanza. */}
      {editable && (
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          {/* Se llama "Margen general" porque es como lo nombra quien cotiza. El
              matiz de la convención no se pierde: va en el tooltip, y el margen
              real del negocio queda impreso abajo, al lado del precio de venta. */}
          <label
            className="text-xs font-medium text-muted-foreground"
            title={convencionMargen === 'sobre_venta'
              ? 'Se calcula sobre la venta: el número que escribes ES el margen real.'
              : `Se calcula como ${nombreDelMargen(convencionMargen).toLowerCase()} sobre el costo, así que el margen real sale un poco por debajo. Lo ves abajo, junto al precio de venta.`}
          >
            Margen general
          </label>
          <div className="relative w-24">
            <input
              key={`margen-cot-${margenPct}`}
              type="number"
              defaultValue={margenPct || ''}
              placeholder="0"
              step="0.01"
              className="w-full rounded border bg-background py-1.5 pl-2 pr-6 text-sm tabular-nums"
              onBlur={e => {
                const pct = Number(e.target.value) || 0
                if (pct === margenPct) return
                onMargenChange(pct)
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            />
            <Percent className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          </div>
        </div>
      )}
      <Renglon etiqueta="Venta bruta" valor={cascada.ventaBruta} />

      {/* DESCUENTO COMERCIAL — el único que ve el cliente. El de cada ítem es de
          compra y ya está adentro del costo. */}
      {editable && (
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <label className="text-xs font-medium text-muted-foreground">Descuento comercial</label>
          <div className="relative w-24">
            <input
              key={`desc-cot-${descuentoPct}`}
              type="number"
              defaultValue={descuentoPct || ''}
              placeholder="0"
              min="0"
              max="100"
              step="0.01"
              className="w-full rounded border bg-background py-1.5 pl-2 pr-6 text-sm tabular-nums"
              onBlur={e => {
                const pct = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                if (pct === descuentoPct) return
                onDescuentoChange(pct)
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            />
            <Percent className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          </div>
        </div>
      )}
      {cascada.descuentoComercial > 0 && (
        <Renglon etiqueta="Descuento comercial" valor={cascada.descuentoComercial} nota={`${descuentoPct}%`} tono="rojo" />
      )}

      <div className="border-t pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">Precio de venta</span>
          <span className="text-base font-bold tabular-nums">{formatCOP(cascada.precioVenta)}</span>
        </div>
        {/* El margen del viaje completo, SIEMPRE en pantalla mientras se arma.
            Antes solo aparecía cuando difería del margen general o cuando era bajo,
            así que la cotización sana no mostraba ninguna cifra consolidada: el
            número que hay que conocer antes de mandar la cotización solo se veía
            cuando ya era malo.
            La etiqueta cambia a "Margen real" cuando NO coincide con el general,
            que es lo que obliga a mirar los dos por separado. */}
        {margenConsolidado && cascada.costoDeVenta > 0 && (
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {margenRealEsOtraCosa ? 'Margen real del viaje' : 'Margen del viaje'}
            </span>
            <span
              className={`text-[11px] font-semibold tabular-nums ${
                nivelConsolidado === 'bajo_piso'
                  ? 'text-red-600'
                  : nivelConsolidado === 'aviso'
                    ? 'text-amber-600'
                    : 'text-green-600'
              }`}
              title={
                nivelConsolidado === 'bajo_piso'
                  ? textoPiso(umbrales.pisoPct, pisoBloqueaAvance)
                  : nivelConsolidado === 'aviso'
                    ? `Por debajo del ${formatMargenPct(umbrales.avisoPct)} de margen. Avisa, no bloquea.`
                    : undefined
              }
            >
              {margenConsolidado}
              {nivelConsolidado === 'bajo_piso' && (
                <span className="ml-1">· bajo el margen mínimo{pisoBloqueaAvance && ' · no deja avanzar'}</span>
              )}
              {nivelConsolidado === 'aviso' && <span className="ml-1">· bajo</span>}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Mini calculadora inline ────────────────────────────────────

function CalcInput({ placeholder, value, onChange, onApply, prefix, formatted }: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  onApply?: (v: string) => void
  prefix?: string
  formatted?: boolean
}) {
  const [showCalc, setShowCalc] = useState(false)
  const [expr, setExpr] = useState('')

  const evalExpr = (input: string): number | null => {
    try {
      const sanitized = input.replace(/[^0-9+\-*/.() ]/g, '')
      if (!sanitized.trim()) return null
      const result = Function(`"use strict"; return (${sanitized})`)()
      if (typeof result === 'number' && isFinite(result)) return Math.round(result)
      return null
    } catch {
      return null
    }
  }

  const handleApply = () => {
    const result = evalExpr(expr)
    if (result !== null && result > 0) {
      const str = result.toString()
      onChange(str)
      if (onApply) onApply(str)
      setShowCalc(false)
      setExpr('')
    }
  }

  const handleCommit = () => {
    if (onApply && value) onApply(value)
  }

  const preview = evalExpr(expr)
  const numVal = Number(value)
  const displayValue = formatted && value && !isNaN(numVal) ? numVal.toLocaleString('es-CO') : value

  return (
    <div className="relative">
      <div className="flex gap-1">
        <div className="relative flex-1 min-w-0">
          {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>}
          <input
            type={formatted ? 'text' : 'number'}
            inputMode="numeric"
            placeholder={placeholder}
            value={displayValue}
            onChange={e => {
              const raw = formatted ? e.target.value.replace(/[^0-9]/g, '') : e.target.value
              onChange(raw)
            }}
            onBlur={handleCommit}
            onKeyDown={e => e.key === 'Enter' && handleCommit()}
            className={`w-full rounded border bg-background py-1.5 pr-2 text-${formatted ? 'sm' : 'xs'} min-w-0 ${prefix ? 'pl-7' : 'px-2'}`}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCalc(!showCalc)}
          className={`shrink-0 rounded border px-1.5 py-1.5 transition-colors ${showCalc ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
        >
          <Calculator className="h-3 w-3" />
        </button>
      </div>
      {showCalc && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border bg-popover p-2 shadow-lg">
          <input
            type="text"
            value={expr}
            onChange={e => setExpr(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleApply()}
            placeholder="ej: 150000 * 3"
            autoFocus
            className="w-full rounded border bg-background px-2 py-1.5 text-xs font-mono"
          />
          {preview !== null && (
            <p className="mt-1 text-right text-xs font-mono text-green-600">
              = {preview.toLocaleString('es-CO')}
            </p>
          )}
          <div className="mt-1.5 flex justify-end gap-1">
            <button
              type="button"
              onClick={() => { setShowCalc(false); setExpr('') }}
              className="rounded px-2 py-1 text-[10px] hover:bg-accent"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={preview === null || preview <= 0}
              className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground disabled:opacity-50"
            >
              Usar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
