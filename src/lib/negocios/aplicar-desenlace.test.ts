import { describe, it, expect, beforeEach } from 'vitest'
import { aplicarDesenlacesDeRetorno } from './aplicar-desenlace'
import { destinoDeRouting, type RoutingEtapa } from './dato-de-decision'
import {
  WS,
  NEGOCIO,
  ETAPAS_LINEA,
  ETAPAS_SIN_DECLARAR,
  bloque,
  clienteFalso,
  negocio,
  reiniciarDoble,
  sembrarCaso,
} from '../../../test/desenlace-doble'

// ════════════════════════════════════════════════════════════════════════════
// El desenlace de punta a punta, contra un doble que ESCRIBE.
//
// Fixtures copiados de producción (SOENA, línea GIT EV/HEV, 2026-09-09): los 46 negocios
// abiertos en Notificación tienen `via_solicitud = pqrs` y su radicado guardado. El doble
// reproduce ese estado, que es el que hace que el caso vuelva a salir por PQR.
//
// ── Mutaciones MEDIDAS contra las dos suites (2026-09-09) ───────────────────
// Arnés con guardas propias: línea base verde comprobada antes de mutar, aborto si el
// reemplazo no cambia el archivo, y verde comprobado otra vez al restaurar. Los conteos
// son sobre las 43 pruebas de `desenlace-retorno.test.ts` + este archivo.
//
//    1. `senalViva` devuelve siempre true ......................... 2 rojas
//    2. no archivar el bloque de la señal ......................... 6 rojas
//    3. `conteoDeDesenlaces` → constante 1 (no derivado) .......... 3 rojas
//   4b. no archivar los bloques DEPENDIENTES ..................... 6 rojas
//    5. saltarse `bloqueArchivable` ............................... 1 roja
//   6b. `fusionarMarcaAnidada` pisa a las marcas hermanas ......... 1 roja
//    7. `leerDesenlaces` acepta declaración incompleta ............ 1 roja
//    8. `desenlacesDelDestino` ignora la etapa actual ............. 2 rojas
//    9. `archivarData` pierde los ciclos previos .................. 2 rojas
//   10. el chip pinta el conteo desde 1 .......................... 1 roja
//   11. el conteo se fija en 1 en vez de leer los ciclos .......... 2 rojas
//
// ⚠️ Ninguna quedó huérfana. Dos de la primera tanda medían otra cosa que su etiqueta y
// se rehicieron: la #6 sustituía el helper por uno INEXISTENTE (medía un error de
// resolución, no la decisión) y la #4 decía "archivar la señal primero" cuando lo que
// hacía era saltarse los dependientes. Un arnés que no se revisa reporta rojos que no
// son del cambio (PR #578).
// ════════════════════════════════════════════════════════════════════════════

const AHORA = '2026-09-09T15:04:00Z'

/** Routing REAL de Cita (orden 16): con la vía vacía cae por DEFECTO a Notificación. */
const ROUTING_CITA: RoutingEtapa = {
  conditional: [
    { condition: { field: 'via_solicitud', value: 'pqrs' }, etapa_orden: 17 },
    { condition: { field: 'via_solicitud', value: 'agenda' }, etapa_orden: 18 },
  ],
  default_etapa_orden: 17,
}

async function correr(etapaActualOrden: number | null = 16) {
  return aplicarDesenlacesDeRetorno({
    supabase: clienteFalso(),
    workspaceId: WS,
    negocioId: NEGOCIO,
    etapaActualOrden,
    etapasLinea: ETAPAS_LINEA,
    ahoraISO: AHORA,
  })
}

/** Los campos vivos de las casillas de Cita, como los leería el motor de routing. */
function camposDeCita(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const id of ['nb-via', 'nb-radicado']) {
    const { _ciclos: _omit, ...vivos } = (bloque(id).data ?? {}) as Record<string, unknown>
    Object.assign(out, vivos)
  }
  return out
}

beforeEach(reiniciarDoble)

describe('cuándo NO hace nada', () => {
  it('ninguna etapa declara el desenlace: no toca la base', () => {
    sembrarCaso({ resultado: 'pqr_rechazado' })
    return aplicarDesenlacesDeRetorno({
      supabase: clienteFalso(),
      workspaceId: WS,
      negocioId: NEGOCIO,
      etapaActualOrden: 16,
      etapasLinea: ETAPAS_SIN_DECLARAR,
      ahoraISO: AHORA,
    }).then(r => {
      expect(r).toEqual([])
      expect(bloque('nb-via').data).toEqual({ via_solicitud: 'pqrs' })
      expect(negocio().metadata).toEqual({})
    })
  })

  it('el caso todavía está en Notificación (17), no en el destino', async () => {
    sembrarCaso({ resultado: 'pqr_rechazado' })
    expect(await correr(17)).toEqual([])
    expect(bloque('nb-via').data).toEqual({ via_solicitud: 'pqrs' })
  })

  it('la DIAN asignó la cita: el caso no vuelve y nada se archiva', async () => {
    sembrarCaso({ resultado: 'cita_asignada' })
    expect(await correr(16)).toEqual([])
    expect(bloque('nb-via').data).toEqual({ via_solicitud: 'pqrs' })
    expect(negocio().metadata).toEqual({})
  })

  it('sin respuesta en el bloque del desenlace no hay señal', async () => {
    sembrarCaso({ resultado: null })
    expect(await correr(16)).toEqual([])
  })
})

