/**
 * Campos del CONTACTO editables desde dentro de un negocio (bloque `contacto`).
 *
 * Por que existe: el perfil de la persona y su autorizacion de tratamiento de datos
 * son del contacto, no del negocio. Vivian como bloques de la etapa 1 de Trappvel, asi
 * que un cliente recurrente volvia a teclear en cada viaje lo que ya habia dado la
 * primera vez, y la autorizacion se registraba una vez por negocio en lugar de una vez
 * por persona. El bloque `contacto` lee y escribe la ficha del contacto; lo que se
 * escribe queda en `contactos`, no en `negocio_bloques.data`.
 *
 * Dos destinos dentro de `contactos`:
 *  · columnas nativas (nombre, email, telefono, rol, segmento) — las que ya tienen
 *    semantica en el directorio y en los listados.
 *  · `custom_data` — todo lo demas, que es perfil declarado por linea de negocio y no
 *    merece una columna por cliente.
 *
 * El vocabulario de campos (slug/label/tipo) es el mismo de `BloqueDatos` a proposito:
 * la configuracion de una linea no deberia cambiar de idioma segun donde se guarde el
 * dato.
 */

/**
 * Columnas de `contactos` escribibles desde el bloque. Todo lo demas va a `custom_data`.
 *
 * Son SOLO las tres de identidad. `segmento` y `rol` quedaron fuera aunque parezcan
 * candidatas obvias: las dos tienen CHECK en la base y ninguna significa lo que un
 * bloque de negocio querria escribir ahi.
 *
 *  · `segmento` es el estado del EMBUDO ('primer_contacto', 'conectado', 'convertido'…),
 *    no una tipologia de cliente. Configurar ahi un "leisure / corporativo" rebota contra
 *    `contactos_segmento_check`, y si los valores casualmente pasaran, el bloque estaria
 *    pisando la posicion del contacto en el funnel desde dentro de un viaje.
 *  · `rol` es el rol en la venta ('decisor', 'influenciador'…), con su propio CHECK.
 *
 * Una tipologia de cliente va a `custom_data` y ahi no colisiona con nada. Si alguna
 * merece columna propia, se agrega con su migracion y se suma a esta lista.
 */
export const CAMPOS_NATIVOS = ['nombre', 'email', 'telefono'] as const

export type CampoNativo = (typeof CAMPOS_NATIVOS)[number]

export function esCampoNativo(slug: string): slug is CampoNativo {
  return (CAMPOS_NATIVOS as readonly string[]).includes(slug)
}

export interface CampoContacto {
  slug: string
  label: string
  tipo: 'texto' | 'email' | 'telefono' | 'numero' | 'fecha' | 'toggle' | 'select' | 'textarea'
  required?: boolean
  options?: string[]
  ayuda?: string
}

/** Estado de la ficha del contacto tal como lo ve el bloque. */
export interface ValoresContacto {
  nombre: string
  email: string | null
  telefono: string | null
  rol: string | null
  segmento: string | null
  custom_data: Record<string, unknown>
}

/**
 * Valor de un campo, mire donde mire. Un nativo ausente y un `custom_data` ausente
 * devuelven ambos `null`: el bloque no distingue "columna vacia" de "clave que nadie
 * escribio", porque para quien llena el formulario son la misma cosa.
 */
export function leerCampo(valores: ValoresContacto, slug: string): unknown {
  if (esCampoNativo(slug)) return valores[slug] ?? null
  return valores.custom_data?.[slug] ?? null
}

/**
 * Parte los valores enviados por el formulario en los dos destinos.
 *
 * `nombre` es la unica columna NOT NULL de `contactos`: un nombre vacio no se escribe,
 * se descarta. Borrar el nombre del contacto desde un bloque de negocio nunca es la
 * intencion y la base lo rechazaria con un error que no dice nada.
 */
export function separarCampos(values: Record<string, unknown>): {
  nativos: Record<string, unknown>
  custom: Record<string, unknown>
} {
  const nativos: Record<string, unknown> = {}
  const custom: Record<string, unknown> = {}
  for (const [slug, valor] of Object.entries(values)) {
    if (!esCampoNativo(slug)) {
      custom[slug] = valor
      continue
    }
    if (slug === 'nombre' && (valor === null || valor === undefined || String(valor).trim() === '')) {
      continue
    }
    nativos[slug] = valor === '' ? null : valor
  }
  return { nativos, custom }
}

// ── Autorizacion de tratamiento de datos ───────────────────────────────────────

/**
 * La autorizacion se firma UNA vez por persona, no una por viaje. Por eso vive en el
 * contacto y el negocio solo la consulta.
 *
 * No hay vencimiento implementado y no se inventa uno: la Ley 1581 no fija un plazo, y
 * poner una vigencia arbitraria aqui invalidaria autorizaciones reales sin que nadie lo
 * haya decidido. Si Trappvel define una, entra como parametro de la linea y este archivo
 * es el unico sitio que cambia.
 */
export const AUTORIZACION_SLUG = 'autorizacion_datos'
export const AUTORIZACION_FECHA_SLUG = 'autorizacion_datos_fecha'
export const AUTORIZACION_AUTOR_SLUG = 'autorizacion_datos_por'

export interface EstadoAutorizacion {
  autorizado: boolean
  fecha: string | null
  autor: string | null
}

/**
 * Lee el estado de autorizacion del `custom_data` del contacto.
 *
 * Un `true` sin fecha SI cuenta como autorizado: la fecha es trazabilidad, no la
 * autorizacion. Descartarlo por falta de fecha bloquearia contactos migrados desde
 * Airtable, donde el dato viene sin estampa.
 */
export function estadoAutorizacion(custom: Record<string, unknown> | null | undefined): EstadoAutorizacion {
  const bruto = custom?.[AUTORIZACION_SLUG]
  const autorizado = bruto === true || bruto === 'true' || bruto === 1
  const fecha = custom?.[AUTORIZACION_FECHA_SLUG]
  const autor = custom?.[AUTORIZACION_AUTOR_SLUG]
  return {
    autorizado,
    fecha: autorizado && typeof fecha === 'string' && fecha !== '' ? fecha : null,
    autor: autorizado && typeof autor === 'string' && autor !== '' ? autor : null,
  }
}
