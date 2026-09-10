/**
 * El buscador de `/negocios` avisa cuando la coincidencia está fuera de la pestaña.
 *
 * El defecto: con un chip de fase puesto, buscar el código exacto de un negocio CERRADO
 * devolvía el vacío de la fase, y eso se lee como «el negocio no existe». Pasó en el QA
 * del #610 con V0419 en soena (`completado`, `stage_actual = 'cobro'`). Medido en
 * producción el 2026-09-10: los 48 cerrados de la base conservan un `stage_actual` que
 * ningún chip de fase muestra, así que a todos les pasaba lo mismo.
 *
 * ⚠️ Por qué RENDER y no basta con `contarCoincidenciasFuera` en aislamiento: el helper
 * puede estar perfecto y el JSX no pintarlo nunca, o pintarlo solo dentro de la rama
 * `sinResultadosBusqueda` —que es justo la que NO se muestra cuando la fase está vacía
 * sin filtrar—. Ninguna prueba pura ve esa diferencia. Precedente: el banner de recaudo
 * (#569) y el panel de retenidos (#581).
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 *
 * ⚠️ Límite declarado: la suite corre en `node`, sin DOM, así que el CLIC de «Ver en
 * Todos» no se ejercita. Lo que sí se fija es que el botón existe y que el estado al
 * que lleva (`fase=todos`, sin etapa y sin motivo) SÍ muestra el caso buscado — si el
 * destino no lo trajera, el aviso mandaría a otra pantalla vacía.
 *
 * ⚠️ Mutaciones MEDIDAS el 2026-09-10 sobre las 7 pruebas de este archivo:
 *   · el aviso se pinta solo dentro de la rama `sinResultadosBusqueda` .... 2 rojas
 *   · el aviso NO se pinta (se borra el bloque del JSX) ................... 4 rojas
 *   · el conteo ignora `currentFiltrado` (cuenta también lo visible) ...... 3 rojas
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// La tarjeta se reemplaza por su código: aquí se prueba QUIÉN entra a la lista y qué
// dice el aviso, no cómo se pinta cada caso.
vi.mock('./negocio-card', () => ({
  default: ({ negocio }: { negocio: { codigo: string | null } }) =>
    React.createElement('div', null, `tarjeta:${negocio.codigo}`),
}))
vi.mock('./descargar-excel-button', () => ({
  default: () => React.createElement('div', null, 'excel'),
}))

const { default: NegociosClient } = await import('./negocios-client')

const fila = (codigo: string, stage: string, estado: string) =>
  ({
    id: `id-${codigo}`,
    codigo,
    nombre: codigo,
    precio_estimado: null,
    precio_aprobado: null,
    carpeta_url: null,
    stage_actual: stage,
    estado,
    created_at: '2026-08-01T12:00:00Z',
    linea_nombre: null,
    linea_numero: null,
    etapa_nombre: 'Facturación',
    etapa_numero: 19,
    etapa_stage: stage,
    empresa_nombre: null,
    contacto_nombre: null,
    contacto_telefono: null,
    costos_ejecutados: 0,
    pausado: false,
    pausado_hasta: null,
    motivo_pausa: null,
    closed_at: estado === 'abierto' ? null : '2026-09-01T12:00:00Z',
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

// Un abierto en Cobro (para que la fase NO esté vacía sin filtrar) y dos cerrados que
// conservan su stage, como en producción.
const ABIERTOS = [fila('V0410', 'cobro', 'abierto')]
const CERRADOS = [
  fila('V0419', 'cobro', 'completado'),
  fila('V0418', 'venta', 'perdido'),
]

const pintar = (searchParams: Record<string, string>) =>
  renderToStaticMarkup(
    React.createElement(NegociosClient, {
      negocios: ABIERTOS,
      cerrados: CERRADOS,
      stagesActivos: ['venta', 'ejecucion', 'cobro'],
      etapas: [],
      searchParams,
      hoyISO: '2026-09-10',
    }),
  )

describe('/negocios · aviso de coincidencias en otras pestañas', () => {
  it('el caso del QA: buscar el código de un cerrado con «Cobro» puesto avisa, no niega', () => {
    const html = pintar({ fase: 'cobro', q: 'V0419' })
    // La lista sigue vacía a propósito: el chip de fase no se ignora.
    expect(html).not.toContain('tarjeta:V0419')
    expect(html).toContain('Sin resultados para')
    // Y el aviso con su salida.
    expect(html).toContain('1 coincidencia en otras pestañas')
    expect(html).toContain('Ver en Todos')
  })

  it('el destino del aviso SÍ trae el caso: en «Todos» aparece y el aviso desaparece', () => {
    const html = pintar({ fase: 'todos', q: 'V0419' })
    expect(html).toContain('tarjeta:V0419')
    expect(html).not.toContain('en otras pestañas')
  })

  it('el motivo de cierre también es pestaña: dentro de Cerrados con un motivo puesto, avisa', () => {
    // V0419 es `completado` (exitoso). Con el chip «Perdidos» la lista queda vacía y el
    // caso sigue existiendo: es la razón por la que la salida limpia el motivo, no solo
    // la fase. Si el botón olvidara `setMotivoCierre('todos')`, el destino escondería
    // otra vez lo mismo que se fue a buscar.
    const conMotivo = pintar({ fase: 'cerrados', q: 'V0419', cierre: 'perdido' })
    expect(conMotivo).not.toContain('tarjeta:V0419')
    expect(conMotivo).toContain('1 coincidencia en otras pestañas')
    // El destino, con las tres dimensiones sueltas, sí lo trae.
    expect(pintar({ fase: 'todos', q: 'V0419', cierre: 'todos' })).toContain('tarjeta:V0419')
  })

  it('también avisa cuando la fase está vacía SIN filtrar (ahí no hay mensaje de búsqueda)', () => {
    // `hayEnFaseEtapa` es false: Ejecución no tiene un solo negocio. Esa es la rama que
    // suprime «Sin resultados», y es justo donde el aviso hace más falta.
    const html = pintar({ fase: 'ejecucion', q: 'V0419' })
    expect(html).not.toContain('Sin resultados para')
    expect(html).toContain('1 coincidencia en otras pestañas')
  })

  it('con resultados a la vista, el aviso va al pie y no reemplaza la lista', () => {
    // 'V04' toca al abierto de Cobro y a los dos cerrados.
    const html = pintar({ fase: 'cobro', q: 'V04' })
    expect(html).toContain('tarjeta:V0410')
    expect(html).toContain('2 coincidencias en otras pestañas')
    // El plural es el que delata que el número sale del conteo y no está escrito a mano.
    expect(html).not.toContain('1 coincidencia en otras')
  })

  it('sin término no se pinta nada, aunque haya casos fuera de la pestaña', () => {
    const html = pintar({ fase: 'cobro' })
    expect(html).toContain('tarjeta:V0410')
    expect(html).not.toContain('en otras pestañas')
  })

  it('el aviso NO delata lo que ya está en pantalla', () => {
    // Control de que el conteo descuenta la lista visible: en «Todos» con 'V04' los
    // tres están a la vista, así que fuera no queda ninguno.
    const html = pintar({ fase: 'todos', q: 'V04' })
    expect(html).toContain('tarjeta:V0410')
    expect(html).toContain('tarjeta:V0419')
    expect(html).toContain('tarjeta:V0418')
    expect(html).not.toContain('en otras pestañas')
  })
})
