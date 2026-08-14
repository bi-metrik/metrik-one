import { describe, it, expect } from 'vitest'
import { documentoVigenteEn, diasAlObjetivo, parseFechaISO, estadoVigencia } from './vigencia'

describe('documentoVigenteEn', () => {
  it('reproduce el caso real que originó la regla (cliente de Cali)', () => {
    // Certificado bancario del 17 de julio, umbral operativo de 10 días.
    // Sirve para una cita del 25 de julio; no sirve para la tercera semana de agosto.
    expect(documentoVigenteEn('2026-07-17', '2026-07-25', 10)).toBe(true)
    expect(documentoVigenteEn('2026-07-17', '2026-08-19', 10)).toBe(false)
  })

  it('valida contra el día de la cita, no contra el día de carga', () => {
    // Mismo documento, misma antigüedad al cargarlo: lo que decide es la cita.
    expect(documentoVigenteEn('2026-07-01', '2026-07-20', 20)).toBe(true)
    expect(documentoVigenteEn('2026-07-01', '2026-07-25', 20)).toBe(false)
  })

  it('el límite exacto pasa y un día más no', () => {
    expect(documentoVigenteEn('2026-07-01', '2026-07-21', 20)).toBe(true)
    expect(documentoVigenteEn('2026-07-01', '2026-07-22', 20)).toBe(false)
  })

  it('un documento posterior a la cita también sirve: es más nuevo', () => {
    expect(documentoVigenteEn('2026-08-10', '2026-08-01', 20)).toBe(true)
  })

  it('usa 30 días cuando no se especifica vigencia', () => {
    expect(documentoVigenteEn('2026-07-01', '2026-07-31', undefined)).toBe(true)
    expect(documentoVigenteEn('2026-07-01', '2026-08-01', undefined)).toBe(false)
  })

  it('devuelve null si falta una fecha o no parsea, en vez de declarar vencido', () => {
    // Sin datos no se afirma que algo esté vencido: bloquear un trámite por una
    // fecha ilegible es peor que dejarlo pasar y que lo revise una persona.
    expect(documentoVigenteEn(null, '2026-08-01', 20)).toBeNull()
    expect(documentoVigenteEn('2026-07-01', '', 20)).toBeNull()
    expect(documentoVigenteEn('17/07/2026', '2026-08-01', 20)).toBeNull()
    expect(documentoVigenteEn('no es fecha', '2026-08-01', 20)).toBeNull()
  })

  it('cruza fin de mes y fin de año sin desfase', () => {
    expect(documentoVigenteEn('2026-01-25', '2026-02-10', 20)).toBe(true)
    expect(documentoVigenteEn('2026-12-20', '2027-01-05', 20)).toBe(true)
    expect(documentoVigenteEn('2026-12-20', '2027-01-15', 20)).toBe(false)
  })

  it('maneja el año bisiesto', () => {
    expect(parseFechaISO('2024-02-29')).not.toBeNull()
    expect(documentoVigenteEn('2024-02-29', '2024-03-10', 20)).toBe(true)
  })
})

describe('parseFechaISO', () => {
  it('rechaza fechas imposibles que Date.UTC normalizaría en silencio', () => {
    expect(parseFechaISO('2026-02-31')).toBeNull()
    expect(parseFechaISO('2026-13-01')).toBeNull()
    expect(parseFechaISO('2026-00-10')).toBeNull()
    expect(parseFechaISO('2025-02-29')).toBeNull() // 2025 no es bisiesto
  })

  it('tolera timestamp completo y espacios', () => {
    expect(parseFechaISO('2026-07-17T10:30:00Z')).toBe(Date.UTC(2026, 6, 17))
    expect(parseFechaISO('  2026-07-17  ')).toBe(Date.UTC(2026, 6, 17))
  })
})

