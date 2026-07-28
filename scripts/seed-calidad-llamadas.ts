/**
 * Seed de la muestra de calidad de llamadas para el workspace `regat`.
 *
 * Contenido:
 *   - 1 llamada REAL auditada (Felipe Sandoval, 65:14, tecnica 73, ROJO) con sus
 *     7 bloques, 6 banderas con cita y segundo, y los eventos de contexto que
 *     alimentan la cinta temporal.
 *   - 1 llamada SIMULADA (agente ficticio Diego Rincon, 9:00, tecnica 36, ROJO)
 *     con la misma estructura. El remate de la muestra es 73 contra 36 y las dos
 *     en ROJO: el problema no es del agente, es del proceso.
 *   - 96 llamadas de relleno para dar volumen, sin transcripcion.
 *   - Cobertura del dia + ~10 dias previos.
 *   - 6 cuotas de dinero (tabla sensible, solo la ve el dueno).
 *
 * DETERMINISTA. El relleno usa un PRNG sembrado por indice, nunca Math.random():
 * cada ensayo de la reunion tiene que mostrar exactamente los mismos numeros.
 *
 * Idempotente por LOTE: borra el lote previo antes de insertar.
 *
 * Uso:
 *   npx tsx scripts/seed-calidad-llamadas.ts
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!URL || !KEY) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const svc = createClient(URL, KEY, { auth: { persistSession: false } })

const SLUG = 'regat'
const LOTE = 'muestra-2026-07'

/** Dia de la muestra. Fijo: la demo no puede cambiar de numeros segun el dia. */
const DIA = '2026-05-21'

// ── PRNG determinista ───────────────────────────────────────────────────────
//
// mulberry32 sembrado por indice. Mismo indice → misma secuencia, siempre.
// Math.random() haria que cada ensayo de la reunion mostrara datos distintos.
function prng(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const entre = (r: () => number, min: number, max: number) => min + Math.floor(r() * (max - min + 1))
const elegir = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]

// ── Llamada real: Felipe Sandoval ───────────────────────────────────────────

const BLOQUES_REAL = [
  { orden: 1, nombre: 'Apertura e identificación', puntaje: 10, puntaje_max: 10 },
  { orden: 2, nombre: 'Descubrimiento', puntaje: 24, puntaje_max: 25 },
  { orden: 3, nombre: 'Escucha y control', puntaje: 4, puntaje_max: 15 },
  { orden: 4, nombre: 'Educación técnica', puntaje: 19, puntaje_max: 20 },
  { orden: 5, nombre: 'Propuesta y precio', puntaje: 4, puntaje_max: 10 },
  { orden: 6, nombre: 'Manejo de objeciones', puntaje: 4, puntaje_max: 10 },
  { orden: 7, nombre: 'Cierre y próximos pasos', puntaje: 8, puntaje_max: 10 },
]

/**
 * Las seis banderas de la llamada real.
 *
 * `titulo` y `hecho` se enuncian SIEMPRE como hecho verificable con minuto,
 * nunca como calificacion juridica. Es la regla del memo de Emilio (2026-07-27):
 * MeTRIK no dictamina derecho estadounidense. "El codigo de seguridad se pidio
 * en 24:57 dentro de una llamada anunciada como grabada", no "viola el estandar
 * de tarjetas".
 */
