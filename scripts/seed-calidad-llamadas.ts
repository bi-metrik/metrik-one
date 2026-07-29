/**
 * Seed de la muestra de calidad de llamadas para el workspace `regat`.
 *
 * Contenido:
 *   - 1 llamada REAL auditada (Felipe Sandoval, 65:14, tecnica 73, ROJO) con sus
 *     7 bloques, 6 banderas con cita y segundo, y los eventos de contexto que
 *     alimentan la cinta temporal.
 *   - 1 llamada SIMULADA (guion ficticio, 9:00, tecnica 36, ROJO)
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

/**
 * Dia ancla = el dia de la DEMO, no el dia en que se corre el seed.
 *
 * La presentacion a Regat es el viernes 31 de julio de 2026. El seed siembra
 * ese dia como "hoy" y 30 dias hacia atras, asi que:
 *
 *   - El 31 tiene el dia completo y las DOS llamadas con detalle (la real de
 *     Felipe y la simulada), que es cuando se va a entrar al detalle desde el
 *     muro.
 *   - La vista de semana del viernes cubre lunes a viernes completos.
 *   - Los dias intermedios quedan sembrados, asi que la pantalla funciona
 *     cualquier dia de esa semana y no solo el viernes. Nadie tiene que
 *     acordarse de correr el seed esa mañana.
 *
 * Los dias posteriores a hoy existen en la base pero NO se ven: la RPC corta
 * en la fecha actual (ver la migracion `20260728000007`). Hoy el muro muestra
 * hoy; el viernes mostrara el viernes.
 *
 * Parametrizable a proposito: si la reunion se mueve es cambiar este valor (o
 * pasar la fecha como argumento), no editar logica.
 *
 *   npx tsx scripts/seed-calidad-llamadas.ts 2026-08-07
 *
 * Esto NO rompe el determinismo: el PRNG esta sembrado por indice, asi que dos
 * corridas producen exactamente los mismos numeros. Lo unico que se mueve al
 * cambiar el ancla es en que fechas caen.
 */
const ANCLA_POR_DEFECTO = '2026-07-31'
const DIA = process.argv[2] ?? process.env.CALIDAD_ANCLA ?? ANCLA_POR_DEFECTO

if (!/^\d{4}-\d{2}-\d{2}$/.test(DIA)) {
  console.error(`Fecha ancla invalida: "${DIA}". Formato esperado YYYY-MM-DD.`)
  process.exit(1)
}

/**
 * Fecha y hora VERDADERAS de la grabacion auditada. Esta no se mueve.
 *
 * La llamada se muestra en el dia ancla para que el muro tenga contenido, pero
 * el detalle dice de cuando es la grabacion de verdad. El workspace esta
 * rotulado como demostracion, asi que reubicarla es legitimo; perder la fecha
 * real no lo es.
 */
const GRABACION_REAL = '2026-05-21T17:23:01-05:00'

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

// ── Llamada simulada (guion ficticio) ───────────────────────────────────────

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

/**
 * Perfiles de agente para el relleno.
 *
 * NO es un sorteo: cada agente tiene su reparto de semaforo, su tasa de cierre
 * y su afinidad por la tarjeta. Un sorteo uniforme produce siete agentes
 * mediocres iguales y el ranking del muro no dice nada; lo que hace util esa
 * pantalla es el CONTRASTE, y el contraste hay que diseñarlo.
 *
 * Los dos casos que sostienen el argumento:
 *   - Felipe: el que mas cierra y esta en ROJO. Es la conversacion del dia, y
 *     no es invento: su llamada real auditada da 73 de tecnica y semaforo rojo.
 *   - Tatiana: pocas llamadas, todas limpias, todos sus cierres con tarjeta.
 *     Es la que hoy nadie ve porque el Excel del televisor solo cuenta ventas.
 *
 * Los totales de semaforo suman exactamente el objetivo global del relleno
 * (17 verde / 33 amarillo / 46 rojo sobre 96), asi que la distribucion general
 * no cambia: solo cambia COMO se reparte entre personas.
 *
 * Los nombres NO se tocan (decision de Mauricio): que el relleno tenga un
 * "Felipe" que coincide con el agente de la llamada real auditada es
 * deliberado: es la misma persona.
 */
