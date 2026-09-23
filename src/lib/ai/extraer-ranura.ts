/**
 * Lector de un pantallazo de proveedor contra el contrato de UNA ranura.
 *
 * Paso 3 del motor de cotización de Trappvel (§3.5).
 *
 * ## Por qué no sirve `extraerCampoDesdeImagen`
 *
 * Esa acción devuelve **campos planos y un solo campo destino**: sirve para sacar un
 * radicado de un pantallazo de la DIAN. Una tarifa de hotel con desglose (tarifa +
 * impuestos + resort fee) son varias FILAS, y además hay que poder rechazar la imagen
 * entera. Es el mismo modelo y la misma llamada: lo que cambia es el esquema de salida.
 *
 * ## RX1 va en el PROMPT, no en una validación posterior
 *
 * *«Esto no es una validacion posterior: va en el prompt, como instruccion explicita
 * de negarse ante N opciones.»* El modelo clasifica la imagen ANTES de extraer y su
 * veredicto viaja como primer campo del JSON. Si el rechazo se dedujera después, de
 * los campos ya leídos, el modelo ya habría elegido una fila del listado para
 * llenarlos — y esa elección es justamente la que no puede hacer.
 *
 * ## R-P7: se verifica el MOTIVO de terminación, no solo que haya texto
 *
 * Una respuesta truncada por presupuesto (`MAX_TOKENS`) trae JSON a medias que a veces
 * parsea. El precedente está escrito en el repo: el motor de calidad daba por buena
 * media transcripción y salía con puntaje normal. Aquí cualquier `finishReason`
 * distinto de `STOP` es RX6.
 *
 * ## La imagen NO se persiste
 *
 * Igual que `extraerCampoDesdeImagen`. La captura de COTIZAR es un insumo de trabajo;
 * la de COMPRA sí es evidencia y debe persistir (§4), pero eso depende de A2 y está
 * fuera de este paso.
 */

import type { DefinicionRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import type {
  FilaTipoPaxCruda,
  IconoEquipajeCrudo,
  OpcionVista,
  LecturaCruda,
  VeredictoImagen,
} from '@/lib/cotizaciones/lectura-pantallazo'
import { extraerConReintento, type ResultadoExtraccion } from './reintentar-extraccion'

/**
 * Mismo modelo que el extractor de documentos: `gemini-2.5-flash` con thinking.
 *
 * El juicio que hace falta aquí es semántico, no de legibilidad: distinguir un listado
 * de resultados de un detalle de itinerario, y saber si el número grande de la pantalla
 * es el total o el precio por pasajero. Eso lo resuelve el razonamiento, no el OCR.
 */
const GEMINI_MODEL = 'gemini-2.5-flash'

/**
 * Presupuesto de salida. El thinking se cobra del MISMO `maxOutputTokens` que el JSON.
 *
 * ⚠️ Medido contra el modelo vivo, y por eso el número es grande: la corrida típica
 * gasta ~400-800 tokens de JSON y ~350-800 de pensamiento, o sea nada. Pero **el
 * pensamiento varía entre corridas con la MISMA imagen**: la captura de hotel que en
 * una corrida terminó en `STOP` con 609 tokens, en otra se cortó por `MAX_TOKENS` con
 * el límite en 8.192 — dos intentos seguidos, 64 segundos, y rechazo RX6 sobre una
 * captura impecable. Es el mismo gotcha que el motor de calidad ya pagó (swings
 * medidos de 12k a 46k). El techo alto no cuesta nada cuando no se usa: se cobra lo
 * gastado, no lo reservado.
 */
const MAX_OUTPUT_TOKENS = 24_576
const THINKING_BUDGET = 2048

/**
 * Tope de reloj por intento.
 *
 * ⚠️ Medido: la lectura típica tarda **5 a 12 segundos**, pero una corrida de las
 * cuatro del banco de prueba se pasó de **90 segundos** con la misma imagen que en
 * aislamiento tardó 7,7. El pensamiento del modelo no es determinista y su cola es
 * larga.
 *
 * Esto corre en una server action, y una server action **no puede declarar
 * `maxDuration`** (es configuración de segmento; el gotcha ya está escrito en el
 * repo). Sin tope, una corrida larga la corta la plataforma con un error genérico y
 * quien cotiza se queda mirando el indicador. Con tope: dos intentos de 25 s son 51 s
 * en el peor caso, por debajo de los 60 s del plan, y el mensaje dice qué hacer.
 */
const TIMEOUT_MS = 25_000

/**
 * A la captura se le dan más píxeles ANTES de mandarla. No es cosmético.
 *
 * ⚠️ Medido contra el modelo vivo sobre `3.57.39_PM-3` (Avianca BASIC), cinco corridas por
 * configuración: **con la imagen tal como llega, el modelo describe el icono de cabina como
 * «azul» en 2 de 5** —es gris oscuro— y el equipaje de mano sale afirmado en falso. **Con la
 * imagen ampliada, 5 de 5 correctas.** El icono mide ~20 px en un pantallazo de 1600; Gemini
 * trocea la imagen en teselas de 768 px, así que ampliar es literalmente darle más píxeles
 * por icono, no un ajuste de redacción. Ninguna forma de escribir el prompt arregla un
 * límite de percepción, y probar redacciones hasta que el número cuadre es cómo se cuela
 * una lectura que parece correcta.
 *
 * El tope de 3.072 px es el lado a partir del cual Gemini reduce la imagen por su cuenta:
 * pasarse no agrega nada y cuesta teselas. El factor 2 es hasta donde se midió.
 */
const LADO_OBJETIVO = 3072
const FACTOR_MAXIMO = 2

const MIMES_SOPORTADOS: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'application/pdf': 'application/pdf',
}

const VEREDICTOS: VeredictoImagen[] = [
  'detalle_unico',
  'varias_opciones',
  'otra_ranura',
  'no_es_pantalla_de_precio',
]

// ── Prompt ───────────────────────────────────────────────────────────────────

/**
 * Los campos que se le piden a la lectura: todos menos los que llena otro paso (`aparte`).
 *
 * ⚠️ Por esto el prompt de hotel es idéntico, byte a byte, al de antes de las estrellas: la
 * categoría la detecta `detectarEstrellas` en paralelo, y todo lo ya medido sobre la lectura
 * de hotel sigue valiendo.
 */
function camposDeLaLectura(ranura: DefinicionRanura) {
  return ranura.campos.filter(c => !c.aparte)
}

/**
 * La opción que ya se eligió en una captura con varias (P8 del ensayo del 2026-09-23): la
 * que la pantalla marca como seleccionada, o la que tocó la persona en «¿Cuál de estas?».
 */