describe('estadoVigencia', () => {
  // Los casos de esta suite son negocios REALES de SOENA medidos el 2026-08-13,
  // con 30 días calendario de vigencia. Un test escrito desde la regla dicha no
  // habría distinguido `esperar` de `reemplazar`: son los datos los que muestran
  // que un certificado pedido hoy para una cita a seis semanas también llega vencido.
  const V30 = { vigenciaDias: 30 }
  const HOY = '2026-08-13'

  it('marca vigente el que sirve el día de la cita (V0157: cita 07-sep, expedido 11-ago)', () => {
    const r = estadoVigencia('2026-08-11', '2026-09-07', { ...V30, hoyISO: HOY })
    expect(r.estado).toBe('vigente')
    expect(r.diasAlObjetivo).toBe(27)
    expect(r.pedirDesde).toBeNull()
  })

  it('no manda a pedir un certificado que TAMBIÉN llegaría vencido (V0027: cita 26-sep)', () => {
    // Expedido el 05-mar: 205 días a la cita, no sirve. Pero hoy es 13-ago y uno
    // pedido hoy vence el 12-sep, antes del 26. Pedirlo ahora es trabajo repetido.
    const r = estadoVigencia('2026-03-05', '2026-09-26', { ...V30, hoyISO: HOY })
    expect(r.estado).toBe('esperar')
    expect(r.diasAlObjetivo).toBe(205)
    expect(r.pedirDesde).toBe('2026-08-27')
  })

  it('los cuatro casos del 26-sep comparten la misma fecha para pedirlo', () => {
    // V0027, V0135, V0167 y V0148: expediciones distintas, misma cita. Lo que
    // decide cuándo pedir es la cita, no la antigüedad del que está cargado.
    for (const exp of ['2026-03-05', '2026-05-20', '2026-06-02', '2026-06-26']) {
      const r = estadoVigencia(exp, '2026-09-26', { ...V30, hoyISO: HOY })
      expect(r.estado).toBe('esperar')
      expect(r.pedirDesde).toBe('2026-08-27')
    }
  })

  it('pasa a reemplazar en cuanto se entra a la ventana, y el día exacto ya cuenta', () => {
    const cita = '2026-09-26'
    expect(estadoVigencia('2026-03-05', cita, { ...V30, hoyISO: '2026-08-26' }).estado).toBe('esperar')
    expect(estadoVigencia('2026-03-05', cita, { ...V30, hoyISO: '2026-08-27' }).estado).toBe('reemplazar')
    expect(estadoVigencia('2026-03-05', cita, { ...V30, hoyISO: '2026-09-20' }).estado).toBe('reemplazar')
  })

  it('sin fecha de cita NO dice vigente: dice que no se pudo comprobar', () => {
    // Es el caso de los 87 casos aguas arriba. El cross_check los daba por buenos
    // porque `null` se colapsaba a `true`; aquí queda como un estado propio.
    const r = estadoVigencia('2026-05-20', null, V30)
    expect(r.estado).toBe('no_comprobable')
    expect(r.diasAlObjetivo).toBeNull()
    expect(r.pedirDesde).toBeNull()
    expect(estadoVigencia('', '2026-09-26', V30).estado).toBe('no_comprobable')
    expect(estadoVigencia('20/05/2026', '2026-09-26', V30).estado).toBe('no_comprobable')
  })

  it('sin reloj cae al lado que pide acción, no al que la aplaza', () => {
    // No saber qué día es hoy no puede convertir un documento inservible en un
    // pendiente silencioso: se reporta `reemplazar` y alguien lo mira.
    const r = estadoVigencia('2026-03-05', '2026-09-26', V30)
    expect(r.estado).toBe('reemplazar')
    expect(r.pedirDesde).toBe('2026-08-27')
  })

  it('la fecha para pedirlo cruza mes y año sin desfase', () => {
    expect(estadoVigencia('2026-01-01', '2026-03-15', { ...V30, hoyISO: '2026-01-05' }).pedirDesde)
      .toBe('2026-02-13')
    expect(estadoVigencia('2026-06-01', '2027-01-10', { ...V30, hoyISO: '2026-06-05' }).pedirDesde)
      .toBe('2026-12-11')
  })

  it('declara contra qué se midió, para que la pantalla pueda redactar', () => {
    expect(estadoVigencia('2026-08-11', '2026-09-07', { ...V30, hoyISO: HOY }).criterio).toBe('cita')
    expect(estadoVigencia('2026-05-20', null, V30).criterio).toBeNull()
  })

  it('respeta la vigencia declarada: los mismos datos cambian de estado con 10 días', () => {
    // El bloque de SOENA tenía 10 días configurados mientras el campo decía un mes.
    // Con el mismo par de fechas, el veredicto es distinto — por eso el parámetro
    // no es un detalle: es la regla.
    const args = ['2026-08-11', '2026-09-07'] as const
    expect(estadoVigencia(...args, { vigenciaDias: 30, hoyISO: HOY }).estado).toBe('vigente')
    expect(estadoVigencia(...args, { vigenciaDias: 10, hoyISO: HOY }).estado).toBe('esperar')
  })
})