const HALLAZGOS_REAL = [
  {
    codigo: 'C1',
    severidad: 'critica',
    segundo: 1497,
    titulo: 'Código de seguridad pedido en llamada grabada',
    hecho:
      'El código de seguridad se pidió en el minuto 24:57, dentro de una llamada anunciada como grabada. Antes se pidieron los dieciséis dígitos (21:09) y el número de ruta (23:03).',
    cita: 'en el respaldo de la tarjeta por la parte de atrás vas a poder identificar un código CCV',
  },
  {
    codigo: 'C2',
    severidad: 'critica',
    segundo: 3582,
    titulo: 'Afirmación de resultado sobre el puntaje',
    hecho:
      'En 59:42 se afirma un resultado sobre el puntaje. Es una afirmación en futuro, sin condicional.',
    cita: 'que pasen a ser positivos, por ende tu crédito va a empezar a aumentar',
  },
  {
    codigo: 'C3',
    severidad: 'alta',
    segundo: 18,
    titulo: 'Motivo del contacto afirmado antes de tener el reporte',
    hecho:
      'En 00:18 se afirman notificaciones sobre el historial de la clienta. El reporte de crédito se obtuvo 31 minutos después, en 31:44.',
    cita:
      'han generado algunas notificaciones a partir de su historial crediticio por algún tipo de alteración o malas facturaciones',
  },
  {
    codigo: 'C4',
    severidad: 'alta',
    segundo: 2919,
    titulo: 'Plan de pago cerrado antes del contrato',
    hecho:
      'El plan de pago se cerró y se dictó fecha por fecha en 48:39. El contrato se enviaría al día siguiente por WhatsApp.',
    cita:
      'el día de mañana el departamento de customer service le estaría enviando la información y el contrato vía WhatsApp',
  },
  {
    codigo: 'C5',
    severidad: 'media',
    segundo: 2639,
    titulo: 'Beneficio condicionado a cerrar hoy',
    hecho:
      'En 43:59 se condiciona el beneficio a cerrar hoy y se advierte que después las cuotas serían más altas.',
    cita:
      'si esperamos hasta el siguiente mes, las aportaciones... a veces son de doscientos, doscientos cincuenta, trescientos',
  },
  {
    codigo: 'C6',
    severidad: 'media',
    segundo: 1582,
    titulo: 'Seguro Social solicitado en voz alta',
    hecho:
      'En 26:22 se solicita el Seguro Social completo. En 01:03:33 el propio agente lo recita en voz alta para revalidarlo.',
    cita: 'indícame tu número de seguro social completo',
  },
]

/**
 * Eventos de contexto de la llamada real. No levantan bandera, pero son el
 * argumento central de la muestra: los datos de pago se piden en el minuto 20 y
 * el reporte de credito llega en el 27. Eso no lo decide el agente, lo decide el
 * procedimiento. Sin estos puntos la cinta no cuenta la historia.
 */
const EVENTOS_REAL = [
  { segundo: 0, titulo: 'Se anuncia que la llamada está siendo grabada.' },
  { segundo: 1249, titulo: 'El agente pide a la clienta que tome su tarjeta.' },
  { segundo: 1383, titulo: 'Se pide el número de ruta y tránsito del banco.' },
  { segundo: 1661, titulo: 'Recién aquí se solicita el reporte de crédito.' },
  { segundo: 1904, titulo: 'Se presenta el diagnóstico del reporte.' },
  { segundo: 3555, titulo: 'La clienta pregunta cómo funciona el servicio que ya aceptó pagar.' },
]

// ── Llamada simulada: Diego Rincón (ficticio) ───────────────────────────────

const DUR_SIM = 540
const TURNOS_SIM = 28
/** Reparte los 540 s entre los 28 turnos del guion para anclar cada hallazgo. */
const segDeTurno = (turno: number) => Math.round(((turno - 1) / TURNOS_SIM) * DUR_SIM)

const BLOQUES_SIM = [
  { orden: 1, nombre: 'Apertura e identificación', puntaje: 4, puntaje_max: 10 },
  { orden: 2, nombre: 'Descubrimiento', puntaje: 9, puntaje_max: 25 },
  { orden: 3, nombre: 'Escucha y control', puntaje: 4, puntaje_max: 15 },
  { orden: 4, nombre: 'Educación técnica', puntaje: 8, puntaje_max: 20 },
  { orden: 5, nombre: 'Propuesta y precio', puntaje: 3, puntaje_max: 10 },
  { orden: 6, nombre: 'Manejo de objeciones', puntaje: 3, puntaje_max: 10 },
  { orden: 7, nombre: 'Cierre y próximos pasos', puntaje: 5, puntaje_max: 10 },
]