export interface EnfoqueDeLectura {
  nombre: string
  precio: string | null
}

/**
 * El bloque que se agrega al prompt cuando la opción YA está elegida. No se relaja la regla
 * de no elegir: quien eligió es la pantalla o la persona, y el modelo solo lee esa fila.
 */
function bloqueDeEnfoque(enfoque: EnfoqueDeLectura): string {
  return `OPCION YA ELEGIDA — ESTO MANDA SOBRE LA REGLA DE VARIAS OPCIONES. La pantalla muestra
varias opciones y la persona que cotiza YA ELIGIO una:
"${enfoque.nombre.replace(/"/g, "'")}"${enfoque.precio ? ` con precio ${enfoque.precio}` : ''}.
No eres tu quien elige: la eleccion ya esta hecha. Por eso:
- El veredicto es "detalle_unico" y "campos" describe SOLO esa opcion (su habitacion, su
  regimen, sus condiciones, su precio). Lo comun a todas (el hotel, la ciudad, las fechas, la
  ocupacion) se lee de la pantalla como siempre.
- Solo si esa opcion NO aparece en la pantalla, responde "varias_opciones" y deja "campos" vacio.
- En "opciones_vistas" sigue listando todas las que ves.`
}

export function construirPrompt(ranura: DefinicionRanura, enfoque: EnfoqueDeLectura | null = null): string {
  const campos = camposDeLaLectura(ranura)
    .map(c => `- ${c.slug} (${c.label}${c.min ? ', OBLIGATORIO' : ''}): ${c.descripcion_ai}`)
    .join('\n')

  return `Eres un lector de pantallas de proveedores de viaje. Lees UNA captura y devuelves JSON.

RANURA DE ESTA CAPTURA: ${ranura.label} (${ranura.slug})
QUE SE ESPERA: ${ranura.queSePide}
QUE NO SIRVE: ${ranura.queNoSirve}

PASO 1 — LISTA LAS OPCIONES QUE SE VEN, ANTES DE EXTRAER NADA. En "opciones_vistas"
devuelve una entrada por cada producto con SU PROPIO precio que aparece DIBUJADO en la
imagen: { "nombre": el nombre tal como se ve, "precio": el precio tal como se ve,
"seleccionada": true o false }.
Tarjetas de hotel, filas de vuelos, habitaciones o tarifas entre las que habria que elegir.
- "seleccionada" es true SOLO si la pantalla MARCA esa opcion como la elegida: un
  "Seleccionada" o un check junto a ella, la fila resaltada como elegida, un radio o casilla
  marcado. Un resumen o encabezado de la reserva ("1 x Suite · AD") NO es otra opcion: si
  repite el nombre y el precio de una fila, esa fila es la seleccionada. Todo lo demas, false.
- En "nombre" de una habitacion pon la habitacion Y su regimen tal como se ven
  ("Suite Ocean View · Alojamiento y desayuno"): dos filas de la misma habitacion con
  distinto regimen son dos opciones distintas.
- Solo lo que SE VE. Un contador o un filtro como "2 Hoteles (de 267)" no es un producto
  visible: no inventes una entrada por el. Si solo se ve una tarjeta, hay una entrada.
- Un precio TACHADO (el de antes de un descuento) no es otra opcion: va en la misma entrada.
- Una tabla que separa el precio de UNA reserva por tipo de pasajero (adultos, ninos,
  infantes) es UNA opcion, no varias.

${enfoque ? bloqueDeEnfoque(enfoque) + '\n\n' : ''}PASO 2 — CLASIFICA LA IMAGEN. Devuelve "veredicto" con uno de:

- "varias_opciones": se ven DOS O MAS opciones con precio propio entre las que habria que
  ELEGIR (dos o mas entradas en opciones_vistas): un listado con varios hoteles, un comparador, una
  grilla de aerolineas, varias habitaciones con precio, un calendario de precios.
  ⚠️ REGLA ABSOLUTA: ante varias opciones NO ELIJAS NINGUNA. No tomes la primera, ni
  la mas barata, ni la resaltada. Devuelve este veredicto y deja "campos" vacio. Elegir
  por tu cuenta produce un precio que parece correcto y no lo es; eso cuesta dinero
  real. Negarte es la respuesta correcta, no una falla.
- "otra_ranura": es una pantalla de viaje valida pero de OTRA cosa (un hotel donde se
  pedia un vuelo, un traslado donde se pedia una actividad).
- "no_es_pantalla_de_precio": no es una pantalla de reserva ni de cotizacion (un correo,
  un chat, una foto, un documento, una pantalla sin precio).
- "detalle_unico": se ve UNA sola opcion con su precio (una entrada en opciones_vistas). Incluye
  la tarjeta de UN hotel dentro de un listado filtrado a ese hotel, y la liquidacion o
  el resumen de una sola reserva. Solo en este caso extraes campos.

Si no puedes decir con certeza cuantas opciones se ven, responde "varias_opciones".

En "observacion" escribe UNA linea diciendo que viste. Si rechazas, es lo que la
persona va a leer para saber que capturar.

PASO 3 — SOLO si el veredicto es "detalle_unico", extrae estos campos:

${campos}

REGLAS DE EXTRACCION:
- Para cada campo: { "value": <texto o null>, "confidence": <0.0 a 1.0> }
- Lo que NO este en la imagen va con value null y confidence 0. NUNCA lo deduzcas del
  contexto del viaje, del destino ni de lo que seria razonable. Un campo vacio es un
  hueco que una persona llena; un campo inventado es un dato falso que nadie revisa.
- confidence refleja certeza de LECTURA (1.0 perfectamente legible, 0.5 borroso pero
  probable, 0.0 no visible).
- Valores monetarios: devuelve SOLO el numero, sin simbolo ni separadores de miles.
  Respeta la convencion de la pantalla: si dice 1.234,56 el valor es 1234.56; si dice
  1,234.56 tambien es 1234.56.
- Fechas en formato AAAA-MM-DD. Si la pantalla muestra dia y mes pero NO el ano
  (ej. "Vie, 23 Oct"), devuelve --MM-DD (ej. --10-23). NUNCA inventes el ano.
- Booleanos: la cadena "true" o "false". null si la pantalla no lo dice.

PASO 3b — LOS ICONOS DE EQUIPAJE, ANTES DE DECIDIR SI VAN INCLUIDOS. Si la pantalla
muestra una fila de iconos de equipaje (bolsos, mochilas, maletas), devuelve en
"iconos_equipaje" una entrada por cada icono, EN EL ORDEN EN QUE APARECEN de izquierda a
derecha: { "dibujo": que se ve (bolso, mochila, maleta de cabina con ruedas, maleta
grande), "color": el color con el que esta RELLENO ese icono, en una o dos palabras y tal
como lo ves (azul, celeste, verde, naranja, morado, rojo, gris, gris oscuro, negro),
"estado": "encendido" o "apagado" }.
- "encendido" = el relleno del icono es UN COLOR: azul, celeste, verde, naranja, morado, rojo.
- "apagado" = el relleno NO es un color: gris, GRIS OSCURO, NEGRO, blanco, plano, sin
  color, difuminado o tachado. Un icono gris oscuro o negro esta APAGADO, nunca encendido:
  en una pantalla de aerolinea el color es lo unico que marca lo incluido.
- COMPARA los iconos de una misma fila ENTRE SI antes de responder. Un icono oscuro al lado
  de uno azul se distingue comparandolos; mirando uno solo, no.
- Describe lo que VES. Que un icono este incluido en la tarifa se decide despues, con esta
  lista: aqui solo importa el dibujo, el color y el estado.
- Si la misma fila de iconos se repite en la pantalla (una vez por cada tramo del vuelo y
  otra en la tabla de tarifa), devuelve UNA sola fila de iconos, no todas.
- Si la pantalla no muestra iconos de equipaje, devuelve la lista vacia.

PASO 4 — DESGLOSE. En "desglose" devuelve las filas de precio que la pantalla muestre
DESGLOSADAS (tarifa, impuestos y tasas, resort fee, cargo por servicio, equipaje).
- Copia lo que la pantalla lista. NO inventes un desglose que no esta: si solo hay un
  precio total, devuelve desglose vacio.
- Cada fila: { "concepto", "cantidad", "unidad", "valor_unitario", "moneda", "confidence" }
- NO incluyas el total general como una fila mas: seria contar el mismo dinero dos veces.

PASO 5 — POR TIPO DE PASAJERO. Solo si la pantalla trae el precio SEPARADO por tipo de
pasajero (una tabla con una fila por ADT / CHD / INF, o "ADULTOS" / "INFANTES"), devuelve
en "por_tipo_pax" una fila por cada tipo:
- "tipo": "adulto" (ADT, adultos), "nino" (CHD, ninos, child) o "infante" (INF, infantes, bebes).
- "cantidad": el numero de la columna Cantidad de esa fila, tal cual.
- "subtotal_tipo": el valor TOTAL de esa fila para TODOS los pasajeros de ese tipo: la
  columna "Subtotal" o "Total" de la fila. Si la fila tiene una columna "Valor" y otra
  "Total", usa "Total". NO uses la tarifa unitaria.
- NO multipliques, NO dividas y NO sumes columnas: las columnas intermedias (tarifa
  unitaria, total tarifa, tasa de embarque, fee, total tasa) tienen bases distintas y
  combinarlas da un numero falso. Copia el subtotal que la pantalla ya muestra.
- "moneda": codigo ISO de ese valor.
En "total_general" devuelve el total de ESA tabla (la fila "Total General" o "Sub-Total"
que suma todas las filas). Si la pantalla NO separa el precio por tipo de pasajero (un
solo precio para todo el grupo), devuelve "por_tipo_pax" vacio y "total_general" null:
NUNCA repartas un total entre tipos de pasajero.${enfoque ? '\n\nRECUERDA: la opcion ya esta elegida (ver OPCION YA ELEGIDA): detalle_unico y los campos de ESA opcion.' : ''}`
}

