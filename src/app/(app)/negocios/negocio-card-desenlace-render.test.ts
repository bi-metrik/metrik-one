/**
 * El chip del desenlace se PINTA, y se pinta como historia y no como alarma.
 *
 * ⚠️ Por qué hace falta además de las pruebas puras de `desenlace-retorno.ts`:
 * `leerDesenlacesDeMetadata` y `textoChipDesenlace` pueden estar perfectas y el JSX
 * ignorarlas. Solo esta prueba mata la mutación «la tarjeta no lee
 * `negocio.desenlaces`». Mismo precedente que `negocio-card-cita-render.test.ts` y el
 * panel de retenidos (#581).
 *
 * Y la segunda mitad importa igual: el brief pide explícitamente que esto **no** sea
 * marca roja de atención inmediata —eso está reservado para la cita a menos de 36 h sin
 * documentación (PR #598)—. Un rechazo de la DIAN es historia del caso. Sin una prueba
 * que lo fije, la próxima persona que toque los chips no tiene cómo saberlo.
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 *
 * ⚠️ Mutaciones MEDIDAS el 2026-09-09 sobre las 6 pruebas de este archivo. Las tres caen:
 *   · el JSX no lee `negocio.desenlaces` ................... 5 rojas
 *   · el chip sube a rojo sólido, como el reproceso ........ 1 roja (la del tono)
 *   · usar `d.chip` crudo en vez de `textoChipDesenlace` ... 1 roja (la del conteo)
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

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

const negocio = (extra: Record<string, unknown>) =>
  ({
    id: 'n1',
    nombre: 'Cliente de prueba',
    codigo: 'V0313',
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

const UN_RECHAZO = [{
  clave: 'pqr_rechazos',
  chip: 'PQR rechazado',
  conteo: 1,
  ultimo_at: '2026-09-09T15:04:00Z',
  ultima_referencia: 'PQR-2026-777',
}]

describe('NegocioCard · desenlace que devolvió el caso', () => {
  it('un negocio sin desenlaces no dice nada', () => {
    expect(pintar({})).not.toContain('PQR rechazado')
  })

  it('con un rechazo, el chip aparece', () => {
    expect(pintar({ desenlaces: UN_RECHAZO })).toContain('PQR rechazado')
  })

  it('el conteo solo aparece a partir del segundo', () => {
    // "PQR rechazado" se lee solo; "PQR rechazado ×1" invita a preguntar qué es el 1.
    expect(pintar({ desenlaces: UN_RECHAZO })).not.toContain('×1')
    const dos = [{ ...UN_RECHAZO[0], conteo: 2 }]
    expect(pintar({ desenlaces: dos })).toContain('PQR rechazado ×2')
  })

  it('la ayuda emergente ubica el ciclo: cuántas veces y con qué radicado', () => {
    const html = pintar({ desenlaces: UN_RECHAZO })
    expect(html).toContain('1 vez')
    expect(html).toContain('PQR-2026-777')
  })

  it('⚠️ es historia, NO alarma: tinte suave, nunca el relleno sólido del reproceso', () => {
    // El rojo sólido está reservado para la cita a menos de 36 h sin documentación.
    // Esta prueba es la única que puede impedir que alguien lo suba de tono sin querer.
    const html = pintar({ desenlaces: UN_RECHAZO })
    const chip = html.slice(html.indexOf('PQR rechazado') - 400, html.indexOf('PQR rechazado'))
    expect(chip).toContain('bg-papel')
    expect(chip).toContain('text-tinta-suave')
    expect(chip).not.toContain('bg-alerta')
    expect(chip).not.toContain('bg-[#DC2626]')
  })

  it('convive con el chip de reproceso sin reemplazarlo: son cosas distintas', () => {
    // Un reproceso es falla propia y alimenta el bono de calidad; un PQR rechazado por
    // la DIAN no es falla de SOENA. Que un caso tenga los dos tiene que poder verse.
    const html = pintar({
      desenlaces: UN_RECHAZO,
      reproceso: { tipo: 'devolucion_dian', ciclo: 1, etapa_retorno: 'Cita' },
    })
    expect(html).toContain('PQR rechazado')
    expect(html).toContain('Reproceso')
  })
})
