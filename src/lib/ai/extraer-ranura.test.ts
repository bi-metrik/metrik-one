/**
 * El prompt y la normalización de lo que devuelve el modelo.
 *
 * ⚠️ Por qué se prueba el TEXTO del prompt: RX1 no es una validación posterior, *«va
 * en el prompt, como instrucción explícita de negarse ante N opciones»*. Si alguien
 * recorta esa instrucción, el modelo vuelve a elegir una fila del listado y **nada
 * falla**: sale un precio plausible por el número equivocado. La prueba pura de
 * `evaluarLectura` seguiría verde, porque el veredicto que recibe ya vendría mal.
 *
 * Lo que NO se prueba aquí: la llamada a Gemini. Eso se mide contra capturas reales
 * (ver el reporte del PR) y no contra un `fetch` doblado, que solo comprobaría que el
 * doble devuelve lo que el doble devuelve.
 */
import { describe, expect, it } from 'vitest'

import { construirPrompt, normalizarRespuesta } from './extraer-ranura'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'

const VUELO = ranuraPorSlug('vuelo_detalle')!
const HOTEL = ranuraPorSlug('hotel_detalle')!

describe('el prompt lleva el rechazo por N opciones (RX1)', () => {
  it('prohíbe elegir una fila, y lo dice con todas las letras', () => {
    const p = construirPrompt(VUELO)
    expect(p).toContain('varias_opciones')
    expect(p).toContain('NO ELIJAS NINGUNA')
    // Las tres formas de elegir mal que hay que cerrar de frente.
    expect(p).toContain('No tomes la primera')
    expect(p).toContain('mas barata')
    expect(p).toContain('resaltada')
  })

  it('el empate se resuelve hacia el rechazo, no hacia la extracción', () => {
    expect(construirPrompt(VUELO)).toContain('Si no puedes decir con certeza cuantas opciones se ven, responde "varias_opciones"')
  })

  it('cuenta las opciones antes de clasificar, y el listado filtrado a UN hotel es detalle (regla 7.5)', () => {
    const p = construirPrompt(HOTEL)
    expect(p.indexOf('"opciones_vistas"')).toBeLessThan(p.indexOf('"varias_opciones": se ven DOS O MAS'))
    expect(p).toContain('Un precio TACHADO')
    expect(p).toContain('"2 Hoteles (de 267)" no es un producto')
    expect(p).toContain('la tarjeta de UN hotel dentro de un listado filtrado a ese hotel')
  })

  it('clasifica ANTES de extraer: el orden está en el prompt', () => {
    const p = construirPrompt(VUELO)
    expect(p.indexOf('PASO 1')).toBeLessThan(p.indexOf('PASO 2'))
    expect(p).toContain('SOLO si el veredicto es "detalle_unico", extrae')
  })

  it('prohíbe inferir fuera de la imagen (R-P4)', () => {
    const p = construirPrompt(HOTEL)
    expect(p).toContain('NUNCA lo deduzcas del')
    expect(p).toContain('un campo inventado es un dato falso que nadie revisa')
  })

  it('el contrato de la ranura viaja en el prompt, no una lista genérica', () => {
    expect(construirPrompt(VUELO)).toContain('El listado de resultados o el comparador de aerolíneas')
    expect(construirPrompt(HOTEL)).toContain('la habitación y el régimen ya seleccionados')
    // Y los campos mínimos se marcan como obligatorios.
    expect(construirPrompt(VUELO)).toContain('pax (Pasajeros, OBLIGATORIO)')
    expect(construirPrompt(VUELO)).toContain('numero_vuelo (Nº de vuelo):')
  })

  it('por tipo de pasajero: lee cantidad y subtotal de la fila, sin operar columnas (TP1)', () => {
    const p = construirPrompt(VUELO)
    expect(p).toContain('"por_tipo_pax"')
    expect(p).toContain('NO multipliques, NO dividas y NO sumes columnas')
    expect(p).toContain('tasa de embarque, fee, total tasa')
    expect(p).toContain('NUNCA repartas un total entre tipos de pasajero')
  })

  it('una fecha sin año se devuelve sin año: el modelo inventaba 2023', () => {
    expect(construirPrompt(VUELO)).toContain('devuelve --MM-DD')
    expect(construirPrompt(VUELO)).toContain('NUNCA inventes el ano')
  })

  it('ningún campo de ocupación se lee de las habitaciones ni del régimen: «AD» volvió como «1 Adulto»', () => {
    // Medido el 2026-09-16 contra la tarjeta de París («1 x Standard Room W... AD»): una de dos
    // corridas devolvió `ocupacion: '1 Adulto'` y TP3 rechazó una captura buena.
    const lineas = construirPrompt(HOTEL).split('\n').filter(l => /^- ocupacion/.test(l))
    expect(lineas.map(l => l.slice(2).split(' ')[0])).toEqual([
      'ocupacion', 'ocupacion_adultos', 'ocupacion_ninos', 'ocupacion_infantes', 'ocupacion_total',
    ])
    for (const l of lineas) {
      expect(l).toContain('«1 x Standard Room»')
      expect(l).toContain('alojamiento y desayuno, no un adulto')
    }
  })

  it('prohíbe inventar un desglose y repetir el total como fila', () => {
    const p = construirPrompt(HOTEL)
    expect(p).toContain('NO inventes un desglose')
    expect(p).toContain('NO incluyas el total general como una fila mas')
  })
})

