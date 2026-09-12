/*
 * `next/image` no aplica aqui: este arbol no lo renderiza un navegador sino
 * Satori, que solo entiende un subconjunto de HTML y CSS. Un `<Image />` no
 * llegaria nunca a la imagen.
 */
/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og'
import { FUENTES_TARJETA } from './fuentes-tarjeta'
import { LOCKUP_ONE, LOCKUP_ONE_DATA_URI } from './lockup-one'
import { PLACA, geometriaPlaca, type ImagenMedida } from './medidas-tarjeta'

/**
 * La tarjeta que se ve al pegar el enlace de un subdominio en WhatsApp o
 * LinkedIn: lockup de MéTRIK one, logo del inquilino sobre placa blanca,
 * titular y el subdominio al pie.
 *
 * Las medidas salen del artboard aprobado. Lo que en el artboard era CSS que
 * el navegador resuelve solo (`object-fit`, `max-width`, ancho por contenido,
 * `ch`) aqui va en numeros explicitos, porque Satori no implementa esa parte
 * del modelo de caja: ver `medidas-tarjeta.ts`.
 */

export const TARJETA = { ancho: 1200, alto: 630 } as const

export const TITULAR = 'Tus números claros para tomar mejores decisiones.'
export const NOTA_PIE = 'Claridad para decidir'

const COLOR = {
  fondo: '#191713',
  placa: '#FFFFFF',
  titular: '#F3F1EC',
  url: '#6FB89D',
  nota: '#A8A29A',
} as const

const LOCKUP_ALTO = 44

/**
 * El artboard acota el titular con `max-width: 15ch`. Satori no resuelve `ch`,
 * asi que se convierte a px: 1ch es el avance del glifo "0" de Newsreader en la
 * instancia que la tarjeta usa (wght=400, opsz=56), o sea 1170/2000 * 56 =
 * 32.76 px. 15ch = 491.4 px. Es lo que fuerza el corte de linea en tres lineas,
 * identico en todos los inquilinos.
 */
const TITULAR_ANCHO_MAXIMO = 491.4

/** El dominio publico. `extractSlug` ya documenta el salto de linea de esta env var. */
const DOMINIO_BASE = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()

/**
 * Una scrape de WhatsApp o LinkedIn pide la imagen cada vez que alguien pega el
 * enlace. La tarjeta depende SOLO del slug de la ruta, asi que se puede cachear
 * de verdad: un dia en el CDN, y una semana sirviendo la copia vieja mientras
 * se regenera. `immutable` NO se usa a proposito: si el cliente cambia su logo,
 * la tarjeta tiene que poder ponerse al dia sin cambiar de URL.
 */
export const CACHE_TARJETA =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

export type LogoInquilino = {
  /** Bytes del logo ya descargados, en data URI. */
  dataUri: string
  medida: ImagenMedida
}

export function elementoTarjeta({ slug, logo }: { slug: string; logo: LogoInquilino }) {
  const { placaAncho, logoAncho, logoAlto } = geometriaPlaca(logo.medida)

  return (
    <div
      style={{
        width: TARJETA.ancho,
        height: TARJETA.alto,
        background: COLOR.fondo,
        paddingTop: 72,
        paddingBottom: 72,
        paddingLeft: 80,
        paddingRight: 80,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <img
        src={LOCKUP_ONE_DATA_URI}
        width={LOCKUP_ALTO * LOCKUP_ONE.proporcion}
        height={LOCKUP_ALTO}
        alt="MéTRIK one"
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 44 }}>
        <div
          style={{
            background: COLOR.placa,
            borderRadius: PLACA.radio,
            height: PLACA.alto,
            width: placaAncho,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <img src={logo.dataUri} width={logoAncho} height={logoAlto} alt="" />
        </div>
        <div
          style={{
            display: 'flex',
            fontFamily: 'Newsreader',
            fontSize: 56,
            lineHeight: 1.05,
            letterSpacing: -0.02 * 56,
            color: COLOR.titular,
            maxWidth: TITULAR_ANCHO_MAXIMO,
          }}
        >
          {TITULAR}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span
          style={{
            fontFamily: 'Martian Mono',
            fontSize: 22,
            letterSpacing: 0.01 * 22,
            color: COLOR.url,
          }}
        >
          {`${slug}.${DOMINIO_BASE}`}
        </span>
        <span style={{ fontFamily: 'Schibsted Grotesk', fontSize: 19, color: COLOR.nota }}>
          {NOTA_PIE}
        </span>
      </div>
    </div>
  )
}

export function tarjetaInquilino({ slug, logo }: { slug: string; logo: LogoInquilino }) {
  return new ImageResponse(elementoTarjeta({ slug, logo }), {
    width: TARJETA.ancho,
    height: TARJETA.alto,
    fonts: FUENTES_TARJETA,
    headers: { 'Cache-Control': CACHE_TARJETA },
  })
}
