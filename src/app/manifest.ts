import type { MetadataRoute } from 'next'
import { PALETA } from '@/lib/marca/paleta'

/**
 * Manifest de la aplicacion. Next lo sirve en `/manifest.webmanifest` y agrega
 * el `<link rel="manifest">` a todas las paginas.
 *
 * Existe para que un celular que ancle ONE a la pantalla de inicio use el
 * icono de marca: sin manifest, Android cae al favicon de la pestana, que es
 * de 64px, y lo escala.
 *
 * Los PNG son los oficiales del sistema "Pino Profundo"
 * (`proyectos/metrik/marca/pino/png-one/`), copiados sin reescalar a
 * `public/icons/`. Viven en `public/` y no en `app/` a proposito: la convencion
 * `app/iconN.png` de Next agregaria un `<link rel="icon">` mas por archivo, y
 * ahi lo que se necesita es una URL que el manifest pueda citar, no otro
 * candidato peleando por el icono de la pestana.
 *
 * El color va por `PALETA` y no por `var(--tinta)` porque esto termina en un
 * JSON que ningun navegador resuelve contra la hoja de estilos — es el mismo
 * caso que el PDF y el correo HTML documentados en `src/lib/marca/paleta.ts`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // El nombre y la descripcion repiten los de `metadata` en `layout.tsx`.
    name: 'MéTRIK one',
    short_name: 'MéTRIK',
    description: 'Tus números claros para tomar mejores decisiones',
    start_url: '/',
    display: 'standalone',
    /** Papel: el fondo que Android pinta mientras carga la aplicacion. */
    background_color: PALETA.papel,
    /** Carbon: tiñe la barra del sistema, a juego con el sidebar y el icono. */
    theme_color: PALETA.tinta,
    icons: [
      // `purpose: 'any'` explicito. NO se declara `maskable`: el asset oficial
      // llena la caja con una esquina redondeada propia, y una mascara mas
      // agresiva que ese radio mostraria el transparente de las esquinas.
      // Declarar una zona segura que nadie midio es peor que no declararla.
      { src: '/icons/metrik-icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/metrik-icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
