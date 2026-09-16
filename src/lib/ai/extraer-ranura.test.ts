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
    expect(construirPrompt(VUELO)).toContain('Si no puedes contar las opciones con certeza, responde "varias_opciones"')
  })

  it('cuenta las opciones antes de clasificar, y el listado filtrado a UN hotel es detalle (regla 7.5)', () => {
    const p = construirPrompt(HOTEL)
    expect(p.indexOf('opciones_visibles')).toBeLessThan(p.indexOf('"varias_opciones": se ven DOS O MAS'))
    expect(p).toContain('Un precio TACHADO')
    expect(p).toContain('"2 Hoteles (de 267)" no son')
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

  it('trae el conteo de opciones visibles', () => {
    expect(normalizarRespuesta({ veredicto: 'detalle_unico', opciones_visibles: 1 }).opcionesVisibles).toBe(1)
  })
})
