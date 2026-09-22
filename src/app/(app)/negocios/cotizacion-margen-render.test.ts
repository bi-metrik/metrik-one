/**
 * El margen se VE mientras se arma la cotización: por línea y consolidado.
 *
 * ⚠️ Por qué hace falta una prueba de RENDER y no basta con `calcularCascada`: la
 * cascada puede devolver el margen perfecto y el JSX seguir sin pintarlo. Ese era
 * exactamente el defecto — `margenRealPct` existía y la pantalla solo lo mostraba en
 * las líneas con `margen_porcentaje` propio distinto de 0, así que un viaje armado
 * sin una sola excepción (el caso normal) no enseñaba **ningún** margen. Una prueba
 * pura no lo habría visto. Mismo precedente que `negocios-chips-cierre-render.test.ts`.
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 *
 * ⚠️ Mutaciones MEDIDAS sobre este archivo (aplicadas y revertidas):
 *   · el chip de margen del encabezado se condiciona a `lineaDecideSuPrecio`
 *     (el comportamiento anterior) ................................. 3 rojas
 *   · `claseNivelMargen` devuelve siempre '' ....................... 2 rojas
 *   · `umbrales` se ignora y se usa UMBRALES_MARGEN_POR_DEFECTO ..... 1 roja
 *   · `origenDelMargen` devuelve siempre 'heredado' ................ 1 roja
 *
 * Los ítems van SIN expandir (`expandedItems` arranca con todos abiertos, así que el
 * render trae las dos superficies: el encabezado y el bloque de precio).
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// El editor arrastra todas las server actions de la cotización y el panel del rastro,
// que consulta al montarse. Nada de eso participa en lo que aquí se prueba.
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

const { default: CotizacionEditor } = await import('./cotizacion-editor')

/** Cotización en borrador, convención `sobre_venta` y margen general del 15%. */
const cotizacion = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cot-1',
    codigo: 'COT-2026-0001',
    consecutivo: 'COT-2026-0001',
    modo: 'detallada',
    estado: 'borrador',
    descripcion: 'España, 7 días',
    valor_total: 0,
    margen_porcentaje: 15,
    costo_total: 0,
    fecha_envio: null,
    fecha_validez: null,
    descuento_porcentaje: 0,
    descuento_valor: 0,
    aiu_admin_pct: null,
    aiu_imprevistos_pct: null,
    margen_default_pct: 15,
    terminos_condiciones: null,
    convencion_margen: 'sobre_venta',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

/** Ítem de costo directo, sin rubros. El caso normal de un viaje a medida. */
const item = (over: Record<string, unknown> = {}) =>
  ({
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    nombre: 'Vuelo BOG-MAD',
    subtotal: 1_000_000,
    orden: 1,
    precio_venta: 0,
    descuento_porcentaje: 0,
    descripcion: null,
    es_ajuste: false,
    cantidad: 1,
    margen_porcentaje: null,
    precio_manual: false,
    rubros: [],
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const pintar = (
  items: unknown[],
  over: Record<string, unknown> = {},
  umbrales = { pisoPct: 5, avisoPct: 10 },
  /** Props del editor que NO son de la cotización (el gate de etapa, por ejemplo). */
  extra: Record<string, unknown> = {},
) =>
  renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: cotizacion(over),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: items as any,
      umbrales,
      ...extra,
    }),
  )

/**
 * El color del chip de margen DE LA LÍNEA, no el del consolidado.
 *
 * ⚠️ Buscar `text-red-600` suelto en el HTML NO sirve: el pie de la cotización tiene
 * su propio rojo, así que la afirmación pasaba aunque la línea no se pintara. Se vio
 * con una mutación que dejaba `claseNivelMargen` devolviendo cadena vacía: las 15
 * pruebas seguían en verde.
 */
function colorDeLinea(html: string, pct: string): string | null {
  const m = html.match(new RegExp(`class="([^"]*)"[^>]*>Margen ${pct.replace(',', ',')}<`))
  if (!m) return null
  return (m[1].match(/text-(red|amber|muted-foreground|green)-?\d*/) ?? [null])[0]
}

