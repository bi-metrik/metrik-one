/**
 * ¿La cotización de este negocio agrega líneas por TIPO («+ Vuelo», «+ Hotel»…) en vez de
 * pedir un nombre libre?
 *
 * ## El criterio: la línea del negocio captura quiénes viajan
 *
 * Los tipos son las ranuras con pantallazo (`gruposCanonicos()`), y esas ranuras solo tienen
 * sentido en una cotización de viaje. La señal de que una línea de negocio es de viaje ya
 * existe y es la misma que usa la tarifa por pasajero: algún bloque de la línea declara los
 * campos de composición (`adultos`, `ninos`, `infantes`).
 *
 * Se descartó el módulo Clarity: medido el 2026-09-16, lo tienen encendido Termotech,
 * WMC, SOENA y Trappvel, así que cambiaría la pantalla de todos. Y se descartó leer el
 * slug del workspace: un segundo cliente de viajes tendría que esperar un deploy.
 *
 * ⚠️ Se decide por CONFIGURACIÓN (los campos declarados), no por el dato capturado: un
 * negocio recién creado todavía no tiene composición y aun así cotiza un viaje.
 */

/** Los campos que declaran quiénes viajan. Los mismos que lee `leerViajeDelNegocio`. */
export const CAMPOS_COMPOSICION_VIAJE: readonly string[] = ['adultos', 'ninos', 'infantes']

/**
 * ¿ESTE bloque es el que captura quiénes viajan?
 *
 * El mismo criterio que `lineaCotizaPorTipo`, mirando un solo bloque. Se expone aparte
 * porque hay superficies que solo tienen delante el bloque que se está editando y no la
 * línea entera — el bloque «Condiciones del viaje» que escribe destino y requisitos es
 * justo ese caso. Reescribir ahí la lista de campos sería una segunda regla que se
 * desincroniza el día que la composición gane un campo.
 *
 * Recibe el `config_extra.fields` tal como llega de la base, sin confiar en su forma.
 */
export function bloqueDeclaraComposicionViaje(fields: unknown): boolean {
  return (
    Array.isArray(fields) &&
    fields.some(f => {
      const slug = (f as { slug?: unknown } | null)?.slug
      return typeof slug === 'string' && CAMPOS_COMPOSICION_VIAJE.includes(slug)
    })
  )
}

/**
 * Recibe el `config_extra.fields` de cada bloque de la línea (tal como llega de la base,
 * sin confiar en su forma) y dice si alguno declara la composición del viaje.
 */
export function lineaCotizaPorTipo(fieldsPorBloque: readonly unknown[]): boolean {
  return fieldsPorBloque.some(bloqueDeclaraComposicionViaje)
}
