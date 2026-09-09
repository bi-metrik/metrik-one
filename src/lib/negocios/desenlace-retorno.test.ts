import { describe, it, expect } from 'vitest'
import {
  leerDesenlaces,
  desenlacesDelDestino,
  senalViva,
  conteoDeDesenlaces,
  construirMarcaDesenlace,
  archivarData,
  leerDesenlacesDeMetadata,
  textoChipDesenlace,
  bloqueArchivable,
  TIPO_CICLO_DESENLACE,
} from './desenlace-retorno'
import { destinoDeRouting, type RoutingEtapa } from './dato-de-decision'

// ════════════════════════════════════════════════════════════════════════════
// Fixtures copiados de PRODUCCIÓN (línea GIT EV/HEV `34a0fa6b`, leída el 2026-09-09).
//
// Se usan los reales porque son los que destapan las dos trampas:
//   · el routing de Cita cae por DEFECTO a Notificación (17) cuando la vía está vacía,
//     así que archivar el dato NO basta por sí solo para romper el bucle;
//   · Notificación tenía UNA sola salida (`conditional: []`, default 18): el flujo
//     asumía que el PQR siempre se acepta.
//
// Medido el mismo día: 46 negocios abiertos parados en Notificación, los 46 con
// `via_solicitud = pqrs` y ninguno con fecha de cita.
// ════════════════════════════════════════════════════════════════════════════

/** Routing de Cita (orden 16) tal como está hoy en producción. */
const ROUTING_CITA: RoutingEtapa = {
  conditional: [
    { condition: { field: 'via_solicitud', value: 'pqrs' }, etapa_orden: 17 },
    { condition: { field: 'via_solicitud', value: 'agenda' }, etapa_orden: 18 },
  ],
  default_etapa_orden: 17,
}

/** Routing de Notificación (orden 17) DESPUÉS de la config que este frente propone. */
const ROUTING_NOTIFICACION: RoutingEtapa = {
  conditional: [
    { condition: { field: 'resultado_pqr', value: 'pqr_rechazado' }, etapa_orden: 16 },
  ],
  default_etapa_orden: 18,
}

const CONFIG_NOTIFICACION = {
  routing: ROUTING_NOTIFICACION,
  desenlace_retorno: [
    {
      bloque: 'resultado_pqr',
      campo: 'resultado_pqr',
      valor: 'pqr_rechazado',
      destino_orden: 16,
      marca: 'pqr_rechazos',
      chip: 'PQR rechazado',
      archivar: ['via_solicitud_cita', 'radicado_pqr'],
      referencia: { bloque: 'radicado_pqr', campo: 'radicado_pqr' },
    },
  ],
}

const DECL = leerDesenlaces(CONFIG_NOTIFICACION)[0]

describe('leerDesenlaces', () => {
  it('lee la declaración real de Notificación', () => {
    expect(DECL).toEqual({
      bloque: 'resultado_pqr',
      campo: 'resultado_pqr',
      valor: 'pqr_rechazado',
      destinoOrden: 16,
      marca: 'pqr_rechazos',
      chip: 'PQR rechazado',
      archivar: ['via_solicitud_cita', 'radicado_pqr'],
      referencia: { bloque: 'radicado_pqr', campo: 'radicado_pqr' },
    })
  })

  it('sin la clave, ninguna línea cambia de comportamiento', () => {
    expect(leerDesenlaces(null)).toEqual([])
    expect(leerDesenlaces({})).toEqual([])
    expect(leerDesenlaces({ routing: ROUTING_CITA })).toEqual([])
    // Forma equivocada (objeto en vez de arreglo): se ignora, no se adivina.
    expect(leerDesenlaces({ desenlace_retorno: { bloque: 'x' } })).toEqual([])
  })

  it('descarta la declaración incompleta entera en vez de completarla con defaults', () => {
    // Devolver un caso y vaciarle casillas es demasiado caro para hacerlo por una config
    // a medio escribir. Cada una de estas pierde un campo obligatorio distinto.
    const casos = [
      { campo: 'r', valor: 'v', destino_orden: 16, marca: 'm', chip: 'c' }, // sin bloque
      { bloque: 'b', valor: 'v', destino_orden: 16, marca: 'm', chip: 'c' }, // sin campo
      { bloque: 'b', campo: 'r', destino_orden: 16, marca: 'm', chip: 'c' }, // sin valor
      { bloque: 'b', campo: 'r', valor: 'v', marca: 'm', chip: 'c' }, // sin destino
      { bloque: 'b', campo: 'r', valor: 'v', destino_orden: '16', marca: 'm', chip: 'c' }, // destino texto
      { bloque: 'b', campo: 'r', valor: 'v', destino_orden: 16, chip: 'c' }, // sin marca
      { bloque: 'b', campo: 'r', valor: 'v', destino_orden: 16, marca: 'm' }, // sin chip
      { bloque: '  ', campo: 'r', valor: 'v', destino_orden: 16, marca: 'm', chip: 'c' }, // bloque en blanco
    ]
    for (const c of casos) {
      expect(leerDesenlaces({ desenlace_retorno: [c] })).toEqual([])
    }
  })

  it('la referencia es opcional y solo cuenta completa', () => {
    const base = { bloque: 'b', campo: 'r', valor: 'v', destino_orden: 16, marca: 'm', chip: 'c' }
    expect(leerDesenlaces({ desenlace_retorno: [base] })[0].referencia).toBeNull()
    expect(leerDesenlaces({ desenlace_retorno: [{ ...base, referencia: { bloque: 'x' } }] })[0].referencia).toBeNull()
    expect(leerDesenlaces({ desenlace_retorno: [{ ...base, referencia: { bloque: 'x', campo: 'y' } }] })[0].referencia)
      .toEqual({ bloque: 'x', campo: 'y' })
  })
})

