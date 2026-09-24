/**
 * Plantilla de cotización «trappvel» — ITINERARIO DE VIAJE con precio.
 *
 * CONTENIDO: Entrega B del brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-17-documento-cliente.md`
 * y `propuesta-visual.md` (qué lleva el documento). FORMA: `sistema-visual-documento.md`
 * (Ren, 2026-09-22), que manda sobre cómo se ve. Si chocan en contenido, manda el primero;
 * en forma, el segundo.
 *
 * Es una plantilla de RENDER. No cambia qué se guarda, ni el cálculo fiscal, ni el total:
 * el dinero que imprime sale de las MISMAS props que la plantilla por defecto.
 *
 * ## Las decisiones que gobiernan este archivo
 *
 * **1 · Lo que no existe no se pinta, y el documento no se ve roto por eso.** No hay
 * placeholders, ni rayas, ni «—» en una ficha vacía: la ficha no aparece. Sin foto de
 * portada la banda no existe y el bloque sube; sin párrafo de destino, sin cargos, sin
 * opcionales, la sección no se imprime. Lo que todavía no tiene campo (foto del hotel,
 * «Antes de viajar», «Incluido en el plan») está dibujado y espera el dato: no se inventa
 * contenido, y tampoco se rellena con lo que ya está dicho en otra sección.
 *
 * **2 · El dinero se imprime en «Inversión».** Los vuelos, los hoteles y la línea de tiempo
 * describen el viaje **sin precios**. Con el precio repetido en dos sitios, basta que una
 * ranura tenga alternativas para que las dos cifras dejen de coincidir.
 *
 * **3 · Lo que el cliente TIENE QUE PAGAR no se recorta por nivel de detalle.** Los tres
 * niveles recortan descripción, nunca obligaciones: los cargos en destino, los adicionales
 * y lo que no incluye salen en los tres.
 *
 * **4 · Quién firma es decisión del cliente, no del código.** El pie y la firma salen de
 * `viaje.pie` / `viaje.firma` (configuración del workspace). Sin configuración, el pie se
 * arma con los datos del vendedor y firma quien generó el documento (`emisor`).
 *
 * **5 · Un color por tarifa, el mismo en todo el documento** (§3 del sistema visual):
 * Recomendada magenta, Económica verde, Premium púrpura. Un vuelo o un hotel lleva el
 * chip de las tarifas a las que pertenece, así el cliente sigue su opción sin leyenda.
 *
 * **6 · Un solo sistema visual, y reglas que escalan en vez de un número de páginas**
 * (2026-09-23, revisión de COT-2026-0006). Todo título de sección con su ícono en el
 * círculo gris; dos cajas y nada más: la tarjeta gris y la barra en degradado; el ámbar,
 * solo como franja. Toda foto que no es la de portada va en miniatura 3:2, encuadrada en
 * su foco. El día a día no repite la tabla de vuelos, y «Antes de viajar» va con «Incluido»,
 * no suelto al final. Las reglas puras viven en `cotizacion-trappvel-formato.ts`.
 *
 * ⚠️ Las fuentes estándar del PDF (Helvetica) NO traen «→», «✔», «✕», «●» ni «★»: un
 * carácter que la fuente no tiene se imprime como otro (la flecha salió como apóstrofo).
 * Todos esos signos van dibujados en SVG, nunca como texto.
 */

import { Fragment, type ReactNode } from 'react'
import {
  Circle,
  Defs,
  Document,
  Image as PdfImage,
  LinearGradient,
  Page,
  Path,
  Polygon,
  Rect,
  Stop,
  Svg,
  Text,
  View,
} from '@react-pdf/renderer'

import type { CotizacionPDFProps, FotoPDF, PrecioPorHabitacionPDF, PrecioPorPasajeroPDF, ViajePDF } from './cotizacion-props'
import { creditosDeFotos } from './fotos-del-viaje'
import {
  ALTO_ENCABEZADO_VUELOS,
  CANAL_COLUMNAS,
  TOKENS as C,
  absorberRedondeo,
  altoEstimadoDeGrupoDeVuelos,
  capitulosDelViaje,
  circuloDeFecha,
  claveDeFecha,
  clienteDeLaPortada,
  colorDeSigla,
  colorDeTarifa,
  conAnio,
  diaADiaSeImprime,
  diaDeLaSemana,
  disposicionDeListas,
  encuadreDeFoto,
  esDeLaPrincipal,
  fechaDelDia,
  fechaEnCapitulo,
  gruposPorDia,
  leerFecha,
  lugarConCodigo,
  lugarLegible,
  numerosDeVuelo,
  rangoCompacto,
  renglonesDeFotos,
  siglaAerolinea,
  sinTildes,
  tablaDeVuelosVaEntera,
  textosDeTarjetaHotel,
  tieneRegreso,
  tituloConAcento,
  yaLoDiceLaPortada,
  type Capitulo,
  type Fecha,
  type ListaDelCierre,
} from './cotizacion-trappvel-formato'
import { partirPalabraLarga } from '@/lib/cotizaciones/condiciones-comerciales'
import { estructurarTerminos, type BloqueDeTerminos } from '@/lib/cotizaciones/terminos-cotizacion'
import { tituloDeBloquePDF } from '@/lib/cotizaciones/itinerarios'
import { textoIvaIncluido } from '@/lib/fiscal/iva-cotizacion'
import type { HotelPDF, VueloPDF } from '@/lib/cotizaciones/detalle-viaje'

/** Ver la nota de `SIN_GUION` en la plantilla de Termotech: la regla es por `<Text>`. */
const SIN_GUION = partirPalabraLarga

const ANCHO_PAGINA = 595.28
const MARGEN = 40
const ANCHO_CONTENIDO = ANCHO_PAGINA - MARGEN * 2
const ALTO_PIE = 26

const pesos = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const NOMBRE_PASAJERO: Record<'adulto' | 'nino' | 'infante', string> = {
  adulto: 'Adulto',
  nino: 'Niño',
  infante: 'Infante',
}

/** Un viaje vacío: lo que recibe una cotización que no es de viaje. No rompe nada. */
const VIAJE_VACIO: ViajePDF = {
  viajeros: null,
  destino: null,
  fechas: null,
  duracion: null,
  presentacion: null,
  foto: null,
  vuelos: [],
  hoteles: [],
  cargosEnDestino: [],
  nivelDetalle: 'normal',
  pie: null,
  firma: null,
}

// ── Piezas de dibujo ──────────────────────────────────────────────────────────

/** El degradado de la marca: magenta → púrpura → azul, horizontal (§2). */
function Degradado({ ancho, alto, id }: { ancho: number; alto: number; id: string }) {
  return (
    <Svg width={ancho} height={alto} style={{ position: 'absolute', top: 0, left: 0 }}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={C.magenta} />
          <Stop offset="0.5" stopColor={C.purpura} />
          <Stop offset="1" stopColor={C.azul} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={ancho} height={alto} fill={`url(#${id})`} />
    </Svg>
  )
}

function Flecha({ color = C.texto, alto = 7 }: { color?: string; alto?: number }) {
  return (
    <Svg width={alto * 1.4} height={alto} viewBox="0 0 14 10" style={{ marginHorizontal: 3 }}>
      <Path d="M1 5 H12 M8.5 1.5 L12 5 L8.5 8.5" stroke={color} strokeWidth={1.4} fill="none" />
    </Svg>
  )
}

function IconoCheck({ color, tam = 8 }: { color: string; tam?: number }) {
  return (
    <Svg width={tam} height={tam} viewBox="0 0 10 10">
      <Path d="M1.5 5.2 L4 7.7 L8.7 2.3" stroke={color} strokeWidth={1.6} fill="none" />
    </Svg>
  )
}

function IconoX({ color, tam = 8 }: { color: string; tam?: number }) {
  return (
    <Svg width={tam} height={tam} viewBox="0 0 10 10">
      <Path d="M2 2 L8 8 M8 2 L2 8" stroke={color} strokeWidth={1.6} fill="none" />
    </Svg>
  )
}

/** Los íconos de sección: línea magenta de 1,6 sobre el círculo gris (§2, el de «Vuelos»). */
type IconoDeSeccion = 'avion' | 'dinero' | 'incluye' | 'alerta' | 'calendario' | 'opcionales' | 'destino' | 'maleta' | 'info'

function Trazos({ tipo }: { tipo: IconoDeSeccion }) {
  const t = { stroke: C.magenta, strokeWidth: 1.6, fill: 'none' }
  switch (tipo) {
    case 'avion':
      return <Path d="M2 11 L22 2 L15 22 L11 13 Z M11 13 L22 2" {...t} />
    case 'dinero':
      return (
        <>
          <Rect x="2.5" y="6" width="19" height="12" rx="2" {...t} />
          <Circle cx="12" cy="12" r="3" {...t} />
        </>
      )
    case 'incluye':
      return <Path d="M4.5 12.5 L9.5 17.5 L19.5 6.5" {...t} />
    case 'alerta':
      return <Path d="M12 3 L22 20.5 H2 Z M12 9.5 V14 M12 16.8 V17.6" {...t} />
    case 'calendario':
      return <Path d="M3.5 5.5 H20.5 V20.5 H3.5 Z M3.5 10 H20.5 M8 3 V7.5 M16 3 V7.5" {...t} />
    case 'opcionales':
      return <Path d="M12 4 V20 M4 12 H20" {...t} />
    case 'destino':
      return (
        <>
          <Path d="M12 21.5 C12 21.5 5 14.5 5 9.5 C5 5.6 8.1 2.5 12 2.5 C15.9 2.5 19 5.6 19 9.5 C19 14.5 12 21.5 12 21.5 Z" {...t} />
          <Circle cx="12" cy="9.5" r="2.6" {...t} />
        </>
      )
    case 'maleta':
      return <Path d="M3 8 H21 V20 H3 Z M8.5 8 V4.5 H15.5 V8 M3 13 H21" {...t} />
    case 'info':
      return (
        <>
          <Circle cx="12" cy="12" r="9" {...t} />
          <Path d="M12 10.5 V16.5 M12 7 V7.8" {...t} />
        </>
      )
  }
}

function IconoSeccion({ tipo }: { tipo: IconoDeSeccion }) {
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: C.tarjeta,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
      }}
    >
      <Svg width={12} height={12} viewBox="0 0 24 24">
        <Trazos tipo={tipo} />
      </Svg>
    </View>
  )
}

/** Estrellas del hotel en `dorado`. ⚠️ Hoy nunca se dibujan: la lectura no trae el campo. */
function Estrellas({ n }: { n: number }) {
  const puntos = '5,0.6 6.5,3.8 10,4.2 7.4,6.6 8.1,10 5,8.3 1.9,10 2.6,6.6 0,4.2 3.5,3.8'
  return (
    <View style={{ flexDirection: 'row', marginLeft: 6 }}>
      {Array.from({ length: Math.min(n, 5) }).map((_, i) => (
        <Svg key={`estrella-${i}`} width={8} height={8} viewBox="0 0 10 10" style={{ marginRight: 1 }}>
          <Polygon points={puntos} fill={C.dorado} />
        </Svg>
      ))}
    </View>
  )
}

