// Subida del navegador a una URL firmada de Storage (proyecto externo).
//
// Un PUT plano: la URL firmada ya autoriza esa ruta concreta y no hace falta ninguna
// llave (medido contra el proyecto de Trappvel el 2026-09-14: PUT sin `apikey` → 200).
// `fetch` entra por parámetro para poder probar la traducción del error.

type Fetch = (input: string, init: RequestInit) => Promise<Response>

export async function subirAUrlFirmada(
  signedUrl: string,
  archivo: Blob,
  contentType: string,
  fetchImpl: Fetch = (i, init) => fetch(i, init),
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetchImpl(signedUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType || 'application/octet-stream', 'x-upsert': 'true' },
      body: archivo,
    })
  } catch (e) {
    return { ok: false, error: `No se pudo subir el archivo: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (res.ok) return { ok: true }

  const texto = await res.text().catch(() => '')
  let mensaje = ''
  try {
    const cuerpo = JSON.parse(texto) as { message?: string; error?: string }
    mensaje = cuerpo.message || cuerpo.error || ''
  } catch {
    mensaje = texto.slice(0, 160)
  }
  return { ok: false, error: `No se pudo subir el archivo (${res.status})${mensaje ? `: ${mensaje}` : ''}` }
}