describe('desenlacesDelDestino', () => {
  it('dispara solo donde el caso está: en Cita (16), no en Notificación (17)', () => {
    expect(desenlacesDelDestino([DECL], 16)).toHaveLength(1)
    expect(desenlacesDelDestino([DECL], 17)).toHaveLength(0)
    expect(desenlacesDelDestino([DECL], 18)).toHaveLength(0)
    expect(desenlacesDelDestino([DECL], null)).toHaveLength(0)
  })
})

describe('senalViva', () => {
  it('la respuesta del desenlace en el bloque ES la señal', () => {
    expect(senalViva(DECL, { resultado_pqr: 'pqr_rechazado' })).toBe(true)
  })

  it('la otra respuesta NO devuelve el caso', () => {
    expect(senalViva(DECL, { resultado_pqr: 'cita_asignada' })).toBe(false)
  })

  it('vacío no es una respuesta', () => {
    expect(senalViva(DECL, {})).toBe(false)
    expect(senalViva(DECL, null)).toBe(false)
    expect(senalViva(DECL, { resultado_pqr: null })).toBe(false)
  })

  it('archivar el bloque consume la señal: eso es lo que hace el mecanismo idempotente', () => {
    const archivado = archivarData(
      { resultado_pqr: 'pqr_rechazado' },
      { ciclo: 1, archivadoAt: '2026-09-09T10:00:00Z', marca: 'pqr_rechazos', campo: 'resultado_pqr' },
    ).data
    expect(senalViva(DECL, archivado)).toBe(false)
  })
})

describe('conteoDeDesenlaces', () => {
  it('el primer rechazo cuenta 1', () => {
    expect(conteoDeDesenlaces({ resultado_pqr: 'pqr_rechazado' }, 'pqr_rechazos')).toBe(1)
    expect(conteoDeDesenlaces(null, 'pqr_rechazos')).toBe(1)
  })

  it('el SEGUNDO rechazo incrementa en vez de pisarse', () => {
    // El caso volvió a Notificación, se radicó otro PQR y lo rechazaron de nuevo. El
    // ciclo 1 quedó archivado dentro del propio bloque, así que el conteo lo sabe.
    const trasPrimerCiclo = archivarData(
      { resultado_pqr: 'pqr_rechazado' },
      { ciclo: 1, archivadoAt: '2026-09-01T10:00:00Z', marca: 'pqr_rechazos', campo: 'resultado_pqr' },
    ).data
    const segundaVuelta = { ...trasPrimerCiclo, resultado_pqr: 'pqr_rechazado' }
    expect(conteoDeDesenlaces(segundaVuelta, 'pqr_rechazos')).toBe(2)
  })

  it('se DERIVA de los ciclos, así que repetir la pasada no cuenta dos veces', () => {
    // La propiedad que hace segura la reentrada: mientras el bloque no se archive, dos
    // pasadas calculan el MISMO número. Un `previo + 1` daría 1 y luego 2.
    const data = { resultado_pqr: 'pqr_rechazado' }
    expect(conteoDeDesenlaces(data, 'pqr_rechazos')).toBe(1)
    expect(conteoDeDesenlaces(data, 'pqr_rechazos')).toBe(1)
  })

  it('no cuenta ciclos de OTRO mecanismo ni de otra marca', () => {
    const mezclado = {
      _ciclos: [
        { ciclo: 1, tipo: 'retorno_decision', campo: 'requiere_cita_dian', data: {} },
        { ciclo: 1, tipo: TIPO_CICLO_DESENLACE, marca: 'otra_cosa', data: {} },
      ],
      resultado_pqr: 'pqr_rechazado',
    }
    expect(conteoDeDesenlaces(mezclado, 'pqr_rechazos')).toBe(1)
  })
})

