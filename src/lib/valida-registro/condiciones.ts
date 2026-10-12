import { POLITICA_DATOS_VALIDA } from '@/lib/valida-api/politica'

/**
 * Los textos legales del registro autogestionado de Valida (pantalla «Tu empresa»).
 *
 * Aprobados por Mauricio el 2026-10-11, copiados TAL CUAL (no se reescriben aquí):
 *   - Condiciones de la prueba v1.0 (Emilio, con Lucía en el encargo):
 *     `proyectos/metrik/valida/docs/legal/condiciones-prueba-valida-v1.0.md` §1, tres bloques.
 *     ⚠️ La cláusula de cobro al terminar la prueba (§2 de ese archivo) NO está aquí: es inactiva hasta
 *     que el registro pida método de pago (ePayco). No entra a este texto ni a su huella; al
 *     activarse reemplaza el numeral 7 y la versión pasa a 2.0.
 *   - Aviso del formulario y casilla v1.0 (Lucía, con Emilio):
 *     `proyectos/metrik/valida/docs/legal/aviso-formulario-registro-v1.0.md` §1.
 *
 * ## La huella cubre lo que la persona leyó y marcó, no solo las Condiciones
 *
 * La autorización del titular se da por conducta inequívoca después de leer el aviso (Decreto 1377
 * de 2013, art. 7): su prueba es el aviso exacto. Por eso la huella que se guarda en
 * `valida_registros.condiciones_sha256` es la de `textoAceptado()`: Condiciones + aviso tal como lo
 * completa la pantalla (con el título y la dirección de la Política) + texto de la casilla. Y
 * `condiciones_version` guarda las DOS versiones (`VERSION_ACEPTADA`).
 *
 * Cambiar una sola letra de las Condiciones exige subir `CONDICIONES_PRUEBA.version`; de la casilla
 * o del aviso, `AVISO_REGISTRO.version`. Las pruebas fijan la huella: si cambia sin subir versión,
 * fallan.
 *
 * Puro, sin `node:crypto`: lo importa la pantalla para mostrar el texto. La huella la calcula el
 * servidor sobre ESTOS MISMOS textos (`huellaAceptacion` en `registro-servidor.ts`).
 */