// ── Esquema de salida ────────────────────────────────────────────────────────

function construirEsquema(ranura: DefinicionRanura) {
  return {
    type: 'OBJECT',
    properties: {
      opciones_vistas: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { nombre: { type: 'STRING' }, precio: { type: 'STRING' }, seleccionada: { type: 'BOOLEAN' } },
        },
      },
      veredicto: { type: 'STRING', enum: VEREDICTOS },
      observacion: { type: 'STRING' },
      campos: {
        type: 'OBJECT',
        properties: Object.fromEntries(
          camposDeLaLectura(ranura).map(c => [c.slug, {
            type: 'OBJECT',
            properties: { value: { type: 'STRING' }, confidence: { type: 'NUMBER' } },
            required: ['value', 'confidence'],
          }]),
        ),
        required: camposDeLaLectura(ranura).map(c => c.slug),
      },
      iconos_equipaje: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            dibujo: { type: 'STRING' },
            // El color concreto y su clasificación, en la misma entrada: la percepción
            // («gris oscuro») y el juicio («apagado») se cruzan, y lo que no coincide no
            // se afirma. El modelo ya contestó «a_color» sobre un icono gris oscuro.
            color: { type: 'STRING' },
            estado: { type: 'STRING', enum: ['encendido', 'apagado'] },
          },
          required: ['dibujo', 'color', 'estado'],
        },
      },
      desglose: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            concepto: { type: 'STRING' },
            cantidad: { type: 'NUMBER' },
            unidad: { type: 'STRING' },
            valor_unitario: { type: 'NUMBER' },
            moneda: { type: 'STRING' },
            confidence: { type: 'NUMBER' },
          },
          required: ['concepto', 'valor_unitario'],
        },
      },
      por_tipo_pax: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            tipo: { type: 'STRING', enum: ['adulto', 'nino', 'infante'] },
            cantidad: { type: 'NUMBER' },
            subtotal_tipo: { type: 'NUMBER' },
            moneda: { type: 'STRING' },
            confidence: { type: 'NUMBER' },
          },
          required: ['tipo', 'cantidad', 'subtotal_tipo'],
        },
      },
      total_general: { type: 'NUMBER', nullable: true },
    },
    required: ['opciones_vistas', 'veredicto', 'campos', 'desglose', 'por_tipo_pax'],
  }
}

// ── Normalización de lo que llega ────────────────────────────────────────────

/**
 * Convierte la respuesta del modelo en `LecturaCruda`, sin juzgarla.
 *
 * ⚠️ Un `veredicto` que no esté en la lista se trata como **rechazo**
 * (`no_es_pantalla_de_precio`), nunca como `detalle_unico`. Caer al caso que crea
 * rubros ante una respuesta que no se entiende es exactamente al revés de lo que este
 * frente protege.
 *
 * Exportada para poder probarla sin llamar a Gemini.
 */
