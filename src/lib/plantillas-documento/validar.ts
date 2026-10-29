/**
 * Validación de una plantilla contra el catálogo de su documento.
 *
 * - `errores`: no se puede GUARDAR (estructura mal cerrada, variable o condición que no
 *   existe, variable de titular fuera de su bloque…).
 * - `faltantes`: requisitos mínimos del documento que la plantilla no usa. Se puede
 *   guardar como borrador, pero NO activar.
 */
import { defDe, type TipoPlantilla } from './catalogo'
import { parsearPlantilla, type Bloque, type Documento, type ErrorPlantilla, type Inline } from './sintaxis'

export interface ResultadoValidacion {
  doc: Documento
  errores: ErrorPlantilla[]
  /** Etiquetas de los requisitos que faltan (bloquean la activación). */
  faltantes: string[]
}

interface Ambito {
  enTitular: boolean
  enSi: boolean
  enFirmas: boolean
}

export function validarPlantilla(tipo: TipoPlantilla, contenido: string): ResultadoValidacion {
  const def = defDe(tipo)
  const { doc, errores } = parsearPlantilla(contenido)
  const vars = new Set(def.variables.map((v) => v.nombre))
  const varsTitular = new Set(def.variablesTitular.map((v) => v.nombre))
  const conds = new Set(def.condiciones.map((c) => c.nombre))
  const condsTitular = new Set(def.condicionesTitular.map((c) => c.nombre))
  /** Variables (y `@firmas`) usadas FUERA de cualquier {{#si}}: las que siempre salen. */
  const seguras = new Set<string>()

  const revisarCond = (cond: string, linea: number, a: Ambito) => {
    if (!cond) return // el parser ya reportó la condición vacía
    if (condsTitular.has(cond)) {
      if (!a.enTitular) errores.push({ linea, mensaje: `«${cond}» solo vale dentro de {{#cada titular}} o {{#firmas}}.` })
      return
    }
    if (!conds.has(cond)) errores.push({ linea, mensaje: `Condición desconocida «${cond}».` })
  }

  const revisarCada = (de: string, linea: number, a: Ambito) => {
    if (de !== 'titular') errores.push({ linea, mensaje: `Solo existe {{#cada titular}} (llegó «${de || 'vacío'}»).` })
    if (a.enTitular) errores.push({ linea, mensaje: 'No se puede repetir por titular dentro de otra repetición por titular.' })
  }

  const recorrerInline = (nodos: Inline[], a: Ambito) => {
    for (const n of nodos) {
      switch (n.t) {
        case 'var':
          if (varsTitular.has(n.nombre)) {
            if (!a.enTitular) errores.push({ linea: n.linea, mensaje: `{{${n.nombre}}} solo vale dentro de {{#cada titular}} o {{#firmas}}.` })
          } else if (!vars.has(n.nombre)) {
            errores.push({ linea: n.linea, mensaje: `Variable desconocida {{${n.nombre}}}.` })
          }
          if (!a.enSi) seguras.add(n.nombre)
          break
        case 'negrita':
          recorrerInline(n.hijos, a)
          break
        case 'si':
          revisarCond(n.cond, n.linea, a)
          recorrerInline(n.si, { ...a, enSi: true })
          recorrerInline(n.sino, { ...a, enSi: true })
          break
        case 'cada':
          revisarCada(n.de, n.linea, a)
          recorrerInline(n.hijos, { ...a, enTitular: true })
          break
      }
    }
  }

  const recorrer = (bloques: Bloque[], a: Ambito) => {
    for (const b of bloques) {
      switch (b.t) {
        case 'parrafo':
        case 'titulo':
          recorrerInline(b.hijos, a)
          break
        case 'tabla':
          for (const fila of b.filas) for (const c of fila) recorrerInline(c.hijos, a)
          break
        case 'linea_firma':
          break
        case 'alineado':
        case 'junto':
          recorrer(b.hijos, a)
          break
        case 'firmas':
          if (a.enTitular || a.enFirmas) errores.push({ linea: b.linea, mensaje: '{{#firmas}} no va dentro de otra repetición por titular.' })
          if (!a.enSi) seguras.add('@firmas')
          recorrer(b.hijos, { ...a, enTitular: true, enFirmas: true })
          break
        case 'si':
          revisarCond(b.cond, b.linea, a)
          recorrer(b.si, { ...a, enSi: true })
          recorrer(b.sino, { ...a, enSi: true })
          break
        case 'cada':
          revisarCada(b.de, b.linea, a)
          recorrer(b.hijos, { ...a, enTitular: true })
          break
      }
    }
  }

  recorrer(doc.bloques, { enTitular: false, enSi: false, enFirmas: false })

  const faltantes = def.requisitos
    .filter((r) => !r.alguna.some((v) => seguras.has(v)))
    .map((r) => r.etiqueta)

  errores.sort((x, y) => x.linea - y.linea)
  return { doc, errores, faltantes }
}

/** Mensaje corto para la persona con los primeros errores. */
export function resumenErrores(errores: ErrorPlantilla[], max = 5): string {
  const lista = errores.slice(0, max).map((e) => `Renglón ${e.linea}: ${e.mensaje}`)
  if (errores.length > max) lista.push(`… y ${errores.length - max} más.`)
  return lista.join('\n')
}
