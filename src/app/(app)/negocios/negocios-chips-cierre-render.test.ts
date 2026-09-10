/**
 * Los tres chips de motivo de la pestaña «Cerrados» cuentan y filtran de verdad.
 *
 * ⚠️ Por qué hace falta una prueba de RENDER y no basta con probar
 * `motivoCierreDeEstado` en aislamiento: el helper puede estar perfecto y el JSX seguir
 * preguntando por otro campo. Ese era exactamente el defecto que este PR corrige —los
 * chips filtraban por `negocios.cierre_motivo`, que está en NULL en el 100% de los
 * cierres reales, así que **los tres daban cero siempre** y elegir uno vaciaba la lista
 * sin explicación—. Una prueba pura no lo habría visto. Mismo precedente que
 * `negocio-card-desenlace-render.test.ts` y el panel de retenidos (#581).
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 *
 * ⚠️ Mutaciones MEDIDAS el 2026-09-10 sobre las 5 pruebas de este archivo:
 *   · `motivoCierreDeEstado` devuelve siempre null (el defecto original) ... 4 rojas
 *   · el FILTRO compara `n.estado === motivoCierre` ....................... 1 roja
 *   · el CONTEO del chip compara `n.estado === m` ......................... 1 roja
 *
 * Las dos últimas caen por «Exitosos», el único de los tres donde el estado y la
 * etiqueta no coinciden (`completado` ≠ `exitoso`). Por eso el fixture NO puede tener
 * solo perdidos y cancelados: con esos, comparar el estado crudo pasaría por bueno.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// La tarjeta se reemplaza por su código: lo que aquí se prueba es QUIÉN entra a la
// lista, no cómo se pinta cada caso (eso ya lo cubren las pruebas de la tarjeta).
vi.mock('./negocio-card', () => ({
  default: ({ negocio }: { negocio: { codigo: string | null } }) =>
    React.createElement('div', null, `tarjeta:${negocio.codigo}`),
}))
vi.mock('./descargar-excel-button', () => ({
  default: () => React.createElement('div', null, 'excel'),
}))

const { default: NegociosClient } = await import('./negocios-client')

const cerrado = (codigo: string, estado: string) =>
  ({
    id: `id-${codigo}`,
    codigo,
    nombre: codigo,
    precio_estimado: null,
    precio_aprobado: null,
    carpeta_url: null,
    stage_actual: 'cobro',
    estado,
    created_at: '2026-08-01T12:00:00Z',
    linea_nombre: null,
    linea_numero: null,
    etapa_nombre: 'Facturación',
    etapa_numero: 19,
    etapa_stage: 'cobro',
    empresa_nombre: null,
    contacto_nombre: null,
    contacto_telefono: null,
    costos_ejecutados: 0,
    pausado: false,
    pausado_hasta: null,
    motivo_pausa: null,
    closed_at: '2026-09-01T12:00:00Z',
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
    etapa_cambiada_at: '2026-08-15T12:00:00Z',
    etapa_sla_horas: null,
    horas_habiles_en_etapa: null,
    sla_exceso_horas: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

/**
 * Proporción tomada de SOENA el 2026-09-10 (17 / 11 / 5), reducida para que las
 * afirmaciones se lean: tres desenlaces distintos y ningún par con el mismo conteo, así
 * un chip no puede pasar por otro.
 */
const CERRADOS = [
  cerrado('V0001', 'completado'),
  cerrado('V0002', 'completado'),
  cerrado('V0003', 'completado'),
  cerrado('V0004', 'perdido'),
  cerrado('V0005', 'perdido'),
  cerrado('V0006', 'cancelado'),
]

const pintar = (searchParams: Record<string, string>) =>
  renderToStaticMarkup(
    React.createElement(NegociosClient, {
      negocios: [],
      cerrados: CERRADOS,
      stagesActivos: ['venta', 'ejecucion', 'cobro'],
      etapas: [],
      searchParams,
      hoyISO: '2026-09-10',
    }),
  )

describe('/negocios · chips de motivo de la pestaña Cerrados', () => {
  it('cada chip trae su conteo, y ninguno queda en cero', () => {
    const html = pintar({ fase: 'cerrados' })
    expect(html).toContain('Todos (6)')
    expect(html).toContain('Exitosos (3)')
    expect(html).toContain('Perdidos (2)')
    expect(html).toContain('Cancelados (1)')
  })

  it('elegir «Exitosos» deja solo los completados', () => {
    const html = pintar({ fase: 'cerrados', cierre: 'exitoso' })
    expect(html).toContain('tarjeta:V0001')
    expect(html).toContain('tarjeta:V0003')
    expect(html).not.toContain('tarjeta:V0004')
    expect(html).not.toContain('tarjeta:V0006')
  })

  it('elegir «Perdidos» deja solo los perdidos', () => {
    const html = pintar({ fase: 'cerrados', cierre: 'perdido' })
    expect(html).toContain('tarjeta:V0004')
    expect(html).toContain('tarjeta:V0005')
    expect(html).not.toContain('tarjeta:V0001')
    expect(html).not.toContain('tarjeta:V0006')
  })

  it('elegir «Cancelados» deja solo el cancelado', () => {
    const html = pintar({ fase: 'cerrados', cierre: 'cancelado' })
    expect(html).toContain('tarjeta:V0006')
    expect(html).not.toContain('tarjeta:V0001')
    expect(html).not.toContain('tarjeta:V0004')
  })

  it('«Todos» no descarta ninguno: los seis siguen listados', () => {
    // Control del filtro: sin esta prueba, un criterio que descartara de más se vería
    // igual de bien en las tres de arriba (cada una solo mira su propio grupo).
    const html = pintar({ fase: 'cerrados' })
    for (const c of ['V0001', 'V0002', 'V0003', 'V0004', 'V0005', 'V0006']) {
      expect(html).toContain(`tarjeta:${c}`)
    }
  })
})