export function normalizarRespuesta(raw: unknown): LecturaCruda {
  const obj = (raw ?? {}) as Record<string, unknown>
  const veredictoCrudo = String(obj.veredicto ?? '')
  const veredicto: VeredictoImagen = (VEREDICTOS as string[]).includes(veredictoCrudo)
    ? (veredictoCrudo as VeredictoImagen)
    : 'no_es_pantalla_de_precio'

  const camposCrudos = (obj.campos ?? {}) as Record<string, unknown>
  const campos: LecturaCruda['campos'] = {}
  for (const [slug, v] of Object.entries(camposCrudos)) {
    const f = (v ?? {}) as Record<string, unknown>
    campos[slug] = { value: textoOVacio(f.value), confidence: Number(f.confidence ?? 0) || 0 }
  }

  const desgloseCrudo = Array.isArray(obj.desglose) ? obj.desglose : []
  const desglose = desgloseCrudo.map(f => {
    const fila = (f ?? {}) as Record<string, unknown>
    return {
      concepto: recortar(textoOVacio(fila.concepto), MAX_CONCEPTO),
      cantidad: numeroONulo(fila.cantidad),
      unidad: recortar(soloLaCabeza(textoOVacio(fila.unidad)), MAX_UNIDAD),
      valor_unitario: numeroONulo(fila.valor_unitario),
      moneda: fila.moneda === null || fila.moneda === undefined ? null : String(fila.moneda).trim() || null,
      confidence: Number(fila.confidence ?? 0) || 0,
    }
  })
    // Una fila sin valor no es un costo: se descarta antes de que llegue a proponerse
    // como rubro en cero. R-P2 — cero es un precio, vacío es un hueco.
    .filter(f => f.valor_unitario !== null && f.valor_unitario > 0)

  const observacion = obj.observacion === null || obj.observacion === undefined
    ? null
    : String(obj.observacion).trim() || null

  const porTipoCrudo = Array.isArray(obj.por_tipo_pax) ? obj.por_tipo_pax : []
  const porTipoPax: FilaTipoPaxCruda[] = []
  for (const f of porTipoCrudo) {
    const fila = (f ?? {}) as Record<string, unknown>
    const tipo = String(fila.tipo ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (tipo !== 'adulto' && tipo !== 'nino' && tipo !== 'infante') continue
    const cantidad = numeroONulo(fila.cantidad)
    const subtotal = numeroONulo(fila.subtotal_tipo)
    // Una fila sin cantidad no reparte nada. Un subtotal en CERO sí se conserva: el
    // infante que viaja sin tarifa es un dato, no un hueco (R-P2 al revés).
    if (cantidad === null || cantidad <= 0 || !Number.isInteger(cantidad)) continue
    if (subtotal === null || subtotal < 0) continue
    porTipoPax.push({
      tipo,
      cantidad,
      subtotal_tipo: subtotal,
      moneda: textoOVacio(fila.moneda),
      confidence: Number(fila.confidence ?? 0) || 0,
    })
  }
  const iconosEquipaje = colapsarRepeticion(normalizarIconos(obj.iconos_equipaje))
  derivarEquipajeDeLosIconos(iconosEquipaje, campos)

  const totalGeneral = numeroONulo(obj.total_general)
  // RX1 con EVIDENCIA: no un número que el modelo declara, sino las opciones que dice ver.
  // Medido el 2026-09-16: con un conteo, el mismo listado filtrado de Bedsonline salió 1 en
  // una corrida y 2 en otra (el contador «2 Hoteles (de 267)» se contaba como opción). Se
  // cuentan las entradas DISTINTAS: la misma tarjeta repetida no son dos opciones.
  const vistas = Array.isArray(obj.opciones_vistas) ? obj.opciones_vistas : null
  const opcionesVisibles = vistas === null
    ? null
    : new Set(
        vistas
          .map(v => {
            const o = (v ?? {}) as Record<string, unknown>
            return `${textoOVacio(o.nombre) ?? ''}|${textoOVacio(o.precio) ?? ''}`.toLowerCase()
          })
          .filter(k => k !== '|'),
      ).size

  const opcionesVistas: OpcionVista[] = (vistas ?? []).flatMap(v => {
    const o = (v ?? {}) as Record<string, unknown>
    const nombre = textoOVacio(o.nombre)
    if (nombre === null) return []
    return [{ nombre, precio: textoOVacio(o.precio), seleccionada: o.seleccionada === true }]
  })

  return { veredicto, observacion, campos, desglose, porTipoPax, totalGeneral, opcionesVisibles, opcionesVistas, iconosEquipaje }
}

const SLUGS_EQUIPAJE = ['equipaje_personal', 'equipaje_mano', 'equipaje_bodega']

/**
 * Cada icono trae DOS respuestas del modelo, y se cruzan entre sí.
 *
 * `color` es lo que percibe («azul», «gris oscuro») y `estado` cómo lo clasifica
 * («encendido», «apagado»). Se piden las dos porque el error medido está justamente en el
 * salto de una a otra: con el esquema anterior, que pedía un `color` libre, el modelo
 * respondió **`a_color` sobre el icono de cabina, que es gris oscuro** — no falló el
 * vocabulario del servidor (`a_color` y `gris` caen los dos en su lista), falló la
 * descripción. Nombrar el color concreto obliga a mirar el píxel; clasificarlo aparte
 * obliga a decidir; y si las dos no coinciden, el icono queda sin leer.
 */
function normalizarIconos(raw: unknown): IconoEquipajeCrudo[] {
  const lista = Array.isArray(raw) ? raw : []
  return lista.map(ic => {
    const o = (ic ?? {}) as Record<string, unknown>
    const color = textoOVacio(o.color)
    const clasificado = textoOVacio(o.estado)
    // Las dos respuestas del modelo sobre el MISMO icono: qué color ve y cómo lo clasifica.
    // Coinciden → el estado se guarda. Se contradicen («gris oscuro» + «encendido») → el
    // icono queda sin leer, y un icono sin leer vacía la fila entera.
    const porColor = estadoDelIcono(color)
    const porClase = estadoDelIcono(clasificado)
    const estado = porColor !== null && porClase !== null && porColor !== porClase
      ? null
      : porColor ?? porClase
    return { dibujo: textoOVacio(o.dibujo), color, clasificado, estado }
  })
}

/**
 * Encendido = pintado de un color. Apagado = gris, NEGRO, blanco, plano o tachado.
 *
 * ⚠️ El TONO se mira antes que el adjetivo, porque «oscuro» no significa lo mismo en
 * «gris oscuro» que en «azul oscuro» — y el modelo devolvió las dos cosas en el banco
 * real. Un adjetivo suelto no es evidencia de nada: lo que decide es si se nombró un color
 * o un neutro.
 *
 * ⚠️ Lo que no se entiende devuelve `null`, y un `null` vacía la fila entera (ver
 * `derivarEquipajeDeLosIconos`). Antes devolvía «no toques el campo», que es lo mismo que
 * dejar mandando al dictamen del modelo — justo el que no es estable.
 */
function estadoDelIcono(raw: string | null): 'encendido' | 'apagado' | null {
  const t = (raw ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  if (t === '') return null
  // «sin color» contiene «color»: se resuelve antes que nada, o el vocabulario de encendido
  // lo toma por su contrario.
  if (/\bsin (color|colorear|pintar|resaltar|resalte)\b|\bno (esta|est) (a color|resaltado|pintado)\b/.test(t)) {
    return 'apagado'
  }
  const tono = /azul|celeste|verde|naranja|morad|violeta|rojo|amarill|turques|cian|fucsia|rosa|dorad/.test(t)
  const neutro = /gris|grey|gray|negr|black|blanc|white|plomo|platead/.test(t)
  // «azul grisáceo» nombra las dos cosas: no se afirma ninguna.
  if (tono !== neutro) return tono ? 'encendido' : 'apagado'
  if (tono && neutro) return null
  // Sin color nombrado, vale la clasificación o el adjetivo.
  const encendido = /encendid|a_color|a color|color|resalt|activ|destac|ilumin|brillante/.test(t)
  const apagado = /apagad|oscur|dark|plano|difumin|atenuad|tenue|tach|desactiv|opac|inactiv/.test(t)
  if (encendido === apagado) return null
  return encendido ? 'encendido' : 'apagado'
}

/**
 * Una terna repetida es UNA terna — y que se repita IGUAL es la prueba de que se leyó bien.
 *
 * La misma fila de iconos aparece varias veces en la pantalla (una por tramo del vuelo y
 * otra por cada fila de la tabla de tarifa: cuatro veces en la captura de Avianca del banco
 * real). El prompt pide TODAS, no una: son observaciones independientes de lo mismo dentro
 * de la misma llamada, y compararlas entre sí es la única forma barata de detectar que el
 * modelo dudó. Si las cuatro coinciden, se colapsan a una; si no, la lista no tiene período
 * exacto, no se puede leer como terna y los tres campos quedan vacíos.
 *
 * ⚠️ Esto **no** es una defensa contra que el modelo desobedezca una instrucción de estilo:
 * es el cruce. Antes el prompt pedía una sola fila y un `length !== 3` mataba la derivación
 * en silencio.
 *
 * Devuelve el período mínimo que, repetido, reproduce la lista completa.
 */
function colapsarRepeticion(iconos: IconoEquipajeCrudo[]): IconoEquipajeCrudo[] {
  const n = iconos.length
  if (n < 2) return iconos
  const claves = iconos.map(ic =>
    `${(ic.dibujo ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()}|${ic.estado ?? '?'}`,
  )
  for (let p = 1; p < n; p++) {
    if (n % p !== 0) continue
    let repite = true
    for (let i = p; i < n && repite; i++) repite = claves[i] === claves[i % p]
    if (repite) return iconos.slice(0, p)
  }
  return iconos
}

/**
 * El equipaje sale del ESTADO de los iconos. Si la fila no se lee limpia, queda vacío.
 *
 * ## La regla, de Mauricio (2026-09-18)
 *
 * *«Debemos traer esa información del mismo pantallazo. En el caso de Avianca se reconoce
 * porque solo está alumbrado el morral pequeño.»* El dato no se resuelve preguntando si la
 * tarifa incluye maleta: está dibujado en la pantalla, y lo dice el estado del icono, no
 * que el icono exista.
 *
 * ## Por qué el dictamen del modelo ya no decide
 *
 * ⚠️ Medido contra el modelo vivo sobre la MISMA imagen (`3.57.39_PM-3`, tarifa BASIC de
 * Avianca por Amadeus): preguntando directo «¿incluye equipaje de bodega?», respondió
 * `false` en una corrida y `true` en la siguiente, las dos con confianza 0,9. Contado por
 * píxeles, de los tres iconos solo el primero está a color. **El juicio del modelo sobre
 * una imagen no es estable entre corridas; su descripción de lo que ve sí.** Hasta el
 * 2026-09-18 las dos respuestas se cruzaban y solo se guardaba lo que coincidía; con un
 * dictamen que se voltea entre corridas, ese cruce producía un campo que también se
 * voltea. Ahora manda la descripción y el dictamen no entra: no se puede estabilizar un
 * dato cruzándolo contra una fuente inestable.
 *
 * ## Hueco antes que mentira
 *
 * Con fila de iconos visible que NO se puede leer como terna limpia —no son tres, o el
 * estado de alguno es ambiguo— los tres campos quedan **vacíos**. Dejar mandando al
 * dictamen en ese caso es exactamente lo que puso los tres en `true` sobre una tarifa que
 * solo lleva morral. Un hueco lo llena una persona mirando las reglas de la tarifa; un
 * «incluye maleta de bodega» falso lo descubre el pasajero en el aeropuerto.
 *
 * ⚠️ **Sin fila de iconos no se toca nada**: una tarifa que dice por escrito «incluye 1
 * maleta de 23 kg» es un dato válido leído del texto, y ahí el único que leyó es el
 * modelo.
 */
function derivarEquipajeDeLosIconos(iconos: IconoEquipajeCrudo[], campos: LecturaCruda['campos']): void {
  if (iconos.length === 0) return
  // La ranura de hotel no declara estos campos: sin ellos no hay nada que derivar, y
  // crearlos inventaría claves que la ranura nunca pidió.
  if (!SLUGS_EQUIPAJE.every(s => s in campos)) return

  const terna = iconos.length === 3 && iconos.every(ic => ic.estado !== null)
  for (const [i, slug] of SLUGS_EQUIPAJE.entries()) {
    // La confianza no es 1 aunque la fila se lea limpia: el dato es DERIVADO de una
    // observación sobre píxeles, no leído de un texto. Los tres van marcados para revisión.
    campos[slug] = terna
      ? { value: iconos[i].estado === 'encendido' ? 'true' : 'false', confidence: 0.9 }
      : { value: null, confidence: 0 }
  }
}

/**
 * El texto de un campo, o `null` si no se leyó.
 *
 * ⚠️ El `responseSchema` declara `value` como STRING, así que el modelo **no puede
 * devolver un JSON null**: devuelve la cadena `"null"`. Medido contra el modelo vivo
 * sobre el listado de vuelos — los quince campos volvieron con `"value": "null"`.
 * Ahí no mordió porque venían con confianza 0 y el umbral los descarta igual, pero un
 * campo que el modelo declare ausente CON confianza alta se guardaría como el texto
 * «null»: una aerolínea llamada «null» en la cotización que ve el cliente.
 *
 * Se descartan también `"none"` y `"n/a"` por el mismo motivo y con el mismo riesgo.
 */
function textoOVacio(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  if (t === '') return null
  return ['null', 'none', 'n/a', 'na', 'undefined'].includes(t.toLowerCase()) ? null : t
}

/**
 * Topes de longitud de los textos libres del desglose.
 *
 * ⚠️ Medido contra el modelo vivo: en una corrida del hotel, `unidad` volvió con
 * **un párrafo entero** — *«noche(s) (total 720,00 USD para 4 noches, no se incluye
 * como linea separada para evitar duplicidad de datos, …)»*. Eso entra tal cual a
 * `rubros.unidad`, que es una columna de texto sin tope, y se imprime en el desglose
 * de costo que alguien tiene que leer para confirmar.
 *
 * El modelo no siempre distingue el campo del comentario sobre el campo. El tope no
 * es cosmético: una tabla de costos ilegible es una tabla que nadie revisa.
 */
const MAX_CONCEPTO = 60
const MAX_UNIDAD = 24

/** Lo que va antes del primer paréntesis: la unidad, sin el comentario del modelo. */
function soloLaCabeza(t: string | null): string | null {
  if (t === null) return null
  const corte = t.indexOf('(')
  const cabeza = (corte > 0 ? t.slice(0, corte) : t).trim()
  return cabeza === '' ? null : cabeza
}

function recortar(t: string | null, max: number): string | null {
  if (t === null) return null
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

function numeroONulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── La llamada ───────────────────────────────────────────────────────────────

/**
 * Lee un pantallazo con el contrato de una ranura. Reintenta una vez ante fallo
 * transitorio, con la MISMA política que el extractor de documentos.
 *
 * `error` distinto de nulo con `data` nulo es RX6 para el llamador: la llamada no
 * terminó bien y no hay lectura que juzgar.
 */
export async function extraerRanuraDesdeImagen(
  buffer: Buffer,
  mimeType: string,
  ranura: DefinicionRanura,
  apiKey: string,
  /** La opción que ya eligió la persona en «¿Cuál de estas?» (P8). */
  enfoque: EnfoqueDeLectura | null = null,
): Promise<ResultadoExtraccion<LecturaCruda>> {
  // Las estrellas se detectan EN PARALELO con la lectura: solo necesitan la imagen, así que
  // no le suman espera a quien cotiza (la lectura tarda más que ellas).
  const deteccion = pideEstrellas(ranura) ? detectarEstrellas(buffer, mimeType, apiKey) : null
  let lectura = await extraerConReintento(
    () => unaLlamada(buffer, mimeType, ranura, apiKey, enfoque),
    `ranura:${ranura.slug}`,
  )
  if (lectura.data && enfoque) {
    lectura.data.elegida = lectura.data.veredicto === 'detalle_unico' ? { ...enfoque, por: 'persona' } : null
  }
  // P8 · la pantalla YA marca una opción como elegida (el Deep Blue del ensayo del 2026-09-23:
  // «✓ Seleccionada» en una de tres filas). No se rechaza: se vuelve a leer SOBRE esa fila.
  // Solo con UNA marcada: dos marcas son tan ambiguas como ninguna.
  const marcada = !enfoque ? opcionMarcada(lectura.data) : null
  if (marcada) {
    const enfocada = await extraerConReintento(
      () => unaLlamada(buffer, mimeType, ranura, apiKey, marcada),
      `ranura:${ranura.slug}:marcada`,
    )
    if (enfocada.data?.veredicto === 'detalle_unico') {
      enfocada.data.elegida = { ...marcada, por: 'marcada' }
      lectura = enfocada
    }
  }
  // ⚠️ Si la detección tarda MÁS que la lectura, se le da una gracia corta y no más. Medido en
  // el banco real: una de 35 detecciones llegó al tope de 20 s y la lectura esperó con ella.
  // Unas estrellas no valen diez segundos más con quien cotiza mirando el indicador: sin
  // respuesta a tiempo, el campo queda vacío y lo cubre la búsqueda en la web.
  const estrellas = deteccion
    ? await Promise.race([
        deteccion,
        new Promise<DeteccionEstrellas>(resolve =>
          setTimeout(() => resolve({ valor: null, corridas: [], error: 'la detección tardó más que la lectura' }), GRACIA_ESTRELLAS_MS)),
      ])
    : null
  if (lectura.data && estrellas) {
    lectura.data.estrellasDeteccion = estrellas
    lectura.data.campos.estrellas = estrellas.valor === null
      ? { value: null, confidence: 0 }
      // 0,9 y no 1: es un dato derivado de iconos de ~14 px, marcado para revisión.
      : { value: String(estrellas.valor), confidence: 0.9 }
  }
  return lectura
}

/**
 * La opción que la pantalla da por elegida, si la lectura se rechazó por varias opciones y
 * la marca es UNA sola. `null` en cualquier otro caso (sin rechazo, sin marca, dos marcas).
 */
export function opcionMarcada(lectura: LecturaCruda | null | undefined): EnfoqueDeLectura | null {
  if (!lectura) return null
  const varias = lectura.veredicto === 'varias_opciones'
    || (lectura.veredicto === 'detalle_unico' && (lectura.opcionesVisibles ?? 0) >= 2)
  if (!varias) return null
  const marcadas = (lectura.opcionesVistas ?? []).filter(o => o.seleccionada)
  const distintas = new Set(marcadas.map(o => `${o.nombre.toLowerCase()}|${o.precio ?? ''}`))
  if (distintas.size !== 1) return null
  return { nombre: marcadas[0].nombre, precio: marcadas[0].precio }
}

// ── Estrellas: se DETECTAN, no se cuentan de un vistazo ──────────────────────

/** ¿La ranura lee la categoría del hotel? Hoy solo `hotel_detalle`, y aparte de la lectura. */
function pideEstrellas(ranura: DefinicionRanura): boolean {
  return ranura.campos.some(c => c.slug === 'estrellas')
}

/**
 * Modelo de la detección de estrellas. NO es el de la lectura, y a propósito.
 *
 * ⚠️ Medido contra el modelo vivo el 2026-09-22 sobre las siete capturas de hotel del banco
 * real (cinco con estrellas, dos sin): preguntando el NÚMERO, todos los modelos probados
 * (2.5-flash, 3-flash-preview, 3.5-flash) contaron **4 en Crown Paradise, que tiene 5**, y
 * 2.5-flash además contó 2 en Vitium, que tiene 3. Pidiendo una CAJA por estrella y contando
 * las cajas, 3.5-flash acertó **21 de 21**; 2.5-flash con la misma pregunta mezcló etiquetas
 * y devolvió JSON roto en dos de tres corridas de Crown.
 */
const MODELO_ESTRELLAS = 'gemini-3.5-flash'
const TIMEOUT_ESTRELLAS_MS = 20_000
/** Lo que se espera a la detección DESPUÉS de que termina la lectura. Ver `extraerRanuraDesdeImagen`. */
const GRACIA_ESTRELLAS_MS = 4_000

/**
 * La categoría del hotel, detectando cada estrella como un objeto con su caja.
 *
 * ## Por qué así, y no como un campo más de la lectura
 *
 * ⚠️ La estrella de categoría mide ~14 px en una captura de 1.600, y contarla de un vistazo
 * es un límite de percepción que no se arregla redactando (el equipaje ya lo enseñó, #792).
 * Medido contra el modelo vivo, con el campo dentro de la lectura normal: las cuatro tarjetas
 * de 3 estrellas bien **20 de 20**, y Crown Paradise (5) leída como **4, con confianza 1, en
 * 5 de 5**. Se probaron y se descartaron, con números:
 *
 *  · pedir los iconos uno por uno (el truco del equipaje): siguió viendo 4 y además desordenó
 *    la lectura del hotel (Vitium rechazada por RX2 en 2 de 5 corridas);
 *  · cruzar la lectura ampliada con un conteo sobre la imagen original: cada escala falla en
 *    capturas distintas, pero el resultado cambiaba con la redacción (con una, Crown salía 5
 *    en la original; con otra, 4 en las dos, y el cruce dejaba pasar el error);
 *  · `mediaResolution: HIGH`: Crown siguió en 4 ampliada y Vitium en 2 sin ampliar;
 *  · recortar alrededor del nombre: las cajas del NOMBRE que devolvió el modelo caían lejos
 *    (en Crown, en la esquina de la foto).
 *
 * Lo que funcionó fue cambiar la pregunta: una caja por estrella, y el servidor cuenta. Es
 * otro mecanismo —localizar cada icono— y no un número estimado. Medido por este mismo camino
 * (`extraerRanuraDesdeImagen`, 7 capturas de hotel × 5 corridas): **32 bien, 2 vacías, 0
 * mal**, más 1 rechazo RX2 de la lectura principal, cuyo cuerpo es idéntico byte a byte al de
 * antes de este cambio. Las 2 vacías fueron una detección que llegó al tope de tiempo y una en
 * que las dos corridas no coincidieron: justo el caso en que se prefiere el hueco.
 * Evidencia: `proyectos/trappvel/clarity/qa/2026-09-22_estrellas-y-campos-editables/`.
 *
 * ## Por qué dos corridas, y qué se exige a cada una
 *
 * La lectura principal NO pregunta por las estrellas: su prompt de hotel queda idéntico al
 * que ya se midió. Esta detección corre DOS veces en paralelo sobre la imagen original, y el
 * número vale solo si:
 *  · las dos corridas coinciden;
 *  · todas las cajas caen en UNA fila (una estrella lejos de las demás es otra cosa);
 *  · hay a lo sumo cinco, y todas son `filled_star` o `empty_star`.
 * Si algo de eso falla, el campo queda vacío. Una estrella de más es una promesa sobre el hotel
 * que la agencia no verificó; un hueco lo llena una persona o la búsqueda en la web.
 *
 * ⚠️ Lo que NO lee: una categoría escrita solo con texto («Hotel 4*») y sin iconos. En el banco
 * real no hay ninguna; si aparece, queda vacía y la cubre la búsqueda en la web.
 *
 * Nunca tumba la lectura: si falla o tarda, el campo queda vacío.
 */
export async function detectarEstrellas(
  buffer: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<DeteccionEstrellas> {
  const mime = MIMES_SOPORTADOS[mimeType.toLowerCase()]
  if (!apiKey || !mime || mime === 'application/pdf') {
    return { valor: null, corridas: [], error: 'la detección solo corre sobre imágenes' }
  }
  const corridas = await Promise.all([unaDeteccion(buffer, mime, apiKey), unaDeteccion(buffer, mime, apiKey)])
  const error = corridas.find(c => c.error)?.error ?? null
  const [a, b] = corridas.map(c => c.valor)
  // `null` en las dos = ninguna de las dos vio estrellas: la captura no las muestra.
  const valor = a !== undefined && a === b ? a : null
  return { valor, corridas: corridas.map(c => c.valor ?? null), error }
}

export interface DeteccionEstrellas {
  /** La categoría que vieron igual las dos corridas, o `null`. */
  valor: number | null
  /** Lo que vio cada corrida (`null` = nada o no legible). Evidencia para el diagnóstico. */
  corridas: (number | null)[]
  error: string | null
}

const PROMPT_ESTRELLAS =
  'Detect every star icon of the hotel CATEGORY rating that sits right next to the hotel name ' +
  '(not guest-review bubbles, not ratings shown with numbers). Output a json list where each entry ' +
  'contains the 2D bounding box in "box_2d" and a text label in "label" ("filled_star" or "empty_star"). ' +
  'If there are none, output an empty list.'

async function unaDeteccion(
  buffer: Buffer,
  mime: string,
  apiKey: string,
): Promise<{ valor: number | null | undefined; error: string | null }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_ESTRELLAS}:generateContent?key=${apiKey}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_ESTRELLAS_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: buffer.toString('base64') } }, { text: PROMPT_ESTRELLAS }] }],
        // La familia 3.x usa `thinkingLevel`; el `thinkingBudget` numérico de 2.5 se ignora
        // en silencio (gotcha ya escrito en el repo).
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
      }),
    })
    if (!res.ok) return { valor: undefined, error: `HTTP ${res.status}` }
    const data = await res.json()
    const candidato = data.candidates?.[0]
    if (candidato?.finishReason && candidato.finishReason !== 'STOP') {
      return { valor: undefined, error: `terminó con ${candidato.finishReason}` }
    }
    const texto: string = (candidato?.content?.parts ?? [])
      .find((p: { thought?: boolean; text?: string }) => !p.thought && p.text)?.text ?? ''
    return { valor: contarCajasDeEstrellas(JSON.parse(texto)), error: null }
  } catch (err) {
    return { valor: undefined, error: String(err).slice(0, 120) }
  }
}