/** Pastilla de color con texto blanco: tarifa o sigla de aerolínea (§2: radio de cápsula). */
function Chip({ texto, color }: { texto: string; color: string }) {
  return (
    <View
      style={{
        backgroundColor: color,
        borderRadius: 7,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginRight: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.blanco, letterSpacing: 0.8 }}>
        {texto.toUpperCase()}
      </Text>
    </View>
  )
}

/** Mayúsculas espaciadas sobre un título (§2: 8,5 pt, espaciado 0,18 em). */
function Antetitulo({ texto, color, punto }: { texto: string; color: string; punto?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {punto && <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.magenta, marginRight: 5 }} />}
      <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold', color, letterSpacing: 1.5 }}>{texto}</Text>
    </View>
  )
}

/**
 * El título de una sección (§2: 22 pt, mayúscula inicial), SIEMPRE con su ícono en el círculo
 * gris, como «Vuelos». Desde el 2026-09-23 es el mismo para todas las secciones: «Incluido»
 * iba en verde a 14 pt, «A tener en cuenta» en rojo, «Día a día» en un antetítulo de 8,5 y
 * «Antes de viajar» dentro de su recuadro: cinco estilos para la misma jerarquía.
 *
 * ⚠️⚠️ Un título NUNCA va solo: quien lo usa lo mete en un `View wrap={false}` junto con
 * el primer renglón de lo que titula. `minPresenceAhead` no sirve aquí, y parecía que sí:
 * react-pdf solo corta ANTES de un elemento que tenga hermanos antes en su mismo padre, y
 * un título es siempre el primer hijo de su sección. Medido: el rótulo «DÍA A DÍA» quedó
 * solo al pie de la página con el `minPresenceAhead` puesto.
 */
function Titulo({ texto, icono }: { texto: string; icono: IconoDeSeccion }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 10 }}>
      <IconoSeccion tipo={icono} />
      <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: C.tinta }}>{texto}</Text>
    </View>
  )
}

/** El rótulo de una foto: mayúsculas blancas sobre una veladura negra al 35 % (§4.2). */
function Rotulo({ texto, chico = false, ancho }: { texto: string; chico?: boolean; ancho?: number }) {
  const borde = chico ? 8 : 10
  return (
    <View
      style={{
        position: 'absolute',
        left: borde,
        bottom: borde,
        // En una miniatura el rótulo largo parte renglón en vez de salirse de la foto.
        maxWidth: ancho ? ancho - borde * 2 : undefined,
        backgroundColor: 'rgba(0,0,0,0.35)',
        borderRadius: 4,
        paddingVertical: chico ? 2.5 : 3,
        paddingHorizontal: chico ? 6 : 7,
      }}
    >
      <Text style={{ fontSize: chico ? 6 : 7, color: C.blanco, letterSpacing: chico ? 0.8 : 1.2 }}>{texto.toUpperCase()}</Text>
    </View>
  )
}

/**
 * La foto de portada, a todo el ancho (§4.2), encuadrada en su foco: la de Johnny Cay dejaba
 * la isla en el borde de arriba porque el recorte iba por el centro.
 */
function FotoConRotulo({ foto, alto }: { foto: FotoPDF; alto: number }) {
  return (
    <View wrap={false} style={{ marginTop: 14, position: 'relative' }}>
      <PdfImage
        src={foto.url}
        style={{
          width: ANCHO_CONTENIDO,
          height: alto,
          objectFit: 'cover',
          objectPosition: encuadreDeFoto(foto.foco, foto.proporcion, ANCHO_CONTENIDO / alto),
          borderRadius: 8,
        }}
      />
      {foto.rotulo && <Rotulo texto={foto.rotulo} />}
    </View>
  )
}

/**
 * La miniatura al lado del hotel (una sola foto en el capítulo) mide un tercio del ancho
 * menos el canal, en 3:2. En la franja cada foto recibe el marco de su renglón.
 *
 * ⚠️ Antes del foco por foto (#832) una franja 3,6 veces más ancha que alta recortaba al
 * centro, y en «El Acuario» solo se veía cielo. Un marco apaisado solo sirve porque el
 * recorte lo guía el foco de cada foto (`encuadreDeFoto`), recalculado para ESE marco.
 */
const CANAL_FOTOS = 8
const ANCHO_MINIATURA = (ANCHO_CONTENIDO - CANAL_FOTOS * 2) / 3
const ALTO_MINIATURA = ANCHO_MINIATURA / 1.5

function Miniatura({ foto, ancho = ANCHO_MINIATURA, alto = ALTO_MINIATURA }: { foto: FotoPDF; ancho?: number; alto?: number }) {
  return (
    <View style={{ width: ancho, height: alto, position: 'relative' }}>
      <PdfImage
        src={foto.url}
        style={{
          width: ancho,
          height: alto,
          objectFit: 'cover',
          // El recorte se recalcula para la forma de ESTE marco: el foco es de la foto.
          objectPosition: encuadreDeFoto(foto.foco, foto.proporcion, ancho / alto),
          borderRadius: 8,
        }}
      />
      {foto.rotulo && <Rotulo texto={foto.rotulo} chico ancho={ancho} />}
    </View>
  )
}

/**
 * Varias fotos en renglones que llenan el ancho: dos van a mitades, tres a tercios, una a
 * todo el ancho, y todo renglón con el alto del de tres (`renglonesDeFotos`). Hasta el
 * 2026-09-23 cada foto medía un tercio fuera cual fuera la cuenta, y con dos quedaba un
 * hueco a la derecha. No se parte entre páginas.
 */
function FranjaDeFotos({ fotos }: { fotos: FotoPDF[] }) {
  if (fotos.length === 0) return null
  return (
    <View wrap={false} style={{ marginTop: 14 }}>
      {renglonesDeFotos(fotos.length, ANCHO_CONTENIDO, CANAL_FOTOS).map((r, i) => (
        <View key={`renglon-${i}`} style={{ flexDirection: 'row', marginTop: i === 0 ? 0 : CANAL_FOTOS }}>
          {fotos.slice(r.desde, r.desde + r.fotos).map((f, j) => (
            <View key={`foto-${j}`} style={{ marginLeft: j === 0 ? 0 : CANAL_FOTOS }}>
              <Miniatura foto={f} ancho={r.ancho} alto={r.alto} />
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

function Ficha({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 0, paddingHorizontal: 9 }}>
      <Text style={{ fontSize: 6.5, color: C.gris, letterSpacing: 1 }}>{etiqueta}</Text>
      <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.tinta, marginTop: 3 }}>
        {valor}
      </Text>
    </View>
  )
}

/** «Bogotá (BOG) → Providencia (PVA)», con la flecha dibujada. */
function Ruta({ desde, hasta, tam = 8.5, color = C.tinta, negrita = false }: {
  desde: string | null
  hasta: string | null
  tam?: number
  color?: string
  negrita?: boolean
}) {
  const estilo = { fontSize: tam, color, fontFamily: negrita ? 'Helvetica-Bold' : 'Helvetica' }
  if (!desde || !hasta) return <Text hyphenationCallback={SIN_GUION} style={estilo}>{desde ?? hasta ?? ''}</Text>
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
      <Text hyphenationCallback={SIN_GUION} style={estilo}>{desde}</Text>
      <Flecha color={color} alto={tam * 0.8} />
      <Text hyphenationCallback={SIN_GUION} style={estilo}>{hasta}</Text>
    </View>
  )
}

// ── Tarifas ───────────────────────────────────────────────────────────────────

interface TarifaDoc {
  titulo: string
  color: string
  esPrincipal: boolean
}

function ChipsDeTarifa({ tarifas, de }: { tarifas: TarifaDoc[]; de: { tarifas?: number[] } }) {
  const propias = (de.tarifas ?? []).map(i => tarifas[i]).filter((t): t is TarifaDoc => t !== undefined)
  if (propias.length === 0) return null
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
      {propias.map(t => <Chip key={t.titulo} texto={t.titulo} color={t.color} />)}
    </View>
  )
}

// ── Hotel (§4.3) ──────────────────────────────────────────────────────────────

function TarjetaHotel({ h, general, tarifas, arriba = false }: { h: HotelPDF; general: boolean; tarifas: TarifaDoc[]; arriba?: boolean }) {
  // Los textos salen de `textosDeTarjetaHotel`, la misma función que pinta «Así lo ve el
  // cliente» en la tarjeta de la opción del editor.
  const t = textosDeTarjetaHotel(h, general)
  return (
    <View wrap={false} style={{ flexDirection: 'row', backgroundColor: C.tarjeta, borderRadius: 8, padding: 11, marginTop: arriba ? 0 : 12 }}>
      {h.foto && (
        <PdfImage src={h.foto.url} style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 8, marginRight: 11 }} />
      )}
      <View style={{ flex: 1 }}>
        <ChipsDeTarifa tarifas={tarifas} de={h} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
          <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.tinta }}>
            {t.nombre}
          </Text>
          {t.estrellas ? <Estrellas n={t.estrellas} /> : null}
        </View>
        {t.resumen !== '' && (
          <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 9.5, color: C.texto, marginTop: 3 }}>{t.resumen}</Text>
        )}
        {t.condiciones !== '' && (
          <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, color: C.gris, marginTop: 3 }}>{t.condiciones}</Text>
        )}
        {/* El adicional vive dentro de su bloque, en los tres niveles: es plata que el
            cliente paga. Sin cifra: el dinero va en «Inversión». */}
        {t.adicionales && (
          <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, color: C.gris, marginTop: 2 }}>
            {t.adicionales}
          </Text>
        )}
        {/* P2 · la nota que escribió una persona para el cliente, debajo de la tarjeta. */}
        {t.nota ? (
          <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, color: C.texto, marginTop: 3 }}>{t.nota}</Text>
        ) : null}
      </View>
    </View>
  )
}

/** El hotel de otra tarifa en la misma ciudad: una línea, con su chip. */
function LineaHotelAlternativo({ h, general, tarifas }: { h: HotelPDF; general: boolean; tarifas: TarifaDoc[] }) {
  const texto = [h.hotel ?? h.linea, !general ? h.regimen : null, !general ? h.habitacion : null].filter(Boolean).join(' · ')
  return (
    <View wrap={false} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, paddingHorizontal: 11 }}>
      <ChipsDeTarifa tarifas={tarifas} de={h} />
      <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 9, color: C.texto, marginLeft: 2, flex: 1 }}>{texto}</Text>
    </View>
  )
}

// ── Línea de tiempo (§4.3) ────────────────────────────────────────────────────

interface EntradaTiempo {
  fecha: Fecha | null
  /** El día relativo, para el círculo cuando no hay fecha: «DÍA 3». */
  dia: number | null
  titulo: { texto: string } | { desde: string | null; hasta: string | null }
  subtitulo: { texto: string } | { aerolinea: string | null; salida: string | null; llegada: string | null } | null
  vinetas: string[]
  notas: string[]
  orden: number
}