describe('normalizar lo que llega · el lado seguro ante lo que no se entiende', () => {
  it('un veredicto desconocido NO cae en «detalle_unico»', () => {
    // Caer al caso que crea rubros ante una respuesta que no se entiende es
    // exactamente al revés de lo que este frente protege.
    expect(normalizarRespuesta({ veredicto: 'quien_sabe' }).veredicto).toBe('no_es_pantalla_de_precio')
    expect(normalizarRespuesta({}).veredicto).toBe('no_es_pantalla_de_precio')
    expect(normalizarRespuesta(null).veredicto).toBe('no_es_pantalla_de_precio')
  })

  it('los cuatro veredictos válidos pasan tal cual', () => {
    for (const v of ['detalle_unico', 'varias_opciones', 'otra_ranura', 'no_es_pantalla_de_precio']) {
      expect(normalizarRespuesta({ veredicto: v }).veredicto).toBe(v)
    }
  })

  it('la CADENA "null" es un valor no leído, no el texto «null»', () => {
    // ⚠️ Medido contra el modelo vivo: el `responseSchema` declara `value` como STRING,
    // así que el modelo no puede devolver un JSON null y devuelve la cadena "null". En
    // el listado de vuelos volvieron los QUINCE campos así. Ahí no mordió porque venían
    // con confianza 0, pero un campo declarado ausente CON confianza alta se guardaría
    // como una aerolínea llamada «null» en la cotización que ve el cliente.
    const r = normalizarRespuesta({
      veredicto: 'detalle_unico',
      campos: {
        aerolinea: { value: 'null', confidence: 0.95 },
        origen: { value: 'N/A', confidence: 0.9 },
        destino: { value: 'None', confidence: 0.9 },
        familia_tarifa: { value: 'Basic', confidence: 0.95 },
      },
    })
    expect(r.campos.aerolinea.value).toBeNull()
    expect(r.campos.origen.value).toBeNull()
    expect(r.campos.destino.value).toBeNull()
    // Control: un valor real NO se descarta.
    expect(r.campos.familia_tarifa.value).toBe('Basic')
  })

  it('una cadena vacía es un valor NO leído, no un valor vacío', () => {
    const r = normalizarRespuesta({ veredicto: 'detalle_unico', campos: { aerolinea: { value: '  ', confidence: 0.9 } } })
    expect(r.campos.aerolinea.value).toBeNull()
  })

  it('una fila de desglose sin valor se descarta: no se propone un rubro en cero', () => {
    const r = normalizarRespuesta({
      veredicto: 'detalle_unico',
      desglose: [
        { concepto: 'Tarifa', valor_unitario: 180, moneda: 'USD' },
        { concepto: 'Cargo por servicio', valor_unitario: null },
        { concepto: 'Descuento aplicado', valor_unitario: 0 },
      ],
    })
    expect(r.desglose).toHaveLength(1)
    expect(r.desglose[0].concepto).toBe('Tarifa')
  })

  it('un párrafo en «unidad» se recorta a la unidad', () => {
    // ⚠️ Medido contra el modelo vivo: `unidad` volvió con «noche(s) (total 720,00 USD
    // para 4 noches, no se incluye como linea separada para evitar duplicidad...)».
    // Eso entra tal cual a `rubros.unidad` y se imprime en el desglose que alguien
    // tiene que leer para confirmar el costo.
    const r = normalizarRespuesta({
      veredicto: 'detalle_unico',
      desglose: [{
        concepto: 'Tarifa por noche',
        cantidad: 4,
        unidad: 'noche(s) (total 720,00 USD para 4 noches, no se incluye como linea separada para evitar duplicidad de datos)',
        valor_unitario: 180,
      }],
    })
    expect(r.desglose[0].unidad).toBe('noche')
  })

  it('un concepto larguísimo se recorta, no se guarda entero', () => {
    const largo = 'Tarifa aérea internacional ida y vuelta con todos los recargos aplicables y tasas'
    const r = normalizarRespuesta({
      veredicto: 'detalle_unico',
      desglose: [{ concepto: largo, valor_unitario: 100 }],
    })
    expect(r.desglose[0].concepto!.length).toBeLessThanOrEqual(60)
    expect(r.desglose[0].concepto).toContain('Tarifa aérea internacional')
  })

  it('una unidad normal NO se toca: el control del recorte', () => {
    const r = normalizarRespuesta({
      veredicto: 'detalle_unico',
      desglose: [{ concepto: 'Impuestos', unidad: 'estadía', valor_unitario: 100 }],
    })
    expect(r.desglose[0].unidad).toBe('estadía')
    expect(r.desglose[0].concepto).toBe('Impuestos')
  })

  it('un desglose ausente o mal formado no revienta: queda vacío', () => {
    expect(normalizarRespuesta({ veredicto: 'detalle_unico' }).desglose).toEqual([])
    expect(normalizarRespuesta({ veredicto: 'detalle_unico', desglose: 'no' }).desglose).toEqual([])
  })

  it('una confianza ausente cuenta como cero, no como certeza', () => {
    const r = normalizarRespuesta({ veredicto: 'detalle_unico', campos: { pax: { value: '2' } } })
    expect(r.campos.pax.confidence).toBe(0)
  })
})