/**
 * Cuenta las estrellas rellenas de una detección, o dice por qué no se puede.
 *
 * Devuelve `null` cuando la lista viene vacía (no hay estrellas junto al nombre) y `undefined`
 * cuando la lista existe pero no se puede leer como UNA fila de categoría: más de cinco
 * cajas, una etiqueta que no es estrella rellena o vacía, cajas en filas distintas, o ninguna
 * rellena. La diferencia importa: `null` en las dos corridas es «no hay estrellas»; un
 * `undefined` nunca coincide con nada y deja el campo vacío.
 *
 * Exportada para probarla sin llamar al modelo.
 */
export function contarCajasDeEstrellas(raw: unknown): number | null | undefined {
  if (!Array.isArray(raw)) return undefined
  if (raw.length === 0) return null
  if (raw.length > 5) return undefined
  const cajas: { yc: number; alto: number; llena: boolean }[] = []
  for (const e of raw) {
    const o = (e ?? {}) as Record<string, unknown>
    const b = o.box_2d
    const label = String(o.label ?? '').trim().toLowerCase()
    if (!Array.isArray(b) || b.length !== 4 || !b.every(n => typeof n === 'number' && Number.isFinite(n))) return undefined
    if (label !== 'filled_star' && label !== 'empty_star') return undefined
    const [ymin, , ymax] = b as number[]
    cajas.push({ yc: (ymin + ymax) / 2, alto: Math.abs(ymax - ymin), llena: label === 'filled_star' })
  }
  // Una sola fila: los centros no se separan más que la estrella más alta (mínimo 10 de 1000).
  const ys = cajas.map(c => c.yc)
  const tolerancia = Math.max(10, ...cajas.map(c => c.alto))
  if (Math.max(...ys) - Math.min(...ys) > tolerancia) return undefined
  const llenas = cajas.filter(c => c.llena).length
  return llenas >= 1 ? llenas : undefined
}