function Circulo({ e }: { e: EntradaTiempo }) {
  const c = e.fecha ? circuloDeFecha(e.fecha) : { arriba: 'DÍA', abajo: String(e.dia ?? '') }
  const conFecha = e.fecha !== null
  return (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: C.magenta,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: conFecha ? 12 : 6.5, fontFamily: 'Helvetica-Bold', color: C.blanco, lineHeight: 1 }}>{c.arriba}</Text>
      <Text style={{ fontSize: conFecha ? 6.5 : 12, fontFamily: 'Helvetica-Bold', color: C.blanco, lineHeight: 1, marginTop: 1 }}>{c.abajo}</Text>
    </View>
  )
}

/** Una tarjeta del día a día: un vuelo o una actividad. */
function TarjetaDelDia({ e, primera }: { e: EntradaTiempo; primera: boolean }) {
  return (
    <View style={{ marginTop: primera ? 0 : 6, backgroundColor: C.tarjeta, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 }}>
      {'texto' in e.titulo ? (
        <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.tinta }}>
          {e.titulo.texto}
        </Text>
      ) : (
        <Ruta desde={e.titulo.desde} hasta={e.titulo.hasta} tam={10} negrita />
      )}
      {e.subtitulo && ('texto' in e.subtitulo ? (
        <Text style={{ fontSize: 8.5, color: C.purpura, marginTop: 2 }}>{e.subtitulo.texto}</Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <Text style={{ fontSize: 8.5, color: C.purpura }}>
            {[e.subtitulo.aerolinea, e.subtitulo.salida].filter(Boolean).join(' · ')}
          </Text>
          {e.subtitulo.salida && e.subtitulo.llegada && <Flecha color={C.purpura} alto={6} />}
          {e.subtitulo.llegada && <Text style={{ fontSize: 8.5, color: C.purpura }}>{e.subtitulo.llegada}</Text>}
        </View>
      ))}
      {e.notas.map((n, j) => (
        <Text key={`n-${j}`} hyphenationCallback={SIN_GUION} style={{ fontSize: 8, color: C.gris, marginTop: 2 }}>{n}</Text>
      ))}
      {e.vinetas.map((v, j) => (
        <View key={`v-${j}`} style={{ flexDirection: 'row', marginTop: 3 }}>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: C.magenta, marginTop: 3.5, marginRight: 6 }} />
          <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 9, color: C.texto, flex: 1 }}>{v}</Text>
        </View>
      ))}
    </View>
  )
}

/**
 * El día a día: un bloque por DÍA, que no se parte. El círculo va una vez por día y las
 * tarjetas de ese día (el vuelo que llega, el traslado de la tarde) quedan juntas.
 *
 * El título viaja con el primer día (#819, afinado el 2026-09-23): solo al pie de la
 * página parece un corte. Si el bloque no cabe, pasa entero a la página que sigue.
 */
function LineaDeTiempo({ entradas }: { entradas: EntradaTiempo[] }) {
  if (entradas.length === 0) return null
  const dias = gruposPorDia(entradas).map((grupo, i) => (
    <View key={`dia-${i}`} wrap={false} style={{ flexDirection: 'row', marginTop: i === 0 ? 0 : 8 }}>
      <View style={{ width: 34, marginRight: 10 }}><Circulo e={grupo[0]} /></View>
      <View style={{ flex: 1 }}>
        {grupo.map((e, j) => <TarjetaDelDia key={`t-${j}`} e={e} primera={j === 0} />)}
      </View>
    </View>
  ))
  return (
    <View>
      <View wrap={false}>
        <Titulo texto="Día a día" icono="calendario" />
        {dias[0]}
      </View>
      {dias.slice(1)}
    </View>
  )
}

// ── Vuelos (§4.4) ─────────────────────────────────────────────────────────────

type ColumnaVuelo = 'aerolinea' | 'ruta' | 'fecha' | 'salida' | 'llegada' | 'vuelo'

const TITULO_COLUMNA: Record<ColumnaVuelo, string> = {
  aerolinea: 'AEROLÍNEA',
  ruta: 'RUTA',
  fecha: 'FECHA',
  salida: 'SALIDA',
  llegada: 'LLEGADA',
  vuelo: 'VUELO',
}

/** El ancho relativo de cada columna. Se reparte entre las que efectivamente salen. */
const PESO_COLUMNA: Record<ColumnaVuelo, number> = {
  aerolinea: 21,
  ruta: 37,
  fecha: 14,
  salida: 9,
  llegada: 10,
  vuelo: 11,
}

/** Aire entre columnas: sin él la caja de una termina donde empieza el texto de la otra. */
const CANAL = 6

interface FilaVuelo {
  vuelo: VueloPDF
  desde: string | null
  hasta: string | null
  escala: string | null
  fecha: string | null
  salida: string | null
  llegada: string | null
  numero: string | null
}

/**
 * Los números de vuelo que no se sabe a qué tramo pertenecen. Van bajo el vuelo entero, en
 * la línea gris: pegados a la ida afirmarían que el regreso no tiene vuelo.
 */
function numerosSinTramo(v: VueloPDF): string | null {
  const { sinAsignar } = numerosDelVuelo(v)
  if (!sinAsignar) return null
  return `${sinAsignar.includes('·') ? 'Vuelos' : 'Vuelo'} ${sinAsignar}`
}

/**
 * Los números de cada fila: los de los tramos del vuelo (B3) cuando vienen repartidos, y si
 * no, el reparto del número leído. ⚠️ Un número de regreso sin fila de regreso (la captura
 * leyó una hora que no se entiende) se perdería: ahí manda el reparto de siempre.
 */
function numerosDelVuelo(v: VueloPDF): { ida: string | null; regreso: string | null; sinAsignar: string | null } {
  const regreso = tieneRegreso(v)
  if (v.numeros && (regreso || !v.numeros.regreso)) return v.numeros
  return numerosDeVuelo(v.numeroVuelo, regreso)
}

function filasDelVuelo(v: VueloPDF): FilaVuelo[] {
  const regreso = tieneRegreso(v)
  const numeros = numerosDelVuelo(v)
  // `escalas === 0` es la ÚNICA forma de afirmar «directo»: un `escalaIda` vacío puede ser
  // un vuelo directo o una pantalla que no mostró el recorrido, y son cosas distintas.
  const escala = (e: string | null) => (e ? `Escala en ${lugarLegible(e)}` : v.escalas === 0 ? 'Vuelo directo' : null)
  const filas: FilaVuelo[] = [{
    vuelo: v,
    desde: lugarLegible(v.origen),
    hasta: lugarLegible(v.destino),
    escala: escala(v.escalaIda),
    fecha: v.fechaSalida,
    salida: v.horaSalida,
    llegada: v.horaLlegada,
    numero: numeros.ida,
  }]
  // El regreso existe cuando la captura leyó ALGO suyo, y su ruta es la de la ida al revés.
  if (regreso) {
    filas.push({
      vuelo: v,
      desde: lugarLegible(v.destino),
      hasta: lugarLegible(v.origen),
      escala: escala(v.escalaRegreso),
      fecha: v.fechaRegreso,
      salida: v.horaSalidaRegreso,
      llegada: v.horaLlegadaRegreso,
      numero: numeros.regreso,
    })
  }
  return filas
}

function TablaVuelos({ vuelos, general, tarifas, titulo }: { vuelos: VueloPDF[]; general: boolean; tarifas: TarifaDoc[]; titulo?: ReactNode }) {
  const grupos = vuelos.map(v => ({ v, filas: filasDelVuelo(v) }))
  const todas = grupos.flatMap(g => g.filas)
  // Las columnas NO son fijas: una columna vacía es la «tabla con guiones» que este
  // documento no puede tener. VUELO sale solo si alguna fila trae número (decisión de
  // Mauricio, 2026-09-22).
  const columnas = (['aerolinea', 'ruta', 'fecha', 'salida', 'llegada', 'vuelo'] as ColumnaVuelo[]).filter(c => {
    if (c === 'aerolinea' || c === 'ruta') return true
    return todas.some(f => (f[c === 'vuelo' ? 'numero' : c] ?? '') !== '')
  })
  const total = columnas.reduce((a, c) => a + PESO_COLUMNA[c], 0)
  const ancho = (c: ColumnaVuelo) => `${(PESO_COLUMNA[c] / total) * 100}%`
  const pad = (j: number) => (j === columnas.length - 1 ? 0 : CANAL)

  const celda = (f: FilaVuelo, c: ColumnaVuelo): ReactNode => {
    if (c === 'aerolinea') {
      const sigla = siglaAerolinea(f.vuelo.aerolinea, f.vuelo.numeroVuelo)
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {sigla && (
            <View
              style={{
                width: 22,
                height: 14,
                borderRadius: 7,
                backgroundColor: colorDeSigla(sigla),
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 5,
              }}
            >
              <Text style={{ fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.blanco }}>{sigla}</Text>
            </View>
          )}
          <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.tinta, flex: 1 }}>
            {f.vuelo.aerolinea ?? f.vuelo.linea}
          </Text>
        </View>
      )
    }
    if (c === 'ruta') {
      return (
        <View>
          <Ruta desde={f.desde} hasta={f.hasta} />
          {f.escala && <Text style={{ fontSize: 7.5, color: C.gris, marginTop: 1 }}>{f.escala}</Text>}
          <ChipsDeTarifa tarifas={tarifas} de={f.vuelo} />
        </View>
      )
    }
    const valor = c === 'vuelo' ? f.numero : f[c]
    return <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, color: C.tinta }}>{valor ?? ''}</Text>
  }

  // Encabezado en degradado con texto blanco en negrita.
  const encabezado = (
      <View style={{ position: 'relative', height: 18, borderRadius: 4 }}>
        <Degradado ancho={ANCHO_CONTENIDO} alto={18} id="degradado-vuelos" />
        <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingTop: 5.5 }}>
          {columnas.map((c, j) => (
            <Text
              key={`th-${c}`}
              style={{ width: ancho(c), paddingRight: pad(j), fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.blanco, letterSpacing: 0.8 }}
            >
              {TITULO_COLUMNA[c]}
            </Text>
          ))}
        </View>
      </View>
  )
  const metas = grupos.map(g => [
    numerosSinTramo(g.v),
    !general ? g.v.tarifa : null,
    !general ? g.v.equipaje : null,
    // §1.2 · el adicional va DENTRO del vuelo y sale en los TRES niveles: es plata
    // que el cliente paga. Sin cifra: el dinero vive en «Inversión».
    g.v.adicionales.length > 0 ? `Adicionales: ${g.v.adicionales.join(' · ')}` : null,
  ].filter(Boolean).join(' · '))
  const bloques = grupos.map((g, gi) => {
        const meta = metas[gi]
        return (
          <View
            key={`vuelo-${gi}`}
            wrap={false}
            style={{ backgroundColor: gi % 2 === 1 ? C.tarjeta : C.blanco, paddingHorizontal: 8, paddingVertical: 6 }}
          >
            {g.filas.map((f, fi) => (
              <View key={`f-${fi}`} style={{ flexDirection: 'row', marginTop: fi === 0 ? 0 : 5 }}>
                {columnas.map((c, j) => (
                  <View key={`td-${c}`} style={{ width: ancho(c), paddingRight: pad(j) }}>{celda(f, c)}</View>
                ))}
              </View>
            ))}
            {meta !== '' && (
              <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7.5, color: C.gris, marginTop: 4 }}>{meta}</Text>
            )}
            {/* P2 · la nota que escribió una persona para el cliente, debajo del vuelo. */}
            {g.v.nota ? (
              <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7.5, color: C.texto, marginTop: 3 }}>{g.v.nota}</Text>
            ) : null}
          </View>
        )
      })
  // Cada aerolínea (sus tramos y su nota de equipaje) es un bloque que no se parte.
  // Lo que se decide aquí es qué pasa con la TABLA cuando no cabe en lo que queda de hoja.
  const altos = grupos.map((g, gi) => altoEstimadoDeGrupoDeVuelos({
    filas: g.filas.map(f => ({
      conEscala: Boolean(f.escala),
      conTarifa: (f.vuelo.tarifas ?? []).some(i => tarifas[i] !== undefined),
    })),
    meta: metas[gi],
  }, ANCHO_CONTENIDO - 16))

  // Tabla corta (la de casi todo viaje): va ENTERA, con su título, a la hoja donde quepa.
  // Partirla deja el encabezado en una hoja y la mitad de las aerolíneas en la otra, sin
  // columnas que las nombren; mover la tabla completa cuesta como mucho un tercio de hoja
  // en blanco, la misma regla que ya aplican las listas del cierre.
  if (tablaDeVuelosVaEntera(altos)) {
    return (
      <View wrap={false}>
        {titulo}
        {encabezado}
        {bloques}
      </View>
    )
  }

  // Tabla larga: se parte entre aerolíneas y el encabezado se REPITE en cada hoja. En
  // react-pdf un hijo `fixed` se copia en cada trozo del View que lo contiene (no en cada
  // página del documento): por eso vive dentro del contenedor de la tabla y no en la hoja.
  // El título (con su marca de presencia) queda HERMANO del contenedor para no ser su
  // primer hijo: `minPresenceAhead` no actúa sobre un primer hijo, y así el título nunca
  // queda solo al pie. La marca pide que quepan el encabezado y la primera aerolínea.
  return (
    <>
      <View minPresenceAhead={ALTO_ENCABEZADO_VUELOS + altos[0] + 20}>{titulo}</View>
      <View>
        <View fixed>{encabezado}</View>
        {bloques}
      </View>
    </>
  )
}

