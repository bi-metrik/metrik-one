import { POLITICA_DATOS_VALIDA } from '@/lib/valida-api/politica'
import { CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION } from './condiciones-cobro'
import { TERMINOS_PLAN, terminosPlanListos } from './terminos-plan'

/**
 * Los textos legales del registro autogestionado de Valida (pantalla «Tu empresa»). Copiados TAL CUAL
 * de su fuente: no se reescriben aquí.
 *
 * ## Dos juegos de textos, según haya o no cobro al cumplirse los 7 días
 *
 *   - **Sin cobro** (hoy, y siempre que la cláusula no esté vigente):
 *       · Condiciones v1.0: `proyectos/metrik/valida/docs/legal/condiciones-prueba-valida-v1.0.md` §1,
 *         aprobadas por Mauricio el 2026-10-11;
 *       · aviso v1.1 (sin «el tipo de empresa», que el registro ya no pregunta) y la casilla v1.0:
 *         `aviso-formulario-registro-v1.1.md` §1, aprobado por Vera el 2026-10-12.
 *   - **Con cobro** (`condicionesVigentes().conCobro`):
 *       · Condiciones v2.0: `condiciones-prueba-valida-v2.0.md` §1 con las correcciones de Vera
 *         (`vera-condiciones-v2.0.md`: numeral 1, título del 7, tercera frase del 7.1 y 7.4);
 *       · aviso v1.2 (`aviso-formulario-registro-v1.1.md` §2.1) y la casilla con cobro, en el texto
 *         corregido por Vera (autoriza el cobro de CADA MES, no solo del primero).
 *     Las Condiciones v2.0 van COMPLETAS (`BLOQUE_1_V2`, `BLOQUE_3_V2`), no armadas con reemplazos sobre
 *     la v1.0: así se armaban antes, y dejaban el numeral 1 de la v1.0 («no pide tarjeta») contra el 7.
 *
 * ## La huella cubre lo que la persona leyó y marcó, no solo las Condiciones
 *
 * La autorización del titular se da por conducta inequívoca después de leer el aviso (Decreto 1377
 * de 2013, art. 7): su prueba es el aviso exacto. Por eso la huella que se guarda en
 * `valida_registros.condiciones_sha256` es la de `textoAceptado(c)`: Condiciones + aviso tal como lo
 * completa la pantalla + texto de la casilla, los tres DE LA VERSIÓN QUE SE MOSTRÓ (`c.aviso`,
 * `c.casilla`). Y `condiciones_version` guarda las dos versiones (`versionAceptada(c)`).
 *
 * Cambiar una sola letra de unas Condiciones exige subir su versión; del aviso o de la casilla, la
 * versión del aviso. Las pruebas fijan las dos huellas: si cambian sin subir versión, fallan.
 *
 * Puro, sin `node:crypto`: lo importa la pantalla para mostrar el texto. La huella la calcula el
 * servidor sobre ESTOS MISMOS textos (`huellaAceptacion` en `registro-servidor.ts`).
 */