const PERFILES_AGENTE = [
  // nombre, llamadas, [verde, amarillo, rojo], cierres, de esos con tarjeta
  //
  // CUATRO AGENTES, no siete: Sergio confirmo que Regat tiene cuatro de
  // ventas. Cada uno sostiene una parte del argumento y ninguno sobra:
  //   Felipe  — la llamada real auditada; el caso de referencia.
  //   Oscar   — viene bajando; el agente que necesita reentrenamiento.
  //   Hector  — viene subiendo; la prueba de que tambien detecta mejora.
  //   Tatiana — la limpia; sin ella el semaforo no significa nada porque
  //             todos serian rojos y el color dejaria de ordenar.
  //
  // EL VOLUMEN TOTAL NO CAMBIA, se reparte entre cuatro: 96 llamadas al dia,
  // 21 cierres, 9 con tarjeta — los mismos que con siete. Eso sube a cada
  // agente de ~400 a ~700 llamadas al mes, que es alto y se sabe: el dato real
  // de Sergio esta pendiente y cuando llegue se ajusta la escala, no el
  // elenco.
  { nombre: 'Felipe Sandoval',  llamadas: 28, semaforos: [2, 7, 19],  cierres: 8, tarjeta: 2 },
  { nombre: 'Tatiana Bermúdez', llamadas: 15, semaforos: [15, 0, 0],  cierres: 5, tarjeta: 5 },
  { nombre: 'Óscar Peñaloza',   llamadas: 28, semaforos: [4, 11, 13], cierres: 5, tarjeta: 2 },
  { nombre: 'Héctor Salgado',   llamadas: 25, semaforos: [2, 11, 12], cierres: 3, tarjeta: 0 },
] as const

/** Precio del programa, del guion real: US$799 en seis cuotas o de una vez. */
const PRECIO_PROGRAMA = 799

/**
 * Dias de operacion que se siembran, contando hoy.
 *
 * El muro rota entre dia, semana y mes. Con un solo dia sembrado, dos de las
 * tres pantallas salen en blanco. Treinta dias es lo minimo para que la vista
 * de mes signifique algo: por debajo de eso no alcanza a distinguirse un mal
 * dia de un patron, que es justamente lo que la pantalla tiene que mostrar.
 *
 * El dia de hoy NO se genera con esta maquinaria: se siembra aparte, con sus
 * semillas y sus `cliente_ref` originales, para que los numeros que ya se
 * revisaron en pantalla no se muevan ni un digito.
 */
const DIAS_HISTORIA = 30

/**
 * Agentes cuyo puntaje se mueve a lo largo del periodo.
 *
 * POR QUE EXISTE. La pantalla de perfil promete responder si un agente esta
 * mejorando o empeorando. Con todos los agentes planos la respuesta es siempre
 * "estable": la pantalla es honesta pero no demuestra lo que promete, y el caso
 * que Mauricio pidio con nombre propio — el agente que se deteriora y necesita
 * reentrenamiento — no existe en ningun lado.
 *
 * LA TENDENCIA ES REAL EN EL DATO, NO UNA ETIQUETA. Aqui solo se inclina el
 * puntaje de las llamadas; el detector estadistico del perfil (pendiente contra
 * su propio error estandar) la encuentra solo, sin que se le toque un umbral.
 * Si hubiera que aflojar el detector para que apareciera, estaria mal hecho: lo
 * que se diseña es el dato.
 *
 * QUIENES. Dos ficticios, y por dos razones explicitas:
 *   - El que BAJA no es Felipe. Su llamada real es de un dia puntual; colgarle
 *     una caida sostenida seria afirmar sobre una persona real algo que no
 *     podemos sostener.
 *   - El que SUBE no es Tatiana. Ya es la referencia limpia del ranking; si
 *     ademas viniera subiendo seria un personaje demasiado perfecto para
 *     creerselo.
 *
 * LA MEDIA NO SE MUEVE. La deriva se centra en la mitad del periodo, asi que
 * suma cero a lo largo de los 30 dias: el promedio mensual del agente, y con el
 * su fila del ranking del muro, se queda donde estaba. Lo que cambia es COMO se
 * reparte ese promedio en el tiempo, que es justo lo que la pantalla mide. El
 * dia suelto SI se mueve, y tiene que moverse: una tendencia que no se nota en
 * ningun corte no es una tendencia.
 */
const TENDENCIAS: Record<string, number> = {
  // Puntos de tecnica por dia. Positivo = viene bajando (empeora con el
  // tiempo); negativo = viene subiendo. 0,6 al dia son ~18 puntos de punta a
  // punta en 30 dias: se ve la inclinacion en el grafico sin que la nube deje
  // de solaparse, que es lo que la mantiene creible. Una recta perfecta se lee
  // como dato inventado; el jitter por llamada la conserva sucia, con buenos
  // dias por el camino.
  'Óscar Peñaloza': 0.6,
  'Héctor Salgado': -0.6,
}

