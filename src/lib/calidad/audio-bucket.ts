/**
 * El buzon de paso del audio, nombrado en un solo sitio.
 *
 * Lo usan las tres piezas que tocan el bucket: la que firma la subida, la que
 * transcribe y borra, y el barrido que recoge los huerfanos. Vive aparte y no
 * dentro de una ruta para que ninguna de ellas tenga que importar de otra.
 */
export const BUCKET_AUDIO = 'calidad-audio'
