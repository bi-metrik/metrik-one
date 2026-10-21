/**
 * Arnés del encabezado fijo del negocio con la pastilla de «Lo que suma» (brief del 2026-10-16,
 * «la pastilla no agranda el encabezado»). Monta el `NegocioDetailClient` REAL con un centro que
 * pinta el `LoQueSuma` REAL dentro del marco, y una réplica del cascarón de la app (menú de 224 px,
 * barra de 56 px y `p-6`), para que el encabezado tenga en Chromium el mismo ancho que en
 * producción. Lo mide `scripts/encabezado-pastilla.e2e.mjs`.
 *
 * Parámetros de la URL:
 *  · `caso`: `fijo` (el viaje largo de la prueba de Vera), `corto`, `motivo` (le faltan pasajeros:
 *    renglón ámbar de dos líneas) o `sin-viaje` (V8: el negocio no tiene línea de viaje).
 *  · `pastilla=0`: el mismo negocio sin la pastilla (el alto de referencia).
 *  · `punto`: `rojo` o `ambar`.
 */
import '../../src/app/globals.css'
import './fuentes.css'

import { createElement, useContext, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'

import NegocioDetailClient from '@/app/(app)/negocios/[id]/negocio-detail-client'
import { MarcoCotizacionContexto } from '@/app/(app)/negocios/marco-cotizacion-contexto'
import { LoQueSuma, type DatosLoQueSuma } from '@/app/(app)/negocios/por-pasos/lo-que-suma'

type Props = ComponentProps<typeof NegocioDetailClient>

const parametros = new URLSearchParams(location.search)
const caso = parametros.get('caso') ?? 'fijo'
const conPastilla = parametros.get('pastilla') !== '0'
const punto = parametros.get('punto')

const VIAJES: Record<string, { destino: string | null; fechas: { inicio: string | null; fin: string | null }; composicion: { adultos: number; ninos: number; infantes: number } | null } | null> = {
  fijo: { destino: 'San Andrés y Providencia', fechas: { inicio: '2026-11-23', fin: '2026-11-28' }, composicion: { adultos: 6, ninos: 1, infantes: 1 } },
  corto: { destino: 'Cartagena', fechas: { inicio: '2026-12-02', fin: '2026-12-05' }, composicion: { adultos: 2, ninos: 0, infantes: 0 } },
  motivo: { destino: 'San Andrés y Providencia', fechas: { inicio: '2026-11-23', fin: '2026-11-28' }, composicion: null },
  'sin-viaje': null,
}
const viajeDelCaso = caso in VIAJES ? VIAJES[caso] : VIAJES.fijo

const negocio = {
  id: 'neg-arnes', workspace_id: 'ws-arnes', codigo: 'F 26 1', nombre: 'PRUEBA · San Andrés · caso fijo', estado: 'abierto',
  stage_actual: 'venta', etapa_actual_id: 'e2', precio_aprobado: null, precio_estimado: null,
  carpeta_url: null, pausado: false, pausado_hasta: null, veces_pausado: 0, motivo_pausa: null,
  motivo_pausa_detalle: null, metadata: {}, fecha_venta: null, responsables: [],
  etapas_negocio: { nombre: 'Cotización', stage: 'venta', numero: 2 },
  lineas_negocio: { nombre: 'Viaje a medida', numero: 1 },
  contactos: { id: 'c-1', nombre: 'Familia de Prueba', telefono: null, email: null, rol: 'decisor', segmento: 'sin_contactar' },
  empresas: null, campanas_contacto: null,
}

const viaje = viajeDelCaso && {
  negocioId: 'neg-arnes',
  viaje: viajeDelCaso,
  iataDestino: null,
  solicitud: { destino: viajeDelCaso.destino, alcance: 'Nacional', fechas: '23 al 28 nov 2026', tipoDeFechas: 'fechas fijas', pasajeros: '6 adultos, 1 niño, 1 infante', requisitos: null },
  perfil: null,
  cotizaciones: [{ id: 'cot-arnes', codigo: 'COT-2026-0901', estado: 'borrador', valorTotal: 22448922, editadaEl: '2026-10-14T14:00:00Z' }],
  puedeCrearCotizacion: true,
}

const datos: DatosLoQueSuma = {
  renglones: [],
  nombreDeOpcion: id => id,
  faltaPrecio: () => null,
  total: 22448922,
  costo: 19081584,
  margenPct: 15,
  otrasQueVan: [],
  pantallazosEnBandeja: punto === 'ambar' ? 1 : 0,
  incompleto: false,
  rojos: punto === 'rojo' ? 2 : 0,
}

/** El centro: lo que la cotización por pasos pone dentro del marco (solo «Lo que suma» y relleno). */
function Centro() {
  const marco = useContext(MarcoCotizacionContexto)
  return (
    <div data-centro-arnes>
      {conPastilla && <LoQueSuma datos={datos} encabezado={marco ? (marco.encabezado ?? null) : undefined} />}
      <div style={{ height: 2400 }} />
    </div>
  )
}

const props = {
  negocio,
  bloques: [],
  etapasLinea: [
    { id: 'e1', nombre: 'Solicitud', stage: 'venta', orden: 1, numero: 1 },
    { id: 'e2', nombre: 'Cotización', stage: 'venta', orden: 2, numero: 2 },
    { id: 'e3', nombre: 'Reserva', stage: 'venta', orden: 3, numero: 3 },
  ],
  profiles: [],
  currentUserId: 'u-1',
  currentUserEsResponsable: true,
  userRole: 'operator',
  cobros: [],
  cotizacionesNegocio: [],
  resumenFinanciero: { totalCobrado: 0, porCobrar: 0, costosEjecutados: 0 },
  ejecucionData: { presupuesto: [], gastos: [], horas: [] },
  historialData: { gastos: [], horas: [], cobros: [] },
  actividad: [],
  staffList: [],
  datosOtrasEtapas: {},
  pausaEnabled: false,
  viaje,
  extras: null,
  centro: createElement(Centro),
  cotActualId: 'cot-arnes',
} as unknown as Props

function Cascaron() {
  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="hidden md:flex w-56 shrink-0 flex-col" style={{ backgroundColor: 'var(--sidebar)' }} />
        <div className="flex flex-1 min-h-0 flex-col">
          <header className="hidden md:flex h-14 items-center border-b border-border bg-background px-6 shrink-0" />
          <header className="flex h-14 items-center border-b border-border px-4 md:hidden" />
          <div className="relative flex flex-1 min-h-0 flex-col">
            <main className="flex-1 overflow-auto min-h-0 bg-background" data-main-arnes>
              <div className="p-6 pb-24 md:pb-6">
                <NegocioDetailClient {...props} />
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('raiz')!).render(<Cascaron />)
