/**
 * El criterio de la cola de facturación, y las fronteras de la banda de materialidad.
 *
 * ⚠️ Mutaciones corridas el 2026-09-08 (`_mutar.sh`, borrado antes de commitear).
 * Las 8 tumbaron pruebas — ninguna quedó huérfana:
 *
 *   1% -> 2% .............................. 4 pruebas
 *   sin piso de materialidad .............. 1
 *   frontera superior EXCLUSIVA ........... 1
 *   frontera inferior EXCLUSIVA ........... 4
 *   descuadre_menor cuenta como listo ..... 2
 *   el retenido vuelve a pintar etiqueta .. 1
 *   sin guard de cero/NaN en la banda ..... 1
 *   sin guard de faltante no numérico ..... 1
 *
 * ⚠️⚠️ El arnés mintió TRES veces antes de servir, y las tres con la misma cara
 * ("ninguna prueba cayó", o peor: caídas que no eran de la mutación):
 *
 *   1. se le pasaba a vitest el archivo FUENTE como filtro, que no casa con ningún
 *      `.test.ts` — corría CERO pruebas y todo salía verde;
 *   2. el grep del resumen no toleraba los códigos de color ANSI;
 *   3. el respaldo se tomó DESPUÉS de una mutación anterior que había quedado sin
 *      revertir (un comando compuesto que el guard rechazó entero, incluido el
 *      `cp` de restauración). La línea base ya estaba rota, así que las "caídas"
 *      reportadas eran suyas y no de cada mutación.
 *
 * Por eso el arnés ahora comprueba la línea base VERDE antes de mutar y aborta si
 * un `sed` no cambia el archivo. Un arnés que no ejecuta nada, o que mide contra
 * una base rota, se lee igual que uno que funciona.
 */
import { describe, it, expect } from 'vitest'
import {
  bandaMaterialidadFacturacion,
  casoListoParaFacturar,
  estadoDeRecaudo,
  faltantesDelCaso,
} from './caso-listo'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

const base = {
  faltan_factura: [] as string[],
  faltan_cliente: [] as string[],
  falta_saldo: 0,
  honorario: 637_500 as number | null,
}

describe('casoListoParaFacturar', () => {
  it('con datos completos y el honorario recaudado, está listo', () => {
    expect(casoListoParaFacturar(base)).toBe(true)
  })

  it('un dato faltante del cliente lo saca de listos', () => {
    expect(casoListoParaFacturar({ ...base, faltan_cliente: ['email'] })).toBe(false)
  })

  it('un dato faltante de la factura lo saca de listos', () => {
    expect(casoListoParaFacturar({ ...base, faltan_factura: ['honorario aprobado'] })).toBe(false)
  })

  it('con saldo del honorario pendiente NO está listo', () => {
    // Es plata que no entró, no un dato que falte. Mostrarlo como listo haría que
    // la bandeja prometa una factura que el gate del servidor va a rechazar.
    expect(casoListoParaFacturar({ ...base, falta_saldo: 250_000 })).toBe(false)
  })

  it('un residuo por debajo de la materialidad no frena', () => {
    // Misma vara que los demás gates del producto: un remanente no cobrable en la
    // práctica no puede dejar un caso sin facturar para siempre.
    expect(casoListoParaFacturar({ ...base, falta_saldo: TOLERANCIA_SALDO_COP })).toBe(true)
    expect(casoListoParaFacturar({ ...base, falta_saldo: TOLERANCIA_SALDO_COP + 1 })).toBe(false)
  })

  it('un descuadre DENTRO de la banda tampoco está listo: es listable con confirmación', () => {
    // La distinción que sostiene el frente entero. Si `descuadre_menor` contara
    // como listo, la bandeja lo sumaría a los que se emiten de un clic y la
    // pantalla pintaría el botón directo, saltándose la justificación escrita.
    expect(estadoDeRecaudo({ ...base, falta_saldo: 3_000 })).toBe('descuadre_menor')
    expect(casoListoParaFacturar({ ...base, falta_saldo: 3_000 })).toBe(false)
  })
})

