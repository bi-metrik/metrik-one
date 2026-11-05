/**
 * Normalizaciones deterministas post-extracción de un documento.
 *
 * Vive aparte de `documento-actions.ts` por dos razones: un archivo `'use server'` solo
 * puede exportar funciones async (y exportar esto de ahí lo convertiría en un endpoint
 * alcanzable), y así se puede probar sin Gemini, sin Drive y sin base.
 *
 * Muta `resultado` en sitio. Orden:
 *
 *  1. `nit_sin_dv` (opt-in por campo) — deja el NIT base sin el DV pegado.
 *  2. NIT y DV del RUT (GENÉRICA, sin opt-in) — cualquier bloque cuyos campos incluyan
 *     `nit`. Ver `normalizarNitYDv`.
 *  2b. Casilla 26 sin el código del tipo de documento pegado delante, y `nit_completo`
 *     sin el DV repetido (GENÉRICA). Ver `normalizarIdentificacionRut`.
 *  2c. Razón social vacía de persona natural, armada con apellidos y nombres. Ver
 *     `completarRazonSocialPersonaNatural`.
 *  3. `dv_desde_nit` (opt-in por campo) — recalcula el DV sobre el NIT ya limpio.
 *  4. `divipola_desde_nombres` (opt-in por campo) — códigos de ubicación desde nombres.
 *  5. `derivar` (opt-in por campo) — el valor sale de una resta de otros dos campos leídos.
 *     Ver `derivarCampos`.
 *  6. `coherencia_pct` (opt-in por campo) — alerta si un monto no es el porcentaje esperado
 *     de su base (IVA ↔ valor). Corre DESPUÉS de `derivar`. Ver `revisarCoherenciaPct`.
 *
 * ⚠️ Ninguna pasada pisa un campo PROTEGIDO: uno con `edicion` (lo tocó una persona) o
 * con `manual: true` y valor. El segundo caso solo existe después del merge de
 * `reprocesarDocumento`, que conserva lo que el bloque ya tenía corregido: en una
 * extracción fresca `manual: true` significa "confianza < 0.70, valor en null", o sea que
 * no hay nada que pisar.
 */

import type { CampoExtraccion, CampoResultado } from '@/lib/ai/extract-fields'
import { calcularDvNit, diagnosticarNitDv, nitSinDv } from '@/lib/dian/nit'
import { resolverCodigosUbicacion } from '@/lib/dian/divipola'
import {
  esCedulaDeCiudadania,
  esOtroTipoDeDocumento,
  nitCompletoSinDvDoble,
  sinPrefijoDeTipo,
} from '@/lib/dian/prefijo-tipo-documento'
import { CONFIANZA_REVISAR, bajarConfianza, campoProtegido } from './confianza'
import { derivarCampos, revisarCoherenciaPct } from './derivar'

// Los ayudantes de confianza y las pasadas 5 y 6 viven aparte porque la pantalla también
// los usa (recalcular un derivado al corregir una fuente) y este archivo arrastra el
// catálogo DIVIPOLA. Se re-exportan para no mover a quien ya los importa de aquí.
export { CONFIANZA_REVISAR, campoProtegido }
export { derivarCampos, revisarCoherenciaPct } from './derivar'
export type { CambioDerivado, AlertaCoherencia } from './derivar'

export interface CambioNitDv {
  campo: 'nit' | 'dv'
  antes: string | null
  despues: string | null
  motivo: string
}

/**
 * NIT y DV de cualquier bloque cuyos campos incluyan `nit`.
 *
 * - Si el NIT trae el DV pegado (con testigo, ver `diagnosticarNitDv`), se quita.
 * - Si no se puede saber, el valor NO se toca y el campo baja a "Verificar".
 * - El `dv` se recalcula SIEMPRE sobre el NIT ya limpio. Antes `dv_desde_nit` lo
 *   calculaba sobre el NIT crudo, y así nació el DV malo de 16 de los 20 RUT de SOENA.
 * - Si el DV que leyó la extracción no coincide con el calculado, se guarda el calculado
 *   y el campo baja a "Verificar": algo no cuadra entre las casillas 5 y 6.
 *
 * Devuelve los cambios hechos (para el log). No hace nada si el bloque no tiene `nit`.
 */