describe('el rechazo: qué queda escrito', () => {
  it('deja la marca con conteo, fecha y el radicado rechazado', async () => {
    sembrarCaso({ resultado: 'pqr_rechazado', radicado: 'PQR-2026-777' })
    const r = await correr()
    expect(r).toEqual([{ marca: 'pqr_rechazos', conteo: 1, bloquesArchivados: 3 }])
    expect(negocio().metadata).toEqual({
      desenlaces: {
        pqr_rechazos: {
          conteo: 1,
          ultimo_at: AHORA,
          ultima_referencia: 'PQR-2026-777',
          chip: 'PQR rechazado',
        },
      },
    })
  })

  it('la fusión conserva el RESTO de la metadata', async () => {
    // El defecto que `marca-metadata.ts` existe para cerrar: un update armado sobre una
    // copia vieja pisa lo que otro proceso escribió (costó 12 negocios con el tercero de
    // Siigo corrupto el 2026-09-02).
    sembrarCaso({
      resultado: 'pqr_rechazado',
      metadata: {
        siigo_cliente: { identificacion: '1020304050' },
        seccional: 'Bogotá',
        desenlaces: { otra_marca: { conteo: 5, chip: 'Otra cosa' } },
      },
    })
    await correr()
    const meta = negocio().metadata as Record<string, unknown>
    expect(meta.siigo_cliente).toEqual({ identificacion: '1020304050' })
    expect(meta.seccional).toBe('Bogotá')
    // Y también conserva las marcas HERMANAS dentro del contenedor.
    expect((meta.desenlaces as Record<string, unknown>).otra_marca).toEqual({ conteo: 5, chip: 'Otra cosa' })
  })

  it('archiva las casillas declaradas y las deja pendientes para volver a preguntarse', async () => {
    sembrarCaso({ resultado: 'pqr_rechazado' })
    await correr()

    expect(bloque('nb-via').estado).toBe('pendiente')
    expect(bloque('nb-via').completado_at).toBeNull()
    expect((bloque('nb-via').data as Record<string, unknown>).via_solicitud).toBeUndefined()
    expect((bloque('nb-via').data as { _ciclos: unknown[] })._ciclos).toHaveLength(1)

    expect(bloque('nb-radicado').estado).toBe('pendiente')
    expect((bloque('nb-radicado').data as Record<string, unknown>).radicado_pqr).toBeUndefined()

    // El bloque de la señal también: si el caso vuelve a Notificación, la pregunta se
    // hace de nuevo. Es además lo que consume la señal.
    expect(bloque('nb-senal').estado).toBe('pendiente')
    expect((bloque('nb-senal').data as Record<string, unknown>).resultado_pqr).toBeUndefined()
  })

  it('NO toca la copia heredada readonly: su dato vive en el bloque origen', async () => {
    sembrarCaso({ resultado: 'pqr_rechazado' })
    await correr()
    expect(bloque('nb-radicado-heredado').data).toEqual({ radicado_pqr: 'PQR-2026-0313' })
    expect(bloque('nb-radicado-heredado').estado).toBe('completo')
  })

  it('respeta `conservar_en_reproceso`: el guard manda sobre la declaración', async () => {
    sembrarCaso({ resultado: 'pqr_rechazado', conservarVia: true })
    const r = await correr()
    expect(bloque('nb-via').data).toEqual({ via_solicitud: 'pqrs' })
    expect(bloque('nb-via').estado).toBe('completo')
    expect(r[0].bloquesArchivados).toBe(2)
  })
})

describe('el segundo ciclo', () => {
  it('el contador incrementa en vez de pisarse', async () => {
    // El caso ya volvió una vez: radicaron otro PQR y la DIAN lo rechazó de nuevo.
    sembrarCaso({
      resultado: 'pqr_rechazado',
      radicado: 'PQR-2026-SEGUNDO',
      ciclosPrevios: [
        {
          ciclo: 1,
          archivado_at: '2026-08-20T10:00:00Z',
          tipo: 'desenlace_retorno',
          marca: 'pqr_rechazos',
          campo: 'resultado_pqr',
          data: { resultado_pqr: 'pqr_rechazado' },
        },
      ],
      metadata: {
        desenlaces: {
          pqr_rechazos: {
            conteo: 1,
            ultimo_at: '2026-08-20T10:00:00Z',
            ultima_referencia: 'PQR-2026-PRIMERO',
            chip: 'PQR rechazado',
          },
        },
      },
    })

    const r = await correr()
    expect(r).toEqual([{ marca: 'pqr_rechazos', conteo: 2, bloquesArchivados: 3 }])
    const marca = (negocio().metadata as { desenlaces: Record<string, Record<string, unknown>> })
      .desenlaces.pqr_rechazos
    expect(marca.conteo).toBe(2)
    expect(marca.ultima_referencia).toBe('PQR-2026-SEGUNDO')
    // Y el ciclo 1 sigue consultable dentro del bloque: dos vueltas se distinguen de una.
    expect((bloque('nb-senal').data as { _ciclos: unknown[] })._ciclos).toHaveLength(2)
  })
})