export const MARCADOR_TEXTO_PENDIENTE = /\[TEXTO (EMILIO|LUCÍA|LUCIA)\b/

// Bloque 1: encabezado y numerales 1 a 5.
const BLOQUE_1 = `CONDICIONES DE LA PRUEBA GRATIS DE VALIDA · Versión 1.0

METRIK IA S.A.S., NIT 902.079.601-9 ("METRIK"), presta el servicio Valida. Estas condiciones las acepta, en nombre de la empresa que se registra (la "Empresa"), la persona que marca la casilla del registro.

1. Qué incluye la prueba. La prueba da 10 consultas de listas restrictivas y vinculantes durante 7 días calendario desde que se abre. Termina cuando se agotan las 10 consultas o cuando pasan los 7 días, lo que ocurra primero. Es gratis, no pide tarjeta ni ningún medio de pago, no tiene permanencia y no obliga a contratar. Hay una sola prueba por NIT.

2. Quién puede usarla. Solo una Empresa que (a) esté obligada por la norma de su supervisor a consultar listas, como un CDA vigilado por la Superintendencia de Transporte, o (b) tenga otra base legal para consultar a terceros en listas, como la autorización del titular o la debida diligencia de sus propias contrapartes. Quien acepta declara que actúa por la Empresa con facultad para hacerlo y que la razón social y el NIT registrados son ciertos.

3. Uso permitido y uso prohibido. Las consultas solo pueden ser sobre clientes, proveedores, empleados, socios u otras contrapartes reales o posibles de la Empresa, para prevenir y gestionar el riesgo de lavado de activos, financiación del terrorismo y financiación de la proliferación de armas. Está prohibido: consultar a personas sin relación con la Empresa o por curiosidad; usar los resultados para perfilar personas, armar listas o bases propias, o para cualquier fin distinto de la gestión de ese riesgo; consultar para terceros, compartir el acceso o revenderlo; enviar datos sensibles o datos de niños, niñas y adolescentes; y abrir más de una prueba para la misma Empresa. Si METRIK detecta uno de estos usos, puede cerrar la prueba de inmediato.

4. El reporte de la prueba. Cada consulta genera un reporte PDF con la marca "PRUEBA". La razón social que aparece en él es la que declaró la Empresa y METRIK no la ha verificado. Por eso el reporte de la prueba no sirve como soporte de cumplimiento ante la Superintendencia de Transporte, otro supervisor, el revisor fiscal o un auditor. Las consultas se hacen contra las mismas listas del servicio pagado.

5. Responsabilidad de la Empresa. Valida es una herramienta de consulta: no es asesoría jurídica ni reemplaza el sistema de gestión del riesgo de la Empresa (SARLAFT, SAGRILAFT u otro). Analizar cada coincidencia, confirmar o descartar homonimias, decidir qué hacer y reportar a la UIAF o al supervisor le corresponde a la Empresa, que sigue siendo la responsable ante su supervisor. Que una consulta no arroje coincidencias no certifica nada sobre la persona consultada. Como la prueba es gratuita, METRIK no responde por lucro cesante ni por daños indirectos, salvo dolo o culpa grave.`

// Bloque 2: numeral 6, acuerdo de encargo del tratamiento.
const BLOQUE_2 = `6. Datos de las personas consultadas (acuerdo de encargo). Este numeral es el contrato de transmisión de datos personales entre la Empresa y METRIK (Ley 1581 de 2012 y Decreto 1074 de 2015, artículos 2.2.2.25.5.1 y 2.2.2.25.5.2) y rige desde antes de la primera consulta.

6.1. Roles. Sobre los nombres, números de documento y demás datos de las personas que la Empresa consulta, y sobre sus resultados, la Empresa es la Responsable del Tratamiento y METRIK es el Encargado.

6.2. Instrucciones. METRIK trata esos datos solo para hacer las consultas que pida la Empresa: contrastarlas con las listas, generar los reportes, guardar la bitácora y entregar los resultados. No los usa para fines propios, no los vende, no los cruza con otras bases para otros fines y solo los comparte con los proveedores declarados en la Política de Tratamiento de Datos Personales de Valida.

6.3. Lo que garantiza la Empresa. Que cuenta con autorización previa, expresa e informada de cada persona consultada, o con un mandato legal o una excepción del artículo 10 de la Ley 1581 de 2012 que le aplique; que conserva la prueba de ello y la entrega si METRIK o una autoridad se la pide; y que atiende las consultas y reclamos de esas personas. La Empresa responde ante METRIK por las reclamaciones, sanciones y costos que resulten de consultar sin esa autorización o base legal.

6.4. Lo que cumple METRIK. Los deberes del Encargado del artículo 18 de la Ley 1581 de 2012. En particular: guarda reserva; aplica medidas de seguridad, como cifrado en tránsito, control de acceso y registros de auditoría; traslada a la Empresa, dentro de los 2 días hábiles siguientes, toda consulta o reclamo de una persona consultada que le llegue; y le informa todo incidente de seguridad que afecte esos datos, a más tardar dentro de las 72 horas siguientes a confirmarlo.

6.5. Conservación. Por instrucción de la Empresa, y para que pueda cumplir su deber de conservación, METRIK guarda la bitácora de consultas, también la de la prueba, con los datos consultados, el resultado, la versión de las listas y la huella del reporte, durante 10 años (Ley 962 de 2005, artículo 28, al que remite la Resolución 2328 de 2025 de la Superintendencia de Transporte, artículo 5.6.11.4). Durante ese plazo esos registros no se suprimen, ni siquiera a solicitud de la Empresa o del titular. La Empresa puede pedir una copia de la bitácora de sus consultas.

6.6. Proveedores y envío al exterior. METRIK se apoya en los proveedores de infraestructura en la nube y de correo declarados en la Política de Tratamiento de Datos Personales de Valida, algunos ubicados en el exterior, a quienes exige seguridad y reserva. Todo cambio de proveedores se refleja en esa Política.

6.7. Lo no previsto. Aplica la Política de Tratamiento de Datos Personales de Valida vigente, publicada en https://valida.metrik.com.co/recursos/privacidad. Sobre el rol de cada parte frente a los datos de las consultas, prevalece este numeral.`

// Bloque 3: numerales 7 y 8 (al terminar la prueba no se cobra nada).
const BLOQUE_3 = `7. Al terminar la prueba. Cuando se agotan las consultas o pasan los 7 días, las consultas de prueba dejan de estar disponibles y no se cobra nada: METRIK no tiene ningún medio de pago de la Empresa. Para seguir usando Valida, la Empresa contrata un plan y acepta los Términos de Uso de Valida que le correspondan. Mientras no lo haga, no hay cobro ni obligación. La Empresa puede pedir la supresión de los datos de su cuenta, salvo los que la ley o el numeral 6.5 obligan a conservar.

8. Aceptación y contacto. Estas condiciones se aceptan por mensaje de datos al marcar la casilla del registro (Ley 527 de 1999). METRIK guarda como prueba la versión aceptada, la huella del texto, la fecha y hora, el usuario, el correo verificado con código y la dirección IP. Se rigen por la ley colombiana. Contacto: mauricio.moreno@metrik.com.co.`

export const CONDICIONES_PRUEBA = {
  slug: 'condiciones-prueba-valida',
  version: '1.0',
  titulo: 'Condiciones de la prueba gratis de Valida',
  texto: [BLOQUE_1, BLOQUE_2, BLOQUE_3].join('\n\n'),
} as const

/**
 * Las Condiciones escriben «10 consultas» y «7 días»: son los números que el texto promete. Si el
 * entorno pide otra prueba (`VALIDA_PRUEBA_CONSULTAS`, `VALIDA_PRUEBA_DIAS`), la pantalla diría una
 * cosa y las Condiciones otra, así que producción no abre (`registroAbierto` en `llave.ts`).
 */
export const PRUEBA_DE_LAS_CONDICIONES = { consultas: 10, dias: 7 } as const

/**
 * El aviso de datos del formulario. La pantalla lo completa con un espacio, el enlace con el título de
 * la Política y un punto: por eso termina en «…están en la».
 */
export const AVISO_DATOS_FORMULARIO = `METRIK IA S.A.S. (NIT 902.079.601-9) es la responsable de sus datos. Usamos su correo, la razón social, el NIT, el tipo de empresa, cómo llegó a Valida (incluido si lo recomendó AFI) y la dirección IP del registro para abrir y proteger su cuenta, darle la prueba, evitar pruebas repetidas, guardar la prueba de su aceptación y escribirle sobre su prueba y su plan. Si indica que lo recomendó AFI, le informamos a AFI la razón social y el NIT de su empresa, no su correo. Puede conocer, actualizar, rectificar y suprimir sus datos, revocar esta autorización y dejar de recibir nuestros correos escribiendo a mauricio.moreno@metrik.com.co. Sus derechos y cómo ejercerlos están en la`

/** El texto de la casilla de aceptación (antes estaba fijo en `registro-client.tsx`). */
export const TEXTO_CASILLA = `Acepto, en nombre de la empresa, las Condiciones de la prueba gratis, incluido el encargo de los datos de las personas que consulte, y autorizo el tratamiento de mis datos según este aviso.`

export const AVISO_REGISTRO = {
  slug: 'aviso-formulario-registro-valida',
  version: '1.0',
} as const

/** Lo que se guarda en `valida_registros.condiciones_version` y lo que la pantalla devuelve al enviar. */
export const VERSION_ACEPTADA = `condiciones-${CONDICIONES_PRUEBA.version}+aviso-${AVISO_REGISTRO.version}`

/** El aviso como se lee en la pantalla: texto, enlace a la Política (con su dirección) y punto. */
export function avisoComoSeLee(politica: { titulo: string; url: string } = POLITICA_DATOS_VALIDA): string {
  return `${AVISO_DATOS_FORMULARIO} ${politica.titulo} (${politica.url}).`
}

/**
 * Todo lo que la persona leyó y aceptó al marcar la casilla, en un orden fijo. Sobre esto se calcula
 * la huella. No se muestra así: es la forma canónica de reconstruir la constancia desde el código.
 */
export function textoAceptado(): string {
  return [
    `${CONDICIONES_PRUEBA.titulo} · v${CONDICIONES_PRUEBA.version}`,
    CONDICIONES_PRUEBA.texto,
    `Aviso del formulario de registro · v${AVISO_REGISTRO.version}`,
    avisoComoSeLee(),
    `Casilla: ${TEXTO_CASILLA}`,
  ].join('\n\n')
}

/** true cuando ya no queda ningún marcador: es la condición para abrir el registro en producción. */
export function textosListos(
  textos: readonly string[] = [CONDICIONES_PRUEBA.texto, AVISO_DATOS_FORMULARIO, TEXTO_CASILLA],
): boolean {
  return textos.every((t) => !MARCADOR_TEXTO_PENDIENTE.test(t))
}
