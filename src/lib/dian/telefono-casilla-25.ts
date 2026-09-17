// Casilla 25 (Teléfono) del Formato 010 de la DIAN.
//
// La DIAN espera el número LOCAL de 7 dígitos, SIN el indicativo de ciudad. Un
// "602 2324412" hace que devuelvan el formato: reportado por Deisy (SOENA) el
// 2026-09-17 con la captura del formato diligenciado. El supuesto contrario (que la
// DIAN esperaba el indicativo delante) vivía escrito en `dian/indicativos.ts`, que se
// borró con este cambio: lo desmiente la ventanilla real.
//
// El número llega de DOS formas, y las dos terminaban con indicativo en la casilla:
//   A) 7 dígitos, y el sistema le pegaba el indicativo del departamento.
//   B) 10 dígitos que YA traen el `60X` adelante desde el propio RUT.
//
// Lo que NO se toca, a propósito: un celular es un número de 10 dígitos completo y
// recortarlo lo destruye; y cualquier forma que no se reconozca se devuelve tal
// cual. Un número raro que se imprime raro es visible y corregible a mano; uno que
// recortamos mal es un dato falso en un formato que va a la DIAN.

export function telefonoCasilla25(telefono: string | null | undefined): string | null {
  if (telefono == null) return null
  const digitos = String(telefono).replace(/\D/g, '')

  // Ya es el número local: se imprime tal cual (sin separadores).
  if (digitos.length === 7) return digitos

  if (digitos.length === 10) {
    // Celular: los 10 dígitos SON el número. No se recorta.
    if (digitos.startsWith('3')) return digitos
    // Fijo con indicativo (601..608): se quitan los 3 primeros y quedan los locales.
    if (digitos.startsWith('60')) return digitos.slice(3)
  }

  // 6, 8, 9 dígitos, un 10 que no empieza ni en 3 ni en 60, o basura: sin cambios.
  return telefono
}