const HALLAZGOS_SIM = [
  {
    codigo: 'C2',
    severidad: 'critica',
    segundo: segDeTurno(7),
    turno_ref: 'turnos 7 y 9',
    titulo: 'Resultado garantizado sobre el puntaje',
    hecho:
      'En el turno 7 se ofrecen 100 puntos garantizados y en el 9 se afirma que todo lo negativo sale del reporte.',
    cita: 'le garantizo que en tres meses usted ve el score arriba, unos 100 puntos fácil',
  },
  {
    codigo: 'C1',
    severidad: 'critica',
    segundo: segDeTurno(17),
    turno_ref: 'turnos 17 a 22',
    titulo: 'Tarjeta completa pedida en llamada sin aviso de grabación',
    hecho:
      'Entre los turnos 17 y 22 se piden los dieciséis dígitos, la fecha de vencimiento y el código de seguridad. La llamada abrió sin aviso de grabación.',
    cita: 'Deme los 16 dígitos de la tarjeta.',
  },
  {
    codigo: 'C4',
    severidad: 'alta',
    segundo: segDeTurno(23),
    turno_ref: 'turnos 23 y 25',
    titulo: 'Cobro anunciado antes de entregar el contrato',
    hecho:
      'En el turno 23 los documentos se enviarán después; en el 25 se anuncia que el cobro entra hoy o mañana.',
    cita: 'Hoy mismo o mañana le entra. Ahí queda activo el proceso.',
  },
  {
    codigo: 'C5',
    severidad: 'media',
    segundo: segDeTurno(15),
    turno_ref: 'turno 15',
    titulo: 'Tarifa alterna sin sustento para cerrar hoy',
    hecho:
      'En el turno 15 se afirma que la tarifa es la de hoy y que la semana siguiente sube a 1.200.',
    cita: 'esta tarifa es la de hoy. Si lo dejamos para la otra semana ya le toca en 1.200',
  },
  {
    codigo: 'C6',
    severidad: 'media',
    segundo: segDeTurno(18),
    turno_ref: 'turnos 17 a 22',
    titulo: 'Datos de pago tomados sin verificar identidad del titular',
    hecho:
      'Entre los turnos 17 y 22 se toman los datos de pago sin haber verificado la identidad del titular.',
    cita: '¿Le parece si lo dejamos activo entonces? Deme los 16 dígitos de la tarjeta.',
  },
]

const EVENTOS_SIM = [
  { segundo: 0, titulo: 'La llamada abre sin aviso de grabación.' },
  { segundo: segDeTurno(3), titulo: 'El agente se identifica a medias, sin nombre completo ni empresa completa.' },
  { segundo: segDeTurno(11), titulo: 'El cliente menciona otro programa activo y el agente lo descarta sin explorar.' },
  { segundo: segDeTurno(14), titulo: 'El cliente pide entender el servicio antes de dar la tarjeta.' },
  { segundo: segDeTurno(27), titulo: 'El agente cierra con el cliente todavía preguntando.' },
]

// ── Relleno ─────────────────────────────────────────────────────────────────

/** Agentes ficticios del relleno. Ninguno tiene cuenta: agente_staff_id = NULL. */
const AGENTES_RELLENO = [
  'Diego Rincón',
  'Karina Villalba',
  'Óscar Peñaloza',
  'Tatiana Bermúdez',
  'Héctor Salgado',
  'Liliana Prieto',
]

const CODIGOS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] as const
const SEVERIDAD_POR_CODIGO: Record<string, string> = {
  C1: 'critica', C2: 'critica', C3: 'alta', C4: 'alta', C5: 'media', C6: 'media',
}
const TITULO_POR_CODIGO: Record<string, string> = {
  C1: 'Datos de tarjeta pedidos en llamada grabada',
  C2: 'Afirmación de resultado sobre el puntaje',
  C3: 'Motivo del contacto afirmado antes de tener el reporte',
  C4: 'Plan de pago cerrado antes del contrato',
  C5: 'Beneficio condicionado a cerrar hoy',
  C6: 'Dato sensible solicitado en voz alta',
}

