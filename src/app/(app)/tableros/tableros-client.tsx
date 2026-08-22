'use client'

import { useState, useTransition } from 'react'
import type { ComercialData, OperativoData, FinancieroData, RentabilidadComercialData, Periodo, ProcesoSeccionalData } from './types'
import { TabComercial } from './components/tab-comercial'
import { TabOperativo } from './components/tab-operativo'
import { TabFinanciero } from './components/tab-financiero'
import { TabRentabilidadComercial } from './components/tab-rentabilidad-comercial'
import { TabComercialSoena } from './components/tab-comercial-soena'
import TabCalidad from './components/tab-calidad'
import { TabOperaciones } from './components/tab-operaciones'
import type { OperacionesBonoData } from './operaciones-types'
import type { DuenoData } from '../calidad/types'
import { getComercialData, getOperativoData, getFinancieroData } from './actions'
import { pestanasDeTableros, type TableroKey } from '@/lib/tableros/pestanas'
import { ShieldCheck, LayoutDashboard } from 'lucide-react'
import type {
  ComercialResumenRow,
  ComercialMesResponse,
  ComercialSerieResponse,
  ComercialOrigenMes,
  ComercialSeccionalMes,
  ComercialPlanPagoMes,
  CapacidadSeccional,
  MetaComercial,
} from '../equipo/comercial-types'

// Que pestanas ve cada workspace lo decide `@/lib/tableros/pestanas`: la misma
// funcion que usa `page.tsx` para saber que datos pedir.
type TabKey = TableroKey

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'mes', label: 'Este mes' },
  { key: 'trimestre', label: 'Trimestre' },
  { key: '6meses', label: '6 meses' },
  { key: 'anio', label: 'Anual' },
]

// Las unicas pestanas que releen su dato cuando cambia el periodo. Declarado en
// positivo: la lista negativa anterior mostraba el selector tambien cuando no
// habia ninguna pestana, sobre la pantalla que dice que no hay tableros.
const PESTANAS_CON_PERIODO: TabKey[] = ['financiero', 'comercial', 'operativo']

export interface ComercialNegociosBundle {
  equipo: ComercialResumenRow[]
  mesInicial: ComercialMesResponse | null
  /** El mes anterior, para la comparación automática del panel. */
  mesAnteriorInicial: ComercialMesResponse | null
  origenInicial: ComercialOrigenMes | null
  seccionalInicial: ComercialSeccionalMes | null
  planPagoInicial: ComercialPlanPagoMes | null
  capacidad: CapacidadSeccional | null
  serie: ComercialSerieResponse | null
  metasIniciales: MetaComercial[]
  anioInicial: number
  mesNumInicial: number
  /** 'YYYY-MM' del mes en curso en Bogotá, resuelto en el servidor. */
  mesEnCurso: string
  diaEnCurso: number
  puedeEditarMetas: boolean
}

interface TablerosClientProps {
  initialComercial: ComercialData | null
  initialOperativo: OperativoData | null
  initialFinanciero: FinancieroData | null
  initialRentabilidad?: RentabilidadComercialData | null
  initialComercialNegocios?: ComercialNegociosBundle | null
  initialProcesoSeccional?: ProcesoSeccionalData | null
  initialOperaciones?: OperacionesBonoData | null
  /** Null si el workspace no tiene el modulo o si el rol no ve dinero. */
  initialCalidad?: DuenoData | null
  modules?: Record<string, boolean>
}

