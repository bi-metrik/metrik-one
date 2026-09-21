/**
 * El texto que un PDF de `@react-pdf` imprime de verdad, leído del binario.
 *
 * Existe porque una plantilla puede tener todas sus reglas bien y aun así no pintar el
 * dato: el JSX decide qué llega a la página. Las pruebas de plantilla afirman sobre ESTO
 * y no sobre las props, que es lo único que distingue «la regla es correcta» de «el
 * documento lo dice».
 *
 * ⚠️ El texto viaja en HEX dentro de los `stream` comprimidos, y cada corrida de texto
 * puede partirse en varios operadores. Por eso el resultado se une con espacios: sirve
 * para buscar (`toContain`) una palabra o una cifra, no para afirmar la maquetación.
 *
 * ⚠️ Con fuentes estándar (Helvetica) los caracteres viajan en la codificación de la
 * fuente, así que una tilde puede no volver como el mismo carácter. Buscar por trozos sin
 * tildes es lo confiable.
 */
import { inflateSync } from 'node:zlib'

export function textoDelPDF(buf: Buffer): string {
  const trozos: string[] = []
  let desde = 0
  for (;;) {
    const ini = buf.indexOf('stream', desde)
    if (ini === -1) break
    let inicio = ini + 'stream'.length
    if (buf[inicio] === 0x0d) inicio++
    if (buf[inicio] === 0x0a) inicio++
    const fin = buf.indexOf('endstream', inicio)
    if (fin === -1) break
    try {
      trozos.push(inflateSync(buf.subarray(inicio, fin)).toString('latin1'))
    } catch {
      // fuente o imagen
    }
    // ⚠️ Avanzar `fin + 1` deja el cursor DENTRO de la palabra «endstream», así que la
    // vuelta siguiente encuentra su propio «stream» y lee basura entre dos objetos: el
    // inflate falla, se traga en el catch y ese stream desaparece. Con varias páginas eso
    // se lleva la mitad del documento sin que nada falle — la prueba pasa a afirmar sobre
    // un texto incompleto. Hay que saltar la palabra entera.
    desde = fin + 'endstream'.length
  }
  const contenido = trozos.join('\n')
  const piezas: string[] = []
  const reOperador = /(\[[^\]]*\]\s*TJ|(?:<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\))\s*Tj)/g
  let op: RegExpExecArray | null
  while ((op = reOperador.exec(contenido)) !== null) {
    let linea = ''
    const reTrozo = /<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g
    let t: RegExpExecArray | null
    while ((t = reTrozo.exec(op[0])) !== null) {
      if (t[1] !== undefined) {
        const hex = t[1].replace(/\s+/g, '')
        for (let i = 0; i + 1 < hex.length; i += 2) linea += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
      } else {
        linea += (t[2] ?? '').replace(/\\([()\\])/g, '$1')
      }
    }
    piezas.push(linea)
  }
  return piezas.join(' ')
}