describe('editor de cotización · margen por línea', () => {
  it('una línea que HEREDA el margen lo muestra igual', () => {
    // El caso que no se veía: sin excepción propia no aparecía ninguna cifra.
    const html = pintar([item()])
    expect(html).toContain('Margen 15,0%')
    expect(html).toContain('Margen real 15,0%')
  })

  it('dice que lo hereda, para que el porcentaje no se lea como excepción', () => {
    const html = pintar([item()])
    expect(html).toContain('hereda el margen de la cotización')
  })

  it('una línea con margen propio del 0% NO se confunde con una que hereda', () => {
    // `null` y `0` son la trampa: los dos pintarían "0,0%" sin el origen al lado, y
    // uno de los dos casos es un viaje entregado al costo.
    const html = pintar([item({ margen_porcentaje: 0 })])
    expect(html).toContain('Margen 0,0%')
    expect(html).toContain('margen propio de la línea')
    expect(html).not.toContain('hereda el margen de la cotización')
  })

  it('una línea con precio escrito a mano deriva su margen del precio', () => {
    const html = pintar([item({ precio_venta: 1_050_000, precio_manual: true })])
    expect(html).toContain('precio escrito a mano')
    // (1.050.000 − 1.000.000) / 1.050.000 = 4,76%
    expect(html).toContain('Margen 4,8%')
  })

  it('bajo el piso sale en ROJO, no en ámbar', () => {
    // El 3,1% con el que Trappvel cerró viajes reales.
    const html = pintar([item({ precio_venta: 1_032_000, precio_manual: true })])
    expect(html).toContain('Margen 3,1%')
    expect(colorDeLinea(html, '3,1%')).toBe('text-red-600')
    expect(html).toContain('bajo el margen mínimo de 5,0%')
  })

  it('entre el piso y el aviso sale en ÁMBAR', () => {
    const html = pintar([item({ margen_porcentaje: 8 })])
    expect(colorDeLinea(html, '8,0%')).toBe('text-amber-600')
    expect(html).toContain('bajo el aviso de 10,0%')
  })

  it('los umbrales que manda el servidor son los que deciden el color', () => {
    // Con piso 12, el mismo 8% que arriba era ámbar pasa a rojo. Si la pantalla
    // usara los del producto (5/10) en vez del prop, este caso seguiría en ámbar.
    const html = pintar([item({ margen_porcentaje: 8 })], {}, { pisoPct: 12, avisoPct: 20 })
    expect(colorDeLinea(html, '8,0%')).toBe('text-red-600')
    expect(html).toContain('bajo el margen mínimo de 12,0%')
  })

  it('una línea sin costo no muestra margen: no hay con qué medirla', () => {
    const html = pintar([item({ subtotal: 0 })])
    expect(html).not.toContain('Margen 0,0%')
    expect(html).not.toContain('Margen real')
  })

  it('con descuento comercial avisa que el margen de la línea va antes de ese descuento', () => {
    const html = pintar([item()], { descuento_porcentaje: 10 })
    expect(html).toContain('Antes del descuento comercial de 10%')
  })
})

describe('editor de cotización · margen consolidado del viaje', () => {
  it('se ve SIEMPRE, también cuando la cotización está sana', () => {
    // Antes solo aparecía si difería del margen general o si era bajo: la cifra que
    // hay que conocer antes de enviar solo se veía cuando ya era mala.
    const html = pintar([item()])
    expect(html).toContain('Margen del viaje')
    expect(html).toContain('text-green-600')
  })

  it('con líneas que marginan distinto se llama «Margen real» y no coincide con el general', () => {
    const html = pintar([item({ margen_porcentaje: 30 }), item({ nombre: 'Hotel' })])
    expect(html).toContain('Margen real del viaje')
  })

  it('un viaje entero bajo el piso lo marca el consolidado, no solo las líneas', () => {
    const html = pintar([item({ margen_porcentaje: 3 })])
    expect(html).toContain('bajo el margen mínimo')
  })

  it('el precio consolidado es el de la convención: 1.176.471, no 1.150.000', () => {
    // El control de la convención congelada. Con `markup` el mismo 15 daría
    // 1.150.000 y el margen real bajaría a 13,0%.
    const html = pintar([item()])
    expect(html).toContain('1.176.471')
    expect(html).not.toContain('1.150.000')
  })

  it('con la convención vieja el precio cambia: es el control que hace válida la prueba anterior', () => {
    const html = pintar([item()], { convencion_margen: 'markup' })
    expect(html).toContain('1.150.000')
    expect(html).toContain('Margen real del viaje')
    expect(html).toContain('13,0%')
  })
})