export default function TablerosClient({
  initialComercial,
  initialOperativo,
  initialFinanciero,
  initialRentabilidad,
  initialComercialNegocios,
  initialProcesoSeccional,
  initialOperaciones,
  initialCalidad,
  modules,
}: TablerosClientProps) {
  const mod = modules ?? { business: true }
  // Sin `useMemo`: armar una lista de seis elementos no justifica mantener un
  // arreglo de dependencias que hay que acordarse de ampliar con cada modulo.
  const tabs = pestanasDeTableros(mod, {
    comercialNegocios: Boolean(initialComercialNegocios),
    procesoSeccional: Boolean(initialProcesoSeccional),
    operacionesBono: Boolean(initialOperaciones),
    calidad: Boolean(initialCalidad),
  })

  // Sin `?? 'cumplimiento'`: cuando no hay ninguna pestaña, caer en la de
  // Cumplimiento hacia que la pantalla mostrara su vacio — un escudo verde y
  // nada — como si el workspace tuviera compliance. Eso es lo que veia el dueño
  // de un call center al entrar a Tableros. Ahora el vacio dice la verdad.
  const defaultTab = tabs[0]?.key ?? null
  const [activeTab, setActiveTab] = useState<TabKey | null>(defaultTab)
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [isPending, startTransition] = useTransition()

  const [comercial, setComercial] = useState(initialComercial)
  const [operativo, setOperativo] = useState(initialOperativo)
  const [financiero, setFinanciero] = useState(initialFinanciero)
  const rentabilidad = initialRentabilidad ?? null

  function handlePeriodoChange(p: Periodo) {
    setPeriodo(p)
    startTransition(async () => {
      if (activeTab === 'comercial') {
        const data = await getComercialData(p)
        if (data) setComercial(data)
      } else if (activeTab === 'operativo') {
        const data = await getOperativoData(p)
        if (data) setOperativo(data)
      } else {
        const data = await getFinancieroData(p)
        if (data) setFinanciero(data)
      }
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tableros</h1>
        <p className="text-sm text-gray-500 mt-1">Indicadores de gestion en tiempo real</p>
      </div>

      {/* Sticky tab bar + periodo */}
      <div className="sticky top-0 z-10 bg-[#F9FAFB] pt-1 pb-4 -mx-6 px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Tabs */}
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Selector de periodo: SOLO para las tres genericas. Las demas pestanas
            traen su propio control de tiempo (o son una foto de hoy), y un
            segundo reloj arriba diria que manda sobre lo que se ve debajo. */}
        {activeTab !== null && PESTANAS_CON_PERIODO.includes(activeTab) && (
          <div className="flex gap-1">
            {PERIODOS.map(p => (
              <button
                key={p.key}
                onClick={() => handlePeriodoChange(p.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  periodo === p.key
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className={`transition-opacity duration-200 ${isPending ? 'opacity-50' : 'opacity-100'}`}>
        {activeTab === null && <SinTableros />}
        {activeTab === 'calidad' && initialCalidad && <TabCalidad datos={initialCalidad} />}
        {activeTab === 'rentabilidad_comercial' && rentabilidad && <TabRentabilidadComercial data={rentabilidad} />}
        {activeTab === 'comercial_negocios' && initialComercialNegocios && (
          <TabComercialSoena
            equipo={initialComercialNegocios.equipo}
            mesInicial={initialComercialNegocios.mesInicial}
            mesAnteriorInicial={initialComercialNegocios.mesAnteriorInicial}
            origenInicial={initialComercialNegocios.origenInicial}
            seccionalInicial={initialComercialNegocios.seccionalInicial}
            planPagoInicial={initialComercialNegocios.planPagoInicial}
            capacidad={initialComercialNegocios.capacidad}
            serie={initialComercialNegocios.serie}
            metasIniciales={initialComercialNegocios.metasIniciales}
            anioInicial={initialComercialNegocios.anioInicial}
            mesNumInicial={initialComercialNegocios.mesNumInicial}
            mesEnCurso={initialComercialNegocios.mesEnCurso}
            diaEnCurso={initialComercialNegocios.diaEnCurso}
            puedeEditarMetas={initialComercialNegocios.puedeEditarMetas}
          />
        )}
        {activeTab === 'operaciones' && (
          <TabOperaciones
            proceso={initialProcesoSeccional ?? null}
            personas={initialOperaciones ?? null}
          />
        )}
        {activeTab === 'financiero' && financiero && <TabFinanciero data={financiero} />}
        {activeTab === 'comercial' && comercial && <TabComercial data={comercial} />}
        {activeTab === 'operativo' && operativo && <TabOperativo data={operativo} />}
        {activeTab === 'cumplimiento' && <CumplimientoPlaceholder />}

        {/* Empty state */}
        {activeTab === 'rentabilidad_comercial' && !rentabilidad && <EmptyState />}
        {activeTab === 'financiero' && !financiero && <EmptyState />}
        {activeTab === 'comercial' && !comercial && <EmptyState />}
        {activeTab === 'operativo' && !operativo && <EmptyState />}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-lg font-medium text-gray-400">Sin datos suficientes</p>
      <p className="text-sm text-gray-400 mt-1">Registra movimientos para ver tus indicadores aqui.</p>
    </div>
  )
}

/**
 * Ningun tablero para quien entra.
 *
 * No es un error: es que sus modulos no arman ninguna pestaña, o que las que
 * hay no son para su rol. Decirlo es mejor que mostrar el vacio de otra cosa,
 * que fue lo que paso: sin pestañas, la pantalla caia en el vacio de
 * Cumplimiento y el dueño de un call center veia un escudo verde sin
 * explicacion.
 */
function SinTableros() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 mb-4">
        <LayoutDashboard className="h-7 w-7 text-gray-400" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-gray-900">Todavía no hay tableros para ti</p>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        Los indicadores de esta pantalla dependen de los módulos activos del negocio y del rol con
        el que entras.
      </p>
    </div>
  )
}

function CumplimientoPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 mb-4">
        <ShieldCheck className="h-7 w-7 text-emerald-500" />
      </div>
      <p className="text-lg font-semibold text-gray-700">Cumplimiento</p>
      <p className="text-sm text-gray-400 mt-2 max-w-sm">
        Este tablero esta en construccion. Pronto se cargara informacion de indicadores de cumplimiento.
      </p>
    </div>
  )
}
