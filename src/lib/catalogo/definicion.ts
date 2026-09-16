/**
 * Esquema de un tipo de servicio del catálogo. **Es la única autoridad**: la Action del
 * cerebro no revalida nada por su cuenta, manda el archivo y ONE lo acepta o lo rechaza con
 * el motivo. Dos esquemas en dos repos se desincronizan, y el síntoma sería un archivo que
 * pasa en el cerebro y rebota en ONE, o peor, uno que pasa en los dos queriendo decir cosas
 * distintas.
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §3.2 (entrega A2).
 *
 * ## Decisiones que el esquema hace cumplir
 *
 * - **Nada nace con IVA del 19 %** (decisión de Mauricio del 2026-09-15: todo se vende como
 *   suscripción a servicios de computación en la nube, excluida de IVA). `tratamiento_iva` es
 *   obligatorio y no tiene valor por defecto: nadie lo hereda sin escribirlo. Si alguna vez un
 *   servicio se grava, hay que escribir `gravado` **y** su `iva_pct`: un `gravado` sin tarifa
 *   no pasa, porque un porcentaje ausente que caiga a 19 es justo lo que la decisión prohíbe.
 * - **La comisión NO vive en el catálogo.** N3 (2026-09-15): el porcentaje o el monto lo
 *   define cada negocio, no un valor global. Vive en `servicios_contratados.comision` y se
 *   calcula con `src/lib/servicios/comision.ts`. Una clave de comisión en un archivo de
 *   catálogo se rechaza, para que ese valor global no exista ni por descuido.
 * - **El módulo sale del catálogo de módulos** (`CLAVES_DE_MODULO`, entrega A1): un servicio
 *   que encendiera un módulo inexistente proyectaría una llave que nadie lee.
 *
 * Módulo puro: lo importan el receptor de `/api/catalogo/versiones` y sus pruebas.
 */
import { z } from 'zod'
import { CLAVES_DE_MODULO } from '@/lib/modulos/catalogo'

/** Cómo se dispara el cobro de este tipo de servicio (§4.2). */
export const DISPARADORES_COBRO = ['ciclo', 'consumo', 'unico'] as const

/**
 * Tratamiento de IVA. `excluido` es lo que hoy usa todo el catálogo; los otros dos existen
 * para que un cambio futuro se escriba, no para que alguien caiga en ellos.
 */
export const TRATAMIENTOS_IVA = ['excluido', 'exento', 'gravado'] as const

/** Tipos de parámetro que un contrato puede fijar. */
export const TIPOS_PARAMETRO = ['entero', 'cop', 'decimal', 'texto', 'booleano', 'lista'] as const

const SLUG = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'el slug va en minúsculas y con guiones: `licencia-clarity`')

const parametro = z
  .object({
    tipo: z.enum(TIPOS_PARAMETRO),
    min: z.number().optional(),
    max: z.number().optional(),
    por_defecto: z.union([z.number(), z.string(), z.boolean(), z.array(z.union([z.number(), z.string()]))]).optional(),
    // Para qué sirve el parámetro, en palabras. No es adorno: quien configure un contrato lo
    // ve en la ficha, y un parámetro sin explicación se llena mal.
    descripcion: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.min !== undefined && p.max !== undefined && p.min > p.max) {
      ctx.addIssue({ code: 'custom', message: `min ${p.min} es mayor que max ${p.max}` })
    }
    if (p.por_defecto === undefined) return
    // Un valor por defecto que el propio parámetro rechazaría es un contrato que nace inválido.
    const d = p.por_defecto
    const problema = (m: string) => ctx.addIssue({ code: 'custom', message: `por_defecto ${m}` })
    if (p.tipo === 'lista') {
      if (!Array.isArray(d)) problema('de un parámetro `lista` tiene que ser una lista')
      return
    }
    if (Array.isArray(d)) return problema(`es una lista pero el tipo es \`${p.tipo}\``)
    if (p.tipo === 'booleano' && typeof d !== 'boolean') return problema('tiene que ser true o false')
    if (p.tipo === 'texto' && typeof d !== 'string') return problema('tiene que ser texto')
    if (p.tipo === 'entero' || p.tipo === 'cop' || p.tipo === 'decimal') {
      if (typeof d !== 'number') return problema('tiene que ser un número')
      if ((p.tipo === 'entero' || p.tipo === 'cop') && !Number.isInteger(d)) {
        return problema('tiene que ser entero')
      }
      if (p.min !== undefined && d < p.min) return problema(`${d} está por debajo del min ${p.min}`)
      if (p.max !== undefined && d > p.max) return problema(`${d} está por encima del max ${p.max}`)
    }
  })