// ── Inversión (§4.5) ──────────────────────────────────────────────────────────

/** El precio de un pasajero de cada tipo, en una línea. */
function PorPasajero({ precios, habitaciones, color }: { precios: PrecioPorPasajeroPDF; habitaciones?: PrecioPorHabitacionPDF; color: string }) {
  // R8 · regla 8: sin precio por pasajero, el de cada habitación.
  if ((!precios || precios.length === 0) && habitaciones && habitaciones.length > 0) {
    return (
      <Text style={{ fontSize: 7, color, marginTop: 2 }}>
        {habitaciones.map(h => `Habitación ${h.numero} (${h.ocupacion}) ${pesos(h.precio)}`).join('  ·  ')}
      </Text>
    )
  }
  if (!precios || precios.length === 0) return null
  return (
    <Text style={{ fontSize: 7, color, marginTop: 2 }}>
      {precios.map(p => `${NOMBRE_PASAJERO[p.tipo]} ${pesos(p.precioUnitario)}`).join('  ·  ')}
    </Text>
  )
}

/** Una línea de dinero ya resuelta: lo que se imprime en «Inversión». */
interface LineaImpresa {
  nombre: string
  cantidad: number
  unidad?: string | null
  adicionales?: string[]
  precioPorPasajero?: PrecioPorPasajeroPDF
  precioPorHabitacion?: PrecioPorHabitacionPDF
  total: number
}

/**
 * De las líneas que llegan a las que se imprimen.
 *
 * ⚠️ El adicional entra en el total de SU línea. `precio_venta` es el precio BASE de la
 * variante: sin este sumando, la columna que el cliente suma quedaría por debajo del
 * TOTAL, que sí los incluye. Ausente vale 0.
 */
function lineasImpresas(
  items: { nombre: string; precio_venta: number; descuento_porcentaje: number; cantidad: number; unidad?: string | null; adicionales?: string[]; valorAdicionales?: number; precioPorPasajero?: PrecioPorPasajeroPDF; precioPorHabitacion?: PrecioPorHabitacionPDF }[],
): LineaImpresa[] {
  return items.map(i => {
    const cantidad = i.cantidad ?? 1
    const base = Math.round(i.precio_venta * cantidad * (1 - (i.descuento_porcentaje || 0) / 100))
    return {
      nombre: i.nombre,
      cantidad,
      unidad: i.unidad,
      adicionales: i.adicionales,
      precioPorPasajero: i.precioPorPasajero,
      ...(i.precioPorHabitacion ? { precioPorHabitacion: i.precioPorHabitacion } : {}),
      total: base + (i.valorAdicionales ?? 0),
    }
  })
}

/** Lo que mide la franja de totales, para que ninguna fila la deje huérfana. */
const ALTO_TOTALES = 70

/** Hasta cuántas líneas la «Inversión» con una tarifa va entera en una página. Más que
 *  eso se parte, con el TOTAL pegado a la última línea. */
const LINEAS_EN_UN_BLOQUE = 8

/** Alto del cierre (créditos al lado de la firma) con su margen: lo que la última sección
 *  pide tener debajo en su misma página. */
const ALTO_CIERRE = 70

/**
 * Una fila de dinero: el concepto a la izquierda, su total a la derecha.
 *
 * ⚠️ `minPresenceAhead` reserva el alto de la franja de totales: sin él la última fila se
 * queda al pie de una página y el TOTAL aparece solo arriba de la siguiente.
 */
function LineaPrecio({ l, detallada, tam = 9, ultima = false, presenciaExtra, tarjeta }: {
  l: LineaImpresa
  detallada: boolean
  tam?: number
  ultima?: boolean
  /** Lo que la última fila pide ADEMÁS del TOTAL: el cierre, si viene detrás. */
  presenciaExtra?: number
  /**
   * Dentro de la tarjeta de «Inversión» con una tarifa: cada fila pinta su tramo del fondo
   * gris y redondea la esquina que le toca. Es la MISMA tarjeta del precio por pasajero
   * (§ un solo sistema visual, 2026-09-23): la caja blanca con borde era un tercer estilo.
   */
  tarjeta?: PosicionEnTarjeta
}) {
  const arriba = tarjeta === 'primera' || tarjeta === 'unica'
  const abajo = tarjeta === 'ultima' || tarjeta === 'unica'
  const fila = (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderBottomWidth: tarjeta && abajo ? 0 : 0.5,
        borderBottomColor: C.linea,
        paddingVertical: 4,
      }}
    >
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text hyphenationCallback={SIN_GUION} style={{ fontSize: tam, color: C.texto }}>
          {l.nombre}
          {l.cantidad > 1 ? `  ×${l.cantidad}${l.unidad ? ` ${l.unidad}` : ''}` : ''}
        </Text>
        {/* Los adicionales, DENTRO de la línea, sin cifra propia —ya están en el total de
            la derecha—, pero con nombre. Salen en los TRES niveles de detalle. */}
        {(l.adicionales?.length ?? 0) > 0 && (
          <Text hyphenationCallback={SIN_GUION} style={{ fontSize: tam - 2, color: C.gris, marginTop: 1 }}>
            {`Incluye: ${l.adicionales!.join(' · ')}`}
          </Text>
        )}
        {detallada && <PorPasajero precios={l.precioPorPasajero ?? null} habitaciones={l.precioPorHabitacion ?? null} color={C.gris} />}
      </View>
      <Text style={{ fontSize: tam, color: C.tinta }}>{pesos(l.total)}</Text>
    </View>
  )
  return (
    <View
      wrap={false}
      minPresenceAhead={ultima ? ALTO_TOTALES + (presenciaExtra ?? 0) : 0}
      style={tarjeta ? {
        backgroundColor: C.tarjeta,
        borderTopLeftRadius: arriba ? 8 : 0,
        borderTopRightRadius: arriba ? 8 : 0,
        borderBottomLeftRadius: abajo ? 8 : 0,
        borderBottomRightRadius: abajo ? 8 : 0,
        paddingHorizontal: 12,
        paddingTop: arriba ? 6 : 0,
        paddingBottom: abajo ? 6 : 0,
      } : undefined}
    >
      {fila}
    </View>
  )
}

type PosicionEnTarjeta = 'unica' | 'primera' | 'media' | 'ultima'

// ── Incluido, a tener en cuenta y antes de viajar (§4.6, §4.9) ───────────────

const LISTAS: Record<ListaDelCierre, { titulo: string; icono: IconoDeSeccion }> = {
  incluye: { titulo: 'Incluido en el plan', icono: 'incluye' },
  noIncluye: { titulo: 'A tener en cuenta', icono: 'alerta' },
  antes: { titulo: 'Antes de viajar', icono: 'maleta' },
}

/**
 * Un ítem de lista, con el marcador de SU lista: chulo verde lo que incluye, equis roja lo
 * que no, viñeta en «Antes de viajar».
 *
 * «Antes de viajar» era un recuadro ámbar con los consejos unidos por « · » en un solo
 * párrafo. Ahora es una lista, y el ámbar queda solo como la franja delgada de la izquierda
 * (§ un solo sistema visual, 2026-09-23). El aire entre ítems va por dentro (`paddingBottom`)
 * para que la franja no se corte entre uno y otro.
 */
function ItemDeLista({ lista, texto, ultimo, presencia }: {
  lista: ListaDelCierre
  texto: string
  ultimo: boolean
  /** Lo que este ítem pide tener debajo en su página: el cierre, si es lo último. */
  presencia?: number
}) {
  const antes = lista === 'antes'
  return (
    <View
      wrap={false}
      minPresenceAhead={presencia}
      style={{
        flexDirection: 'row',
        paddingBottom: ultimo ? 0 : 4,
        ...(antes ? { borderLeftWidth: 2, borderLeftColor: C.ambarBorde, paddingLeft: 10 } : {}),
      }}
    >
      <View style={{ width: 14, paddingTop: antes ? 4.5 : 1.5 }}>
        {lista === 'incluye' && <IconoCheck color={C.verde} />}
        {lista === 'noIncluye' && <IconoX color={C.rojo} />}
        {antes && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: C.magenta }} />}
      </View>
      <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 9, color: C.texto, flex: 1, lineHeight: 1.3 }}>{texto}</Text>
    </View>
  )
}

/** Una lista entera dentro de una columna: la fila de dos columnas no se parte. */
function ListaEnColumna({ lista, items }: { lista: ListaDelCierre; items: string[] }) {
  return (
    <View>
      <Titulo texto={LISTAS[lista].titulo} icono={LISTAS[lista].icono} />
      {items.map((t, i) => <ItemDeLista key={`${lista}-${i}`} lista={lista} texto={t} ultimo={i === items.length - 1} />)}
    </View>
  )
}

