/**
 * El RUT al activar el plan (`18-recorrido-baja-friccion.md` §2.2 paso 9 y §5, PR 8). Puro.
 *
 * Compara lo que leyó `parseRut` con lo que la empresa declaró al registrarse. El veredicto NO frena
 * el pago (§5, «RUT que no coincide»: se acepta el pago y queda en revisión): solo decide si la
 * empresa queda verificada en el directorio de MeTRIK (`empresas.rut_verificado`). Lo que no
 * coincide o no se leyó lo revisa una persona; esa es la única cola humana del recorrido.
 */

export type VeredictoRut = 'coincide' | 'no_coincide' | 'ilegible'

export interface LecturaRut {
  nit: string | null
  dv: string | null
  razonSocial: string | null
  /** `overall_confidence` de la lectura, de 0 a 1. */
  confianza: number
}

/** Confianza mínima para dar una lectura por buena (el tier `auto` de `src/lib/rut/types.ts`). */
export const CONFIANZA_MINIMA_RUT = 0.85

const SOCIEDAD = /\b(S\s*A\s*S|S\s*A|LTDA|LIMITADA|S\s*EN\s*C|E\s*U|SOCIEDAD POR ACCIONES SIMPLIFICADA|SOCIEDAD ANONIMA)\b/g

/** Razón social para comparar: sin tildes, sin puntuación, sin la forma societaria, en mayúsculas. */
export function razonParaComparar(razon: string): string {
  return razon
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    // El punto se quita sin dejar espacio («C.D.A.» = «CDA», «S.A.S.» = «SAS»); lo demás separa.
    .replace(/\./g, '')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(SOCIEDAD, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function digitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '')
}

export function compararRut(declarado: { nit: string; dv: string | null; razonSocial: string }, leido: LecturaRut): VeredictoRut {
  const nitLeido = digitos(leido.nit)
  if (!nitLeido || !leido.razonSocial || leido.confianza < CONFIANZA_MINIMA_RUT) return 'ilegible'
  const mismoNit = nitLeido === digitos(declarado.nit) && (!declarado.dv || !leido.dv || digitos(leido.dv) === declarado.dv)
  const mismaRazon = razonParaComparar(leido.razonSocial) === razonParaComparar(declarado.razonSocial)
  return mismoNit && mismaRazon ? 'coincide' : 'no_coincide'
}