export const definicionServicio = z
  .object({
    // Que el archivo diga qué es. Un `.md` cualquiera del cerebro que llegue por error a la
    // Action se rechaza aquí y no por "faltan campos", que mandaría a buscar el problema lejos.
    tipo: z.literal('servicio'),
    slug: SLUG,
    version: z.number().int().min(1),
    nombre: z.string().min(1),
    modulo: z.enum(CLAVES_DE_MODULO as [string, ...string[]]),
    disparador_cobro: z.enum(DISPARADORES_COBRO),
    tratamiento_iva: z.enum(TRATAMIENTOS_IVA),
    /** Solo con `gravado`. Sin valor por defecto: ver la cabecera. */
    iva_pct: z.number().min(0).max(100).optional(),
    /** Slug de la decisión o regla del cerebro que fija el precio de lista. **No** el precio. */
    precios_lista_fuente: z.string().min(1),
    /**
     * Slug de la decisión del cerebro que fija el tratamiento de IVA. Obligatorio: el IVA no
     * se escribe de memoria, ni siquiera cuando la respuesta es «excluido». La Action del
     * cerebro comprueba que los dos slugs existan como archivo antes de enviar (es lo único
     * que ella puede verificar y ONE no, porque ONE no tiene el sistema de archivos del
     * cerebro).
     */
    tratamiento_iva_fuente: z.string().min(1),
    parametros: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), parametro),
    /** Documentos contractuales, cada uno como `slug@version`. */
    documentos: z.array(z.string().regex(/^[a-z0-9-]+@\d+\.\d+$/, 'un documento se cita como `slug@1.0`')).default([]),
    /** Texto corto para la pantalla del cliente. */
    descripcion: z.string().min(1).optional(),
    activo: z.boolean().default(true),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.tratamiento_iva === 'gravado' && d.iva_pct === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['iva_pct'],
        message:
          'un servicio `gravado` declara su `iva_pct`: sin él, la tarifa la pondría quien lea, ' +
          'y la decisión del 2026-09-15 es que nada nace con 19 %',
      })
    }
    if (d.tratamiento_iva !== 'gravado' && d.iva_pct !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['iva_pct'],
        message: `\`iva_pct\` no aplica con tratamiento \`${d.tratamiento_iva}\``,
      })
    }
  })

export type DefinicionServicio = z.infer<typeof definicionServicio>

/**
 * Claves que un archivo de catálogo NO puede traer, con el motivo.
 *
 * Cada mensaje se explica solo: quien lo lea en el registro de la Action tiene que poder
 * corregir sin abrir otro archivo. Por eso no hay «ídem»: un mensaje que remite a otro
 * mensaje deja al que corrige buscando.
 */
const MOTIVO_COMISION =
  'la comisión la define cada negocio o contrato, no el catálogo (N3 del 2026-09-15): ' +
  'un valor aquí sería el valor global que esa decisión prohíbe. ' +
  'Va en `servicios_contratados.comision`, y la calcula `src/lib/servicios/comision.ts`.'

const CLAVES_PROHIBIDAS: Record<string, string> = {
  comision: MOTIVO_COMISION,
  comision_pct: MOTIVO_COMISION,
  comision_monto: MOTIVO_COMISION,
  precio:
    'el catálogo cita la decisión que fija el precio de lista (`precios_lista_fuente`), no lo copia; ' +
    'copiarlo deja dos precios que se separan. El precio pactado va en los parámetros del contrato.',
}

export interface ResultadoValidacion {
  ok: boolean
  definicion?: DefinicionServicio
  errores: string[]
}

/**
 * Valida el frontmatter ya leído. Devuelve todos los errores juntos: quien escribe el archivo
 * corrige una vez, no una por corrida.
 */
export function validarDefinicion(crudo: unknown): ResultadoValidacion {
  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) {
    return { ok: false, errores: ['el frontmatter no es un mapa de claves'] }
  }

  const prohibidas = Object.keys(crudo as object)
    .filter((k) => k in CLAVES_PROHIBIDAS)
    .map((k) => `${k}: ${CLAVES_PROHIBIDAS[k]}`)
  if (prohibidas.length > 0) return { ok: false, errores: prohibidas }

  const r = definicionServicio.safeParse(crudo)
  if (!r.success) {
    return {
      ok: false,
      errores: r.error.issues.map((i) => {
        const donde = i.path.length > 0 ? i.path.join('.') : '(raíz)'
        return `${donde}: ${i.message}`
      }),
    }
  }
  return { ok: true, definicion: r.data, errores: [] }
}
