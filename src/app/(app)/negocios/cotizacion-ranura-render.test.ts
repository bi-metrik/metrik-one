/**
 * Los dos defectos que Mauricio vio en vivo, con Daniela y Alejandra mirando.
 *
 *  1. *«no me deja editar todavía el nombre»* — el nombre del ítem se pintaba como
 *     texto en el encabezado y **no había un solo input para él** en toda la pantalla
 *     (medido antes de tocar nada: cero `<input>` con el nombre, y el único
 *     `aria-label` de nombre era el de la cotización). Una alternativa nace llamándose
 *     «Vuelo BOG-PUJ (alternativa)» y no se podía renombrar a «WINGO», que es
 *     exactamente lo que distingue una opción de otra en la tabla y en el PDF.
 *
 *  2. *«quiero ver acá un segundo, no sé, hotel, pero no me deja cambiar»* — el grupo
 *     era un `<input type="text">` con un `datalist` armado con los grupos ya usados
 *     EN ESA cotización. En una cotización nueva ninguno tiene grupo, así que el
 *     desplegable salía con **cero opciones** (medido) y no había nada que elegir ni
 *     pista de que la palabra exacta decide si el pantallazo encuentra contrato.
 *
 * ⚠️ Por qué RENDER y no una prueba pura: las dos fallas son del JSX. `updateItem` ya
 * aceptaba `nombre` desde antes y `actualizarRanuraDeItem` ya escribía `grupo`; el
 * servidor estaba bien y la pantalla no ofrecía por dónde. Una prueba de los helpers
 * habría seguido en verde con la pantalla rota — el precedente es
 * `cotizacion-margen-render.test.ts`.
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({
  updateCotizacion: async () => ({ success: true }),
  enviarCotizacion: async () => ({ success: true }),
  duplicarCotizacion: async () => ({ success: true }),
  addItem: async () => ({ success: true }),
  updateItem: async () => ({ success: true }),
  deleteItem: async () => ({ success: true }),
  addRubro: async () => ({ success: true }),
  updateRubro: async () => ({ success: true }),
  deleteRubro: async () => ({ success: true }),
  recalcularTotales: async () => ({ success: true }),
  addItemFromServicio: async () => ({ success: true }),
  aplicarAIU: async () => ({ success: true }),
  getRastroDeMargen: async () => ({ ok: true, entradas: [], alcance: 'negocio' }),
}))
vi.mock('@/app/(app)/config/servicios-actions', () => ({ getServiciosActivos: async () => [] }))
vi.mock('@/app/(app)/negocios/cotizacion-pdf-actions', () => ({
  generateCotizacionPDF: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/pantallazo-actions', () => ({
  leerPantallazoDeItem: async () => ({ ok: false, codigo: 'RX1', motivo: '', instruccion: '' }),
  confirmarLecturaDePantallazo: async () => ({ success: true }),
}))

const { default: CotizacionEditor } = await import('./cotizacion-editor')

const cotizacion = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cot-1', codigo: 'COT-2026-0001', consecutivo: 'COT-2026-0001', modo: 'detallada',
    estado: 'borrador', descripcion: 'Punta Cana 5 días', valor_total: 0, margen_porcentaje: 15,
    costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
    descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null, margen_default_pct: 15,
    terminos_condiciones: null, convencion_margen: 'sobre_venta', ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: 'item-1', nombre: 'Vuelo BOG-PUJ', subtotal: 1_000_000, orden: 1, precio_venta: 0,
    descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1,
    margen_porcentaje: null, precio_manual: false, rubros: [], grupo: null, opcion_de: null,
    unidad: null, ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const pintar = (items: unknown[], over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: cotizacion(over),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: items as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
    }),
  )

/** Las opciones de valor del selector de grupo, en orden. */
function opcionesDeGrupo(html: string): string[] {
  const bloque = html.match(/aria-label="Grupo de la línea"[\s\S]*?<\/select>/)
  if (!bloque) return []
  return [...bloque[0].matchAll(/<option value="([^"]*)"/g)].map(m => m[1])
}