async function main() {
  // ── Workspace ─────────────────────────────────────────────────────────────
  const { data: ws, error: eWs } = await svc
    .from('workspaces')
    .select('id')
    .eq('slug', SLUG)
    .single()
  if (eWs || !ws) throw new Error(`No existe el workspace ${SLUG}. Correr antes setup-regat-workspace.ts`)
  const workspaceId = ws.id as string

  // ── staff de Felipe: POR profile_id, no por nombre ────────────────────────
  //
  // Este es el paso que rompe la demo si se hace mal. getWorkspace() auto-crea
  // un registro `staff` cuando el usuario autenticado no tiene uno; si el seed
  // apunta a un staff distinto del que resuelve la app, Felipe entra a
  // /calidad y ve CERO llamadas. Se resuelve por profile_id (exactamente lo
  // mismo que hace getWorkspace) y se aborta si no cuadra.
  const { data: perfilFelipe } = await svc
    .from('profiles')
    .select('id, full_name, role')
    .eq('workspace_id', workspaceId)
    .eq('full_name', 'Felipe Sandoval')
    .maybeSingle()
  if (!perfilFelipe) throw new Error('No hay profile de Felipe Sandoval en el workspace.')

  const { data: staffFelipeTodos } = await svc
    .from('staff')
    .select('id, is_active')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', perfilFelipe.id)

  const activos = (staffFelipeTodos ?? []).filter((s) => s.is_active)
  if (activos.length !== 1) {
    throw new Error(
      `Se esperaba exactamente 1 staff activo para el profile de Felipe y hay ${activos.length}. ` +
        `getWorkspace() resuelve por (profile_id, is_active) con maybeSingle: con 0 o con 2 la vista ` +
        `del ejecutor queda vacia o apunta al registro equivocado. Resolver antes de seedear.`,
    )
  }
  const staffFelipe = activos[0].id as string
  console.log(`staff Felipe   profile=${perfilFelipe.id}  staff=${staffFelipe}`)

  // ── Borrado del lote previo (idempotencia) ────────────────────────────────
  //
  // bloques y hallazgos caen por ON DELETE CASCADE desde calidad_llamadas.
  const { data: previas } = await svc
    .from('calidad_llamadas')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('lote', LOTE)
  if (previas && previas.length > 0) {
    await svc.from('calidad_llamadas').delete().eq('workspace_id', workspaceId).eq('lote', LOTE)
    console.log(`lote previo    ${previas.length} llamadas borradas`)
  }
  await svc.from('calidad_cobertura_dia').delete().eq('workspace_id', workspaceId)
  await svc.from('calidad_dinero_cuotas').delete().eq('workspace_id', workspaceId)

  const llamadas: Record<string, unknown>[] = []
  const bloques: Record<string, unknown>[] = []
  const hallazgos: Record<string, unknown>[] = []

  const nuevoId = () => crypto.randomUUID()

  // ── 1. Llamada real ───────────────────────────────────────────────────────
  const idReal = nuevoId()
  llamadas.push({
    id: idReal,
    workspace_id: workspaceId,
    cliente_ref: 'LL-0000',
    fecha_hora: `${DIA}T17:23:01-05:00`,
    direccion: 'entrante',
    duracion_seg: 3914,
    agente_staff_id: staffFelipe,
    agente_nombre: 'Felipe Sandoval',
    puntaje_tecnico: 73,
    semaforo: 'rojo',
    habla_agente_pct: 73.7,
    habla_cliente_pct: 26.3,
    turnos: 450,
    repreguntas: 11,
    monologos_45s: 15,
    detalle_completo: true,
    es_real: true,
    lote: LOTE,
  })
  for (const b of BLOQUES_REAL) {
    bloques.push({ workspace_id: workspaceId, llamada_id: idReal, ...b })
  }
  for (const h of HALLAZGOS_REAL) {
    hallazgos.push({ workspace_id: workspaceId, llamada_id: idReal, eje: 'cumplimiento', ...h })
  }
  for (const e of EVENTOS_REAL) {
    hallazgos.push({ workspace_id: workspaceId, llamada_id: idReal, eje: 'tecnica', ...e })
  }

  // ── 2. Llamada simulada ───────────────────────────────────────────────────
  const idSim = nuevoId()
  llamadas.push({
    id: idSim,
    workspace_id: workspaceId,
    cliente_ref: 'LL-0099',
    fecha_hora: `${DIA}T16:02:00-05:00`,
    direccion: 'saliente',
    duracion_seg: DUR_SIM,
    agente_staff_id: null,
    agente_nombre: 'Diego Rincón',
    puntaje_tecnico: 36,
    semaforo: 'rojo',
    habla_agente_pct: 81.0,
    habla_cliente_pct: 19.0,
    turnos: TURNOS_SIM,
    repreguntas: 0,
    monologos_45s: 3,
    detalle_completo: true,
    es_real: false,
    lote: LOTE,
  })
  for (const b of BLOQUES_SIM) {
    bloques.push({ workspace_id: workspaceId, llamada_id: idSim, ...b })
  }
  for (const h of HALLAZGOS_SIM) {
    hallazgos.push({ workspace_id: workspaceId, llamada_id: idSim, eje: 'cumplimiento', ...h })
  }
  for (const e of EVENTOS_SIM) {
    hallazgos.push({ workspace_id: workspaceId, llamada_id: idSim, eje: 'tecnica', ...e })
  }

  // ── 3. 96 de relleno ──────────────────────────────────────────────────────
  //
  // Distribucion objetivo ~18% verde / 34% amarillo / 48% rojo. Se reparte por
  // posicion (no por sorteo) para que el conteo sea exacto y estable; el PRNG
  // solo decide puntaje, duracion, hora y banderas dentro de cada franja.
  //
  // ~15 quedan asignadas al staff real de Felipe para que su vista de ejecutor
  // tenga volumen; el resto va con agente_staff_id NULL → un ejecutor no las ve
  // por construccion.
  const N = 96
  const nVerde = 17
  const nAmarillo = 33
  for (let i = 0; i < N; i++) {
    const r = prng(1000 + i)
    const semaforo = i < nVerde ? 'verde' : i < nVerde + nAmarillo ? 'amarillo' : 'rojo'

    const tecnica =
      semaforo === 'verde' ? entre(r, 74, 92) : semaforo === 'amarillo' ? entre(r, 62, 84) : entre(r, 38, 81)

    // Las primeras 15 del relleno son de Felipe (tiene cuenta); el resto, de los
    // agentes ficticios sin cuenta.
    const esDeFelipe = i < 15
    const agenteNombre = esDeFelipe ? 'Felipe Sandoval' : elegir(r, AGENTES_RELLENO)

    const hora = entre(r, 8, 18)
    const minuto = entre(r, 0, 59)
    const idx = i + 1
    const id = nuevoId()

    llamadas.push({
      id,
      workspace_id: workspaceId,
      cliente_ref: `LL-${String(idx).padStart(4, '0')}`,
      fecha_hora: `${DIA}T${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00-05:00`,
      direccion: r() < 0.55 ? 'entrante' : 'saliente',
      duracion_seg: entre(r, 480, 4200),
      agente_staff_id: esDeFelipe ? staffFelipe : null,
      agente_nombre: agenteNombre,
      puntaje_tecnico: tecnica,
      semaforo,
      habla_agente_pct: null,
      habla_cliente_pct: null,
      turnos: null,
      repreguntas: null,
      monologos_45s: null,
      // Sin transcripcion: no hay pantalla de detalle para estas.
      detalle_completo: false,
      es_real: false,
      lote: LOTE,
    })

    // 0 a 3 banderas, agregadas: sin cita y sin segundo real (segundo = 0).
    const nBanderas = semaforo === 'verde' ? 0 : semaforo === 'amarillo' ? entre(r, 1, 2) : entre(r, 1, 3)
    const usados = new Set<string>()
    for (let k = 0; k < nBanderas; k++) {
      // Verde no llega aqui. Amarillo nunca levanta critica (C1/C2): eso es lo
      // que hace que el semaforo signifique algo.
      const pool = semaforo === 'amarillo' ? (['C3', 'C4', 'C5', 'C6'] as const) : CODIGOS
      let cod = elegir(r, pool)
      let intentos = 0
      while (usados.has(cod) && intentos < 8) {
        cod = elegir(r, pool)
        intentos++
      }
      if (usados.has(cod)) continue
      usados.add(cod)
      hallazgos.push({
        workspace_id: workspaceId,
        llamada_id: id,
        eje: 'cumplimiento',
        codigo: cod,
        severidad: SEVERIDAD_POR_CODIGO[cod],
        titulo: TITULO_POR_CODIGO[cod],
        hecho: null,
        cita: null,
        segundo: 0,
      })
    }
  }

  // ── Insercion ─────────────────────────────────────────────────────────────
  const enLotes = async (tabla: string, filas: Record<string, unknown>[]) => {
    for (let i = 0; i < filas.length; i += 200) {
      const { error } = await svc.from(tabla).insert(filas.slice(i, i + 200))
      if (error) throw new Error(`${tabla}: ${error.message}`)
    }
  }
  await enLotes('calidad_llamadas', llamadas)
  await enLotes('calidad_llamadas_bloques', bloques)
  await enLotes('calidad_llamadas_hallazgos', hallazgos)
  console.log(
    `insertado      ${llamadas.length} llamadas · ${bloques.length} bloques · ${hallazgos.length} hallazgos`,
  )

  // ── Cobertura ─────────────────────────────────────────────────────────────
  //
  // Hoy: 100 recibidas, 100 auditadas, baseline 5 (lo que se audita a mano).
  // Los ~10 dias previos son el contrafactual: auditadas ~= 5% de recibidas.
  const cobertura: Record<string, unknown>[] = [
    { workspace_id: workspaceId, fecha: DIA, recibidas: 100, auditadas: 100, baseline_manual: 5 },
  ]
  for (let d = 1; d <= 10; d++) {
    const r = prng(500 + d)
    const fecha = new Date(`${DIA}T12:00:00Z`)
    fecha.setUTCDate(fecha.getUTCDate() - d)
    const recibidas = entre(r, 82, 118)
    cobertura.push({
      workspace_id: workspaceId,
      fecha: fecha.toISOString().slice(0, 10),
      recibidas,
      auditadas: Math.max(3, Math.round(recibidas * 0.05)),
      baseline_manual: Math.max(3, Math.round(recibidas * 0.05)),
    })
  }
  const { error: eCob } = await svc.from('calidad_cobertura_dia').insert(cobertura)
  if (eCob) throw new Error(`cobertura: ${eCob.message}`)
  console.log(`cobertura      ${cobertura.length} dias`)

  // ── Dinero por cuota ──────────────────────────────────────────────────────
  //
  // 37 ventas de US$799 en 6 cuotas. El recaudo cae de ~100% en la cuota 1 a
  // ~48% en la cuota 6. Es el punto de Sofia: el piso celebra la venta, pero la
  // venta no termina cuando el agente cierra, termina en la cuota 6.
  const VENTAS = 37
  const PRECIO = 799
  const CUOTA = PRECIO / 6
  const PCT = [1.0, 0.89, 0.78, 0.66, 0.57, 0.48]
  const dinero = PCT.map((pct, i) => ({
    workspace_id: workspaceId,
    cuota: i + 1,
    ventas: Math.round(VENTAS * pct),
    vendido_usd: Number((VENTAS * CUOTA).toFixed(2)),
    recaudado_usd: Number((VENTAS * CUOTA * pct).toFixed(2)),
  }))
  const { error: eDin } = await svc.from('calidad_dinero_cuotas').insert(dinero)
  if (eDin) throw new Error(`dinero: ${eDin.message}`)
  console.log(`dinero         ${dinero.length} cuotas`)

  // ── Verificacion: suma(bloques) == puntaje_tecnico ────────────────────────
  const sumaReal = BLOQUES_REAL.reduce((a, b) => a + b.puntaje, 0)
  const sumaSim = BLOQUES_SIM.reduce((a, b) => a + b.puntaje, 0)
  if (sumaReal !== 73) throw new Error(`suma(bloques) real = ${sumaReal}, se esperaba 73`)
  if (sumaSim !== 36) throw new Error(`suma(bloques) simulada = ${sumaSim}, se esperaba 36`)
  console.log(`verificado     suma(bloques) real=${sumaReal} simulada=${sumaSim}`)

  const porSemaforo = llamadas.reduce<Record<string, number>>((acc, l) => {
    const s = l.semaforo as string
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})
  console.log(`semáforos      ${JSON.stringify(porSemaforo)}`)
  console.log(
    `de Felipe      ${llamadas.filter((l) => l.agente_staff_id === staffFelipe).length} llamadas`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