describe('bandaMaterialidadFacturacion — las fronteras', () => {
  it('honorario nulo: la banda COLAPSA al piso de materialidad', () => {
    // No hay de qué sacar el 1%. Estirarla sería inventar una franja sobre un
    // número que nadie aprobó.
    expect(bandaMaterialidadFacturacion(null)).toBe(TOLERANCIA_SALDO_COP)
  })

  it('honorario cero: también el piso', () => {
    expect(bandaMaterialidadFacturacion(0)).toBe(TOLERANCIA_SALDO_COP)
  })

  it('un valor no numérico cae al piso en vez de propagar NaN', () => {
    expect(bandaMaterialidadFacturacion(Number.NaN)).toBe(TOLERANCIA_SALDO_COP)
    expect(bandaMaterialidadFacturacion(-100)).toBe(TOLERANCIA_SALDO_COP)
  })

  it('bajo $100.000 el 1% queda POR DEBAJO del piso y manda el piso', () => {
    // 1% de 50.000 son 500. La banda no puede ser más estrecha que la vara de
    // materialidad del resto del producto.
    expect(bandaMaterialidadFacturacion(50_000)).toBe(TOLERANCIA_SALDO_COP)
    // Justo en el cruce: 1% de 100.000 son exactamente 1.000.
    expect(bandaMaterialidadFacturacion(100_000)).toBe(TOLERANCIA_SALDO_COP)
    expect(bandaMaterialidadFacturacion(100_100)).toBe(1_001)
  })

  it('sobre el cruce manda el 1% y escala con el honorario', () => {
    // Los dos honorarios que más se repiten en SOENA (medido 2026-09-08).
    expect(bandaMaterialidadFacturacion(637_500)).toBe(6_375)
    expect(bandaMaterialidadFacturacion(850_000)).toBe(8_500)
  })

  it('redondea a peso: la banda es una cifra en pesos, no un decimal', () => {
    expect(bandaMaterialidadFacturacion(699_975)).toBe(7_000)
  })
})

describe('estadoDeRecaudo — las fronteras de la banda', () => {
  const con = (falta: number, honorario: number | null = 637_500) =>
    estadoDeRecaudo({ falta_saldo: falta, honorario })

  it('$1.000 exactos siguen siendo CUBIERTO', () => {
    // Frontera de abajo: el piso de materialidad es inclusivo, igual que en
    // `saldoCuadrado` y en el gate `saldo_cero`.
    expect(con(TOLERANCIA_SALDO_COP)).toBe('cubierto')
  })

  it('$1.001 ya no es cubierto: entra a la banda', () => {
    expect(con(TOLERANCIA_SALDO_COP + 1)).toBe('descuadre_menor')
  })

  it('exactamente el 1% del honorario sigue DENTRO de la banda', () => {
    // Frontera de arriba, inclusiva: quien cae justo en el 1% se lista marcado,
    // no se retiene.
    expect(con(6_375)).toBe('descuadre_menor')
  })

  it('el 1% más un peso ya es RETENIDO', () => {
    expect(con(6_376)).toBe('retenido')
  })

  it('honorario nulo: la banda es el piso, así que $1.001 ya retiene', () => {
    expect(con(TOLERANCIA_SALDO_COP, null)).toBe('cubierto')
    expect(con(TOLERANCIA_SALDO_COP + 1, null)).toBe('retenido')
  })

  it('honorario cero: idéntico al nulo', () => {
    expect(con(TOLERANCIA_SALDO_COP, 0)).toBe('cubierto')
    expect(con(TOLERANCIA_SALDO_COP + 1, 0)).toBe('retenido')
  })

  it('un faltante en cero o negativo es cubierto', () => {
    // `descuadreConciliacion` nunca devuelve negativos, pero el criterio no puede
    // depender de eso: un negativo significaría que sobra plata, no que falta.
    expect(con(0)).toBe('cubierto')
    expect(con(-5_000)).toBe('cubierto')
  })

  it('un faltante no numérico se trata como cero, no como retenido', () => {
    expect(estadoDeRecaudo({ falta_saldo: Number.NaN, honorario: 637_500 })).toBe('cubierto')
  })
})