describe('normalizar las filas por tipo de pasajero', () => {
  it('conserva la fila del infante con subtotal CERO: es un dato, no un hueco', () => {
    const r = normalizarRespuesta({
      veredicto: 'detalle_unico',
      por_tipo_pax: [
        { tipo: 'adulto', cantidad: 2, subtotal_tipo: 1017600, moneda: 'COP' },
        { tipo: 'infante', cantidad: 1, subtotal_tipo: 0, moneda: 'COP' },
      ],
      total_general: 1017600,
    })
    expect(r.porTipoPax?.map(f => [f.tipo, f.cantidad, f.subtotal_tipo])).toEqual([['adulto', 2, 1017600], ['infante', 1, 0]])
    expect(r.totalGeneral).toBe(1017600)
  })

  it('descarta filas sin cantidad, con tipo desconocido o cantidad no entera', () => {
    const r = normalizarRespuesta({
      veredicto: 'detalle_unico',
      por_tipo_pax: [
        { tipo: 'senior', cantidad: 1, subtotal_tipo: 10 },
        { tipo: 'adulto', cantidad: null, subtotal_tipo: 10 },
        { tipo: 'adulto', cantidad: 1.5, subtotal_tipo: 10 },
        { tipo: 'niño', cantidad: 1, subtotal_tipo: 10 },
      ],
    })
    expect(r.porTipoPax?.map(f => f.tipo)).toEqual(['nino'])
  })

  it('la cadena "null" en la moneda de una fila es ausencia (medido: Decameron)', () => {
    const r = normalizarRespuesta({
      veredicto: 'detalle_unico',
      por_tipo_pax: [{ tipo: 'adulto', cantidad: 2, subtotal_tipo: 2019412, moneda: 'null' }],
    })
    expect(r.porTipoPax?.[0].moneda).toBeNull()
  })

  it('cuenta las opciones DISTINTAS que el modelo dice ver, no un número declarado', () => {
    expect(normalizarRespuesta({ veredicto: 'detalle_unico', opciones_vistas: [{ nombre: 'Crown Paradise', precio: '3.780.884' }] }).opcionesVisibles).toBe(1)
    expect(normalizarRespuesta({
      veredicto: 'detalle_unico',
      opciones_vistas: [{ nombre: 'Crown Paradise', precio: '3.780.884' }, { nombre: 'crown paradise', precio: '3.780.884' }],
    }).opcionesVisibles).toBe(1)
    expect(normalizarRespuesta({
      veredicto: 'detalle_unico',
      opciones_vistas: [{ nombre: 'Crown Paradise', precio: '3.780.884' }, { nombre: 'Crown Paradise Golden', precio: '4.100.000' }],
    }).opcionesVisibles).toBe(2)
    expect(normalizarRespuesta({ veredicto: 'detalle_unico' }).opcionesVisibles).toBeNull()
  })
})