/**
 * La deriva, ya resuelta a numeros enteros y con la media intacta.
 *
 * Inclinar el puntaje es facil; hacerlo SIN mover el promedio del mes no lo es
 * tanto. Dos trampas, las dos medidas contra la base:
 *
 *   1. Centrar en la mitad del calendario (dia 14,5) no basta: el volumen
 *      diario varia, asi que el centro tiene que ser el dia medio PONDERADO POR
 *      LLAMADAS. Con eso la deriva suma cero sobre las llamadas que el agente
 *      realmente hizo.
 *
 *   2. Aun centrada, redondear deja sesgo. La deriva de un dia es la MISMA para
 *      todas las llamadas de ese dia, asi que al redondear se empujan todas
 *      hacia el mismo lado y el error no se cancela entre dias: en la primera
 *      version eso movio dos casillas del ranking mensual un punto (Oscar 68→69,
 *      Hector 66→65). Se corrige repartiendo el residuo entero entre llamadas
 *      sueltas, de a un punto, empezando por los dias donde el redondeo se
 *      equivoco mas.
 *
 * El resultado es una inclinacion visible en el grafico con el promedio del mes
 * exacto: el ranking del muro que Mauricio ya reviso no se mueve.
 */
type PlanTendencia = { offset: number[]; correccion: number[]; signo: number }
const planCache = new Map<string, PlanTendencia | null>()

function planTendencia(nombre: string): PlanTendencia | null {
  const cacheado = planCache.get(nombre)
  if (cacheado !== undefined) return cacheado

  const k = TENDENCIAS[nombre]
  if (!k) {
    planCache.set(nombre, null)
    return null
  }

  const iPerfil = PERFILES_AGENTE.findIndex((p) => p.nombre === nombre)
  const perfil = PERFILES_AGENTE[iPerfil]

  // Llamadas por dia. El dia 0 no pasa por planDelDia: usa el plan base.
  const n: number[] = new Array(DIAS_HISTORIA).fill(0)
  n[0] = perfil.llamadas
  for (let d = 1; d < DIAS_HISTORIA; d++) n[d] = planDelDia(perfil, iPerfil, d).llamadas

  const total = n.reduce((a, b) => a + b, 0)
  const centro = n.reduce((a, nd, d) => a + nd * d, 0) / total

  const real = n.map((_, d) => k * (d - centro))
  const offset = real.map((v) => Math.round(v))

  // Residuo entero que dejo el redondeo, en puntos-llamada.
  let resto = offset.reduce((a, o, d) => a + n[d] * o, 0)
  const signo = resto > 0 ? -1 : 1
  let falta = Math.abs(resto)

  // Se corrige donde el redondeo mas se equivoco, para que la curva quede lo
  // mas cerca posible de la recta que se diseño.
  const correccion: number[] = new Array(DIAS_HISTORIA).fill(0)
  const porError = offset
    .map((o, d) => ({ d, error: (o - real[d]) * signo }))
    .sort((a, b) => b.error - a.error || a.d - b.d)
  for (const { d } of porError) {
    if (falta <= 0) break
    const toma = Math.min(n[d], falta)
    correccion[d] = toma
    falta -= toma
  }
  resto = 0

  const plan = { offset, correccion, signo }
  planCache.set(nombre, plan)
  return plan
}

/**
 * Cuantos dias ANTES del ancla se muestran las dos llamadas auditadas.
 *
 * No van en el dia ancla. Si van ahi, la lista —que corta el futuro— las
 * esconde hasta el dia de la presentacion, y no se puede ni ensayar ni
 * revisar antes. Puestas unos dias atras son visibles hoy Y el viernes, en la
 * lista y en la vista de semana.
 *
 * Cuatro dias: dentro de la semana en cualquiera de los dos momentos, y lejos
 * del borde por si el ancla se mueve un dia.
 */
const DIAS_ANTES_AUDITADAS = 4

/** Fecha (YYYY-MM-DD) a `d` dias antes del dia ancla. */
function fechaOffset(d: number): string {
  const f = new Date(`${DIA}T12:00:00Z`)
  f.setUTCDate(f.getUTCDate() - d)
  return f.toISOString().slice(0, 10)
}

type PerfilAgente = (typeof PERFILES_AGENTE)[number]
type PlanDia = { llamadas: number; semaforos: number[]; cierres: number; tarjeta: number }

