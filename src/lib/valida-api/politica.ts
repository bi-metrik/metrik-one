/**
 * Política de Datos que cada usuario acepta en su primer ingreso al módulo Valida API (§5.4).
 *
 * ## De dónde sale la versión
 *
 * Tiene que ser la publicada en `bi-metrik/metrik-valida` (`POLITICA_PRIVACIDAD.version` en
 * `lib/recursos/politica-privacidad.ts`, servida en `/recursos/privacidad`). Hoy es la **1.6**,
 * vigente desde el 2026-10-05 (verificada en la página publicada el 2026-10-11): ajusta el numeral
 * 13.3 (OFAC y UE como «listas restrictivas internacionales») y retira la cita de la Circular
 * 100-000016 de Supersociedades. La 1.5 (2026-09-16) corrigió la razón social del Responsable, que la
 * 1.4 nombraba sin «IA». El Responsable es METRIK IA S.A.S., NIT 902.079.601-9.
 *
 * ⚠️ Pasar de 1.5 a 1.6 vuelve a pedir la Política una vez a quien entra a Valida API y al Radar
 * (`exigeAprobacionPorUsuario`); en Valida de los CDA no se pide por usuario y no cambia nada.
 *
 * ⚠️ La spec de servicios y cobro llama «v1.5» a la versión que agrega a Wompi como destinatario
 * (entrega B5). Esa ya no puede ser la 1.5: será la siguiente. Donde la spec o el catálogo exijan
 * «1.5 o mayor» para Wompi, el mínimo real es la versión que publique ese cambio.
 *
 * Pedirle a alguien que acepte una versión que no existe publicada sería una constancia sobre un
 * texto que nadie puede leer. Cuando Valida publique otra, se cambia aquí, en el mismo PR, y
 * `requiereAceptacion` vuelve a pedirla a todos: es otro consentimiento.
 *
 * ## La prueba de la autorización es el aviso
 *
 * La autorización se da por conducta inequívoca (Decreto 1377 de 2013, arts. 7 y 8): marcar la
 * casilla después de leer el aviso. Por eso se guarda la huella del TEXTO EXACTO del aviso,
 * además de la versión. El texto es el del portal v1 de Valida (`app/portal/aviso-privacidad.tsx`),
 * adaptado al módulo: lo que reemplaza tiene que decir lo mismo.
 *
 * Puro, sin `server-only`: lo usan el servidor (que registra) y la pantalla (que muestra), y los
 * dos tienen que leer EL MISMO texto, o la huella no probaría lo que se leyó.
 */

// Sin `node:crypto` aquí: la pantalla importa este archivo para mostrar el aviso. La huella la
// calcula el servidor en `politica-huella.ts`.

import { PRODUCTOS_ENTRADA, type ProductoEntrada } from './producto'

export const POLITICA_DATOS_VALIDA = {
  slug: 'politica-datos-valida',
  version: '1.6',
  titulo: 'Política de Tratamiento de Datos Personales',
  url: 'https://valida.metrik.com.co/recursos/privacidad',
} as const

/**
 * El aviso que se lee junto a la casilla. Cambiarlo exige subir `version` o cambia la huella.
 *
 * Nombra el módulo en el que se acepta (Valida API o Valida de los CDA). Con el producto por defecto
 * el texto es, carácter por carácter, el que ya aceptaron los usuarios de 4D SOFT.
 */
export function textoAvisoPolitica(producto: ProductoEntrada = 'valida_api'): string {
  return (
    'Al continuar, autoriza a METRIK IA S.A.S. a tratar su correo, dirección IP y navegador para darle ' +
    `acceso al módulo ${PRODUCTOS_ENTRADA[producto].nombre} y proteger la cuenta, conforme a la ` +
    `${POLITICA_DATOS_VALIDA.titulo} v${POLITICA_DATOS_VALIDA.version}.`
  )
}

export interface AceptacionRegistrada {
  documento_version: string
  aceptada_at: string
}

/**
 * ¿Hay que pedirle la Política a este usuario? Solo cuenta una aceptación de la versión VIGENTE:
 * haber aceptado la 1.4 no autoriza tratar datos bajo la 1.5.
 */
export function requiereAceptacion(aceptaciones: readonly AceptacionRegistrada[]): boolean {
  return !aceptaciones.some((a) => a.documento_version === POLITICA_DATOS_VALIDA.version)
}