describe('editor de cotización · rastro de margen', () => {
  it('el historial es alcanzable desde la cotización', () => {
    expect(pintar([item()])).toContain('Historial de cambios de margen')
  })
})


// ── Regla 3 (reunión 2026-09-14): el rojo bloquea, el ámbar avisa ────────────
//
// El copy hasta hoy decía, en los DOS casos, «es una marca, no un bloqueo». Con el
// gate `margen_sobre_piso` declarado en la etapa eso es falso para el rojo, y lo que
// el equipo tiene que poder leer sin preguntar es justamente la diferencia.

describe('el piso se distingue del aviso en pantalla', () => {
  const UMBRALES = { pisoPct: 5, avisoPct: 10 }
  const bajoPiso = [item({ margen_porcentaje: 3, subtotal: 1_000_000 })]
  const bajoAviso = [item({ margen_porcentaje: 7, subtotal: 1_000_000 })]

  it('con el gate declarado, el rojo DICE que no deja avanzar', () => {
    const html = pintar(bajoPiso, {}, UMBRALES, { pisoBloqueaAvance: true })
    expect(html).toContain('no deja avanzar')
    expect(html).toContain('NO avanza de etapa')
  })

  it('el ámbar NUNCA dice que bloquea, ni con el gate declarado', () => {
    // El control que hace valer la prueba de arriba: si el texto se pintara siempre,
    // esta caería.
    const html = pintar(bajoAviso, {}, UMBRALES, { pisoBloqueaAvance: true })
    expect(html).not.toContain('no deja avanzar')
    expect(html).toContain('Avisa, no bloquea')
  })

  it('SIN el gate, el rojo no promete un bloqueo que no existe', () => {
    const html = pintar(bajoPiso, {}, UMBRALES, { pisoBloqueaAvance: false })
    expect(html).not.toContain('no deja avanzar')
    expect(html).toContain('se puede enviar igual')
  })

  it('ya no queda el texto viejo cuando el gate SÍ bloquea', () => {
    // «Es una marca, no un bloqueo: la cotización se puede enviar igual» era la
    // pantalla sana que miente. Con el gate puesto no puede aparecer en ninguna parte.
    const html = pintar(bajoPiso, {}, UMBRALES, { pisoBloqueaAvance: true })
    expect(html).not.toContain('se puede enviar igual')
  })
})

// ── El margen que trae el pantallazo, y sus dos puertas de edición ───────────
//
// Brief del 2026-09-19 (`brief-max-2026-09-19-margen-por-item.md`). Tres cosas que una
// prueba pura NO fija: que la pantalla DIGA que el margen lo trae la captura, que el
// número original siga a la vista después de editarlo, y que exista por dónde volver.
// `origenDelMargen` puede devolver 'proveedor' perfecto y el JSX seguir escribiendo
// «margen propio de la línea» — que es exactamente el defecto que se viene a cerrar.

/** Decameron, medido contra el banco real: costo 1.818.919 y precio al pasajero 2.029.118. */
const COSTO_DECAMERON = 1_818_919
const PRECIO_DECAMERON = 2_029_118

/** Un ítem ya confirmado desde un pantallazo que traía los dos precios. */
const itemConPantallazo = (
  costo: number,
  precio: number,
  over: Record<string, unknown> = {},
) => {
  const margenPct = ((precio - costo) / precio) * 100
  return item({
    subtotal: costo,
    margen_porcentaje: margenPct,
    tarifa_pax: {
      confirmada: {
        composicion: { adultos: 2, ninos: 0, infantes: 0 },
        costos: [{ tipo: 'adulto', cantidad: 2, unitarioCOP: costo / 2, totalCOP: costo }],
        costoTotalCOP: costo,
        moneda: 'COP',
        tasa: null,
        confirmadaEn: '2026-09-19T12:00:00.000Z',
        margenProveedor: { precioCliente: precio, costoAgencia: costo, moneda: 'COP', margenPct },
      },
    },
    ...over,
  })
}