describe('reentrada', () => {
  it('correr dos veces NO cuenta el rechazo dos veces', async () => {
    // La propiedad que permite colgar esto de la LECTURA del negocio: la ficha se abre
    // muchas veces y solo la primera tiene trabajo que hacer.
    sembrarCaso({ resultado: 'pqr_rechazado' })
    const primera = await correr()
    const segunda = await correr()

    expect(primera).toHaveLength(1)
    expect(segunda).toEqual([])
    const marca = (negocio().metadata as { desenlaces: Record<string, Record<string, unknown>> })
      .desenlaces.pqr_rechazos
    expect(marca.conteo).toBe(1)
    expect((bloque('nb-senal').data as { _ciclos: unknown[] })._ciclos).toHaveLength(1)
  })

  it('una pasada a medias se completa en la siguiente: la señal es lo ÚLTIMO que se consume', async () => {
    // Se simula el corte dejando el bloque de la vía sin archivar (como si ese update
    // hubiera fallado) pero con la señal todavía viva.
    sembrarCaso({ resultado: 'pqr_rechazado' })
    await correr()
    // Reponer el estado "a medias": la vía vuelve a tener su valor viejo y la señal vuelve.
    bloque('nb-via').data = { via_solicitud: 'pqrs' }
    bloque('nb-via').estado = 'completo'
    const senal = bloque('nb-senal').data as { _ciclos: unknown[] }
    bloque('nb-senal').data = { _ciclos: senal._ciclos, resultado_pqr: 'pqr_rechazado' }

    const r = await correr()
    expect(bloque('nb-via').estado).toBe('pendiente')
    // El conteo sube a 2 porque hay dos ciclos archivados: es el número honesto de
    // veces que el bloque dio la vuelta, no un contador que se dispara solo.
    expect(r[0].conteo).toBe(2)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ LA PRUEBA DEL BUCLE, de punta a punta.
// ════════════════════════════════════════════════════════════════════════════
describe('el bucle 17 → 16 → 17', () => {
  it('SIN el desenlace el caso vuelve a salir por PQR: así están hoy los 46 abiertos', () => {
    sembrarCaso({ resultado: 'pqr_rechazado' })
    expect(destinoDeRouting(ROUTING_CITA, camposDeCita())).toBe(17)
  })

  it('tras el rechazo, al avanzar desde Cita el caso NO sale automáticamente por PQR', async () => {
    sembrarCaso({ resultado: 'pqr_rechazado' })
    await correr(16)

    // 1. La vía ya no está respondida: ninguna rama condicional matchea.
    const campos = camposDeCita()
    expect(campos.via_solicitud).toBeUndefined()
    expect(campos.radicado_pqr).toBeUndefined()
    const algunaRama = (ROUTING_CITA.conditional ?? []).some(
      r => String(campos[r.condition.field] ?? '') === r.condition.value,
    )
    expect(algunaRama).toBe(false)

    // 2. Y el caso no se puede ir solo: el bloque de la vía es GATE y quedó `pendiente`.
    //    Esto es lo que de verdad corta el bucle — el DEFAULT del routing de Cita apunta
    //    a Notificación (17), así que sin el gate el caso volvería igual.
    expect(bloque('nb-via').estado).toBe('pendiente')
    expect((bloque('nb-via').bloque_configs as { es_gate: boolean }).es_gate).toBe(true)
  })

  it('cuando la persona responde de nuevo, manda la NUEVA respuesta', async () => {
    sembrarCaso({ resultado: 'pqr_rechazado' })
    await correr(16)

    // Deisy: tras el rechazo el camino normal es pedir la cita por el portal. No se
    // fuerza `agenda` — radicar otro PQR sigue siendo posible y lo elige una persona.
    bloque('nb-via').data = { ...(bloque('nb-via').data as object), via_solicitud: 'agenda' }
    expect(destinoDeRouting(ROUTING_CITA, camposDeCita())).toBe(18)

    bloque('nb-via').data = { ...(bloque('nb-via').data as object), via_solicitud: 'pqrs' }
    expect(destinoDeRouting(ROUTING_CITA, camposDeCita())).toBe(17)
  })
})