describe('editor de cotización · el nombre de la línea se puede editar', () => {
  it('hay un input con el nombre del ítem', () => {
    const html = pintar([item()])
    expect(html).toContain('aria-label="Nombre de la línea"')
    // El valor tiene que llegar al input, no solo existir el campo: un input vacío
    // sobre un ítem con nombre borra el nombre al primer blur.
    expect(html).toMatch(/aria-label="Nombre de la línea"[^>]*value="Vuelo BOG-PUJ"/)
  })

  it('el input del ítem NO se confunde con el nombre de la cotización', () => {
    // Los dos existen y son cosas distintas: uno distingue variantes del negocio, el
    // otro distingue alternativas dentro de la misma cotización.
    const html = pintar([item()])
    expect(html).toContain('aria-label="Nombre de esta cotización"')
    expect(html).toContain('aria-label="Nombre de la línea"')
  })

  it('una alternativa recién creada se puede renombrar', () => {
    // El caso real: `agregarOpcionAItem` la nombra «<titular> (alternativa)».
    const html = pintar([
      item({ id: 'a', nombre: 'Vuelo', grupo: 'vuelo' }),
      item({ id: 'b', nombre: 'Vuelo (alternativa)', grupo: 'vuelo', opcion_de: 'a', orden: 2 }),
    ])
    expect(html).toMatch(/aria-label="Nombre de la línea"[^>]*value="Vuelo \(alternativa\)"/)
  })

  it('en una cotización que ya no se edita NO aparece el input', () => {
    const html = pintar([item()], { estado: 'aceptada' })
    expect(html).not.toContain('aria-label="Nombre de la línea"')
  })
})

describe('editor de cotización · la ranura se elige de una lista', () => {
  it('una cotización NUEVA ya ofrece los cuatro componentes del viaje', () => {
    // El defecto medido: con el datalist, aquí había CERO opciones.
    const opciones = opcionesDeGrupo(pintar([item()]))
    expect(opciones).toContain('vuelo')
    expect(opciones).toContain('hotel')
    expect(opciones).toContain('traslado')
    expect(opciones).toContain('actividad')
  })

  it('«sin grupo» sigue siendo una opción explícita, no el vacío por descuido', () => {
    // Un componente sin grupo entra en TODOS los itinerarios (R3). Tiene que poder
    // elegirse a propósito y decir qué significa.
    const html = pintar([item()])
    expect(opcionesDeGrupo(html)).toContain('')
    expect(html).toContain('Sin grupo · entra en todos')
  })

  it('el texto libre no desaparece: el método día a día lo necesita', () => {
    const html = pintar([item({ grupo: 'dia-1' })])
    expect(opcionesDeGrupo(html)).toContain('__otro__')
    // Y el grupo propio que ya existe sigue ofreciéndose.
    expect(opcionesDeGrupo(html)).toContain('dia-1')
  })

  it('el selector dice qué habilita el grupo elegido, y NOMBRA la ranura', () => {
    // Sin esta línea, que «vuelo» abra el cargue de pantallazo y «día-1» no es una
    // regla invisible que nadie puede deducir. Desde las ranuras múltiples además
    // tiene que decir CUÁL: mover una línea de «Vuelo» a «Vuelo 2» la saca de una
    // competencia y la mete en otra, y el total se mueve.
    const hotel = pintar([item({ grupo: 'hotel' })])
    expect(hotel).toContain('Hotel · compite con las demás líneas de esta ranura')
    expect(hotel).toContain('permite pegar su pantallazo')
    const segundoVuelo = pintar([item({ grupo: 'vuelo 2: San Andrés a Providencia' })])
    expect(segundoVuelo).toContain('Vuelo 2 · San Andrés a Providencia · compite con las demás')
    expect(pintar([item({ grupo: 'dia-1' })])).toContain('el costo se carga a mano')
  })
})

describe('editor de cotización · el pantallazo cuelga de la ranura', () => {
  it('con grupo «vuelo» aparece el cargue, con su contrato de captura', () => {
    const html = pintar([item({ grupo: 'vuelo' })])
    expect(html).toContain('Pantallazo de vuelo')
    // Qué se pide y qué NO sirve, las dos ANTES de pegar.
    expect(html).toContain('La pantalla de DETALLE del itinerario ya seleccionado')
    expect(html).toContain('El listado de resultados o el comparador')
  })

  it('con grupo «hotel» el contrato es el del hotel, no el del vuelo', () => {
    const html = pintar([item({ grupo: 'hotel' })])
    expect(html).toContain('Pantallazo de hotel')
    expect(html).toContain('la habitación y el régimen ya seleccionados')
    expect(html).not.toContain('Pantallazo de vuelo')
  })

  it('SIN grupo no hay cargue de pantallazo: sin ranura no hay contrato', () => {
    expect(pintar([item({ grupo: null })])).not.toContain('Pega la captura')
  })

  it('un grupo propio («día-1») tampoco lo ofrece', () => {
    expect(pintar([item({ grupo: 'dia-1' })])).not.toContain('Pega la captura')
  })

  it('dice que la imagen NO se guarda', () => {
    // Es una promesa sobre datos de un tercero (el pasajero aparece en la captura) y
    // tiene que estar en pantalla, no solo en el código.
    expect(pintar([item({ grupo: 'vuelo' })])).toContain('La imagen no se guarda')
  })
})
