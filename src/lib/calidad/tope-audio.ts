/**
 * Tope del audio que se puede auditar. MANDA EL PESO, NO EL RELOJ.
 *
 * Vive en su propio modulo, sin `server-only`, PORQUE LA VALIDACION QUE DE
 * VERDAD PROTEGE AL USUARIO CORRE EN EL NAVEGADOR. Por encima de 4.500.000
 * bytes la plataforma rechaza el cuerpo de la peticion antes de que corra una
 * sola linea nuestra: en ese punto quien responde es ella, con un 413 de texto
 * plano, y ninguna validacion del servidor alcanza a dar la cara. La unica
 * forma de que la persona lea un mensaje escrito por nosotros es no mandarlo.
 *
 * Los dos limites son distintos y el que muerde no es el que uno supone.
 *
 * EL RELOJ NO ES EL LIMITE. La tabla del plan dice 60 s, pero eso rige para
 * proyectos anteriores a abril de 2025 sin Fluid compute; este lo tiene activo
 * y su presupuesto por funcion es de 300 s. Verificado en produccion sobre el
 * dominio propio: 12 min de audio → 200 en 48,9 s; 17 min → 200 en 78,1 s. Los
 * 78 segundos son la prueba de que el corte de 60 no existe aqui.
 *
 * EL PESO SI ES EL LIMITE: 4.500.000 bytes, medidos con sondas de tamaño
 * creciente contra produccion (4.380 KiB pasa, 4.400 KiB no).
 *
 * 4,2 MB deja margen para el multipart y los campos del formulario.
 *
 * Antes escribi que "20 minutos pesan 4,6 MB y caben en una peticion". No
 * caben: esa cifra la di por buena sin medirla y la medicion la desmiente.
 */
export const MAX_BYTES_AUDIO = 4_200_000

/**
 * Bytes por minuto del audio TIPICO de un call center: mono, 8 kHz, 32 kbps.
 * 32.000 bits/s ÷ 8 = 4.000 bytes/s × 60.
 *
 * Sirve SOLO para traducir el tope a una magnitud que una persona entienda
 * ("unos 17 minutos"). No es el criterio: un archivo mejor comprimido rinde
 * mas minutos y uno peor rinde menos, y el que decide es el peso.
 */
const BYTES_POR_MINUTO_TIPICO = 240_000

/** Minutos aproximados que caben en el tope, al bitrate tipico. */
export const MINUTOS_APROX_AUDIO = Math.floor(MAX_BYTES_AUDIO / BYTES_POR_MINUTO_TIPICO)

/** MB con un decimal, para hablarle al usuario en la unidad que ve en su disco. */
export function mb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1).replace('.', ',')
}

/**
 * El mensaje del rechazo, uno solo para el navegador y para la ruta.
 *
 * Dice las DOS magnitudes: el peso, que es el criterio real, y su equivalencia
 * aproximada en minutos, que es lo unico que la persona sabe de su archivo
 * antes de mirarlo. Con solo el peso, nadie sabe cuanto recortar.
 */
export function mensajeAudioMuyPesado(bytes: number): string {
  return (
    `El archivo pesa ${mb(bytes)} MB y el máximo son ${mb(MAX_BYTES_AUDIO)} MB, ` +
    `unos ${MINUTOS_APROX_AUDIO} minutos de llamada. ` +
    `Sube un fragmento más corto: la parte donde se toman los datos de pago suele ser la más reveladora.`
  )
}