describe('estadoDeRecaudo — los casos reales de SOENA (medidos 2026-09-08)', () => {
  // Copiados de producción con la fecha puesta: el día que la cifra cambie se
  // verá que la prueba envejeció, en vez de parecer un defecto del código.
  it('V0179 es el ÚNICO en la banda: faltan $3.000 sobre $637.500 (0,47%)', () => {
    expect(estadoDeRecaudo({ falta_saldo: 3_000, honorario: 637_500 })).toBe('descuadre_menor')
  })

  it('V0406 es el retenido más cercano y aun así debe el 11,8%', () => {
    // $50.000 sobre $425.000, con banda de $4.250. Entre 0,47% y 11,8% no hay un
    // solo caso: la vara del 1% no parte ningún grupo por la mitad.
    expect(estadoDeRecaudo({ falta_saldo: 50_000, honorario: 425_000 })).toBe('retenido')
  })

  it('quien no pagó nada del honorario es retenido, no un descuadre', () => {
    expect(estadoDeRecaudo({ falta_saldo: 850_000, honorario: 850_000 })).toBe('retenido')
  })
})

describe('faltantesDelCaso', () => {
  it('no repite un faltante que aparece en las dos listas', () => {
    const f = faltantesDelCaso({ ...base, faltan_cliente: ['identificación'], faltan_factura: ['identificación'] })
    expect(f).toEqual(['identificación'])
  })

  it('un caso RETENIDO no nombra el recaudo: ya no se lista en ninguna parte', () => {
    // Antes decía "recaudo del honorario". Ahora el retenido sale de la cola en el
    // servidor, así que esa etiqueta no la leería nadie.
    expect(faltantesDelCaso({ ...base, falta_saldo: 250_000 })).toEqual([])
  })

  it('un DESCUADRE MENOR nombra el residuo con el monto', () => {
    // El trabajo no es conseguir esa plata: es decidir por escrito que se factura
    // sin ella. El monto es lo que hace la decisión tomable.
    const f = faltantesDelCaso({ ...base, falta_saldo: 3_000 })
    expect(f).toHaveLength(1)
    expect(f[0]).toContain('descuadre de recaudo')
    expect(f[0]).toContain('3.000')
  })

  it('sin faltas, lista vacía', () => {
    expect(faltantesDelCaso(base)).toEqual([])
  })
})

describe('faltantesDelCaso — sin RUT se nombra la causa, no las consecuencias', () => {
  // Los cinco casos con pago y sin recibo de caja medidos el 2026-09-08 (V0231,
  // V0442, V0443, V0453, V0471) llegaban así: el RUT nunca se cargó, y la tarjeta
  // pintaba cuatro etiquetas de datos personales como si fueran para teclear.
  const sinRut = {
    ...base,
    sin_rut: true,
    faltan_cliente: ['identificación', 'nombre', 'dirección', 'ciudad (no se pudo resolver el código DANE)'],
  }

  it('reemplaza los faltantes derivados del RUT por una sola etiqueta', () => {
    expect(faltantesDelCaso(sinRut)).toEqual(['RUT sin cargar'])
  })

  it('conserva lo que le falta a la FACTURA, que no sale del RUT', () => {
    // El honorario no está en el RUT: sigue faltando el día que el documento llegue.
    const f = faltantesDelCaso({ ...sinRut, faltan_factura: ['honorario aprobado'] })
    expect(f).toEqual(['RUT sin cargar', 'honorario aprobado'])
  })

  it('con RUT cargado los faltantes del cliente se muestran uno a uno', () => {
    // Ahí sí son datos sueltos por corregir, y decir "RUT sin cargar" mentiría.
    const f = faltantesDelCaso({ ...base, sin_rut: false, faltan_cliente: ['email'] })
    expect(f).toEqual(['email'])
  })

  it('sigue sin estar listo para facturar', () => {
    // La etiqueta cambia lo que se lee, no el gate: sin identificación no hay tercero.
    expect(casoListoParaFacturar(sinRut)).toBe(false)
  })
})