describe('archivarData', () => {
  it('el ciclo anterior queda consultable dentro del propio bloque', () => {
    const { data, teniaContenido } = archivarData(
      { via_solicitud: 'pqrs' },
      { ciclo: 1, archivadoAt: '2026-09-09T10:00:00Z', marca: 'pqr_rechazos', campo: 'resultado_pqr' },
    )
    expect(teniaContenido).toBe(true)
    expect(data.via_solicitud).toBeUndefined()
    expect(data._ciclos).toEqual([
      {
        ciclo: 1,
        archivado_at: '2026-09-09T10:00:00Z',
        tipo: TIPO_CICLO_DESENLACE,
        marca: 'pqr_rechazos',
        campo: 'resultado_pqr',
        data: { via_solicitud: 'pqrs' },
      },
    ])
  })

  it('los ciclos previos se conservan, no se reemplazan', () => {
    const uno = archivarData({ via_solicitud: 'pqrs' }, { ciclo: 1, archivadoAt: 'A', marca: 'm', campo: 'c' }).data
    const dos = archivarData({ ...uno, via_solicitud: 'pqrs' }, { ciclo: 2, archivadoAt: 'B', marca: 'm', campo: 'c' }).data
    expect((dos._ciclos as unknown[]).length).toBe(2)
  })

  it('un bloque vacío no genera ciclo: no hay nada que archivar', () => {
    expect(archivarData({}, { ciclo: 1, archivadoAt: 'A', marca: 'm', campo: 'c' }).teniaContenido).toBe(false)
    expect(archivarData(null, { ciclo: 1, archivadoAt: 'A', marca: 'm', campo: 'c' }).teniaContenido).toBe(false)
  })
})

describe('bloqueArchivable — el guard compartido con el retorno al punto de decisión', () => {
  it('se comparte a propósito: si aquí dijera otra cosa, dos mecanismos vecinos tratarían el mismo bloque distinto', () => {
    expect(bloqueArchivable({ fields: [] })).toBe(true)
    // Heredado readonly: su dato vive en otra etapa que no se está rehaciendo.
    expect(bloqueArchivable({ source_etapa_orden: 16 })).toBe(false)
    // Documento que sigue sirviendo (el certificado bancario dura 30 días).
    expect(bloqueArchivable({ conservar_en_reproceso: true })).toBe(false)
    // Dinero: archivar el bloque NO revierte el cobro, deja la pantalla en desacuerdo.
    expect(bloqueArchivable({ es_pagos_epayco: true })).toBe(false)
    expect(bloqueArchivable({ es_pago_externo: true })).toBe(false)
    expect(bloqueArchivable({ triggers: [{ action: 'auto_cobros' }] })).toBe(false)
  })
})

describe('la marca', () => {
  it('deja conteo, cuándo y el radicado del PQR rechazado', () => {
    expect(construirMarcaDesenlace({
      decl: DECL,
      conteo: 2,
      ahoraISO: '2026-09-09T15:04:00Z',
      referencia: 'PQR-2026-99',
    })).toEqual({
      conteo: 2,
      ultimo_at: '2026-09-09T15:04:00Z',
      ultima_referencia: 'PQR-2026-99',
      chip: 'PQR rechazado',
    })
  })
})

describe('leerDesenlacesDeMetadata', () => {
  it('lee la marca anidada y la deja lista para la tarjeta', () => {
    expect(leerDesenlacesDeMetadata({
      desenlaces: {
        pqr_rechazos: { conteo: 1, ultimo_at: '2026-09-09T15:04:00Z', ultima_referencia: 'PQR-1', chip: 'PQR rechazado' },
      },
    })).toEqual([
      { clave: 'pqr_rechazos', conteo: 1, ultimo_at: '2026-09-09T15:04:00Z', ultima_referencia: 'PQR-1', chip: 'PQR rechazado' },
    ])
  })

  it('un negocio que nunca dio la vuelta no pinta nada', () => {
    expect(leerDesenlacesDeMetadata(null)).toEqual([])
    expect(leerDesenlacesDeMetadata({})).toEqual([])
    expect(leerDesenlacesDeMetadata({ reproceso: { activo: true } })).toEqual([])
  })

  it('una marca a medio escribir se ignora: pintar un chip vacío es peor que no pintarlo', () => {
    expect(leerDesenlacesDeMetadata({ desenlaces: { x: { conteo: 1 } } })).toEqual([])
    expect(leerDesenlacesDeMetadata({ desenlaces: { x: { chip: 'X' } } })).toEqual([])
    expect(leerDesenlacesDeMetadata({ desenlaces: { x: { conteo: 0, chip: 'X' } } })).toEqual([])
    expect(leerDesenlacesDeMetadata({ desenlaces: [] })).toEqual([])
  })
})