describe('el margen que trae el pantallazo se distingue del escrito a mano', () => {
  it('lo dice con sus palabras, no como «margen propio de la línea»', () => {
    const html = pintar([itemConPantallazo(COSTO_DECAMERON, PRECIO_DECAMERON)])
    expect(html).toContain('lo trae el pantallazo')
    expect(html).not.toContain('margen propio de la línea')
  })

  it('la línea se vende al precio del proveedor, no al del margen general', () => {
    // Con el 15% de la cotización saldría en 2.139.905. Es la diferencia entre cobrar
    // lo que el proveedor le cobra al pasajero y cobrar otra cosa.
    const html = pintar([itemConPantallazo(COSTO_DECAMERON, PRECIO_DECAMERON)])
    expect(html).toContain('2.029.118')
    expect(html).toContain('Margen real 10,4%')
  })

  it('no repite el número del pantallazo cuando es el mismo que está puesto', () => {
    const html = pintar([itemConPantallazo(COSTO_DECAMERON, PRECIO_DECAMERON)])
    expect(html).not.toContain('El pantallazo decía')
  })
})

describe('editar el margen NO borra lo que dijo la captura', () => {
  const editado = () =>
    pintar([itemConPantallazo(COSTO_DECAMERON, PRECIO_DECAMERON, { margen_porcentaje: 18 })])

  it('al moverlo pasa a ser propio de la línea', () => {
    const html = editado()
    expect(html).toContain('margen propio de la línea')
    expect(html).not.toContain('lo trae el pantallazo')
    expect(html).toContain('Margen real 18,0%')
  })

  it('el número del proveedor queda a la vista al lado del editado', () => {
    // La condición dura del brief: sin esto la agencia no sabe cuánto se movió de lo
    // que el proveedor le daba, y ese número no está en ninguna otra pantalla.
    expect(editado()).toContain('El pantallazo decía 10,4%')
  })

  it('hay por dónde volver a él', () => {
    expect(editado()).toContain('Volver al del pantallazo')
  })

  it('con precio escrito a mano también se conserva y también se puede volver', () => {
    const html = pintar([
      itemConPantallazo(COSTO_DECAMERON, PRECIO_DECAMERON, {
        precio_manual: true,
        precio_venta: 2_500_000,
      }),
    ])
    expect(html).toContain('precio escrito a mano')
    expect(html).toContain('El pantallazo decía 10,4%')
    expect(html).toContain('Volver al del pantallazo')
  })
})

describe('la segunda puerta: escribir el precio al cliente', () => {
  it('la línea con margen propio ofrece la casilla de precio al cliente', () => {
    const html = pintar([itemConPantallazo(COSTO_DECAMERON, PRECIO_DECAMERON)])
    expect(html).toContain('Precio al cliente')
    // Arranca con el precio que hoy tiene la línea, no vacía.
    expect(html).toContain('value="2.029.118"')
  })

  it('una línea que HEREDA el margen no la ofrece: ahí la puerta es «Marginar distinto»', () => {
    // El control que hace valer la prueba de arriba. Si la casilla se pintara siempre,
    // esta caería y el cambio habría tocado cotizaciones que no usan pantallazos.
    const html = pintar([item()])
    expect(html).not.toContain('Precio al cliente')
    expect(html).toContain('Marginar distinto')
  })
})

describe('dos hoteles con márgenes distintos en la misma cotización', () => {
  // Altos Ushuaia, medido: precio 799.016,38 y «precio neto» 687.154,09 → 14,0%.
  const COSTO_USHUAIA = 687_154
  const PRECIO_USHUAIA = 799_016

  const dosHoteles = () =>
    pintar([
      itemConPantallazo(COSTO_DECAMERON, PRECIO_DECAMERON, { nombre: 'Decameron' }),
      itemConPantallazo(COSTO_USHUAIA, PRECIO_USHUAIA, { nombre: 'Altos Ushuaia', orden: 2 }),
    ])

  it('cada uno conserva el suyo y el general de la cotización no los pisa', () => {
    const html = dosHoteles()
    expect(html).toContain('Margen real 10,4%')
    expect(html).toContain('Margen real 14,0%')
    // Ninguno cayó al 15% general de la cotización.
    expect(html).not.toContain('Margen real 15,0%')
    // Los dos se anuncian como servidos por su captura. Se cuenta la frase del
    // TOOLTIP, que sale una vez por línea: el texto suelto «lo trae el pantallazo»
    // aparece dos veces por línea (el renglón del margen y el tooltip) y contarlo
    // pasaría igual si solo una de las dos superficies lo dijera.
    expect(html.match(/El margen de esta línea lo trae el pantallazo\./g)?.length).toBe(2)
  })

  it('los dos precios son los del proveedor, al peso', () => {
    const html = dosHoteles()
    expect(html).toContain('2.029.118')
    expect(html).toContain('799.016')
  })
})