export const MARCADOR_TEXTO_PENDIENTE = /\[TEXTO (EMILIO|LUCÍA|LUCIA)\b/

// ── Condiciones v1.0 (sin cobro) ──────────────────────────────────────────────────────────────

// Bloque 1: encabezado y numerales 1 a 5.
const BLOQUE_1 = `CONDICIONES DE LA PRUEBA GRATIS DE VALIDA · Versión 1.0

METRIK IA S.A.S., NIT 902.079.601-9 ("METRIK"), presta el servicio Valida. Estas condiciones las acepta, en nombre de la empresa que se registra (la "Empresa"), la persona que marca la casilla del registro.

1. Qué incluye la prueba. La prueba da 10 consultas de listas restrictivas y vinculantes durante 7 días calendario desde que se abre. Termina cuando se agotan las 10 consultas o cuando pasan los 7 días, lo que ocurra primero. Es gratis, no pide tarjeta ni ningún medio de pago, no tiene permanencia y no obliga a contratar. Hay una sola prueba por NIT.

2. Quién puede usarla. Solo una Empresa que (a) esté obligada por la norma de su supervisor a consultar listas, como un CDA vigilado por la Superintendencia de Transporte, o (b) tenga otra base legal para consultar a terceros en listas, como la autorización del titular o la debida diligencia de sus propias contrapartes. Quien acepta declara que actúa por la Empresa con facultad para hacerlo y que la razón social y el NIT registrados son ciertos.

3. Uso permitido y uso prohibido. Las consultas solo pueden ser sobre clientes, proveedores, empleados, socios u otras contrapartes reales o posibles de la Empresa, para prevenir y gestionar el riesgo de lavado de activos, financiación del terrorismo y financiación de la proliferación de armas. Está prohibido: consultar a personas sin relación con la Empresa o por curiosidad; usar los resultados para perfilar personas, armar listas o bases propias, o para cualquier fin distinto de la gestión de ese riesgo; consultar para terceros, compartir el acceso o revenderlo; enviar datos sensibles o datos de niños, niñas y adolescentes; y abrir más de una prueba para la misma Empresa. Si METRIK detecta uno de estos usos, puede cerrar la prueba de inmediato.

4. El reporte de la prueba. Cada consulta genera un reporte PDF con la marca "PRUEBA". La razón social que aparece en él es la que declaró la Empresa y METRIK no la ha verificado. Por eso el reporte de la prueba no sirve como soporte de cumplimiento ante la Superintendencia de Transporte, otro supervisor, el revisor fiscal o un auditor. Las consultas se hacen contra las mismas listas del servicio pagado.

5. Responsabilidad de la Empresa. Valida es una herramienta de consulta: no es asesoría jurídica ni reemplaza el sistema de gestión del riesgo de la Empresa (SARLAFT, SAGRILAFT u otro). Analizar cada coincidencia, confirmar o descartar homonimias, decidir qué hacer y reportar a la UIAF o al supervisor le corresponde a la Empresa, que sigue siendo la responsable ante su supervisor. Que una consulta no arroje coincidencias no certifica nada sobre la persona consultada. Como la prueba es gratuita, METRIK no responde por lucro cesante ni por daños indirectos, salvo dolo o culpa grave.`

// Bloque 2: numeral 6, acuerdo de encargo del tratamiento. El mismo en la v1.0 y en la v2.0.
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

// ── Condiciones v2.0 (con medio de pago y cobro al cumplirse los 7 días) ─────────────────────

// Bloque 1 v2.0: encabezado y numerales 1 a 5. Cambia el numeral 1 (texto de Vera); 2 a 5, iguales.
const BLOQUE_1_V2 = `CONDICIONES DE LA PRUEBA GRATIS DE VALIDA · Versión 2.0

METRIK IA S.A.S., NIT 902.079.601-9 ("METRIK"), presta el servicio Valida. Estas condiciones las acepta, en nombre de la empresa que se registra (la "Empresa"), la persona que marca la casilla del registro.

1. Qué incluye la prueba. La prueba da 10 consultas de listas restrictivas y vinculantes durante 7 días calendario desde que se abre. Termina cuando se agotan las 10 consultas o cuando pasan los 7 días, lo que ocurra primero. Es gratis: durante la prueba no se cobra nada. Para abrirla, la Empresa registra un medio de pago. Si no cancela a tiempo, a ese medio de pago se le cobra el plan mensual de Valida: el primer mes al cumplirse los 7 días y después cada mes, hasta que se retire, como dicen los numerales 7.1 y 7.4. No tiene permanencia. Hay una sola prueba por NIT.

2. Quién puede usarla. Solo una Empresa que (a) esté obligada por la norma de su supervisor a consultar listas, como un CDA vigilado por la Superintendencia de Transporte, o (b) tenga otra base legal para consultar a terceros en listas, como la autorización del titular o la debida diligencia de sus propias contrapartes. Quien acepta declara que actúa por la Empresa con facultad para hacerlo y que la razón social y el NIT registrados son ciertos.

3. Uso permitido y uso prohibido. Las consultas solo pueden ser sobre clientes, proveedores, empleados, socios u otras contrapartes reales o posibles de la Empresa, para prevenir y gestionar el riesgo de lavado de activos, financiación del terrorismo y financiación de la proliferación de armas. Está prohibido: consultar a personas sin relación con la Empresa o por curiosidad; usar los resultados para perfilar personas, armar listas o bases propias, o para cualquier fin distinto de la gestión de ese riesgo; consultar para terceros, compartir el acceso o revenderlo; enviar datos sensibles o datos de niños, niñas y adolescentes; y abrir más de una prueba para la misma Empresa. Si METRIK detecta uno de estos usos, puede cerrar la prueba de inmediato.

4. El reporte de la prueba. Cada consulta genera un reporte PDF con la marca "PRUEBA". La razón social que aparece en él es la que declaró la Empresa y METRIK no la ha verificado. Por eso el reporte de la prueba no sirve como soporte de cumplimiento ante la Superintendencia de Transporte, otro supervisor, el revisor fiscal o un auditor. Las consultas se hacen contra las mismas listas del servicio pagado.

5. Responsabilidad de la Empresa. Valida es una herramienta de consulta: no es asesoría jurídica ni reemplaza el sistema de gestión del riesgo de la Empresa (SARLAFT, SAGRILAFT u otro). Analizar cada coincidencia, confirmar o descartar homonimias, decidir qué hacer y reportar a la UIAF o al supervisor le corresponde a la Empresa, que sigue siendo la responsable ante su supervisor. Que una consulta no arroje coincidencias no certifica nada sobre la persona consultada. Como la prueba es gratuita, METRIK no responde por lucro cesante ni por daños indirectos, salvo dolo o culpa grave.`

// Bloque 3 v2.0: numerales 7 (7.1 a 7.6) y 8.
const BLOQUE_3_V2 = `7. Medio de pago y cobro al cumplirse los 7 días de la prueba. Para abrir la prueba, la Empresa registra un medio de pago en la pasarela ePayco. METRIK no guarda los datos de la tarjeta: los guarda la pasarela. Durante la prueba no se cobra nada.

7.1. Cobro. Si la Empresa no cancela antes de que se cumplan los 7 días de la prueba, a partir de ese momento METRIK cobra a ese medio de pago el primer mes del plan mensual de Valida: $150.000, valor total, sin IVA que sumar. El cobro no se adelanta aunque las 10 consultas se agoten antes. METRIK informa al abrir la prueba la fecha y la hora en que se cumplen los 7 días; el cobro se hace después de ese momento, nunca antes. Desde ese día el plan queda activo bajo los Términos de Uso de Valida que la Empresa aceptó en este registro, con hasta 3.000 consultas al mes.

7.2. Aviso previo. METRIK escribe al correo registrado al menos 48 horas antes del cobro, con la fecha, el valor y cómo cancelar.

7.3. Cómo cancelar. La Empresa cancela desde el botón "Cancelar prueba" de su cuenta en Valida o escribiendo a mauricio.moreno@metrik.com.co antes de que se cumplan los 7 días de la prueba. Si cancela a tiempo, no se cobra nada y METRIK pide a la pasarela eliminar el medio de pago registrado. Cancelar no quita las consultas que le queden de la prueba.

7.4. Sin permanencia. Al cumplirse los 7 días de la prueba se cobra un solo mes. Después, el plan se renueva y se cobra a ese medio de pago cada mes según los Términos de Uso de Valida, y la Empresa puede retirarse cuando quiera, sin penalidad; el mes ya pagado no se reembolsa.

7.5. Si el cobro falla. No se activa el plan y METRIK envía un enlace de pago. La Empresa no queda debiendo nada por la prueba.

7.6. Supresión. La Empresa puede pedir la supresión de los datos de su cuenta, salvo los que la ley o el numeral 6.5 obligan a conservar.

8. Aceptación y contacto. Estas condiciones se aceptan por mensaje de datos al marcar la casilla del registro (Ley 527 de 1999). METRIK guarda como prueba la versión aceptada, la huella del texto, la fecha y hora, el usuario, el correo verificado con código, la dirección IP y la referencia del medio de pago registrado en la pasarela. Se rigen por la ley colombiana. Contacto: mauricio.moreno@metrik.com.co.`

export const CONDICIONES_PRUEBA_CON_COBRO = {
  slug: 'condiciones-prueba-valida',
  version: '2.0',
  titulo: 'Condiciones de la prueba gratis de Valida',
  texto: [BLOQUE_1_V2, BLOQUE_2, BLOQUE_3_V2].join('\n\n'),
} as const

/**
 * Las Condiciones escriben «10 consultas» y «7 días»: son los números que el texto promete. Si el
 * entorno pide otra prueba (`VALIDA_PRUEBA_CONSULTAS`, `VALIDA_PRUEBA_DIAS`), la pantalla diría una
 * cosa y las Condiciones otra, así que producción no abre (`registroAbierto` en `llave.ts`).
 */
export const PRUEBA_DE_LAS_CONDICIONES = { consultas: 10, dias: 7 } as const

// ── Aviso de datos y casilla ──────────────────────────────────────────────────────────────────

/**
 * El aviso de datos del formulario, v1.1 (sin medio de pago). La pantalla lo completa con un espacio,
 * el enlace con el título de la Política y un punto: por eso termina en «…están en la».
 */
export const AVISO_DATOS_FORMULARIO = `METRIK IA S.A.S. (NIT 902.079.601-9) es la responsable de sus datos. Usamos su correo, la razón social, el NIT, cómo llegó a Valida (incluido si lo recomendó AFI) y la dirección IP del registro para abrir y proteger su cuenta, darle la prueba, evitar pruebas repetidas, guardar la prueba de su aceptación y escribirle sobre su prueba y su plan. Si indica que lo recomendó AFI, le informamos a AFI la razón social y el NIT de su empresa, no su correo. Puede conocer, actualizar, rectificar y suprimir sus datos, revocar esta autorización y dejar de recibir nuestros correos escribiendo a mauricio.moreno@metrik.com.co. Sus derechos y cómo ejercerlos están en la`

/** El aviso v1.2: el de la v1.1 más lo que va a ePayco y lo que guarda METRIK (token y celular). */
export const AVISO_DATOS_FORMULARIO_CON_COBRO = `METRIK IA S.A.S. (NIT 902.079.601-9) es la responsable de sus datos. Usamos su correo, la razón social, el NIT, cómo llegó a Valida (incluido si lo recomendó AFI) y la dirección IP del registro para abrir y proteger su cuenta, darle la prueba, evitar pruebas repetidas, guardar la prueba de su aceptación y escribirle sobre su prueba y su plan. Los datos de la tarjeta los recibe y los guarda la pasarela ePayco (EPAYCO.COM S.A.S.), no METRIK. A METRIK solo le llega una referencia de la tarjeta (token), que guarda junto con su celular para cobrar el plan como dicen las Condiciones. Para registrar la tarjeta y hacer los cobros le entregamos a ePayco el nombre del titular, su celular, su correo y el NIT. Si indica que lo recomendó AFI, le informamos a AFI la razón social y el NIT de su empresa y si contrató el plan y sigue activo, no su correo. Puede conocer, actualizar, rectificar y suprimir sus datos, revocar esta autorización y dejar de recibir nuestros correos escribiendo a mauricio.moreno@metrik.com.co. Sus derechos y cómo ejercerlos están en la`

/** La casilla sin cobro (la de la v1.0; el aviso v1.1 no la cambia). */
export const TEXTO_CASILLA = `Acepto, en nombre de la empresa, las Condiciones de la prueba gratis, incluido el encargo de los datos de las personas que consulte, y autorizo el tratamiento de mis datos según este aviso.`

/** La casilla con cobro (aviso v1.2, texto corregido por Vera): autoriza el cobro de cada mes. */
export const TEXTO_CASILLA_CON_COBRO = `Acepto, en nombre de la empresa, las Condiciones de la prueba gratis, incluido el cobro del plan mensual al medio de pago registrado si no cancelo antes de que se cumplan los 7 días (el primer mes y después cada mes hasta que me retire), el encargo de los datos de las personas que consulte y los Términos de Uso de Valida, y autorizo el tratamiento de mis datos según este aviso.`

/**
 * El texto junto a la tarjeta (aviso §2.3, texto de Vera). NO entra a la huella: es ayuda en pantalla.
 * `{fecha_y_hora_vence}` lo llena la pantalla con `textoJuntoATarjeta`.
 */
export const TEXTO_JUNTO_A_TARJETA = `Durante la prueba no se cobra nada. Si no cancela antes del {fecha_y_hora_vence}, después de ese momento se cobran $150.000 por el primer mes y luego cada mes. La tarjeta la guarda ePayco, no METRIK.`

export function textoJuntoATarjeta(fechaYHoraVence: string): string {
  return TEXTO_JUNTO_A_TARJETA.replace('{fecha_y_hora_vence}', fechaYHoraVence)
}

export const AVISO_REGISTRO = {
  slug: 'aviso-formulario-registro-valida',
  version: '1.1',
} as const

export const AVISO_REGISTRO_CON_COBRO = {
  slug: 'aviso-formulario-registro-valida',
  version: '1.2',
} as const

// ── Las Condiciones vigentes ──────────────────────────────────────────────────────────────────

export interface CondicionesVigentes {
  version: string
  titulo: string
  texto: string
  /** true = la versión con medio de pago y cobro al cumplirse los 7 días (2.0). */
  conCobro: boolean
  /** El aviso que se muestra con ESTAS Condiciones (entra a la huella). */
  aviso: { version: string; texto: string }
  /** La casilla que se muestra con ESTAS Condiciones (entra a la huella). */
  casilla: string
  /**
   * Los Términos de Uso que se aceptan con la casilla, en el MISMO registro (Condiciones 7.1; Términos
   * autoservicio 16.2). Solo con cobro: la casilla v1.2 los nombra. El texto lleno de cada empresa lo
   * arma el servidor (`terminos-registro-servidor.ts`); aquí va qué documento es.
   */
  terminos: { slug: string; titulo: string; version: string } | null
}

export const VIGENTES_SIN_COBRO: CondicionesVigentes = {
  ...CONDICIONES_PRUEBA,
  conCobro: false,
  aviso: { version: AVISO_REGISTRO.version, texto: AVISO_DATOS_FORMULARIO },
  casilla: TEXTO_CASILLA,
  terminos: null,
}

export const VIGENTES_CON_COBRO: CondicionesVigentes = {
  ...CONDICIONES_PRUEBA_CON_COBRO,
  conCobro: true,
  aviso: { version: AVISO_REGISTRO_CON_COBRO.version, texto: AVISO_DATOS_FORMULARIO_CON_COBRO },
  casilla: TEXTO_CASILLA_CON_COBRO,
  terminos: { slug: TERMINOS_PLAN.slug, titulo: TERMINOS_PLAN.titulo, version: TERMINOS_PLAN.version },
}

/** Lo que se guarda en `valida_registros.condiciones_version` sin cobro. */
export const VERSION_ACEPTADA = `condiciones-${CONDICIONES_PRUEBA.version}+aviso-${AVISO_REGISTRO.version}`

/**
 * La versión aceptada de unas Condiciones dadas, con el aviso que se mostró con ellas y, con cobro,
 * los Términos (`condiciones-2.0+aviso-1.2+terminos-auto-2.0`, la que pide Emilio en la sección B de
 * los Términos de autoservicio).
 */
export function versionAceptada(c: Pick<CondicionesVigentes, 'version' | 'aviso'> & { terminos?: CondicionesVigentes['terminos'] } = VIGENTES_SIN_COBRO): string {
  const base = `condiciones-${c.version}+aviso-${c.aviso.version}`
  return c.terminos ? `${base}+terminos-auto-${c.terminos.version.replace(/^v/, '')}` : base
}

/** El aviso como se lee en la pantalla: texto, enlace a la Política (con su dirección) y punto. */
export function avisoComoSeLee(
  aviso: string = AVISO_DATOS_FORMULARIO,
  politica: { titulo: string; url: string } = POLITICA_DATOS_VALIDA,
): string {
  return `${aviso} ${politica.titulo} (${politica.url}).`
}

/**
 * Los Términos de Uso que se aceptan EN EL REGISTRO (7.1: «los Términos de Uso de Valida que la
 * Empresa aceptó en este registro»): los de autoservicio v2.0 (`terminos-plan.ts`), llenos con la Orden
 * de la empresa. El registro los muestra junto a las Condiciones y los pasa a `textoAceptado`, que los
 * mete en la huella detrás de la casilla.
 */
export interface TerminosDelRegistro {
  titulo: string
  version: string
  texto: string
}

/**
 * Todo lo que la persona leyó y aceptó al marcar la casilla, en un orden fijo. Sobre esto se calcula
 * la huella. No se muestra así: es la forma canónica de reconstruir la constancia desde el código.
 */
export function textoAceptado(c: CondicionesVigentes = VIGENTES_SIN_COBRO, terminos: TerminosDelRegistro | null = null): string {
  const partes = [
    `${c.titulo} · v${c.version}`,
    c.texto,
    `Aviso del formulario de registro · v${c.aviso.version}`,
    avisoComoSeLee(c.aviso.texto),
    `Casilla: ${c.casilla}`,
  ]
  if (terminos) partes.push(`${terminos.titulo} · ${terminos.version}`, terminos.texto)
  return partes.join('\n\n')
}

/** true cuando ya no queda ningún marcador: es la condición para abrir el registro en producción. */
export function textosListos(
  textos: readonly string[] = [CONDICIONES_PRUEBA.texto, AVISO_DATOS_FORMULARIO, TEXTO_CASILLA],
): boolean {
  return textos.every((t) => !MARCADOR_TEXTO_PENDIENTE.test(t))
}

type Env = Record<string, string | undefined>

/**
 * ePayco puede tokenizar en ESTE despliegue: encendido y con la llave pública de METRIK. Es la regla
 * de `epaycoHabilitado` + `llavePublicaEpayco` (`pasarela/epayco.ts`), repetida aquí porque aquel
 * archivo usa `node:crypto` y este lo importa la pantalla. Una prueba vigila que coincidan.
 */
export function epaycoPuedeTokenizar(env: Env = process.env): boolean {
  const llave = env.EPAYCO_PUBLIC_KEY_METRIK
  return env.EPAYCO_HABILITADO === '1' && typeof llave === 'string' && llave.trim() !== ''
}

/**
 * Las Condiciones que muestra y registra la pantalla. Por defecto, la v1.0 (sin cobro) con el aviso
 * v1.1. La v2.0, con el aviso v1.2 y la casilla con cobro, sale SOLO si se cumple todo:
 *
 *   1. `VALIDA_COBRO_TRAS_PRUEBA=1`;
 *   2. ePayco encendido y con llave pública (fila 14 de Vera): sin eso la tarjeta no se puede pedir, y
 *      aceptar un texto que dice «la Empresa registra un medio de pago» sin registrarlo dejaría una
 *      constancia falsa;
 *   3. en producción, además: `CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION`, los Términos de Uso escritos
 *      (la casilla los nombra). El límite de 3.000 no se mira aquí: está fijo en `plan.ts`.
 *
 * En un preview bastan 1 y 2, para poder recorrer el registro con la tarjeta de prueba.
 */
export function condicionesVigentes(env: Env = process.env, terminosListos: boolean = terminosPlanListos()): CondicionesVigentes {
  if (env.VALIDA_COBRO_TRAS_PRUEBA !== '1') return VIGENTES_SIN_COBRO
  if (!epaycoPuedeTokenizar(env)) return VIGENTES_SIN_COBRO
  if (env.VERCEL_ENV === 'production') {
    if (!CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION) return VIGENTES_SIN_COBRO
    if (!terminosListos) return VIGENTES_SIN_COBRO
  }
  return VIGENTES_CON_COBRO
}
