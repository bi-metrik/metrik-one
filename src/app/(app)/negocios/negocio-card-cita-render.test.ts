/**
 * La marca roja y el chip de la cita se PINTAN de verdad.
 *
 * ⚠️ Por qué hace falta además de las pruebas puras: `evaluarAtencionCita` puede
 * estar perfecta y la tarjeta ignorarla. Solo esta prueba mata la mutación «el
 * JSX no lee `negocio.atencion_cita`». Mismo precedente que
 * `recaudo-cambiado-banner.test.ts` (PR #569) y el panel de retenidos (#581).
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// La tarjeta es un client component: navega, avisa y llama server actions. Nada
// de eso corre en este render, pero sí se importa, así que se dobla el módulo
// entero — un `'use server'` real arrastra el runtime de Next y no resuelve aquí.
vi.mock('./negocio-v2-actions', () => ({
  agregarResponsable: vi.fn(),
  quitarResponsable: vi.fn(),
}))
vi.mock('./marcas-actions', () => ({
  agregarMarcaNegocio: vi.fn(),
  quitarMarcaNegocio: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/card-link', () => ({
  CardLink: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}))

const { default: NegocioCard } = await import('./negocio-card')

/** Lo mínimo que la tarjeta necesita para pintarse. */
const negocio = (extra: Record<string, unknown>) =>
  ({
    id: 'n1',
    nombre: 'Cliente de prueba',
    codigo: 'V0001',
    precio_estimado: null,
    precio_aprobado: 850_000,
    carpeta_url: null,
    stage_actual: 'ejecucion',
    estado: 'abierto',
    created_at: '2026-09-01T12:00:00Z',
    linea_nombre: null,
    linea_numero: null,
    etapa_nombre: 'Cita',
    etapa_numero: 13,
    etapa_stage: 'ejecucion',
    empresa_nombre: null,
    contacto_nombre: null,
    contacto_telefono: null,
    costos_ejecutados: 0,
    pausado: false,
    pausado_hasta: null,
    motivo_pausa: null,
    cierre_motivo: null,
    closed_at: null,
    razon_cierre: null,
    vehiculo_label: null,
    seccional_label: null,
    ciudad_label: null,
    cedula: null,
    radicado: null,
    numero_factura: null,
    fecha_cita: null,
    cita_pendiente: false,
    atencion_cita: null,
    servicio: null,
    servicio_label: null,
    responsables: [],
    es_meta_lead: false,
    reproceso: null,
    desenlaces: [],
    origen: null,
    aliado_nombre: null,
    marcas: [],
    etapa_cambiada_at: '2026-09-08T12:00:00Z',
    etapa_sla_horas: null,
    horas_habiles_en_etapa: null,
    sla_exceso_horas: null,
    ...extra,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const pintar = (extra: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(NegocioCard, { negocio: negocio(extra) }))

describe('NegocioCard · cita en la DIAN', () => {
  it('pinta la marca roja con lo que falta y cuánto queda', () => {
    const html = pintar({
      fecha_cita: '2026-09-26T09:30',
      atencion_cita: { docs: ['certificado bancario'], horas: 20.4 },
    })
    expect(html).toContain('Atención inmediata: falta certificado bancario, cita en 20 h')
  })

  it('sin marca no pinta nada de atención inmediata', () => {
    const html = pintar({ fecha_cita: '2026-09-26T09:30' })
    expect(html).not.toContain('Atención inmediata')
  })

  it('un negocio CERRADO no muestra la marca aunque venga calculada', () => {
    // La cita de un caso cerrado ya no es accionable; pintarla en rojo sería ruido.
    //
    // El caso está escrito como llega de verdad: `estado` cerrado y `cierre_motivo` en
    // NULL, que es como está el 100% de los cierres reales (el CHECK
    // `negocios_cierre_motivo_coherente` solo admite la columna con stage `cerrado`).
    // Con el criterio viejo —`cierre_motivo !== null`— esta tarjeta se pintaba como
    // abierta y la marca salía.
    const html = pintar({
      estado: 'completado',
      cierre_motivo: null,
      closed_at: '2026-09-09T12:00:00Z',
      fecha_cita: '2026-09-26T09:30',
      atencion_cita: { docs: ['certificado bancario'], horas: 2 },
    })
    expect(html).not.toContain('Atención inmediata')
    // Y se reconoce como cerrado sin motivo: rótulo genérico y fecha de salida.
    expect(html).toContain('CERRADO')
  })

  it('el chip de la cita lleva día y hora, y lee el valor como hora de pared', () => {
    // '2026-09-26T09:30' es civil de Bogotá. Leído como instante UTC el chip
    // diría «25 sept», que es el error que este chip no puede cometer. Y el "de"
    // del patrón CLDR de 'es-CO' no puede volver: "26 de sept · 09:30" estorba.
    const html = pintar({ fecha_cita: '2026-09-26T09:30' })
    expect(html).toContain('Cita 26 sept · 09:30')
    // Acotado al chip: la ayuda emergente SÍ dice «26 de septiembre», y ahí está bien.
    expect(html).not.toContain('Cita 26 de sept')
  })

  it('la ayuda emergente da la cita completa, con la hora que asignó la DIAN', () => {
    const html = pintar({ fecha_cita: '2026-09-26T09:30' })
    expect(html).toContain('Cita en la DIAN: 26 de septiembre de 2026, 9:30 a. m.')
  })

  it('un valor heredado de solo día no inventa hora', () => {
    const html = pintar({ fecha_cita: '2026-09-26' })
    expect(html).toContain('Cita 26 sept')
    expect(html).not.toContain('· 00:00')
  })

  it('sin fecha pero con el bloque abierto, la tarjeta lo dice', () => {
    const html = pintar({ cita_pendiente: true })
    expect(html).toContain('Sin fecha de cita')
  })

  it('sin fecha y sin bloque abierto no dice nada de la cita', () => {
    const html = pintar({})
    expect(html).not.toContain('Sin fecha de cita')
    expect(html).not.toContain('Cita ')
  })
})
