/**
 * El léxico de marca en el nombre de una tarifa que lee el cliente: «Premium» se dice «Superior»
 * (respeta mayúsculas: PREMIUM → SUPERIOR, Premium → Superior, premium → superior).
 *
 * Una sola función para la propuesta (`nombreDeTarifaParaCliente`, modelo-documento.ts) y el
 * mensaje de confirmación (`nombreUtilDeTarifa`, viaje/nombre-tarifa.ts): QA G14, pedido de Vera.
 */
export function conLexicoDeMarca(nombre: string): string {
  return nombre.replace(/\bpremium\b/gi, (m) =>
    m === m.toUpperCase() ? 'SUPERIOR' : m[0] === 'P' ? 'Superior' : 'superior',
  )
}
