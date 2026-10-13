/**
 * Recorridos de un valor jsonb para el espacio de pruebas: quitar credenciales, cambiar ids
 * de la cliente por los de la copia y encontrar lo que parece un dato personal.
 *
 * Puro. Lo usan el plan (`plan.ts`) y su prueba.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function esUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

/** Copia `valor` sin las llaves que casan con `llave` (a cualquier profundidad). Devuelve las rutas quitadas. */
export function sinLlaves(valor: unknown, llave: RegExp, ruta = ''): { valor: unknown; quitadas: string[] } {
  const quitadas: string[] = []
  const ir = (v: unknown, r: string): unknown => {
    if (Array.isArray(v)) return v.map((x, i) => ir(x, `${r}[${i}]`))
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const rk = r ? `${r}.${k}` : k
        if (llave.test(k)) {
          quitadas.push(rk)
          continue
        }
        out[k] = ir(x, rk)
      }
      return out
    }
    return v
  }
  return { valor: ir(valor, ruta), quitadas }
}

/**
 * Cambia todo string que sea un id conocido por el que le toca en la copia, a cualquier
 * profundidad (columnas y jsonb por igual: así una llave foránea o un `staff_ids` dentro de
 * un `config_extra` se resuelven con la misma regla, sin tener que nombrarlos).
 */
export function remapear(valor: unknown, mapa: ReadonlyMap<string, string>): unknown {
  if (typeof valor === 'string') return mapa.get(valor.toLowerCase()) ?? valor
  if (Array.isArray(valor)) return valor.map(v => remapear(v, mapa))
  if (valor && typeof valor === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) out[k] = remapear(v, mapa)
    return out
  }
  return valor
}

/** Los uuid que aparecen en `valor`, con su ruta. */
export function uuidsEn(valor: unknown, ruta = ''): { ruta: string; uuid: string }[] {
  const out: { ruta: string; uuid: string }[] = []
  const ir = (v: unknown, r: string) => {
    if (esUuid(v)) out.push({ ruta: r, uuid: v.toLowerCase() })
    else if (Array.isArray(v)) v.forEach((x, i) => ir(x, `${r}[${i}]`))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) ir(x, r ? `${r}.${k}` : k)
  }
  ir(valor, ruta)
  return out
}

const CORREO = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/i
const TELEFONO = /(?:\+?\d[\s-]?){10,}/

/**
 * Las rutas donde hay algo que parece un correo o un teléfono. No se imprime el valor: el
 * simulacro solo dice DÓNDE, para que quien lo revisa decida.
 */
export function pareceDatoPersonal(valor: unknown, ruta = ''): { ruta: string; tipo: 'correo' | 'telefono' }[] {
  const out: { ruta: string; tipo: 'correo' | 'telefono' }[] = []
  const ir = (v: unknown, r: string) => {
    if (typeof v === 'string') {
      if (esUuid(v)) return
      if (CORREO.test(v)) out.push({ ruta: r, tipo: 'correo' })
      else if (TELEFONO.test(v)) out.push({ ruta: r, tipo: 'telefono' })
    } else if (Array.isArray(v)) v.forEach((x, i) => ir(x, `${r}[${i}]`))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) ir(x, r ? `${r}.${k}` : k)
  }
  ir(valor, ruta)
  return out
}