// ── Términos y condiciones (brief del 2026-09-23, C2) ────────────────────────

/**
 * Los términos en piezas que no se parten: un subtítulo va con su primer renglón, para que
 * «Medios de pago» nunca quede solo al pie de una página. Lo demás, un renglón por pieza.
 */
function piezasDeTerminos(bloques: BloqueDeTerminos[]): BloqueDeTerminos[][] {
  const piezas: BloqueDeTerminos[][] = []
  for (const b of bloques) {
    const ultima = piezas[piezas.length - 1]
    if (ultima && ultima.length === 1 && ultima[0].tipo === 'subtitulo') ultima.push(b)
    else piezas.push([b])
  }
  return piezas
}

/** Un bloque de los términos: letra chica, porque es lo que se consulta, no lo que se lee primero. */
function BloqueTerminos({ b, primero }: { b: BloqueDeTerminos; primero: boolean }) {
  if (b.tipo === 'subtitulo') {
    return (
      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.tinta, marginTop: primero ? 0 : 8, marginBottom: 3 }}>
        {b.texto}
      </Text>
    )
  }
  if (b.tipo === 'vineta') {
    return (
      <View style={{ flexDirection: 'row', paddingLeft: b.nivel === 2 ? 14 : 0, paddingBottom: 2.5 }}>
        <View style={{ width: 10, paddingTop: 3.5 }}>
          <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: b.nivel === 2 ? C.gris : C.magenta }} />
        </View>
        <Text hyphenationCallback={SIN_GUION} style={{ flex: 1, fontSize: 8, color: C.texto, lineHeight: 1.35 }}>{b.texto}</Text>
      </View>
    )
  }
  return (
    <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8, color: C.texto, lineHeight: 1.35, paddingBottom: 2.5 }}>
      {b.texto}
    </Text>
  )
}

// ── Documento ─────────────────────────────────────────────────────────────────