describe('textoChipDesenlace', () => {
  const base = { clave: 'pqr_rechazos', chip: 'PQR rechazado', ultimo_at: '', ultima_referencia: null }

  it('el conteo aparece solo a partir del segundo', () => {
    expect(textoChipDesenlace({ ...base, conteo: 1 })).toBe('PQR rechazado')
    expect(textoChipDesenlace({ ...base, conteo: 3 })).toBe('PQR rechazado ×3')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ EL BUCLE — la prueba que el frente existe para no fallar.
//
// Devolver el caso a Cita sin tocar nada más lo deja saliendo otra vez por PQR con el
// radicado que la DIAN acaba de rechazar, y nadie ve por qué. Estas pruebas recorren el
// ciclo completo con el MISMO evaluador de routing que usa el motor de avance
// (`destinoDeRouting`), no con una reimplementación.
// ════════════════════════════════════════════════════════════════════════════
describe('el bucle 17 → 16 → 17', () => {
  it('SIN archivar, el caso vuelve a salir por PQR: el bucle existe', () => {
    // Es el estado de los 46 abiertos en Notificación hoy.
    const citaSinTocar = { via_solicitud: 'pqrs' }
    expect(destinoDeRouting(ROUTING_CITA, citaSinTocar)).toBe(17)
  })

  it('rechazado, el routing de Notificación devuelve a Cita (16)', () => {
    expect(destinoDeRouting(ROUTING_NOTIFICACION, { resultado_pqr: 'pqr_rechazado' })).toBe(16)
  })

  it('con la cita asignada sigue a Anexos (18), como hoy', () => {
    expect(destinoDeRouting(ROUTING_NOTIFICACION, { resultado_pqr: 'cita_asignada' })).toBe(18)
  })

  it('archivado el dato, el caso NO sale automáticamente por PQR otra vez', () => {
    // Lo que archivar consigue: la vía deja de estar respondida, así que la rama `pqrs`
    // ya no matchea. El caso NO se va solo por donde venía.
    const citaArchivada = archivarData(
      { via_solicitud: 'pqrs' },
      { ciclo: 1, archivadoAt: '2026-09-09T10:00:00Z', marca: 'pqr_rechazos', campo: 'resultado_pqr' },
    ).data
    const rutaCondicional = (ROUTING_CITA.conditional ?? []).some(
      r => String(citaArchivada[r.condition.field] ?? '') === r.condition.value,
    )
    expect(rutaCondicional).toBe(false)
  })

  it('⚠️ y aun así el DEFAULT de Cita apunta a Notificación: lo que corta el bucle es el GATE', () => {
    // Esta prueba fija la trampa que hace insuficiente el archivado por sí solo. El
    // routing de Cita cae por defecto a 17 con la vía vacía, así que si el bloque
    // archivado no retuviera, el caso volvería igual. Lo que lo retiene es que queda
    // `pendiente` y es gate: nadie puede avanzar sin volver a responder.
    const citaArchivada = archivarData(
      { via_solicitud: 'pqrs' },
      { ciclo: 1, archivadoAt: 'A', marca: 'pqr_rechazos', campo: 'resultado_pqr' },
    ).data
    expect(destinoDeRouting(ROUTING_CITA, citaArchivada)).toBe(17)
  })

  it('cuando la persona vuelve a responder, el caso sigue la NUEVA respuesta', () => {
    // Deisy: tras el rechazo el camino es pedir la cita por el portal. No se fuerza
    // `agenda`: radicar otro PQR sigue siendo posible y lo elige una persona.
    expect(destinoDeRouting(ROUTING_CITA, { via_solicitud: 'agenda' })).toBe(18)
    expect(destinoDeRouting(ROUTING_CITA, { via_solicitud: 'pqrs' })).toBe(17)
  })
})