export function normalizarNitYDv(
  campos: CampoExtraccion[],
  resultado: Record<string, CampoResultado>,
): CambioNitDv[] {
  const slugs = new Set(campos.map((c) => c.slug))
  if (!slugs.has('nit')) return []
  const cambios: CambioNitDv[] = []

  const nitC = resultado.nit
  const dvC = slugs.has('dv') ? resultado.dv : undefined
  // El DV leído se toma ANTES de recalcular nada: es el testigo.
  const dvLeido = dvC?.value ?? null
  const idC = resultado.numero_identificacion
  const identificacion = idC?.value ?? null

  if (nitC?.value && !campoProtegido(nitC)) {
    const d = diagnosticarNitDv({ nit: nitC.value, numeroIdentificacion: identificacion, dvLeido })
    if (d.accion === 'quitar_dv') {
      cambios.push({ campo: 'nit', antes: nitC.value, despues: d.nit, motivo: d.motivo })
      nitC.value = d.nit
    } else if (d.accion === 'dudoso') {
      cambios.push({ campo: 'nit', antes: nitC.value, despues: nitC.value, motivo: d.motivo })
      bajarConfianza(nitC)
    }
  }

  if (!slugs.has('dv')) return cambios
  const nitFinal = resultado.nit?.value ?? null
  const dvCalc = calcularDvNit(nitFinal)
  if (dvCalc == null) return cambios
  if (campoProtegido(dvC)) return cambios

  const leido = (dvLeido ?? '').replace(/\D/g, '')
  if (!dvC) {
    resultado.dv = { value: dvCalc, confidence: 1, manual: false }
    cambios.push({ campo: 'dv', antes: null, despues: dvCalc, motivo: 'calculado' })
  } else if (!leido) {
    // La extracción no lo pudo leer: el DV es función del NIT, se completa sin duda.
    dvC.value = dvCalc
    dvC.confidence = 1
    dvC.manual = false
    cambios.push({ campo: 'dv', antes: null, despues: dvCalc, motivo: 'calculado' })
  } else if (leido !== dvCalc) {
    cambios.push({ campo: 'dv', antes: dvC.value, despues: dvCalc, motivo: 'dv_leido_no_coincide' })
    dvC.value = dvCalc
    // El DV impreso se conserva como testigo: que no valide con el NIT leído dice que
    // una de las dos casillas se leyó mal, y el voto entre fuentes lo usa (`votos.ts`).
    // Recalcularlo sin guardarlo borraba justo esa evidencia.
    dvC.leido = leido
    bajarConfianza(dvC)
  }
  return cambios
}

export interface CambioIdentificacion {
  campo: 'numero_identificacion' | 'nit' | 'nit_completo'
  antes: string | null
  despues: string | null
  motivo: 'prefijo_tipo_documento' | 'cc_casillas_distintas' | 'nit_completo_dv_doble'
}

/**
 * La casilla 26 del RUT (`numero_identificacion`) sin el código de la casilla 25 pegado
 * delante, y `nit_completo` sin el DV repetido. Corre DESPUÉS de `normalizarNitYDv`: el
 * testigo es el NIT de la casilla 5 ya limpio.
 *
 * - Si la casilla 26 es «13» + NIT (o «1» + NIT, ver `sinPrefijoDeTipo`), se guarda el
 *   NIT y lo leído queda en `leido`. El testigo es otra casilla del mismo papel: no se
 *   adivina por la forma del número.
 * - Con cédula de ciudadanía la casilla 26 tiene que ser la 5. Si después de limpiar no
 *   lo es, las dos bajan a «Verificar»: no se sabe cuál se leyó mal.
 * - Con otro tipo de documento legible (extranjería, pasaporte, NIT) no se toca nada:
 *   ahí las dos casillas difieren por diseño.
 * - `nit_completo` con el DV dos veces («799074677-7») queda «79907467-7».
 */