describe('estadoVigencia sin cita: margen contra el calendario', () => {
  // Acuerdo con SOENA del 2026-08-13 (reunión con Deisy): el vencimiento se mide
  // contra la cita cuando la hay, y contra el calendario con 10 días de tolerancia
  // cuando no. Deisy: "cuando no tenga cita, que por lo menos tenga una vigencia de
  // 10 días"; Mauricio: "De hoy, de hoy 10 días de vigencia".
  const HOY = '2026-08-13'
  const CON_MARGEN = { vigenciaDias: 30, margenSinObjetivoDias: 10, hoyISO: HOY }

  it('con 30 de vigencia y 10 de margen, el corte cae a los 20 días de expedido', () => {
    // Objetivo derivado = 2026-08-23. Un certificado del 24-jul llega con 30 días
    // justos: sirve. El del 23-jul llega con 31: no. El límite es exacto, y por eso
    // se prueba en los dos lados — un `<` en vez de `<=` movería la línea un día.
    const r = estadoVigencia('2026-07-24', null, CON_MARGEN)
    expect(r.estado).toBe('vigente')
    expect(r.diasAlObjetivo).toBe(30)
    expect(r.criterio).toBe('margen')

    expect(estadoVigencia('2026-07-23', null, CON_MARGEN).estado).toBe('reemplazar')
  })

  it('sin cita NO existe "esperar": uno pedido hoy siempre alcanza', () => {
    // El objetivo se mueve con el día, así que nunca hay una fecha desde la cual
    // valga la pena esperar. Devolver `pedirDesde` aquí mandaría al comercial a
    // agendar algo que puede hacer ya.
    const r = estadoVigencia('2026-01-15', null, CON_MARGEN)
    expect(r.estado).toBe('reemplazar')
    expect(r.pedirDesde).toBeNull()
    expect(r.criterio).toBe('margen')
  })

  it('la cita real MANDA sobre el margen', () => {
    // Con cita el 26-sep, un certificado del 24-jul no sirve aunque pase el margen
    // de 10 días. Derivar el objetivo teniendo cita mediría contra un día que no es
    // el del trámite: exactamente el error que este módulo viene a evitar.
    const r = estadoVigencia('2026-07-24', '2026-09-26', CON_MARGEN)
    expect(r.criterio).toBe('cita')
    expect(r.estado).toBe('esperar')
    expect(r.pedirDesde).toBe('2026-08-27')
  })

  it('sin reloj no se inventa el objetivo: queda sin comprobar', () => {
    // El margen se cuenta desde hoy. Sin `hoyISO` no hay contra qué medir, y
    // suponer una fecha sería peor que declarar que no se pudo comprobar.
    const r = estadoVigencia('2026-07-24', null, { vigenciaDias: 30, margenSinObjetivoDias: 10 })
    expect(r.estado).toBe('no_comprobable')
    expect(r.criterio).toBeNull()
  })

  it('quien no declara margen conserva el comportamiento previo', () => {
    // El margen es opt-in por check. Un bloque que no lo declara sigue diciendo
    // "no se pudo comprobar" cuando falta la cita, como hasta hoy.
    const r = estadoVigencia('2026-07-24', null, { vigenciaDias: 30, hoyISO: HOY })
    expect(r.estado).toBe('no_comprobable')
    expect(r.criterio).toBeNull()
  })
})

describe('diasAlObjetivo', () => {
  it('cuenta los días que tendrá el documento el día de la cita', () => {
    expect(diasAlObjetivo('2026-07-17', '2026-08-19')).toBe(33)
    expect(diasAlObjetivo('2026-07-17', '2026-07-17')).toBe(0)
  })

  it('devuelve null sin fechas válidas', () => {
    expect(diasAlObjetivo('2026-07-17', null)).toBeNull()
  })
})
