/**
 * Pasarela `wompi`: cargo por token contra la tarjeta guardada (débito sin clic).
 *
 * Es la pasarela ELEGIDA para el cobro recurrente
 * (`cerebro/decisiones/2026-09-09_wompi-exige-cuenta-bancolombia-sas.md`): Bold no
 * tiene tokenización ni cargo iniciado por el comercio, Wompi sí.
 *
 * ⚠️ ESTE ADAPTADOR TODAVÍA NO COBRA, Y LO DICE EN VOZ ALTA.
 *
 * No es un olvido ni un TODO perezoso: faltan dos insumos que no dependen del código.
 *
 *   1. **Credenciales.** Wompi las emite contra un comercio, y un comercio se abre
 *      con una cuenta de ahorros o corriente Bancolombia a nombre de METRIK IA S.A.S.
 *      Esa cuenta no existe: la vinculación está radicada, no aprobada. Sin comercio
 *      no hay llaves ni sandbox.
 *   2. **El contrato exacto de la API.** Escribir un cliente de pagos de memoria es
 *      la forma más cara de equivocarse. Los campos del cargo, el cálculo de la firma
 *      de integridad y el algoritmo del checksum del webhook se transcriben de la
 *      documentación de Wompi con las llaves en la mano, no antes.
 *
 * Mientras tanto el adaptador EXISTE y está registrado, que es lo que cambia respecto
 * a no tenerlo: una suscripción declarada en `wompi` deja de caer en el `default` del
 * registro —donde era indistinguible de una pasarela escrita mal— y produce un error
 * explícito y NO reintentable, con el motivo escrito. El ciclo lo registra en
 * `suscripciones.ultimo_error` y sigue; nadie se suspende por esto, porque
 * `reintentable: false` no cuenta como cargo fallido de negocio.
 *
 * Cuando lleguen las llaves, lo único que cambia aquí es el cuerpo de `cobrar`,
 * `consultar` y `verificarWebhook`. El contrato con el ciclo ya está fijado por
 * `PasarelaAdapter` y no se mueve.
 *
 * Spec: docs/specs/2026-09-08_suscripciones-cobro-automatico.md
 */

import type {
  PasarelaAdapter,
  ResultadoCargo,
  SolicitudCargo,
  VerificacionWebhook,
} from './adapter'

/**
 * Lo que hará cuando esté conectado. Se declara ya porque el ciclo consulta
 * `capacidades` para decidir si tiene sentido reintentar un cargo o esperar a que el
 * cliente haga clic, y esa respuesta no depende de que las llaves estén puestas.
 */
export const CAPACIDADES_WOMPI = {
  cobroSinClic: true,
  tokenizacion: true,
  linkDePago: true,
  webhook: true,
} as const

export const MOTIVO_SIN_CREDENCIALES =
  'Wompi sin configurar: falta el comercio (depende de la cuenta Bancolombia de la SAS, en tramite) y el cliente HTTP contra la API. La suscripcion no se cobro y nadie fue suspendido.'

/** Env vars que tendrá que leer el cliente HTTP. Se nombran aquí para que buscarlas encuentre un solo lugar. */
export const ENV_WOMPI = {
  llavePublica: 'WOMPI_PUBLIC_KEY',
  llavePrivada: 'WOMPI_PRIVATE_KEY',
  secretoIntegridad: 'WOMPI_INTEGRITY_SECRET',
  secretoEventos: 'WOMPI_EVENTS_SECRET',
} as const

/**
 * `true` solo cuando las cuatro llaves están puestas. Hoy es `false` en todos los
 * entornos. Recibe el entorno como parámetro (y no lee `process.env` por dentro) para
 * que se pueda probar sin ensuciar el proceso: un test que muta `process.env` se
 * filtra a los que corren después.
 */
export function wompiConfigurado(env: Record<string, string | undefined> = process.env): boolean {
  return Object.values(ENV_WOMPI).every((k) => {
    const v = env[k]
    return typeof v === 'string' && v.trim().length > 0
  })
}

export const pasarelaWompi: PasarelaAdapter = {
  nombre: 'wompi',
  capacidades: { ...CAPACIDADES_WOMPI },

  async cobrar(_solicitud: SolicitudCargo): Promise<ResultadoCargo> {
    // `error` y no `rechazado`: un rechazo es una respuesta de la pasarela sobre la
    // tarjeta del cliente, y aqui no se le pregunto nada a nadie. Confundirlos le
    // sumaria un intento fallido a la suscripcion y la acercaria a la suspension por
    // un problema que es NUESTRO.
    return { estado: 'error', mensaje: MOTIVO_SIN_CREDENCIALES, reintentable: false }
  },

  async consultar(_externalRef: string): Promise<ResultadoCargo> {
    return { estado: 'error', mensaje: MOTIVO_SIN_CREDENCIALES, reintentable: false }
  },

  verificarWebhook(_cuerpoCrudo: string, _cabeceras: Record<string, string | undefined>): VerificacionWebhook {
    // `no_configurado` es un motivo del contrato, distinto de `firma_invalida`: el
    // route handler tiene que poder responder distinto a "no tengo con que verificar"
    // que a "alguien mando una firma que no cuadra".
    return { ok: false, motivo: 'no_configurado' }
  },
}