export function normalizarIdentificacionRut(
  campos: CampoExtraccion[],
  resultado: Record<string, CampoResultado>,
): CambioIdentificacion[] {
  const slugs = new Set(campos.map((c) => c.slug))
  if (!slugs.has('nit')) return []
  const cambios: CambioIdentificacion[] = []
  const nit = resultado.nit?.value ?? null
  if (!nit) return cambios

  const ncC = slugs.has('nit_completo') ? resultado.nit_completo : undefined
  if (ncC?.value && !campoProtegido(ncC)) {
    const bueno = nitCompletoSinDvDoble(ncC.value, nit)
    if (bueno) {
      cambios.push({ campo: 'nit_completo', antes: ncC.value, despues: bueno, motivo: 'nit_completo_dv_doble' })
      ncC.value = bueno
    }
  }

  if (!slugs.has('numero_identificacion')) return cambios
  const tipo = resultado.tipo_documento?.value ?? null
  if (esOtroTipoDeDocumento(tipo)) return cambios
  const idC = resultado.numero_identificacion
  if (!idC?.value || campoProtegido(idC)) return cambios

  const limpio = sinPrefijoDeTipo(idC.value, nit)
  if (limpio) {
    cambios.push({ campo: 'numero_identificacion', antes: idC.value, despues: limpio, motivo: 'prefijo_tipo_documento' })
    idC.leido = idC.value
    idC.value = limpio
    return cambios
  }

  const d = (v: unknown) => String(v ?? '').replace(/\D/g, '')
  if (esCedulaDeCiudadania(tipo) && d(idC.value) !== d(nit)) {
    cambios.push({ campo: 'numero_identificacion', antes: idC.value, despues: idC.value, motivo: 'cc_casillas_distintas' })
    bajarConfianza(idC)
    const nitC = resultado.nit
    if (nitC && !campoProtegido(nitC)) bajarConfianza(nitC)
  }
  return cambios
}

/**
 * Razón social de una persona natural vacía: se arma con las casillas 31 a 34 (primer apellido, segundo apellido,
 * primer nombre, otros nombres), que es lo que pide su `descripcion_ai`. La casilla 35 del RUT («Razón social») va en
 * blanco para una persona natural, y Haiku 5.5 a veces la transcribe literal, vacía (V0660, SOE-038). Solo cuando el
 * bloque trae esas casillas, el tipo de persona es «Natural» y hay al menos un apellido y un nombre. Devuelve el valor
 * armado, o null si no hizo nada.
 */
export function completarRazonSocialPersonaNatural(
  campos: CampoExtraccion[],
  resultado: Record<string, CampoResultado>,
): string | null {
  const slugs = new Set(campos.map((c) => c.slug))
  if (!slugs.has('razon_social') || !slugs.has('primer_apellido') || !slugs.has('primer_nombre')) return null
  const rs = resultado.razon_social
  if (rs?.value || campoProtegido(rs)) return null
  if (!/natural/i.test(resultado.tipo_persona?.value ?? '')) return null
  const partes = ['primer_apellido', 'segundo_apellido', 'primer_nombre', 'otros_nombres']
    .map((k) => resultado[k])
    .filter((c): c is CampoResultado => !!c?.value?.trim())
  if (!resultado.primer_apellido?.value?.trim() || !resultado.primer_nombre?.value?.trim()) return null
  const valor = partes.map((c) => c.value!.trim()).join(' ')
  const confidence = Math.min(...partes.map((c) => c.confidence))
  resultado.razon_social = { value: valor, confidence, manual: false }
  return valor
}

/**
 * Todas las normalizaciones, en orden. Ver el encabezado.
 */
