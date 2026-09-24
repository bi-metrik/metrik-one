/**
 * Los campos extra (la titularidad de SOENA) se PINTAN en la tarjeta.
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

describe('NegocioCard · campos extra', () => {
  it('pinta la modalidad y los titulares en una línea compacta', () => {
    const html = pintar({
      extras: [{ indice: 0, label: 'Titularidad', valor: 'Copropiedad', detalle: ['Ana Pérez', 'Luis Gómez'] }],
    })
    expect(html).toContain('Copropiedad')
    expect(html).toContain(' · Ana Pérez, Luis Gómez')
    expect(html).toContain('title="Titularidad: Copropiedad · Ana Pérez, Luis Gómez"')
    // Truncada: un nombre largo no rompe la tarjeta en celular.
    expect(html).toMatch(/<p class="[^"]*truncate[^"]*"[^>]*data-extra="Titularidad"/)
  })

  it('sin extras no pinta la línea', () => {
    expect(pintar({ extras: [] })).not.toContain('data-extra=')
    // Un negocio de una lista vieja (sin la propiedad) tampoco revienta.
    expect(pintar({})).not.toContain('data-extra=')
  })
})