/**
 * Cuanto trabaja y como le va a un agente en un dia del pasado.
 *
 * La regla de diseño es una sola: **el caracter del agente no cambia, el
 * volumen si**. Lo que varia dia a dia es cuantas llamadas tomo y cuantas
 * cerro; el reparto de semaforo conserva las proporciones de su perfil, y el
 * jitter solo mueve llamadas entre colores que el perfil YA tiene.
 *
 * Esa ultima condicion es la que hace util la vista de mes: Tatiana (8/0/0)
 * nunca gana un rojo por sorteo, asi que su limpieza se sostiene en el tiempo
 * en vez de ser la suerte de un dia. Si el jitter pudiera introducir un color
 * nuevo, el mes promediaria ruido y las tres pantallas dirian lo mismo.
 */
function planDelDia(perfil: PerfilAgente, iPerfil: number, d: number): PlanDia {
  const r = prng(900000 + d * 97 + iPerfil)

  const factor = 0.75 + r() * 0.45 // 0.75 – 1.20
  const llamadas = Math.max(4, Math.round(perfil.llamadas * factor))

  // Proporciones del perfil, escaladas al volumen del dia.
  const base = perfil.semaforos as unknown as number[]
  const total = base.reduce((a, b) => a + b, 0)
  const sem = base.map((n) => Math.floor((n / total) * llamadas))
  // El sobrante del redondeo va al color dominante del agente: es su caracter.
  const dominante = base.indexOf(Math.max(...base))
  sem[dominante] += llamadas - sem.reduce((a, b) => a + b, 0)

  // Jitter: mueve UNA llamada entre dos colores que el perfil ya tiene.
  const presentes = base.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0)
  if (presentes.length > 1) {
    const desde = elegir(r, presentes)
    const hacia = elegir(r, presentes.filter((i) => i !== desde))
    if (sem[desde] > 1) {
      sem[desde] -= 1
      sem[hacia] += 1
    }
  }

  const cierres = Math.min(
    llamadas,
    Math.max(0, Math.round(perfil.cierres * factor * (0.7 + r() * 0.6))),
  )
  const propTarjeta = perfil.cierres > 0 ? perfil.tarjeta / perfil.cierres : 0
  const tarjeta = Math.min(cierres, Math.round(cierres * propTarjeta))

  return { llamadas, semaforos: sem, cierres, tarjeta }
}

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

  // En hora de BOGOTA, no UTC: pasadas las 19:00 locales `toISOString()` ya
  // reporta el dia siguiente y la linea diria que hoy es mañana. Es el mismo
  // error de zona que hacia agrupar las llamadas de la noche en el dia
  // equivocado; la RPC ya usa `America/Bogota` y este log tiene que coincidir.
  const hoyReal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  console.log(
    `dia ancla      ${DIA}  (día de la demo)` +
      (DIA > hoyReal ? `  ·  hoy es ${hoyReal}: el muro mostrará hoy hasta que llegue el ancla` : ''),
  )

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
  await svc.from('calidad_recobro_dia').delete().eq('workspace_id', workspaceId)

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
    // Unos dias antes del ancla, conservando su hora real (17:23): asi es
    // visible hoy y sigue estandolo el dia de la presentacion.
    fecha_hora: `${fechaOffset(DIAS_ANTES_AUDITADAS)}T17:23:01-05:00`,
    // Y la fecha verdadera de la grabacion queda registrada aparte.
    fecha_grabacion: GRABACION_REAL,
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
    // Cerro venta POR CUENTA: el plan que se dicta fecha por fecha en 48:39 es
    // 5x$120 + $199 = $799 en seis cuotas, y en 23:03 se toma el numero de ruta
    // y transito del banco. Es el caso de riesgo: promesa a seis cuotas, no caja.
    cerro_venta: true,
    forma_pago: 'cuenta',
    monto_usd: PRECIO_PROGRAMA,
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
    fecha_hora: `${fechaOffset(DIAS_ANTES_AUDITADAS)}T16:02:00-05:00`,
    // Guion simulado: no hay grabacion que fechar.
    fecha_grabacion: null,
    direccion: 'saliente',
    duracion_seg: DUR_SIM,
    agente_staff_id: null,
    // La simulada pasa a Oscar. Con un elenco de cuatro, dejarla a nombre de
    // "Diego" metia un quinto agente al ranking con UNA sola llamada: una fila
    // fantasma que no resiste la primera mirada. Y ademas cuadra: la peor
    // llamada auditada es del agente que viene bajando.
    agente_nombre: 'Óscar Peñaloza',
    puntaje_tecnico: 36,
    semaforo: 'rojo',
    habla_agente_pct: 81.0,
    habla_cliente_pct: 19.0,
    turnos: TURNOS_SIM,
    repreguntas: 0,
    monologos_45s: 3,
    detalle_completo: true,
    es_real: false,
    // Cerro venta POR TARJETA: entre los turnos 17 y 22 toma los 16 digitos, el
    // vencimiento y el codigo de seguridad, y en el 25 anuncia que el cobro
    // entra hoy o manana. Caja inmediata... y bandera critica en la misma
    // llamada. Ese es el punto: cobrar bien y exponer a la empresa no son cosas
    // opuestas.
    cerro_venta: true,
    forma_pago: 'tarjeta',
    monto_usd: PRECIO_PROGRAMA,
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

  // ── 3. Relleno de un dia, por perfil de agente ────────────────────────────
  //
  // Se genera agente por agente segun el plan del dia: cada uno aporta su
  // reparto exacto de semaforo, sus cierres y su mezcla de forma de pago. El
  // PRNG decide puntaje, duracion, hora y que banderas caen — nunca a quien le
  // toca que.
  //
  // Las de Felipe llevan su `agente_staff_id` real: son las que ve en su vista
  // de ejecutor. Las de los agentes ficticios van con NULL, asi que un ejecutor
  // no las ve por construccion.
  //
  // `semilla` y `ref` entran como parametro para que el dia de hoy conserve
  // EXACTAMENTE las suyas (1000+idx y LL-0001…): los numeros de esa pantalla ya
  // se revisaron y no se pueden mover al agregar historia detras.
  function sembrarDia(opts: {
    fecha: string
    /** Dias hacia atras desde el ancla. 0 = hoy. Lo usa la deriva. */
    offset: number
    planes: { perfil: PerfilAgente; plan: PlanDia }[]
    semilla: (idx: number) => number
    ref: (idx: number) => string
  }): Record<string, unknown>[] {
    const delDia: Record<string, unknown>[] = []
    let idx = 0

    for (const { perfil, plan } of opts.planes) {
      const [nVerde, nAmarillo] = plan.semaforos
      const esFelipe = perfil.nombre === 'Felipe Sandoval'

      // Llamadas del agente, con su semaforo ya asignado por posicion.
      // Se guarda `ref` (el cliente_ref) porque el desempate de cierres tiene
      // que ser determinista: el `id` es un UUID aleatorio y usarlo para
      // ordenar hace que dos corridas repartan las tarjetas distinto.
      const delAgente: { id: string; ref: string; semaforo: string; tecnica: number }[] = []

      for (let j = 0; j < plan.llamadas; j++) {
        const r = prng(opts.semilla(idx))
        const semaforo = j < nVerde ? 'verde' : j < nVerde + nAmarillo ? 'amarillo' : 'rojo'
        const base =
          semaforo === 'verde' ? entre(r, 74, 92)
          : semaforo === 'amarillo' ? entre(r, 62, 84)
          : entre(r, 38, 81)
        // La deriva es la misma para todas las llamadas del dia (salvo el ajuste
        // de un punto que cuadra la media), asi que practicamente no altera cual
        // llamada cierra: el orden por tecnica dentro del dia se conserva.
        const tend = planTendencia(perfil.nombre)
        const deriva = tend
          ? tend.offset[opts.offset] + (j < tend.correccion[opts.offset] ? tend.signo : 0)
          : 0
        const tecnica = Math.max(0, Math.min(100, base + deriva))

        const hora = entre(r, 8, 18)
        const minuto = entre(r, 0, 59)
        const id = nuevoId()
        idx += 1
        const ref = opts.ref(idx)

        const fila = {
          id,
          workspace_id: workspaceId,
          cliente_ref: ref,
          fecha_hora: `${opts.fecha}T${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00-05:00`,
          fecha_grabacion: null,
          direccion: r() < 0.55 ? 'entrante' : 'saliente',
          duracion_seg: entre(r, 480, 4200),
          agente_staff_id: esFelipe ? staffFelipe : null,
          agente_nombre: perfil.nombre,
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
          // Se decide abajo, cuando ya estan todas las del agente.
          cerro_venta: false,
          forma_pago: null as string | null,
          monto_usd: null as number | null,
          lote: LOTE,
        }
        delDia.push(fila)
        delAgente.push({ id, ref, semaforo, tecnica })

        // 0 a 3 banderas, agregadas: sin cita y sin segundo real (segundo = 0).
        const nBanderas = semaforo === 'verde' ? 0 : semaforo === 'amarillo' ? entre(r, 1, 2) : entre(r, 1, 3)
        const usados = new Set<string>()
        for (let k = 0; k < nBanderas; k++) {
          // Verde no llega aqui. Amarillo nunca levanta critica (C1/C2): eso es
          // lo que hace que el semaforo signifique algo.
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

      // ── Cierres del agente ─────────────────────────────────────────────
      //
      // Cierran las de mejor tecnica, y de esas las mejores llevan tarjeta. No
      // es una ley del negocio, es una regla legible y determinista: una
      // llamada bien llevada tiene mas chance de cerrar, y la tarjeta se
      // consigue cuando la conversacion fue solida. Sergio no da tasas
      // ("depende de la base"), asi que el mix se diseña, no se estima.
      // Desempate por `ref`, NUNCA por `id`: el id es un UUID aleatorio y
      // ordenar por el hace que dos corridas repartan las tarjetas distinto.
      const orden = [...delAgente].sort((a, b) => b.tecnica - a.tecnica || a.ref.localeCompare(b.ref))
      const porId = new Map(delDia.map((l) => [l.id as string, l]))
      for (let c = 0; c < plan.cierres && c < orden.length; c++) {
        const fila = porId.get(orden[c].id)!
        fila.cerro_venta = true
        fila.forma_pago = c < plan.tarjeta ? 'tarjeta' : 'cuenta'
        fila.monto_usd = PRECIO_PROGRAMA
      }
    }

    return delDia
  }

  // ── 3a. Hoy ───────────────────────────────────────────────────────────────
  //
  // Semillas y refs originales: esta es la pantalla que ya se reviso.
  const rellenoHoy = sembrarDia({
    fecha: DIA,
    offset: 0,
    planes: PERFILES_AGENTE.map((perfil) => ({
      perfil,
      plan: {
        llamadas: perfil.llamadas,
        semaforos: perfil.semaforos as unknown as number[],
        cierres: perfil.cierres,
        tarjeta: perfil.tarjeta,
      },
    })),
    // `semilla` recibe el indice ANTES de incrementar y `ref` despues: asi
    // quedan 1000+0 para la primera llamada y LL-0001 para su referencia,
    // identico a como se sembro la pantalla que ya se reviso.
    semilla: (idx) => 1000 + idx,
    ref: (idx) => `LL-${String(idx).padStart(4, '0')}`,
  })
  llamadas.push(...rellenoHoy)

  // OJO: aqui NO se decide que es "el dia ancla". Se decide abajo, agrupando
  // por la fecha real de cada llamada.
  //
  // Antes esta linea era `[...llamadas]` — el relleno del dia mas las dos
  // auditadas, que entonces vivian en el ancla. Al moverlas cuatro dias atras,
  // la variable siguio contandolas como del ancla y el resumen empezo a
  // reportar 98 llamadas y 23 cierres donde la base tenia 96 y 21. Peor: ese
  // mismo conteo alimenta `calidad_cobertura_dia`, asi que la cobertura del
  // ancla contaba dos llamadas que ya no estaban ahi.
  //
  // La leccion, que vale mas que el arreglo: el resumen que uno usa para
  // verificar tiene que derivarse del DATO, no de la variable que uno creia
  // que lo representaba. Si no, la comprobacion hereda el mismo supuesto que
  // el codigo.

  // ── 3b. Historia ──────────────────────────────────────────────────────────
  //
  // Los dias previos existen para que el muro pueda rotar a semana y a mes.
  // Nada de esto se ve en el detalle: son llamadas sin transcripcion, y las dos
  // auditadas siguen siendo de hoy.
  //
  // NOTA ABIERTA: se siembran los 30 dias corridos, sin calendario laboral.
  // Sergio no dijo si operan fines de semana y no vamos a inventarle una
  // jornada al cliente; el volumen varia dia a dia pero ningun dia queda en
  // cero. Si confirma que no operan domingos, es una linea aqui.
  for (let d = 1; d < DIAS_HISTORIA; d++) {
    const fecha = fechaOffset(d)
    const filas = sembrarDia({
      fecha,
      offset: d,
      planes: PERFILES_AGENTE.map((perfil, i) => ({ perfil, plan: planDelDia(perfil, i, d) })),
      semilla: (idx) => 200000 + d * 5000 + idx,
      ref: (idx) => `LL-D${String(d).padStart(2, '0')}-${String(idx).padStart(4, '0')}`,
    })
    llamadas.push(...filas)
  }

  // Cuantas llamadas quedaron en cada dia, contadas por su FECHA REAL. Cubre
  // cualquier llamada que se mueva de dia sin que haya que acordarse de
  // ajustar el conteo a mano.
  const porDia = new Map<string, number>()
  for (const l of llamadas) {
    const f = String(l.fecha_hora).slice(0, 10)
    porDia.set(f, (porDia.get(f) ?? 0) + 1)
  }

  /** Las del dia ancla: lo que se proyecta el dia de la demo. */
  const llamadasHoy = llamadas.filter((l) => String(l.fecha_hora).slice(0, 10) === DIA)
  console.log(`historia       ${DIAS_HISTORIA} dias · ${llamadas.length} llamadas en total`)

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
  // Recibidas = auditadas = las llamadas realmente sembradas ESE dia, para que
  // el sello del muro ("98 de 98 auditadas") cuadre con la lista y con el
  // ranking. Si se pone un redondo a mano, la pantalla se contradice sola.
  //
  // `baseline_manual` es el contrafactual: lo que alcanzaban a escuchar a mano,
  // ~5% de las recibidas. Antes ese 5% se ponia en `auditadas` para los dias
  // previos, pero ahora esos dias TIENEN sus llamadas auditadas sembradas (la
  // vista de mes las agrega): decir que solo se auditaron 5 mientras el ranking
  // del mes suma 2.900 seria contradecirse en la misma pantalla. El argumento
  // no se pierde, vive donde corresponde.
  const cobertura = [...porDia.entries()].map(([fecha, n]) => ({
    workspace_id: workspaceId,
    fecha,
    recibidas: n,
    auditadas: n,
    baseline_manual: Math.max(3, Math.round(n * 0.05)),
  }))
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

  // ── Ciclo de recobro ──────────────────────────────────────────────────────
  //
  // "Cuando hacen un debito y el pago no se ve efectivo, se ve fondos
  // insuficientes, se reporta y ellos tienen que volver a llamarle."
  // Es trabajo real que hoy nadie cuantifica. Solo aplica a los cierres por
  // cuenta: la tarjeta se cobro de una vez y no rebota.
  const CUOTA_CUENTA = PRECIO_PROGRAMA / 6
  const recobro: Record<string, unknown>[] = [
    {
      workspace_id: workspaceId,
      fecha: DIA,
      debitos_rebotados: 4,
      pendientes_recobro: 3,
      monto_en_riesgo_usd: Number((4 * CUOTA_CUENTA).toFixed(2)),
    },
  ]
  for (let d = 1; d < DIAS_HISTORIA; d++) {
    const r = prng(700 + d)
    const rebotados = entre(r, 1, 6)
    recobro.push({
      workspace_id: workspaceId,
      fecha: fechaOffset(d),
      debitos_rebotados: rebotados,
      pendientes_recobro: entre(r, 0, rebotados),
      monto_en_riesgo_usd: Number((rebotados * CUOTA_CUENTA).toFixed(2)),
    })
  }
  const { error: eRec } = await svc.from('calidad_recobro_dia').insert(recobro)
  if (eRec) throw new Error(`recobro: ${eRec.message}`)
  console.log(`recobro        ${recobro.length} dias`)

  // ── Verificacion: suma(bloques) == puntaje_tecnico ────────────────────────
  const sumaReal = BLOQUES_REAL.reduce((a, b) => a + b.puntaje, 0)
  const sumaSim = BLOQUES_SIM.reduce((a, b) => a + b.puntaje, 0)
  if (sumaReal !== 73) throw new Error(`suma(bloques) real = ${sumaReal}, se esperaba 73`)
  if (sumaSim !== 36) throw new Error(`suma(bloques) simulada = ${sumaSim}, se esperaba 36`)
  console.log(`verificado     suma(bloques) real=${sumaReal} simulada=${sumaSim}`)

  const porSemaforo = llamadasHoy.reduce<Record<string, number>>((acc, l) => {
    const s = l.semaforo as string
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})
  console.log(`semáforos ${DIA}  ${JSON.stringify(porSemaforo)}`)
  console.log(
    `de Felipe      ${llamadasHoy.filter((l) => l.agente_staff_id === staffFelipe).length} hoy · ` +
      `${llamadas.filter((l) => l.agente_staff_id === staffFelipe).length} en el mes`,
  )

  // ── Verificacion: el ranking tiene que producir el contraste ──────────────
  //
  // Se comprueba, no se espera. Si un cambio de perfiles deja al primero en
  // cierres en verde, o deja a todos en rojo, el muro pierde su razon de ser y
  // el seed tiene que fallar ruidosamente en vez de sembrar una pantalla que no
  // dice nada.
  // Se verifica el DIA: es la pantalla con la que se abre la reunion. La
  // historia hereda los mismos perfiles, asi que si el dia tiene contraste el
  // mes tambien — y si no lo tuviera, es porque los perfiles cambiaron y hay
  // que enterarse aqui, no en el televisor.
  const criticasPorLlamada = new Map<string, number>()
  for (const h of hallazgos) {
    if (h.severidad !== 'critica') continue
    const k = h.llamada_id as string
    criticasPorLlamada.set(k, (criticasPorLlamada.get(k) ?? 0) + 1)
  }

  const RANK_SEV = { rojo: 3, amarillo: 2, verde: 1 } as const
  const rank = new Map<
    string,
    { llamadas: number; cierres: number; tarjeta: number; peor: number; tecnica: number; criticas: number }
  >()
  for (const l of llamadasHoy) {
    const agente = (l.agente_nombre as string).split(' ')[0]
    const acc = rank.get(agente) ?? { llamadas: 0, cierres: 0, tarjeta: 0, peor: 0, tecnica: 0, criticas: 0 }
    acc.llamadas += 1
    acc.tecnica += l.puntaje_tecnico as number
    acc.criticas += criticasPorLlamada.get(l.id as string) ?? 0
    if (l.cerro_venta) {
      acc.cierres += 1
      if (l.forma_pago === 'tarjeta') acc.tarjeta += 1
    }
    acc.peor = Math.max(acc.peor, RANK_SEV[l.semaforo as keyof typeof RANK_SEV])
    rank.set(agente, acc)
  }
  const tabla = [...rank.entries()]
    .map(([agente, v]) => ({
      agente,
      ...v,
      tecnica: Math.round(v.tecnica / v.llamadas),
      semaforo: v.peor === 3 ? 'rojo' : v.peor === 2 ? 'amarillo' : 'verde',
    }))
    .sort((a, b) => b.cierres - a.cierres || a.agente.localeCompare(b.agente))

  const lider = tabla[0]
  const limpioQueCierra = tabla.find(
    (a) => a.semaforo === 'verde' && a.cierres > 0 && a.tarjeta === a.cierres,
  )
  if (lider.semaforo !== 'rojo') {
    throw new Error(
      `El primero en cierres (${lider.agente}) esta en ${lider.semaforo}. El muro necesita que ` +
        `el que mas cierra tenga bandera: sin eso el ranking no genera ninguna conversacion.`,
    )
  }
  if (!limpioQueCierra) {
    throw new Error(
      'No hay ningun agente en verde que cierre y cierre solo con tarjeta. Ese es el caso ' +
        'invisible que el muro tiene que sacar a la luz; sin el, la pantalla solo premia volumen.',
    )
  }

  // Contraste v5: la tabla ahora muestra TECNICA y BANDERAS, no un semaforo.
  // Si el que mas cierra fuera tambien el de mejor tecnica y sin criticas, las
  // dos columnas nuevas no aportarian nada y sobrarian.
  const mejorTecnica = [...tabla].sort((a, b) => b.tecnica - a.tecnica)[0]
  if (mejorTecnica.agente === lider.agente) {
    throw new Error(
      `${lider.agente} lidera en cierres Y en tecnica. Las columnas de tecnica y banderas existen ` +
        `para desmentir o confirmar el ranking de ventas: si coinciden, no dicen nada.`,
    )
  }
  if (!tabla.some((a) => a.criticas === 0)) {
    throw new Error(
      'Todos los agentes tienen al menos un error critico. Una columna donde todos valen lo mismo ' +
        'no ordena, solo ocupa espacio — que fue exactamente el reclamo sobre el semaforo.',
    )
  }

  const cierres = llamadasHoy.filter((l) => l.cerro_venta)
  const conTarjeta = cierres.filter((l) => l.forma_pago === 'tarjeta').length
  console.log(
    `cierres ${DIA}  ${cierres.length} de ${llamadasHoy.length} llamadas · ` +
      `${conTarjeta} tarjeta / ${cierres.length - conTarjeta} cuenta · ` +
      `US$${cierres.length * PRECIO_PROGRAMA}`,
  )
  console.log(
    `contraste      lider ${lider.agente} (${lider.cierres} cierres · técnica ${lider.tecnica} · ` +
      `${lider.criticas} críticas) · mejor técnica ${mejorTecnica.agente} (${mejorTecnica.tecnica} · ` +
      `${mejorTecnica.criticas} críticas)`,
  )
  console.log('ranking día    AGENTE     LLAM CIER  %CIE  TEC  BAND')
  for (const a of tabla) {
    console.log(
      `               ${a.agente.padEnd(9)} ${String(a.llamadas).padStart(4)} ` +
        `${String(a.cierres).padStart(4)} ${String(Math.round((100 * a.cierres) / a.llamadas)).padStart(4)}% ` +
        `${String(a.tecnica).padStart(4)} ${String(a.criticas).padStart(5)}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