export default function CotizacionTrappvelPDF({
  cotizacion,
  empresa,
  vendedor,
  items,
  itinerarios,
  dias,
  sugeridos,
  preciosPorPasajero,
  fiscal,
  ivaEnPrecios,
  negocio,
  emisor,
  viaje,
}: CotizacionPDFProps) {
  const v = viaje ?? VIAJE_VACIO
  const detallada = v.nivelDetalle === 'muy_detallada'
  const general = v.nivelDetalle === 'general'

  // El titular del texto para el cliente, si una persona lo revisó; si no, el de siempre.
  const titulo = (v.titular?.trim() || negocio?.nombre || cotizacion.descripcion || 'Propuesta de viaje').trim()
  const intro = v.intro?.trim() || null
  const acento = tituloConAcento(titulo, v.destino)
  const bloquesDia = (dias ?? []).filter(d => d.items.length > 0)
  const opcionales = sugeridos ?? []

  // Lo que el cliente paga: la MISMA lista que alimenta el Subtotal. Ver decisión 2.
  const lineas = lineasImpresas(items)
  const subtotal = lineas.reduce((a, l) => a + l.total, 0)
  /**
   * Con el IVA dentro de los precios (`ivaEnPrecios`), cada línea ya lo trae y el TOTAL
   * también: «Subtotal» e «IVA» no se imprimen aparte, y la nota dice cuánto IVA lleva el
   * total —si el workspace la pide (`linea_incluida`)—. Sin eso, lo de siempre.
   */
  const ivaIncluido = ivaEnPrecios ?? null
  const notaIva = ivaIncluido && ivaIncluido.nota && ivaIncluido.iva > 0 ? textoIvaIncluido(ivaIncluido.iva, pesos) : null
  const iva = ivaIncluido ? 0 : fiscal?.iva ?? 0
  const total = fiscal?.totalBruto ?? subtotal + iva

  /**
   * R7 · las TRES tarifas que van en la propuesta. Cada bloque imprime SU combinación,
   * y la RECOMENDADA va primera por ser la principal (el orden lo fija `bloquesParaPDF`):
   * es la única cuyo total coincide con el TOTAL de abajo (R5). Con una sola tarifa o
   * ninguna el arreglo queda vacío y el documento se comporta como la lista plana.
   */
  const bloques = (itinerarios ?? []).map((it, i) => {
    const t = tituloDeBloquePDF(it.nombre, it.esPrincipal, i + 1)
    const ivaDelBloque = ivaIncluido?.nota ? ivaIncluido.porBloque[i] ?? 0 : 0
    return {
      titulo: t,
      color: colorDeTarifa(t),
      esPrincipal: it.esPrincipal,
      precio: it.precio,
      /** Solo con `linea_incluida`: cuánto IVA trae el precio de esta tarifa. */
      notaIva: ivaDelBloque > 0 ? `Incluye IVA de ${pesos(ivaDelBloque)}` : null,
      lineas: lineasImpresas(it.items),
    }
  })
  const porTarifas = bloques.length > 1
  // Los chips solo existen con varias tarifas: con una, no hay nada que distinguir.
  const tarifas: TarifaDoc[] = porTarifas ? bloques : []
  const principal = porTarifas ? Math.max(0, bloques.findIndex(b => b.esPrincipal)) : null
  /**
   * ¿El TOTAL de abajo es el de una tarifa? Solo con la Recomendada en la propuesta
   * (`idDelPrincipal`). Sin ella el total sale de un supuesto, el documento es un borrador
   * (la acción lo marca) y NO puede decir «corresponde a la opción recomendada».
   */
  const totalEsDeLaRecomendada = porTarifas && bloques.some(b => b.esPrincipal)

  /**
   * Lo que la tabla por pasajero NO explica: la diferencia contra el TOTAL se imprime con
   * nombre y **cierra por construcción**, porque sale de restar. No se reparte entre los
   * viajeros: una maleta la compra alguien concreto.
   */
  const cubierto = preciosPorPasajero?.cubierto ?? null
  const diferencia = cubierto === null ? null : total - cubierto

  /**
   * ⚠️⚠️ Una diferencia de unos pocos pesos NO es un cobro por el grupo: es redondeo.
   *
   * Cada línea reparte su precio entre tipos y lo divide entre cuántos son; la división no
   * da entero y se redondea al peso. COT-2026-0006 imprimía «Se cobra por el grupo $ 2»
   * sin que nada se cobrara por el grupo. Es redondeo, y solo si las dos cosas son ciertas:
   * nada se queda fuera del reparto (`sinReparto` vacío) y la diferencia cabe en un peso por
   * pasajero de cada línea repartida, el mismo margen que ya usa `confirmadaVigente`. Se
   * absorbe en una fila para que la columna siga sumando el TOTAL; si ninguna fila puede
   * absorberlo entero, se nombra como lo que es.
   */
  const toleranciaRedondeo = lineas.reduce(
    (a, l) => a + (l.cantidad || 1) * (l.precioPorPasajero ?? []).reduce((b, p) => b + p.cantidad, 0),
    0,
  )
  const esRedondeo = diferencia !== null
    && diferencia !== 0
    && (preciosPorPasajero?.sinReparto.length ?? 0) === 0
    && Math.abs(diferencia) <= toleranciaRedondeo
  const reconciliado = esRedondeo && preciosPorPasajero
    ? absorberRedondeo(preciosPorPasajero.filas, diferencia as number)
    : { filas: preciosPorPasajero?.filas ?? [], residuo: 0 }
  const filasPorPasajero = reconciliado.filas
  const ajusteRedondeo = esRedondeo ? reconciliado.residuo : 0
  const porElGrupo = diferencia === null ? null : esRedondeo ? 0 : diferencia

  /**
   * «A tener en cuenta»: lo que el viajero paga aparte. Sale de hechos que el documento ya
   * tiene —los cargos en destino y la existencia de opcionales—, no de una lista genérica
   * de exclusiones: afirmarla en nombre de la agencia sería inventar una condición.
   */
  // Con varias tarifas hay un cargo por hotel, y tres hoteles de la misma ciudad dirían tres
  // veces lo mismo: la línea se escribe una vez.
  const noIncluye = [
    ...new Set(v.cargosEnDestino.map(c => `${c.concepto}${c.ciudad ? ` (${c.ciudad})` : ''}, que se pagan en destino`)),
    ...(opcionales.length > 0 ? ['Las actividades opcionales listadas al final de este documento'] : []),
  ]

  const pie = v.pie ?? [vendedor.nombre, vendedor.email, vendedor.telefono, vendedor.ciudad].filter(Boolean).join(' · ')
  const firma = v.firma ?? (emisor ? { nombre: emisor.nombre, cargo: emisor.cargo, contacto: null } : null)

  const fichas: { etiqueta: string; valor: string }[] = []
  if (v.viajeros) fichas.push({ etiqueta: 'VIAJEROS', valor: v.viajeros })
  if (v.destino) fichas.push({ etiqueta: 'DESTINO', valor: v.destino })
  if (v.fechas) fichas.push({ etiqueta: 'FECHA', valor: v.fechas })
  if (v.duracion) fichas.push({ etiqueta: 'DURACIÓN', valor: v.duracion })

  // ── Capítulos por ciudad ────────────────────────────────────────────────────
  const capitulos = capitulosDelViaje(v.hoteles, principal, v.destino)
  const multiples = capitulos.length > 1

  // Cada foto de ciudad va al capítulo que la nombra; la que no encuentra capítulo (la de
  // una ciudad sin hotel) va en la franja de la portada.
  const fotosCiudades = v.fotosCiudades ?? []
  const nombraA = (f: FotoPDF, c: Capitulo) => {
    if (!c.ciudad) return false
    const clave = sinTildes(lugarConCodigo(c.ciudad)?.nombre ?? c.ciudad)
    return (f.lugares ?? []).some(l => sinTildes(lugarConCodigo(l)?.nombre ?? l) === clave)
  }
  const fotoDeCapitulo = new Map<number, FotoPDF[]>()
  const fotosSueltas: FotoPDF[] = []
  for (const f of fotosCiudades) {
    const i = capitulos.findIndex(c => nombraA(f, c))
    if (i === -1) fotosSueltas.push(f)
    else fotoDeCapitulo.set(i, [...(fotoDeCapitulo.get(i) ?? []), f])
  }

  // La línea de tiempo: los días del itinerario y los días de vuelo (solo los de la
  // tarifa principal: los de las alternativas se ven en la tabla con su chip).
  const entradas: EntradaTiempo[] = []
  for (const d of bloquesDia) {
    const [primero, ...resto] = d.items
    const fecha = fechaDelDia(v.fechaInicio, d.dia)
    entradas.push({
      fecha,
      dia: d.dia,
      titulo: { texto: primero.nombre },
      subtitulo: fecha ? (diaDeLaSemana(fecha) ? { texto: diaDeLaSemana(fecha) as string } : null) : null,
      notas: detallada && primero.descripcion ? [primero.descripcion] : [],
      vinetas: resto.map(it => (detallada && it.descripcion ? `${it.nombre} — ${it.descripcion}` : it.nombre)),
      orden: entradas.length,
    })
  }
  // Un día de vuelo solo entra si su fecha es COMPLETA: sin año no se puede ordenar contra
  // los días del itinerario, y un vuelo en la fecha equivocada es peor que en la tabla.
  const hayDiasSinFecha = entradas.some(e => e.fecha === null)
  if (!hayDiasSinFecha) {
    for (const vu of v.vuelos.filter(x => esDeLaPrincipal(x, principal))) {
      const tramos = filasDelVuelo(vu)
      for (const t of tramos) {
        const fecha = conAnio(leerFecha(t.fecha), v.fechaInicio)
        if (!fecha || claveDeFecha(fecha) === null) continue
        const aero = lugarConCodigo(t.desde)
        const dest = lugarConCodigo(t.hasta)
        entradas.push({
          fecha,
          dia: null,
          titulo: { desde: aero?.nombre ?? null, hasta: dest?.nombre ?? null },
          subtitulo: { aerolinea: vu.aerolinea ?? vu.linea, salida: t.salida, llegada: t.llegada },
          notas: [],
          vinetas: [],
          orden: entradas.length,
        })
      }
    }
  }
  entradas.sort((a, b) => {
    const ka = a.fecha ? claveDeFecha(a.fecha) : null
    const kb = b.fecha ? claveDeFecha(b.fecha) : null
    if (ka !== null && kb !== null && ka !== kb) return ka - kb
    // El mismo día: el vuelo de llegada antes de las actividades, el de regreso al final
    // lo deja el orden de inserción.
    if (ka !== null && kb !== null && 'desde' in a.titulo !== 'desde' in b.titulo) {
      return 'desde' in a.titulo ? -1 : 1
    }
    return a.orden - b.orden
  })

  // ⚠️ Un día a día que es SOLO vuelos repite, tarjeta por tarjeta, la tabla de «Vuelos»:
  // en COT-2026-0006 eran las cuatro filas de la tabla otra vez, media página de lo mismo.
  // Con un solo día que no sea vuelo el día a día sí cuenta algo, y los vuelos van en él.
  const diaADia = diaADiaSeImprime(entradas.map(e => ({ esVuelo: 'desde' in e.titulo }))) ? entradas : []

  // Con varios capítulos, cada entrada va al de su fecha. Sin fechas no se puede saber a
  // qué ciudad pertenece un día: la línea de tiempo sale aparte, después de los capítulos.
  const entradasDe = new Map<number, EntradaTiempo[]>()
  const entradasSueltas: EntradaTiempo[] = []
  for (const e of diaADia) {
    if (!multiples) {
      entradasDe.set(0, [...(entradasDe.get(0) ?? []), e])
      continue
    }
    if (!e.fecha) { entradasSueltas.push(e); continue }
    let i = capitulos.findIndex(c => fechaEnCapitulo(e.fecha as Fecha, c, v.fechaInicio))
    if (i === -1) {
      // El día de regreso cae en la salida del último hotel: va con el último capítulo que
      // ya empezó; lo anterior al primero, con el primero.
      const k = claveDeFecha(e.fecha) ?? 0
      i = 0
      capitulos.forEach((c, j) => {
        const ci = c.hotel ? conAnio(leerFecha(c.hotel.checkIn), v.fechaInicio) : null
        const kc = ci ? claveDeFecha(ci) : null
        if (kc !== null && kc <= k) i = j
      })
    }
    entradasDe.set(i, [...(entradasDe.get(i) ?? []), e])
  }

  const creditos = creditosDeFotos([v.foto, ...fotosCiudades])
  const antesDeViajar = v.antesDeViajar ?? []

  /**
   * «Incluido en el plan»: lo que el cliente RECIBE (traslados, equipaje, alimentación,
   * impuestos…), no los nombres de las líneas.
   *
   * ⚠️ Hasta el 2026-09-22 la columna repetía, con un chulo delante, exactamente la lista de
   * «Inversión» que el cliente acababa de leer media página arriba: no decía nada que no
   * estuviera dicho, y su título prometía una cosa que no era. Ahora solo sale con una lista
   * de inclusiones de verdad (`viaje.incluye`): la del texto para el cliente que una persona
   * revisó.
   */
  const incluye = (v.incluye ?? []).map(t => t.trim()).filter(Boolean)

  // ⚠️ La firma sola en una página en blanco: pasaba con la cotización de tres tarifas.
  // El cierre (créditos + firma) no se parte, y la ÚLTIMA sección que se imprime pide
  // tener el cierre en su misma página: si no cabe, la sección baja con él. Las secciones
  // que se parten igual se parten, y el cierre sigue al resto en la página siguiente.
  //
  // ⚠️ La lista empieza en «Inversión», que sale siempre. Hasta el 2026-09-22 empezaba en
  // «Incluido», que también salía siempre (repetía las líneas): al dejar de imprimirse, la
  // regla se habría quedado sin a quién pegarle el cierre en un documento sin opcionales ni
  // cargos, que es justo el más corto.
  const hayPorPasajero = Boolean(preciosPorPasajero && preciosPorPasajero.filas.length > 0)
  //
  // ⚠️ «Antes de viajar» iba de ÚLTIMO, suelto: era lo único que quedaba para la última
  // página, y COT-2026-0006 terminaba en una hoja al 70 % en blanco con ese recuadro y la
  // firma. Desde el 2026-09-23 va con «Incluido» (`disposicionDeListas`), y el final del
  // documento son las secciones que de verdad son largas.
  const listas: Record<ListaDelCierre, string[]> = { incluye, noIncluye, antes: antesDeViajar }
  const filasDeListas = disposicionDeListas(listas, ANCHO_CONTENIDO)
  // Los términos de ESTA cotización (`terminos_condiciones`), al cierre y antes de la firma.
  // Es la copia guardada: el texto base de la línea no se lee aquí, así que un documento ya
  // enviado no cambia si ese texto cambia después.
  const piezasTerminos = piezasDeTerminos(estructurarTerminos(cotizacion.terminos_condiciones))
  const seccionesFinales = [
    'inversion',
    hayPorPasajero && 'porPasajero',
    filasDeListas.length > 0 && 'listas',
    opcionales.length > 0 && 'opcionales',
    v.cargosEnDestino.length > 0 && 'cargos',
    cotizacion.notas && 'notas',
    piezasTerminos.length > 0 && 'terminos',
  ].filter((x): x is string => Boolean(x))
  const ultimaSeccion = firma ? seccionesFinales[seccionesFinales.length - 1] : undefined
  const conCierre = (seccion: string) => (seccion === ultimaSeccion ? ALTO_CIERRE : undefined)

  // Totales: subtotal e IVA solo con IVA; el TOTAL en la barra de degradado, siempre.
  // `minPresenceAhead` solo cuando el TOTAL va suelto (más de 8 líneas) y es lo último antes
  // de la firma: en los demás casos lo lleva la caja que lo envuelve.
  const totales = (minPresenceAhead?: number) => (
    <View wrap={false} minPresenceAhead={minPresenceAhead} style={{ marginTop: 8 }}>
      {!general && iva > 0 && (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 2 }}>
          <Text style={{ fontSize: 8.5, color: C.gris, width: 120 }}>Subtotal</Text>
          <Text style={{ fontSize: 8.5, color: C.tinta, width: 110, textAlign: 'right' }}>{pesos(subtotal)}</Text>
        </View>
      )}
      {iva > 0 && (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 2 }}>
          <Text style={{ fontSize: 8.5, color: C.gris, width: 120 }}>IVA</Text>
          <Text style={{ fontSize: 8.5, color: C.tinta, width: 110, textAlign: 'right' }}>{pesos(iva)}</Text>
        </View>
      )}
      <View style={{ position: 'relative', height: 30, marginTop: 4 }}>
        <Degradado ancho={ANCHO_CONTENIDO} alto={30} id="degradado-total" />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 30, paddingHorizontal: 12 }}>
          <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.blanco, letterSpacing: 1 }}>TOTAL</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.blanco }}>{pesos(total)}</Text>
        </View>
      </View>
      {/* Dentro de la misma caja que el TOTAL: la nota no se separa de la cifra que explica. */}
      {notaIva && (
        <Text style={{ fontSize: 7.5, color: C.gris, marginTop: 4, textAlign: 'right' }}>{notaIva}</Text>
      )}
    </View>
  )

  return (
    <Document>
      <Page
        size="A4"
        style={{ paddingTop: 58, paddingBottom: ALTO_PIE + 22, fontFamily: 'Helvetica', color: C.texto }}
      >
        {/* ── Encabezado de todas las páginas (§4.1) ───────────────────────── */}
        <View fixed style={{ position: 'absolute', top: 0, left: 0, width: ANCHO_PAGINA, height: 4 }}>
          <Degradado ancho={ANCHO_PAGINA} alto={4} id="degradado-barra" />
        </View>
        <View fixed style={{ position: 'absolute', top: 14, right: MARGEN }}>
          {/* El logo real del workspace, no la palabra escrita. Solo si no hay logo se
              escribe el nombre, para que la página no quede sin marca. */}
          {vendedor.logo_url ? (
            <PdfImage src={vendedor.logo_url} style={{ height: 28 }} />
          ) : (
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.tinta, letterSpacing: 1.5, marginTop: 8 }}>
              {(vendedor.razon_social ?? vendedor.nombre).toUpperCase()}
            </Text>
          )}
        </View>

        <View style={{ paddingHorizontal: MARGEN }}>
          {/* ── Portada (§4.2) ─────────────────────────────────────────────── */}
          <Antetitulo texto="PROPUESTA DE VIAJE · COTIZACIÓN" color={C.purpura} punto />
          <Text
            hyphenationCallback={SIN_GUION}
            style={{ fontSize: 34, fontFamily: 'Helvetica-Bold', color: C.tinta, marginTop: 8, lineHeight: 1.1 }}
          >
            {acento.antes}
            <Text style={{ color: C.magenta }}>{acento.acento}</Text>
            {acento.despues}
          </Text>
          <Text style={{ fontSize: 10, color: C.gris, marginTop: 5 }}>
            {clienteDeLaPortada(empresa.contacto_nombre, empresa.nombre) ?? 'Propuesta de viaje'}
          </Text>
          {intro && (
            <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 12, color: C.texto, lineHeight: 1.45, marginTop: 10 }}>
              {intro}
            </Text>
          )}

          {/* Sin foto la banda no aparece y el bloque sube: nada de rectángulo vacío. */}
          {v.foto && <FotoConRotulo foto={v.foto} alto={190} />}

          {fichas.length > 0 && (
            <View style={{ flexDirection: 'row', backgroundColor: C.tarjeta, borderRadius: 8, paddingVertical: 10, marginTop: 14 }}>
              {fichas.map(f => <Ficha key={f.etiqueta} etiqueta={f.etiqueta} valor={f.valor} />)}
            </View>
          )}

          {v.presentacion && (
            <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 11, color: C.texto, lineHeight: 1.5, marginTop: 16 }}>
              {v.presentacion}
            </Text>
          )}

          {/* Las fotos de ciudades que no tienen capítulo propio (una ciudad sin hotel). */}
          <FranjaDeFotos fotos={fotosSueltas} />

          {/* ── Un capítulo por ciudad (§4.3) ──────────────────────────────── */}
          {capitulos.map((c, i) => {
            const fotos = fotoDeCapitulo.get(i) ?? []
            const suyas = entradasDe.get(i) ?? []
            const hayAlgo = c.hotel !== null || c.alternativas.length > 0 || fotos.length > 0 || suyas.length > 0
            if (!hayAlgo) return null
            const nombreCiudad = c.ciudad ? (lugarConCodigo(c.ciudad)?.nombre ?? c.ciudad) : null
            // Con un solo capítulo, su nombre casi siempre es el destino que la portada ya
            // dice («San Andrés - Providencia» salía dos veces en la misma página). La portada
            // lo dice en el título, en el nombre del negocio o en la ficha DESTINO: con un
            // titular redactado el título ya no es el nombre del negocio, y hay que mirar los
            // tres. Sin el nombre tampoco va la línea de fechas: la repite la tarjeta del hotel.
            const conNombre = nombreCiudad !== null
              && (multiples || !yaLoDiceLaPortada(nombreCiudad, [titulo, negocio?.nombre, v.destino]))
            const fechasCapitulo = conNombre && c.hotel
              ? [rangoCompacto(c.hotel.checkIn, c.hotel.checkOut), c.hotel.noches ? `${c.hotel.noches} ${c.hotel.noches === 1 ? 'noche' : 'noches'}` : null].filter(Boolean).join(' · ')
              : null
            const encabezado = (
              <>
                {multiples && <Antetitulo texto={`DESTINO ${i + 1} DE ${capitulos.length}`} color={C.magenta} />}
                {conNombre && (
                  <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: C.tinta, marginTop: multiples ? 4 : 0 }}>
                    {nombreCiudad}
                  </Text>
                )}
                {fechasCapitulo && <Text style={{ fontSize: 9, color: C.gris, marginTop: 2 }}>{fechasCapitulo}</Text>}
              </>
            )
            const conEncabezado = multiples || conNombre
            // Con UNA foto, la foto va en miniatura al lado del encabezado y de la tarjeta del
            // hotel (2026-09-23). Antes era una banda de 150 pt a todo el ancho entre los dos:
            // cada ciudad gastaba un tercio de página antes de decir en qué hotel duerme.
            const fotoAlLado = fotos.length === 1 && (conEncabezado || c.hotel !== null)
            // El nombre de la ciudad viaja con lo primero que muestra el capítulo (fotos u
            // hotel): un título de capítulo solo al pie de la página parece un corte.
            const conFotos = fotos.length > 0
            const conHotel = !conFotos && c.hotel !== null
            return (
              <View key={`capitulo-${i}`} style={{ marginTop: conEncabezado ? 26 : 0 }}>
                {fotoAlLado ? (
                  <View wrap={false} style={{ flexDirection: 'row' }}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      {encabezado}
                      {c.hotel && <TarjetaHotel h={c.hotel} general={general} tarifas={tarifas} arriba={!conEncabezado} />}
                    </View>
                    <Miniatura foto={fotos[0]} />
                  </View>
                ) : (
                  <>
                    <View wrap={false}>
                      {encabezado}
                      {conFotos && <FranjaDeFotos fotos={fotos} />}
                      {conHotel && c.hotel && <TarjetaHotel h={c.hotel} general={general} tarifas={tarifas} />}
                    </View>
                    {!conHotel && c.hotel && <TarjetaHotel h={c.hotel} general={general} tarifas={tarifas} />}
                  </>
                )}
                {c.alternativas.map((h, j) => (
                  <LineaHotelAlternativo key={`alt-${j}`} h={h} general={general} tarifas={tarifas} />
                ))}
                <LineaDeTiempo entradas={suyas} />
              </View>
            )
          })}
          {entradasSueltas.length > 0 && <LineaDeTiempo entradas={entradasSueltas} />}

          {/* ── Vuelos (§4.4) ──────────────────────────────────────────────── */}
          {v.vuelos.length > 0 && (
            <TablaVuelos vuelos={v.vuelos} general={general} tarifas={tarifas} titulo={<Titulo texto="Vuelos" icono="avion" />} />
          )}

          {/* ── Inversión (§4.5) ─────────────────────────────────────────────
              Todo el dinero del documento vive aquí (decisión 2). El TOTAL va PEGADO:
              con varias tarifas el bloque entero no se parte (`wrap={false}`), así el
              total nunca queda solo en la página siguiente. */}
          {porTarifas ? (
            <View wrap={false} minPresenceAhead={conCierre('inversion')}>
              <Titulo texto="Inversión" icono="dinero" />
              <View style={{ flexDirection: 'row' }}>
                {bloques.map((b, i) => (
                  <View
                    key={`tarifa-${i}`}
                    style={{
                      flexGrow: 1,
                      flexBasis: 0,
                      marginLeft: i === 0 ? 0 : 8,
                      borderRadius: 8,
                      backgroundColor: C.tarjeta,
                      // La recomendada se distingue por el borde magenta; las demás, sin borde.
                      // ⚠️ `borderWidth: 0` revienta react-pdf («Invalid border width»): el
                      // borde se omite, no se pone en cero.
                      ...(b.esPrincipal ? { borderWidth: 1.5, borderColor: C.magenta } : {}),
                    }}
                  >
                    <View style={{ height: 4, backgroundColor: b.color, borderTopLeftRadius: 7, borderTopRightRadius: 7 }} />
                    <View style={{ padding: 10 }}>
                      <Chip texto={b.titulo} color={b.color} />
                      {b.esPrincipal && (
                        <Text style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.magenta, marginTop: 4 }}>
                          La que recomendamos
                        </Text>
                      )}
                      <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: C.tinta, marginTop: 5 }}>{pesos(b.precio)}</Text>
                      {b.notaIva && (
                        <Text style={{ fontSize: 7, color: C.gris, marginTop: 1 }}>{b.notaIva}</Text>
                      )}
                      {/* El nivel general recorta el desglose, nunca el nombre y el precio
                          de cada opción: eso ES lo que el cliente tiene que decidir. */}
                      {!general && (
                        <View style={{ marginTop: 6 }}>
                          {b.lineas.map((l, j) => (
                            <LineaPrecio key={`tarifa-${i}-linea-${j}`} l={l} detallada={detallada} tam={7.5} />
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
              {/* Sin esta línea el cliente ve tres precios y un total, y no sabe cuál está
                  aceptando. El de abajo es el de la recomendada (R5). */}
              {totalEsDeLaRecomendada && (
                <Text style={{ fontSize: 7.5, color: C.gris, marginTop: 6 }}>
                  El total de abajo corresponde a la opción recomendada. Las demás son alternativas
                  con el precio indicado en su encabezado.
                </Text>
              )}
              {totales()}
            </View>
          ) : !general && lineas.length > 0 && lineas.length <= LINEAS_EN_UN_BLOQUE ? (
            // Pocas líneas: la tarjeta entera y el TOTAL no se parten. Partida en dos
            // páginas, la tarjeta queda abierta por abajo en una y por arriba en la otra.
            <View wrap={false} minPresenceAhead={conCierre('inversion')}>
              <Titulo texto="Inversión" icono="dinero" />
              {lineas.map((l, i) => (
                <LineaPrecio
                  key={`precio-${i}`}
                  l={l}
                  detallada={detallada}
                  tarjeta={lineas.length === 1 ? 'unica' : i === 0 ? 'primera' : i === lineas.length - 1 ? 'ultima' : 'media'}
                />
              ))}
              {totales()}
            </View>
          ) : !general && lineas.length > 0 ? (
            // ⚠️ Las filas y el TOTAL van como HERMANOS directos del cuerpo (fragmento, no
            // una caja): `minPresenceAhead` de la última fila solo mira a sus hermanos, y
            // con las filas dentro de una tarjeta el TOTAL quedaba fuera de su alcance.
            // Por eso el borde de la tarjeta lo dibuja cada fila.
            <>
              <View wrap={false} minPresenceAhead={lineas.length === 1 ? ALTO_TOTALES : 0}>
                <Titulo texto="Inversión" icono="dinero" />
                <LineaPrecio l={lineas[0]} detallada={detallada} tarjeta={lineas.length === 1 ? 'unica' : 'primera'} />
              </View>
              {lineas.slice(1).map((l, i) => (
                <LineaPrecio
                  key={`precio-${i + 1}`}
                  l={l}
                  detallada={detallada}
                  ultima={i === lineas.length - 2}
                  // Si la firma va detrás del TOTAL, la última fila pide sitio para los dos.
                  presenciaExtra={conCierre('inversion')}
                  tarjeta={i === lineas.length - 2 ? 'ultima' : 'media'}
                />
              ))}
              {totales(conCierre('inversion'))}
            </>
          ) : (
            <View wrap={false} minPresenceAhead={conCierre('inversion')}>
              <Titulo texto="Inversión" icono="dinero" />
              {totales()}
            </View>
          )}

          {/* ── Precio por tipo de pasajero, del viaje entero ──────────────────
              ⚠️⚠️ Esta tabla y el TOTAL son dinero del MISMO viaje: la diferencia se
              imprime con nombre y cierra por construcción (Σ por pasajero + lo del grupo =
              TOTAL). Con varias tarifas, es la de la recomendada. */}
          {preciosPorPasajero && hayPorPasajero && (
            <View
              wrap={false}
              minPresenceAhead={conCierre('porPasajero')}
              style={{ marginTop: 12, backgroundColor: C.tarjeta, borderRadius: 8, padding: 11 }}
            >
              <Text style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.gris, letterSpacing: 1, marginBottom: 4 }}>
                {totalEsDeLaRecomendada ? 'PRECIO POR PASAJERO · OPCIÓN RECOMENDADA' : 'PRECIO POR PASAJERO'}
              </Text>
              {filasPorPasajero.map(f => (
                <View key={`pax-${f.tipo}`} style={{ flexDirection: 'row', alignItems: 'flex-end', paddingVertical: 1.5 }}>
                  <Text style={{ fontSize: 9, color: C.tinta, flex: 1 }}>
                    {NOMBRE_PASAJERO[f.tipo]}
                    {/* El «×6» permite rehacer la cuenta. Solo cuando todas las líneas
                        coinciden en cuántos son. */}
                    {f.cantidad !== null && f.cantidad > 1 ? `  ×${f.cantidad}` : ''}
                  </Text>
                  {/* ⚠️ «c/u» y el subtotal por separado: «Adulto ×6 … $1.170.000» se lee
                      igual de bien como «seis adultos cuestan 1.170.000», que es falso. */}
                  {f.cantidad !== null && f.cantidad > 1 && (
                    <Text style={{ fontSize: 8, color: C.gris, paddingRight: 10 }}>{`${pesos(f.precioUnitario)} c/u`}</Text>
                  )}
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.tinta }}>
                    {pesos(f.cantidad !== null && f.cantidad > 1 ? f.precioUnitario * f.cantidad : f.precioUnitario)}
                  </Text>
                </View>
              ))}
              {porElGrupo !== null && porElGrupo !== 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4, marginTop: 3, borderTopWidth: 0.5, borderTopColor: C.linea }}>
                  <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8, color: C.texto, flex: 1, paddingRight: 10 }}>
                    {preciosPorPasajero.sinReparto.length > 0
                      ? `Se cobra por el grupo: ${preciosPorPasajero.sinReparto.join(', ')}`
                      : 'Se cobra por el grupo'}
                  </Text>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.tinta }}>{pesos(porElGrupo)}</Text>
                </View>
              )}
              {/* Solo cuando ninguna fila pudo absorber el redondeo entero: se dice qué es. */}
              {ajusteRedondeo !== 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 3, marginTop: 2 }}>
                  <Text style={{ fontSize: 7.5, color: C.gris, flex: 1 }}>Ajuste por redondeo</Text>
                  <Text style={{ fontSize: 7.5, color: C.gris }}>{pesos(ajusteRedondeo)}</Text>
                </View>
              )}
              {/* Sin `cubierto` no se puede afirmar que la columna sume el total: se dice. */}
              {porElGrupo === null && preciosPorPasajero.sinReparto.length > 0 && (
                <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7.5, color: C.gris, marginTop: 3 }}>
                  {`No incluye lo que se cobra por el grupo: ${preciosPorPasajero.sinReparto.join(', ')}.`}
                </Text>
              )}
              {porElGrupo === null && preciosPorPasajero.sinReparto.length === 0 && (
                <Text style={{ fontSize: 7.5, color: C.gris, marginTop: 3 }}>
                  Es el precio de cada viajero; no suma el total de arriba.
                </Text>
              )}
            </View>
          )}

          {cotizacion.condiciones_pago && (
            <Text style={{ fontSize: 8.5, color: C.texto, marginTop: 10 }}>{`Forma de pago: ${cotizacion.condiciones_pago}`}</Text>
          )}

          {/* ── Incluido, a tener en cuenta y antes de viajar (§4.6, §4.9) ────────
              Cómo se reparten lo decide `disposicionDeListas`: lado a lado si son cortas,
              a todo el ancho si no. Una fila de dos columnas no se parte; una lista a todo
              el ancho sí, entre ítems, con el título pegado al primero. La última pieza
              pide tener el cierre debajo si «listas» es la última sección. */}
          {filasDeListas.map((fila, f) => {
            const presencia = f === filasDeListas.length - 1 ? conCierre('listas') : undefined
            if (fila.length > 1) {
              return (
                <View key={`listas-${f}`} wrap={false} minPresenceAhead={presencia} style={{ flexDirection: 'row' }}>
                  {fila.map((columna, c) => (
                    <View key={`col-${c}`} style={{ flexGrow: 1, flexBasis: 0, marginLeft: c === 0 ? 0 : CANAL_COLUMNAS }}>
                      {columna.map(l => <ListaEnColumna key={l} lista={l} items={listas[l]} />)}
                    </View>
                  ))}
                </View>
              )
            }
            const l = fila[0][0]
            const items = listas[l]
            // ⚠️ Fragmento, no caja: el último ítem tiene que ser HERMANO del cierre para que
            // su `minPresenceAhead` lo alcance (la misma razón que en «Opcionales»).
            return (
              <Fragment key={`listas-${f}`}>
                <View wrap={false} minPresenceAhead={items.length === 1 ? presencia : undefined}>
                  <Titulo texto={LISTAS[l].titulo} icono={LISTAS[l].icono} />
                  <ItemDeLista lista={l} texto={items[0]} ultimo={items.length === 1} />
                </View>
                {items.slice(1).map((t, i) => (
                  <ItemDeLista
                    key={`${l}-${i + 1}`}
                    lista={l}
                    texto={t}
                    ultimo={i === items.length - 2}
                    presencia={i === items.length - 2 ? presencia : undefined}
                  />
                ))}
              </Fragment>
            )
          })}

          {/* ── Opcionales (§4.7) ──────────────────────────────────────────── */}
          {opcionales.length > 0 && (() => {
            const tarjetas = opcionales.map((o, i) => {
                const valor = Math.round((o.precio_venta || 0) * (o.cantidad ?? 1))
                return (
                  <View
                    key={`opcional-${i}`}
                    wrap={false}
                    minPresenceAhead={i > 0 && i === opcionales.length - 1 ? conCierre('opcionales') : undefined}
                    style={{ flexDirection: 'row', backgroundColor: C.tarjeta, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 11, marginTop: 6 }}
                  >
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.tinta }}>{o.nombre}</Text>
                      {!general && o.descripcion && (
                        <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, color: C.gris, marginTop: 2 }}>{o.descripcion}</Text>
                      )}
                    </View>
                    {valor > 0 && (
                      <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.tinta }}>
                        {`${pesos(valor)}${o.unidad ? ` / ${o.unidad}` : ''}`}
                      </Text>
                    )}
                  </View>
                )
              })
            // Fragmento, no caja: la última tarjeta tiene que ser HERMANA del cierre para
            // que su `minPresenceAhead` lo alcance.
            return (
              <>
                <View wrap={false} minPresenceAhead={opcionales.length === 1 ? conCierre('opcionales') : undefined}>
                  <Titulo texto="Opcionales" icono="opcionales" />
                  <Text style={{ fontSize: 8.5, color: C.gris, marginBottom: 4 }}>
                    Actividades que se pueden coordinar aparte. No están incluidas en el precio de arriba.
                  </Text>
                  {tarjetas[0]}
                </View>
                {tarjetas.slice(1)}
              </>
            )
          })()}

          {/* ── Cargos a pagar en destino (§4.8) ───────────────────────────────
              Plata del viajero: sale en los TRES niveles de detalle (decisión 3). */}
          {v.cargosEnDestino.length > 0 && (
            <View wrap={false} minPresenceAhead={conCierre('cargos')}>
              <Titulo texto="Cargos a pagar en destino" icono="destino" />
              <View style={{ position: 'relative', height: 18, borderRadius: 4 }}>
                <Degradado ancho={ANCHO_CONTENIDO} alto={18} id="degradado-cargos" />
                <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingTop: 5.5 }}>
                  <Text style={{ fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.blanco, letterSpacing: 0.8, width: '22%' }}>CIUDAD / HOTEL</Text>
                  <Text style={{ fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.blanco, letterSpacing: 0.8, width: '33%' }}>CONCEPTO</Text>
                  <Text style={{ fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.blanco, letterSpacing: 0.8, width: '20%' }}>MONTO APROX.</Text>
                  <Text style={{ fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.blanco, letterSpacing: 0.8, width: '25%' }}>OBSERVACIÓN</Text>
                </View>
              </View>
              {v.cargosEnDestino.map((c, i) => (
                <View
                  key={`cargo-${i}`}
                  wrap={false}
                  style={{ flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 8, backgroundColor: i % 2 === 1 ? C.tarjeta : C.blanco }}
                >
                  {/* B2 · el cargo es de UNA opción: con varias tarifas, dice de qué hotel y
                      de qué tarifa, igual que su tarjeta de hotel. */}
                  <View style={{ width: '22%', paddingRight: 4 }}>
                    <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, color: C.tinta }}>{c.ciudad ?? ''}</Text>
                    {c.hotel && (
                      <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7.5, color: C.gris, marginTop: 1 }}>{c.hotel}</Text>
                    )}
                    <ChipsDeTarifa tarifas={tarifas} de={c} />
                  </View>
                  <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, color: C.tinta, width: '33%' }}>{c.concepto}</Text>
                  <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.tinta, width: '20%' }}>{c.monto}</Text>
                  <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8, color: C.texto, width: '25%' }}>{c.observacion}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Información importante ─────────────────────────────────────── */}
          {cotizacion.notas && (
            <View wrap={false} minPresenceAhead={conCierre('notas')}>
              <Titulo texto="Información importante" icono="info" />
              <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 9, color: C.texto, lineHeight: 1.45 }}>
                {cotizacion.notas}
              </Text>
            </View>
          )}

          {/* ── Términos y condiciones: al cierre, antes de la firma ──────────────
              Fragmento, no caja, por la misma razón que en «Opcionales»: se parten entre
              piezas, el título va pegado a la primera y la última pide el cierre debajo. */}
          {piezasTerminos.length > 0 && (
            <>
              <View wrap={false} minPresenceAhead={piezasTerminos.length === 1 ? conCierre('terminos') : undefined}>
                <Titulo texto="Términos y condiciones" icono="info" />
                {piezasTerminos[0].map((b, j) => <BloqueTerminos key={`terminos-0-${j}`} b={b} primero={j === 0} />)}
              </View>
              {piezasTerminos.slice(1).map((pieza, i) => (
                <View
                  key={`terminos-${i + 1}`}
                  wrap={false}
                  minPresenceAhead={i === piezasTerminos.length - 2 ? conCierre('terminos') : undefined}
                >
                  {pieza.map((b, j) => <BloqueTerminos key={`terminos-${i + 1}-${j}`} b={b} primero={false} />)}
                </View>
              ))}
            </>
          )}

          {/* ── Cierre: los créditos de las fotos (§4.10) AL LADO de la firma ─────
              Sin crédito, la licencia de casi todas (CC BY / BY-SA) no se cumple. Solo las
              que se imprimieron, y la línea no existe si no hubo ninguna. Encima de la firma
              sumaban 30 pt más al bloque que tiene que caber con la última sección. */}
          {(creditos.length > 0 || firma) && (
            <View
              wrap={false}
              style={{ marginTop: 24, flexDirection: 'row', alignItems: 'flex-end', justifyContent: creditos.length > 0 ? 'space-between' : 'center' }}
            >
              {creditos.length > 0 && (
                <Text hyphenationCallback={SIN_GUION} style={{ flex: 1, fontSize: 6.5, color: C.gris, lineHeight: 1.4, paddingRight: firma ? 24 : 0 }}>
                  {`Fotografías: ${creditos.join(' · ')}`}
                </Text>
              )}
              {firma && (
                <View style={{ alignItems: creditos.length > 0 ? 'flex-end' : 'center', maxWidth: 220 }}>
                  <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.tinta }}>{firma.nombre}</Text>
                  {firma.cargo && <Text style={{ fontSize: 8.5, color: C.gris, marginTop: 1 }}>{firma.cargo}</Text>}
                  {firma.contacto && <Text style={{ fontSize: 8, color: C.gris, marginTop: 1 }}>{firma.contacto}</Text>}
                </View>
              )}
            </View>
          )}
        </View>

        {/* ── Pie de todas las páginas (§4.10): barra `tinta` de lado a lado ──── */}
        <View
          fixed
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: ANCHO_PAGINA,
            height: ALTO_PIE,
            backgroundColor: C.tinta,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: MARGEN,
          }}
        >
          <Text style={{ fontSize: 8.5, color: C.blanco, flex: 1 }}>{pie}</Text>
          <Text style={{ fontSize: 7.5, color: C.grisClaro, marginLeft: 10 }}>{cotizacion.consecutivo}</Text>
          <Text
            style={{ fontSize: 7.5, color: C.grisClaro, marginLeft: 10 }}
            render={({ pageNumber, totalPages }) => `${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
