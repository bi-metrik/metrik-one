/**
 * De dónde sale el archivo cuando el usuario NO lo busca en el disco.
 *
 * Registrar un pago casi siempre empieza con un pantallazo de la transferencia que ya
 * está en el portapapeles, o con el archivo arrastrado desde la carpeta de descargas.
 * Obligar a pasar por el diálogo de archivos para algo que ya se tiene copiado es el
 * paso que hace que el comprobante no se adjunte.
 *
 * Módulo puro a propósito: lo que se equivoca aquí es la SELECCIÓN (qué se toma del
 * portapapeles y qué se descarta), no el `<input>`. Un `paste` trae varias entradas —
 * al copiar de una web vienen el `text/html`, el `text/plain` y la imagen — y tomar la
 * primera devuelve el texto, no el pantallazo.
 */

/** Lo que se acepta como comprobante de un pago: un pantallazo, una foto o el PDF. */
export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
export const MAX_COMPROBANTE_BYTES = 10 * 1024 * 1024

/** Lo mínimo de `DataTransferItem` que esto necesita. Evita depender del DOM. */
export interface ItemPegado {
  type: string
  getAsFile(): File | null
}

/**
 * El comprobante dentro de lo que se pegó, o `null` si no había ninguno.
 *
 * Las imágenes ganan: un pantallazo pegado junto a su texto es un pantallazo. El PDF
 * sirve igual, pero solo se mira cuando no hay imagen.
 */
export function comprobanteDelPortapapeles(items: ArrayLike<ItemPegado> | null | undefined): File | null {
  // Se pide el archivo de UNA VEZ, y eso es lo que separa un archivo de un texto: los
  // items de texto devuelven `null`. Preguntar por `kind === 'file'` además de esto no
  // descarta nada más, y un item que anuncia `image/png` sin entregar archivo no debe
  // tapar al que venía detrás.
  const archivos = Array.from(items ?? [])
    .map((i) => ({ tipo: i.type, file: i.getAsFile() }))
    .filter((e): e is { tipo: string; file: File } => e.file !== null)

  const imagen = archivos.find((e) => e.tipo.startsWith('image/'))
  return (imagen ?? archivos.find((e) => e.tipo === 'application/pdf'))?.file ?? null
}

/**
 * Por qué NO sirve este archivo, o `null` si sirve.
 *
 * Devuelve el motivo en vez de un booleano: el usuario tiene que saber si el problema
 * fue el formato o el tamaño, porque la corrección es distinta.
 */
export function motivoRechazoComprobante(file: File): string | null {
  if (file.type && !TIPOS_COMPROBANTE.includes(file.type)) {
    return 'El comprobante debe ser una imagen (JPG, PNG, WebP) o un PDF'
  }
  if (file.size > MAX_COMPROBANTE_BYTES) return 'El comprobante pesa más de 10 MB'
  return null
}

/**
 * Nombre para lo pegado. El portapapeles casi siempre entrega `image.png`: guardar
 * veinte comprobantes con el mismo nombre los vuelve indistinguibles en la carpeta del
 * negocio, que es justo donde alguien va a buscarlos meses después.
 */
export function nombreDeComprobantePegado(file: File, ahora: Date = new Date()): string {
  const generico = !file.name || file.name === 'image.png' || /^image\.\w+$/.test(file.name)
  if (!generico) return file.name
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const sello = ahora.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  return `comprobante-${sello}.${ext}`
}