/**
 * El equipaje sale de dos respuestas del modelo en la MISMA llamada, y lo que no coincide
 * no se afirma. El caso de referencia es la tarifa BASIC de Avianca del banco real
 * (`3.57.39_PM-3`), donde de los tres iconos solo el primero está a color y el modelo
 * respondía «con equipaje de bodega» una corrida sí y otra no.
 */
describe('equipaje · el icono observado se cruza con el dictamen del modelo', () => {
  const conIconos = (colores: string[], dictamen: Record<string, unknown> = {}) =>
    normalizarRespuesta({
      veredicto: 'detalle_unico',
      campos: dictamen,
      iconos_equipaje: colores.map((color, i) => ({ dibujo: ['bolso', 'maleta de cabina', 'maleta grande'][i], color })),
    }).campos

  it('los tres a color: los tres incluidos', () => {
    const c = conIconos(['a_color', 'a_color', 'a_color'])
    expect([c.equipaje_personal.value, c.equipaje_mano.value, c.equipaje_bodega.value]).toEqual(['true', 'true', 'true'])
  })

  it('solo el primero a color: artículo personal sí, los otros dos no', () => {
    const c = conIconos(['azul', 'gris', 'gris'])
    expect([c.equipaje_personal.value, c.equipaje_mano.value, c.equipaje_bodega.value]).toEqual(['true', 'false', 'false'])
  })

  // El defecto que se busca cerrar: un icono dibujado en gris NO es equipaje incluido.
  it('el dictamen que CONTRADICE al icono deja el campo vacío, no elige uno de los dos', () => {
    const c = conIconos(['azul', 'gris', 'gris'], {
      equipaje_bodega: { value: 'true', confidence: 0.9 },
      equipaje_mano: { value: 'false', confidence: 0.9 },
    })
    expect(c.equipaje_bodega.value).toBeNull()
    expect(c.equipaje_bodega.confidence).toBe(0)
    // El que sí coincide se conserva.
    expect(c.equipaje_mano.value).toBe('false')
  })

  it('con dos iconos la posición no dice cuál es cuál: manda lo que respondió el modelo', () => {
    const c = conIconos(['azul', 'gris'], { equipaje_bodega: { value: 'true', confidence: 0.9 } })
    expect(c.equipaje_bodega.value).toBe('true')
  })

  it('un color que no se entiende no toca el campo', () => {
    const c = conIconos(['morado con lunares', 'gris', 'gris'], { equipaje_personal: { value: 'true', confidence: 0.9 } })
    expect(c.equipaje_personal.value).toBe('true')
    expect(c.equipaje_mano.value).toBe('false')
  })

  it('sin iconos en la respuesta, el campo queda como lo dejó el modelo', () => {
    const r = normalizarRespuesta({
      veredicto: 'detalle_unico',
      campos: { equipaje_bodega: { value: 'true', confidence: 0.9 } },
    })
    expect(r.campos.equipaje_bodega.value).toBe('true')
  })
})
