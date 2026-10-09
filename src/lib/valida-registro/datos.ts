import { calcularDvNit } from '@/lib/dian/nit'
import { textoMotivo, type MotivoRechazo } from '@/lib/secop-registro/antiabuso'

/**
 * Los datos de la pantalla «Tu empresa», validados igual en la pantalla (mientras se escribe) y en
 * el servidor (que es el que decide). Puro: sin base, sin red, sin reloj.
 */

// ─── NIT y DV ───────────────────────────────────────────────────────────

/**
 * El NIT y su DV van en DOS campos y el DV se comprueba con módulo 11. Así no hay que adivinar nada:
 * `src/lib/secop-registro/identificacion.ts` explica por qué adivinar el DV mutila números buenos, y
 * su salida recomendada era justamente esta («pedir el número y el DV en dos campos»).
 *
 * Con el DV comprobado, la llave «una prueba por NIT» (`valida_registros_identificacion_creada`) no
 * tiene el hueco del DV pegado: el número que se guarda es siempre la base.
 */
export type ProblemaNit = 'nit_vacio' | 'nit_forma' | 'dv_vacio' | 'dv_no_coincide'

export function soloDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '')
}

export function problemaDelNit(nit: string, dv: string): ProblemaNit | null {
  const base = soloDigitos(nit)
  if (!base) return 'nit_vacio'
  // Un NIT de persona jurídica en Colombia tiene 9 dígitos; se admite de 6 a 10 por los NIT viejos
  // y los de persona natural (la cédula), sin pasar de lo que soporta el módulo 11.
  if (base.length < 6 || base.length > 10) return 'nit_forma'
  const d = soloDigitos(dv)
  if (!d) return 'dv_vacio'
  if (d.length !== 1 || calcularDvNit(base) !== d) return 'dv_no_coincide'
  return null
}

export function textoProblemaNit(p: ProblemaNit): string {
  switch (p) {
    case 'nit_vacio':
      return 'Escribe el NIT de tu empresa.'
    case 'nit_forma':
      return 'Revisa el NIT: se escribe sin puntos y sin el dígito de verificación.'
    case 'dv_vacio':
      return 'Escribe el dígito de verificación (el número después del guion).'
    case 'dv_no_coincide':
      return 'El dígito de verificación no corresponde a ese NIT. Revisa los dos.'
  }
}

/** `900123456` → `900.123.456`, para mostrarlo mientras se escribe. */
export function nitConPuntos(nit: string): string {
  return soloDigitos(nit).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

// ─── Razón social y tipo de entidad ─────────────────────────────────────

export const LARGO_MIN_RAZON = 3
export const LARGO_MAX_RAZON = 120

export function normalizarRazonSocial(v: string): string {
  return v.trim().replace(/\s+/g, ' ')
}

export function problemaDeRazonSocial(v: string): string | null {
  const r = normalizarRazonSocial(v)
  if (r.length < LARGO_MIN_RAZON) return 'Escribe la razón social de tu empresa, como aparece en el RUT.'
  if (r.length > LARGO_MAX_RAZON) return `La razón social no puede pasar de ${LARGO_MAX_RAZON} caracteres.`
  return null
}

export const TIPOS_ENTIDAD = [
  { valor: 'cda', etiqueta: 'CDA' },
  { valor: 'vigilado_supertransporte', etiqueta: 'Otro vigilado de la Supertransporte' },
  { valor: 'otro', etiqueta: 'Otro tipo de empresa' },
] as const

export type TipoEntidad = (typeof TIPOS_ENTIDAD)[number]['valor']

export function esTipoEntidad(v: unknown): v is TipoEntidad {
  return TIPOS_ENTIDAD.some((t) => t.valor === v)
}

// ─── Marca de origen (comisión AFI) ─────────────────────────────────────

/**
 * Decisión B de Mauricio (2026-10-09): cliente con código de AFI, la comisión de siempre; cliente que
 * no viene de AFI, máximo 5 %; pauta, proporcional a lo que AFI haya puesto en el fondo. Aquí solo se
 * MARCA el origen; el número de la comisión se escribe en el contrato al activar (PR 6), no aquí.
 *
 * Precedencia: cualquier señal de AFI gana (el enlace `?ref=afi`, un código de AFI, o la respuesta
 * «me recomendó AFI»); después la pauta (UTM de campaña pagada); si no, directo. AFI gana sobre la
 * pauta porque el reclamo de AFI se resuelve a su favor cuando trae soporte (§3.4): marcarlo de una
 * vez evita el reclamo.
 */
export type Origen = 'afi' | 'pauta' | 'directo'
export type FuenteOrigen = 'ref' | 'codigo_afi' | 'respuesta_afi' | 'utm' | 'ninguna'

export type SenalesOrigen = {
  ref?: string | null
  codigoAfi?: string | null
  recomendadoAfi?: boolean | null
  utm?: Record<string, string>
}

/** Las UTM que se guardan; cualquier otra llave del cuerpo se descarta. */
export const LLAVES_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

const MEDIOS_PAGADOS = new Set(['cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'ads', 'display', 'cpm'])

export function limpiarUtm(crudo: unknown): Record<string, string> {
  const fuera: Record<string, string> = {}
  if (!crudo || typeof crudo !== 'object') return fuera
  for (const llave of LLAVES_UTM) {
    const v = (crudo as Record<string, unknown>)[llave]
    if (typeof v === 'string' && v.trim()) fuera[llave] = v.trim().slice(0, 100)
  }
  return fuera
}

/** Un código de AFI se guarda tal cual, en mayúsculas, si tiene forma de código. */
export function limpiarCodigoAfi(v: string | null | undefined): string | null {
  const c = (v ?? '').trim().toUpperCase()
  return /^[A-Z0-9-]{3,24}$/.test(c) ? c : null
}

export function decidirOrigen(s: SenalesOrigen): { origen: Origen; fuente: FuenteOrigen } {
  const ref = (s.ref ?? '').trim().toLowerCase()
  if (ref === 'afi') return { origen: 'afi', fuente: 'ref' }
  if (limpiarCodigoAfi(s.codigoAfi)) return { origen: 'afi', fuente: 'codigo_afi' }
  if (s.recomendadoAfi === true) return { origen: 'afi', fuente: 'respuesta_afi' }
  const medio = (s.utm?.utm_medium ?? '').toLowerCase()
  if (MEDIOS_PAGADOS.has(medio)) return { origen: 'pauta', fuente: 'utm' }
  return { origen: 'directo', fuente: 'ninguna' }
}

// ─── Slug y textos de rechazo ───────────────────────────────────────────

/** `cda-ejemplo`, `cda-ejemplo-2`, … `cda-ejemplo-9`, recortados para que quepan en 30. */
export function candidatosDeSlug(base: string): string[] {
  const fuera = [base]
  for (let i = 2; i <= 9; i++) {
    const sufijo = `-${i}`
    fuera.push(`${base.slice(0, 30 - sufijo.length).replace(/-+$/g, '')}${sufijo}`)
  }
  return fuera
}

/**
 * Los textos de rechazo NO revelan la regla ni el dato (decir «ese NIT ya tiene prueba» confirma que
 * es cliente). El del NIT tomado lleva a la única cola humana del recorrido (§5, suplantación).
 */
export function textoMotivoValida(m: MotivoRechazo): string {
  if (m === 'identificacion_tomada') {
    return '¿Ya tienes cuenta en tu empresa? Pídele acceso a quien la abrió, o escríbenos a mauricio.moreno@metrik.com.co y lo revisamos.'
  }
  return textoMotivo(m)
}