/**
 * Amplía la captura hasta el tamaño en que el modelo distingue un icono de 20 px.
 *
 * ⚠️ El formato NO se cambia: `sharp` devuelve el mismo que entró si no se le pide otro, y
 * así el `mime_type` que viaja sigue siendo el que declaró quien subió el archivo. Un PNG
 * de pantalla recomprimido a JPEG mete artefactos justo en los bordes de letra pequeña.
 *
 * ⚠️ Si `sharp` falla —o no está— se manda la imagen ORIGINAL. Ampliar es una mejora de
 * lectura, no un requisito: quedarse sin leer la captura porque no se pudo redimensionar
 * sería cambiar un dato peor por ningún dato.
 */
async function conMasPixeles(buffer: Buffer, mime: string): Promise<Buffer> {
  if (mime === 'application/pdf') return buffer
  try {
    const sharp = (await import('sharp')).default
    const meta = await sharp(buffer).metadata()
    const ancho = meta.width ?? 0
    const lado = Math.max(ancho, meta.height ?? 0)
    if (lado === 0) return buffer
    const factor = Math.min(FACTOR_MAXIMO, LADO_OBJETIVO / lado)
    if (factor <= 1.05) return buffer
    return await sharp(buffer).resize({ width: Math.round(ancho * factor), kernel: 'lanczos3' }).toBuffer()
  } catch (err) {
    console.warn('[extraer-ranura] No se pudo ampliar la captura, se manda como llegó:', err)
    return buffer
  }
}