export function aplicarNormalizaciones(
  campos: CampoExtraccion[],
  resultado: Record<string, CampoResultado>,
): void {
  // Pasada 1: nit_sin_dv (deja el NIT base sin el DV pegado).
  //
  // ⚠️ `nitSinDv` ADIVINA si el valor trae DV (ver el aviso de ÁMBITO en
  // `@/lib/dian/nit`): cuando el último dígito resulta ser el DV válido de los
  // anteriores, recorta — acierte o no. Sobre una identificación limpia eso borra
  // un dígito REAL ~1 de cada 11 veces. Por eso, cuando de verdad recorta, se
  // deja rastro en el log: la mutilación dejó de ser silenciosa (así se colaron
  // 14 cédulas mutiladas antes de que alguien lo notara).
  for (const campo of campos) {
    if (campo.normalizar === 'nit_sin_dv') {
      const cr = resultado[campo.slug]
      if (cr?.value && !campoProtegido(cr)) {
        const antes = cr.value
        cr.value = nitSinDv(antes)
        if (cr.value !== antes) {
          console.warn(`[documento] nit_sin_dv RECORTÓ ${campo.slug}: "${antes}" → "${cr.value}"`)
        }
      }
    }
  }
  // Pasada 2: NIT y DV (genérica). Con testigo, a diferencia de la pasada 1.
  for (const c of normalizarNitYDv(campos, resultado)) {
    console.warn(`[documento] nit/dv ${c.campo}: "${c.antes}" → "${c.despues}" (${c.motivo})`)
  }
  // Pasada 2b: casilla 26 sin el código del tipo de documento (testigo: la casilla 5
  // ya limpia) y `nit_completo` sin el DV repetido.
  for (const c of normalizarIdentificacionRut(campos, resultado)) {
    console.warn(`[documento] identificación ${c.campo}: "${c.antes}" → "${c.despues}" (${c.motivo})`)
  }
  // Pasada 2c: razón social de persona natural desde las casillas 31 a 34.
  const razonSocial = completarRazonSocialPersonaNatural(campos, resultado)
  if (razonSocial) console.warn(`[documento] razon_social vacía: se arma con apellidos y nombres → "${razonSocial}"`)
  // Pasada 3: dv_desde_nit (recalcula el DV desde el NIT base ya normalizado).
  for (const campo of campos) {
    if (campo.normalizar === 'dv_desde_nit') {
      const nitSlug = campo.normalizar_desde ?? 'nit'
      const nitVal = resultado[nitSlug]?.value ?? null
      const dvCalc = calcularDvNit(nitVal)
      if (dvCalc != null) {
        const cr = resultado[campo.slug]
        if (cr) {
          if (!campoProtegido(cr)) cr.value = dvCalc
        } else resultado[campo.slug] = { value: dvCalc, confidence: 1, manual: false }
      }
    }
  }
  // Pasada 4: divipola_desde_nombres (códigos de ubicación desde los NOMBRES).
  // Mismo criterio que el DV: el código es función del nombre y el nombre se lee
  // bien. Se hace UNA vez para los tres códigos porque el municipio solo se puede
  // resolver dentro de su departamento (hay 67 nombres repetidos en el país).
  if (campos.some((c) => c.normalizar === 'divipola_desde_nombres')) {
    const valor = (slug: string) => (resultado[slug]?.value ?? null) as string | null
    const codes = resolverCodigosUbicacion(
      valor('pais'), valor('departamento'), valor('municipio'),
      {
        codigo_pais: valor('codigo_pais'),
        codigo_departamento: valor('codigo_departamento'),
        codigo_municipio: valor('codigo_municipio'),
      },
    )
    for (const campo of campos) {
      if (campo.normalizar !== 'divipola_desde_nombres') continue
      const nuevo = codes[campo.slug as keyof typeof codes]
      if (nuevo == null) continue
      const cr = resultado[campo.slug]
      if (campoProtegido(cr)) continue
      if (cr) { cr.value = nuevo; cr.confidence = 1 }
      else resultado[campo.slug] = { value: nuevo, confidence: 1, manual: false }
    }
  }
  // Pasada 5: campos derivados (resta de dos campos leídos).
  for (const c of derivarCampos(campos, resultado)) {
    console.warn(`[documento] derivar ${c.campo}: "${c.antes}" → "${c.despues}" (${c.motivo})`)
  }
  // Pasada 6: coherencia porcentual (IVA ↔ valor), sobre el valor ya derivado.
  for (const a of revisarCoherenciaPct(campos, resultado)) {
    console.warn(`[documento] coherencia_pct ${a.campo}: "${a.valor}" no cuadra con ${JSON.stringify(a.bases)}`)
  }
}
