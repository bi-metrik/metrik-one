/**
 * Bloque «Pagos ePayco» multi-pago (`config_extra.es_multi_pago`): qué cobros crear,
 * corregir o anular cuando se guardan sus filas.
 *
 * Hasta el 2026-10-19 el bloque se guardaba solo a los 800 ms y `autoCrearCobrosMulti`
 * creaba un cobro real por cada par (referencia, monto) que no existiera todavía. De ahí
 * tres defectos:
 *   - una pausa a mitad de la cifra («150» de 1.500.000) creaba un cobro de $150;
 *   - corregir un valor creaba otro cobro y dejaba el anterior;
 *   - borrar una fila no borraba su cobro.
 *
 * Ahora cada fila lleva un `id` estable y, una vez guardada, el `cobro_id` del cobro que
 * la respalda. Guardar compara contra eso, no contra (referencia, monto): editar una fila
 * corrige SU cobro, quitarla anula SU cobro, y una fila cuyo cobro ya confirmó la
 * financiera no se toca.
 *
 * Puro: no toca DB, red ni reloj.
 */

export interface FilaMultiPago {
  /** Estable desde que la fila nace en pantalla. */
  id: string
  referencia_epayco: string
  valor_pago: number | ''
  /** Cobro que respalda la fila, desde que se guardó. */
  cobro_id?: string | null
}

/** Un cobro del negocio, tal como hace falta para decidir. */
export interface CobroExistente {
  id: string
  external_ref: string | null
  monto: number
  /** La financiera ya lo confirmó (o tiene recibo emitido): no se corrige ni se anula. */
  bloqueado: boolean
}

export interface PlanGuardadoMulti {
  crear: Array<{ filaId: string; referencia: string; monto: number }>
  corregir: Array<{ cobroId: string; referencia: string; monto: number }>
  anular: Array<{ cobroId: string; referencia: string; montoAnterior: number }>
  /** Filas tal como quedan guardadas: con `cobro_id` las que ya lo tenían o lo adoptan. */
  filas: FilaMultiPago[]
  errores: string[]
}

const clave = (ref: string, monto: number) => `${ref.trim()}|${Math.round(monto)}`

/**
 * @param filas      lo que la persona quiere dejar guardado.
 * @param previas    las filas guardadas antes (de ahí salen los cobros que una fila quitada
 *                   tiene que anular).
 * @param existentes cobros vigentes del negocio.
 */
export function planearGuardadoMulti(
  filas: readonly FilaMultiPago[],
  previas: readonly FilaMultiPago[],
  existentes: readonly CobroExistente[],
): PlanGuardadoMulti {
  const errores: string[] = []
  const porId = new Map(existentes.map((c) => [c.id, c]))
  const usados = new Set<string>()

  filas.forEach((f, i) => {
    const n = i + 1
    if (!f.referencia_epayco.trim()) errores.push(`Fila ${n}: falta la referencia`)
    if (!(Number(f.valor_pago) > 0)) errores.push(`Fila ${n}: el valor tiene que ser mayor a cero`)
  })

  // Adopción: filas guardadas antes de este cambio no traen `cobro_id`. Se atan al cobro con
  // su misma referencia y monto que nadie más reclame (por multiplicidad, como antes).
  const reclamados = new Set(
    [...filas, ...previas].map((f) => f.cobro_id).filter((x): x is string => !!x && porId.has(x)),
  )
  const libres = new Map<string, string[]>()
  for (const c of existentes) {
    if (reclamados.has(c.id) || !c.external_ref) continue
    const k = clave(c.external_ref, c.monto)
    libres.set(k, [...(libres.get(k) ?? []), c.id])
  }
  const adoptar = (f: FilaMultiPago): string | null => {
    if (f.cobro_id && porId.has(f.cobro_id)) return f.cobro_id
    const lista = libres.get(clave(f.referencia_epayco, Number(f.valor_pago) || 0))
    return lista && lista.length > 0 ? lista.shift()! : null
  }
  const previasAdoptadas = previas.map((f) => ({ ...f, cobro_id: adoptar(f) }))
  const previaPorFila = new Map(previasAdoptadas.map((f) => [f.id, f]))

  const crear: PlanGuardadoMulti['crear'] = []
  const corregir: PlanGuardadoMulti['corregir'] = []
  const filasFinales: FilaMultiPago[] = []

  for (const f of filas) {
    const monto = Math.round(Number(f.valor_pago) || 0)
    const ref = f.referencia_epayco.trim()
    // (1) su cobro explícito; (2) el de la fila guardada con el mismo id; (3) el de una fila
    // guardada con la misma referencia y monto que nadie haya tomado (filas viejas sin id);
    // (4) un cobro suelto con esa referencia y monto.
    const deMismaPrevia = previaPorFila.get(f.id)?.cobro_id
    const gemela = previasAdoptadas.find((p) =>
      p.cobro_id && !usados.has(p.cobro_id) &&
      clave(p.referencia_epayco, Number(p.valor_pago) || 0) === clave(ref, monto))?.cobro_id
    const candidato = f.cobro_id && porId.has(f.cobro_id) ? f.cobro_id : deMismaPrevia ?? gemela ?? adoptar(f)
    const cobroId = candidato && !usados.has(candidato) ? candidato : null
    if (cobroId) {
      usados.add(cobroId)
      const c = porId.get(cobroId)!
      const cambio = Math.round(c.monto) !== monto || (c.external_ref ?? '').trim() !== ref
      if (cambio) {
        if (c.bloqueado) {
          errores.push(`El pago ${c.external_ref ?? ''} ya lo confirmó el área financiera: no se puede cambiar desde aquí.`)
        } else {
          corregir.push({ cobroId, referencia: ref, monto })
        }
      }
      filasFinales.push({ ...f, referencia_epayco: ref, valor_pago: monto, cobro_id: cobroId })
    } else {
      crear.push({ filaId: f.id, referencia: ref, monto })
      filasFinales.push({ ...f, referencia_epayco: ref, valor_pago: monto, cobro_id: null })
    }
  }

  // Filas que se quitaron: su cobro se anula, salvo que ya esté confirmado.
  const anular: PlanGuardadoMulti['anular'] = []
  for (const p of previasAdoptadas) {
    if (!p.cobro_id || usados.has(p.cobro_id)) continue
    const c = porId.get(p.cobro_id)
    if (!c) continue
    if (c.bloqueado) {
      errores.push(`El pago ${c.external_ref ?? ''} ya lo confirmó el área financiera: no se puede quitar desde aquí.`)
      continue
    }
    anular.push({ cobroId: c.id, referencia: c.external_ref ?? '', montoAnterior: c.monto })
  }

  return { crear, corregir, anular, filas: filasFinales, errores }
}

/** Una fila nueva en pantalla. */
export function filaNueva(id: string): FilaMultiPago {
  return { id, referencia_epayco: '', valor_pago: '', cobro_id: null }
}

/**
 * Las filas guardadas, con `id` aunque vengan de antes de este cambio (sin él no hay cómo
 * saber, al guardar, cuál fila se editó y cuál se quitó).
 */
export function filasConId(guardadas: ReadonlyArray<Partial<FilaMultiPago>>, nuevoId: () => string): FilaMultiPago[] {
  return guardadas.map((f) => ({
    id: typeof f.id === 'string' && f.id ? f.id : nuevoId(),
    referencia_epayco: String(f.referencia_epayco ?? ''),
    valor_pago: f.valor_pago === '' || f.valor_pago == null ? '' : Number(f.valor_pago),
    cobro_id: f.cobro_id ?? null,
  }))
}