async function unaLlamada(
  buffer: Buffer,
  mimeType: string,
  ranura: DefinicionRanura,
  apiKey: string,
  enfoque: EnfoqueDeLectura | null = null,
): Promise<ResultadoExtraccion<LecturaCruda>> {
  if (!apiKey) return { data: null, error: 'GEMINI_API_KEY no configurada en el servidor' }

  const mime = MIMES_SOPORTADOS[mimeType.toLowerCase()]
  if (!mime) return { data: null, error: `Tipo de imagen no soportado: ${mimeType}` }

  const imagen = await conMasPixeles(buffer, mime)

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: construirPrompt(ranura, enfoque) }] },
        contents: [{
          parts: [
            { text: 'Clasifica y lee la siguiente captura.' },
            { inline_data: { mime_type: mime, data: imagen.toString('base64') } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
          responseSchema: construirEsquema(ranura),
          thinkingConfig: { thinkingBudget: THINKING_BUDGET },
        },
      }),
    })

    if (!res.ok) {
      const cuerpo = await res.text()
      console.error(`[extraer-ranura] Gemini HTTP ${res.status} — ${cuerpo.slice(0, 400)}`)
      return { data: null, error: `Error de Gemini (${res.status})` }
    }

    const data = await res.json()

    const bloqueo = data.promptFeedback?.blockReason
    if (bloqueo) return { data: null, error: `Contenido bloqueado por Gemini: ${bloqueo}` }

    const candidato = data.candidates?.[0]
    const finishReason = candidato?.finishReason

    // R-P7. El motivo de terminación se verifica ANTES de mirar el texto: una respuesta
    // truncada por presupuesto puede traer JSON que parsea y valores a medias. Ahí el
    // fallo es mudo — se ve igual que una lectura buena.
    if (finishReason && finishReason !== 'STOP') {
      return {
        data: null,
        error: finishReason === 'MAX_TOKENS'
          ? 'La lectura se cortó por límite de tokens'
          : `La lectura terminó con motivo ${finishReason}`,
      }
    }

    const partes = candidato?.content?.parts ?? []
    const parteJson =
      partes.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text?.trim().startsWith('{'))
      ?? partes.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text)
    const texto: string = parteJson?.text ?? ''
    if (!texto) return { data: null, error: 'Gemini no devolvió respuesta' }

    let raw: unknown
    try {
      raw = JSON.parse(texto)
    } catch (e) {
      console.error('[extraer-ranura] JSON inválido:', texto.slice(0, 400))
      return { data: null, error: `JSON inválido de Gemini: ${String(e).slice(0, 80)}` }
    }

    return { data: normalizarRespuesta(raw) }
  } catch (err) {
    // Un corte por reloj se nombra: «error leyendo la captura» manda a revisar la
    // imagen, que está bien, y lo que pasó fue que el modelo se demoró.
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { data: null, error: 'La lectura tardó demasiado' }
    }
    console.error('[extraer-ranura] Excepción:', err)
    return { data: null, error: `Error leyendo la captura: ${String(err).slice(0, 120)}` }
  }
}
