/**
 * La tarjeta ofrece la carpeta que corresponde al workspace: en Drive, el botón que
 * abre la carpeta de Drive; fuera de Drive, el enlace al repositorio del negocio en
 * ONE. Solo una prueba de render fija que el JSX lea `almacenamiento_externo`.
 *
 * ⚠️ Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
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

describe('NegocioCard · carpeta del negocio', () => {
  it('workspace fuera de Drive: enlace al repositorio, nunca el botón de Drive', () => {
    const html = pintar({ almacenamiento_externo: true, carpeta_url: null })
    expect(html).toContain('href="/negocios/n1/archivos"')
    expect(html).toContain('Abrir archivos del negocio')
    expect(html).not.toContain('Abrir carpeta Drive')
  })

  it('fuera de Drive aunque quede una carpeta_url vieja: sigue siendo el repositorio', () => {
    const html = pintar({ almacenamiento_externo: true, carpeta_url: 'https://drive.google.com/drive/folders/x' })
    expect(html).toContain('href="/negocios/n1/archivos"')
    expect(html).not.toContain('Abrir carpeta Drive')
  })

  it('workspace en Drive con carpeta: el botón de Drive de siempre', () => {
    const html = pintar({ almacenamiento_externo: false, carpeta_url: 'https://drive.google.com/drive/folders/x' })
    expect(html).toContain('Abrir carpeta Drive')
    expect(html).not.toContain('/archivos"')
  })

  it('workspace en Drive sin carpeta: ninguno de los dos', () => {
    const html = pintar({ carpeta_url: null })
    expect(html).not.toContain('Abrir carpeta Drive')
    expect(html).not.toContain('Abrir archivos del negocio')
  })
})
