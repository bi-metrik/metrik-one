/**
 * Qué ofrece la tarjeta de un caso RETENIDO, y que la búsqueda lo encuentre.
 *
 * El 2026-09-08 los retenidos salieron de la cola (#578) y con ellos se fue la
 * ADOPCIÓN: un caso sin el honorario recaudado ya no podía reconocer una factura
 * que Siigo ya tenía. La enmienda del mismo día los devuelve a la pantalla, a una
 * sección propia, con una regla de dos mitades que este archivo fija:
 *
 *   · NO se ofrece facturar — el servidor bloquea la emisión por encima de la
 *     banda (`motivo: 'saldo_pendiente'`, y ninguna justificación lo abre). La
 *     pantalla no puede ofrecer lo que va a ser rechazado. Ese lado del gate lo
 *     prueba `src/lib/siigo/facturas-gate-recaudo.test.ts`.
 *   · SÍ se ofrece adoptar — una factura que ya existe en Siigo existe pase lo
 *     que pase con el recaudo, y traerla al bloque no emite nada.
 *
 * Los códigos y las cifras son reales, medidos en producción SOENA el 2026-09-08
 * sobre los 27 retenidos. **V0224 es el caso del enunciado**: falta recaudar
 * $425.000 de $850.000 (50%), y buscarlo y no encontrarlo era lo que se leía como
 * que el buscador estaba roto.
 *
 * ⚠️ Estas pruebas fijan la DECISIÓN, no el pintado. Las dos condiciones de la
 * tarjeta viven en funciones puras EXPORTADAS del componente
 * (`ofreceEmitirFactura`, `ofreceAdoptarFactura`) y el JSX las llama: si aquí se
 * copiara la condición en vez de importarla, la prueba pasaría el día que el botón
 * dejara de mirarla. Mismo patrón que `filtrarCasos`.
 *
 * Que el JSX de verdad las consulta lo fija `tarjeta-retenido-render.test.ts`, que
 * SÍ renderiza (`renderToStaticMarkup`, sin DOM, en el entorno `node` de vitest).
 * Las dos capas hacen falta: sin la pura, la regla no está fijada; sin la de render,
 * un botón que deje de consultarla pasa igual.
 *
 * ⚠️ Mutaciones corridas el 2026-09-08 (`_qa/mutar.py`, borrado antes de
 * commitear); ninguna quedó huérfana:
 *
 *   la pantalla ofrece facturar al retenido ..... 1 prueba
 *   la adopción se gatea por saldo .............. 2
 */
import { describe, it, expect } from 'vitest'
import { filtrarCasos, ofreceEmitirFactura, ofreceAdoptarFactura } from './conciliacion-client'
import { casoFalso } from '../../../../test/cola-facturacion-doble'

/** V0224, tal como sale hoy del servidor: retenido al 50%. */
const V0224 = casoFalso({
  negocio_id: 'neg-v0224', codigo: 'V0224', cliente: 'CLIENTE DE PRUEBA',
  honorario: 850_000, falta_saldo: 425_000,
  estado_recaudo: 'retenido', banda_materialidad: 8_500,
  retenido_por_recaudo: true,
})

/** Uno cuadrado, para contrastar. */
const LISTO = casoFalso({
  negocio_id: 'neg-v0345', codigo: 'V0345', cliente: 'OTRO CLIENTE',
  honorario: 637_500, falta_saldo: 0,
})

describe('la tarjeta de un retenido NO ofrece facturar', () => {
  it('con datos completos y todo, el retenido no ofrece emitir', () => {
    // Es lo único que lo separa de un caso listo: la plata que no entró.
    expect(ofreceEmitirFactura(V0224, true)).toBe(false)
    expect(ofreceEmitirFactura(LISTO, true)).toBe(true)
  })

  it('el DESCUADRE MENOR sí lo ofrece: ese se abre con justificación escrita', () => {
    // La frontera importa. Si el botón desapareciera también en la banda, la
    // justificación de la financiera no tendría dónde escribirse.
    const enBanda = casoFalso({
      honorario: 637_500, falta_saldo: 3_000,
      estado_recaudo: 'descuadre_menor', banda_materialidad: 6_375,
    })
    expect(ofreceEmitirFactura(enBanda, true)).toBe(true)
  })

  it('sin Siigo configurado no se ofrece emitir, retenido o no', () => {
    expect(ofreceEmitirFactura(LISTO, false)).toBe(false)
    expect(ofreceEmitirFactura(V0224, false)).toBe(false)
  })

  it('un dato faltante también lo saca, por su propia razón', () => {
    expect(ofreceEmitirFactura(casoFalso({ faltan_cliente: ['email'] }), true)).toBe(false)
    expect(ofreceEmitirFactura(casoFalso({ faltan_factura: ['honorario aprobado'] }), true)).toBe(false)
  })
})

describe('la tarjeta de un retenido SÍ ofrece adoptar', () => {
  it('⚠️ la adopción NO se gatea por saldo', () => {
    // La capacidad que #578 se llevó por delante sin decidirlo. Adoptar no emite
    // nada: solo reconoce lo que Siigo ya tiene y trae su PDF al expediente.
    expect(ofreceAdoptarFactura(V0224, true)).toBe(true)
  })

  it('el retenido y el listo se comportan igual para adoptar', () => {
    expect(ofreceAdoptarFactura(V0224, true)).toBe(ofreceAdoptarFactura(LISTO, true))
  })

  it('un retenido YA FACTURADO solo la ofrece para reponer el PDF', () => {
    const facturadoConPdf = { ...V0224, ya_facturado: true, factura_sin_pdf: false, retenido_por_recaudo: false }
    const facturadoSinPdf = { ...V0224, ya_facturado: true, factura_sin_pdf: true, retenido_por_recaudo: false }
    expect(ofreceAdoptarFactura(facturadoConPdf, true)).toBe(false)
    expect(ofreceAdoptarFactura(facturadoSinPdf, true)).toBe(true)
  })

  it('un descartado no la ofrece, y sin Siigo tampoco', () => {
    const descartado = { ...V0224, descartado: { at: '2026-09-01T00:00:00.000Z', por: 'Diana', motivo: null } }
    expect(ofreceAdoptarFactura(descartado, true)).toBe(false)
    expect(ofreceAdoptarFactura(V0224, false)).toBe(false)
  })
})

describe('la búsqueda encuentra a los retenidos', () => {
  const CASOS = [LISTO, V0224]

  it('buscar V0224 lo devuelve, aunque esté retenido', () => {
    // Buscar un caso que existe y no obtener nada se lee como que el buscador
    // está roto. Mientras estuvieron fuera de `casos`, esto devolvía cero.
    expect(filtrarCasos(CASOS, 'v0224').map(c => c.negocio_id)).toEqual(['neg-v0224'])
  })

  it('el resultado viene marcado, para que la sección se pueda abrir sola', () => {
    // La pantalla abre la sección de retenidos cuando lo tecleado cae adentro; sin
    // la marca no habría cómo saberlo.
    const [hallado] = filtrarCasos(CASOS, 'v0224')
    expect(hallado.retenido_por_recaudo).toBe(true)
  })

  it('también por nombre del cliente', () => {
    expect(filtrarCasos(CASOS, 'cliente de prueba').map(c => c.codigo)).toEqual(['V0224'])
  })
})
