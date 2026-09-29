/**
 * Las capas 1 a 3 del antiabuso del autoservicio SECOP, puras.
 *
 * Spec §0-quater («qué recomiendo para este experimento»), en ese orden y por ese motivo:
 *
 *   1. **Correo verificado + bloqueo de dominios desechables.** La verificación NO se implementa
 *      aquí y no hace falta implementarla: el login de ONE es magic link con OTP
 *      (`src/app/(marketing)/login/login-client.tsx`), así que quien tiene sesión ya probó que el
 *      correo existe. Lo que falta es lo otro: «el correo verificado solo ya no alcanza, Mailinator
 *      y compañía lo vuelven inútil».
 *   2. **Tope por IP y por dominio de correo**, en una ventana de tiempo.
 *   3. **Identificación única**, que vive en un índice de la base (`secop_registros`) y no aquí.
 *
 * Y lo que deliberadamente NO está: huella de dispositivo (§0-quater.5, «no todavía»: dependencia
 * externa y datos de terceros que habría que declarar en la política de tratamiento) y medio de pago
 * en el registro (decisión de producto de Mauricio, no de un PR).
 *
 * ## Por qué el veredicto es una función pura que recibe conteos
 *
 * Para poder probar el tope sin base y sin reloj. Quien cuenta es `registro-servidor.ts`; aquí solo
 * se decide. La misma razón por la que `usuarios-espacio/reglas.ts` separa reglas de lecturas.
 */

/**
 * Dominios de correo desechable. Lista corta y explícita a propósito: un servicio de terceros que
 * los resuelve es otra dependencia externa, y a esta escala los 20 primeros cubren el caso que se
 * quiere frenar (§0-quater: «es un freno barato y proporcional al tamaño del experimento»).
 *
 * Se compara el dominio COMPLETO en minúsculas, no por substring: `mailinator.com.co` sería un
 * dominio distinto y `gmailinator.com` contiene `mailinator.com`.
 */
export const DOMINIOS_DESECHABLES: readonly string[] = [
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.info',
  'sharklasers.com',
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'yopmail.com',
  'yopmail.fr',
  'getnada.com',
  'dispostable.com',
  'trashmail.com',
  'maildrop.cc',
  'fakeinbox.com',
  'mintemail.com',
  'mailnesia.com',
  'inboxbear.com',
  'moakt.com',
  'emailondeck.com',
  'spam4.me',
  'grr.la',
  'harakirimail.com',
  'mohmal.com',
]

/** Cuántos registros se toleran por IP y por dominio de correo dentro de la ventana. */
export const TOPE_POR_IP = 3
export const TOPE_POR_DOMINIO = 5
export const VENTANA_HORAS = 24

/**
 * Dominios de correo masivo, exentos del tope por dominio.
 *
 * Sin esta exención el tope se dispara contra la gente legítima antes que contra el abusador: el
 * cuarto registro con Gmail del experimento entero sería el que quedara afuera. Del lado del
 * abusador la exención no regala nada que el tope por IP y la identificación única no cubran.
 */
export const DOMINIOS_MASIVOS: readonly string[] = [
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'outlook.es',
  'live.com',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'me.com',
]

/** `usuario@Dominio.COM` → `dominio.com`. `''` si el correo no tiene forma de correo. */
export function dominioDeCorreo(correo: string | null | undefined): string {
  if (!correo) return ''
  const partes = correo.trim().toLowerCase().split('@')
  if (partes.length !== 2) return ''
  const dominio = partes[1]
  // Un `@` suelto al final deja dominio vacío, y un dominio sin punto no es un dominio público.
  return dominio.includes('.') ? dominio : ''
}

export function esDominioDesechable(correo: string | null | undefined): boolean {
  const d = dominioDeCorreo(correo)
  return d !== '' && DOMINIOS_DESECHABLES.includes(d)
}

export function esDominioMasivo(correo: string | null | undefined): boolean {
  const d = dominioDeCorreo(correo)
  return d !== '' && DOMINIOS_MASIVOS.includes(d)
}

export type MotivoRechazo =
  | 'correo_invalido'
  | 'dominio_desechable'
  | 'tope_ip'
  | 'tope_dominio'
  | 'identificacion_tomada'
  | 'correo_tomado'
  | 'slug_tomado'

export interface SenalesRegistro {
  /** El correo de la sesión, ya verificado por Auth. */
  correo: string
  /** Registros (de cualquier estado) desde esta IP dentro de la ventana. `null` = no se pudo medir. */
  registrosPorIp: number | null
  /** Registros desde este dominio de correo dentro de la ventana. `null` = no se pudo medir. */
  registrosPorDominio: number | null
}

/**
 * El veredicto de las capas que se pueden decidir con estas señales. `null` = pasa.
 *
 * ⚠️ Un conteo `null` («no pude medir») **no bloquea**. Es la decisión opuesta a la de
 * `radar/contexto.ts`, y la razón es de qué lado cae el error: allá un `?? {}` convertía «no pude
 * leer» en «el módulo no está» y ABRÍA una puerta; aquí un fallo de lectura cerraría el registro a
 * todo el mundo y el experimento se vería como «nadie se registró». El tope es una capa de fricción
 * sobre un producto de $15.000, no el aislamiento del tenant: eso lo sostienen la identificación
 * única (un índice de la base, que no falla en silencio) y la ruta de servidor.
 */
export function motivoDeRechazo(s: SenalesRegistro): MotivoRechazo | null {
  const dominio = dominioDeCorreo(s.correo)
  if (!dominio) return 'correo_invalido'
  if (DOMINIOS_DESECHABLES.includes(dominio)) return 'dominio_desechable'
  if (s.registrosPorIp !== null && s.registrosPorIp >= TOPE_POR_IP) return 'tope_ip'
  if (
    !DOMINIOS_MASIVOS.includes(dominio) &&
    s.registrosPorDominio !== null &&
    s.registrosPorDominio >= TOPE_POR_DOMINIO
  ) {
    return 'tope_dominio'
  }
  return null
}

/**
 * Lo que se le dice a la persona.
 *
 * Ninguno de estos textos revela la regla que se rompió ni con qué dato: decir «ya hay un espacio
 * con ese NIT» le confirma a cualquiera que ese NIT es cliente nuestro, y decir «vas 3 de 3 por tu
 * IP» le enseña el tope al que lo está sondeando. Todos terminan en la misma salida real, que es
 * escribirnos: el que se topó de verdad siendo legítimo tiene que poder seguir.
 */
export function textoMotivo(m: MotivoRechazo): string {
  switch (m) {
    case 'correo_invalido':
      return 'No pudimos leer tu correo. Vuelve a entrar e inténtalo de nuevo.'
    case 'dominio_desechable':
      return 'Necesitamos un correo permanente para abrir tu espacio. Usa el correo de tu empresa o tu correo personal.'
    case 'tope_ip':
    case 'tope_dominio':
      return 'No pudimos abrir el espacio ahora mismo. Inténtalo más tarde o escríbenos a mauricio.moreno@metrik.com.co.'
    case 'identificacion_tomada':
      return 'Ese número de identificación ya tiene un espacio abierto. Si es de tu empresa, pídele acceso a quien lo abrió, o escríbenos a mauricio.moreno@metrik.com.co.'
    case 'correo_tomado':
      return 'Ya tienes un espacio con este correo. Entra con él desde la página de ingreso.'
    case 'slug_tomado':
      return 'Esa dirección ya está en uso. Elige otra.'
  }
}
