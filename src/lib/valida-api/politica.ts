/**
 * Política de Datos que cada usuario acepta en su primer ingreso al módulo Valida API (§5.4).
 *
 * ## De dónde sale la versión
 *
 * Tiene que ser la publicada en `bi-metrik/metrik-valida` (`POLITICA_PRIVACIDAD.version` en
 * `lib/recursos/politica-privacidad.ts`, servida en `/recursos/privacidad`). Desde el PR #1191 es la
 * **1.7** (texto de Emilio, 2026-10-19): agrega el registro desde la página de Valida (5.12), el medio
 * de pago y la pasarela ePayco (4.3, 5.11, 9 bis), a AFI como destinataria (9 bis) y sus plazos (12.1).
 * ⚠️ La 1.7 se publica con el PR de metrik-valida `docs/politica-datos-v1.7`: tiene que estar
 * publicada ANTES o en el mismo despliegue que este cambio, nunca después (Emilio, «Antes de
 * publicar» 4). La 1.6 (2026-10-05) ajustó el 13.3 y retiró la Circular 100-000016; la 1.5
 * (2026-09-16) corrigió la razón social del Responsable: METRIK IA S.A.S., NIT 902.079.601-9.
 *
 * ⚠️ Pasar de 1.6 a 1.7 vuelve a pedir la Política una vez a quien entra a Valida API y al Radar
 * (`exigeAprobacionPorUsuario`); en Valida de los CDA no se pide por usuario y no cambia nada. Es el
 * aviso previo del cambio sustancial (Decreto 1074 de 2015, art. 2.2.2.25.3.1, inc. final).
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
  version: '1.7',
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
