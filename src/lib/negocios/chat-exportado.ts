/**
 * El chat dentro del .zip que arma WhatsApp con «Exportar chat» (con o sin archivos). Solo se lee el .txt; las fotos,
 * audios y documentos se ignoran en esta versión. iPhone lo llama `_chat.txt`; Android, «Chat de WhatsApp con X.txt».
 * Corre en el navegador (el .zip no viaja al servidor: solo el texto). Pura salvo por descomprimir.
 */
import PizZip from 'pizzip'

export function chatDelZip(datos: ArrayBuffer | Uint8Array): string | null {
  const zip = new PizZip(datos)
  const txts = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith('.txt'))
  const chat = txts.find((f) => f.name.toLowerCase().endsWith('_chat.txt')) ?? txts[0]
  return chat ? chat.asText() : null
}
