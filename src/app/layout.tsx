import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import Splash from '@/components/splash'
import './globals.css'

// Fuentes autoalojadas (subset latin, variable). No se descargan de fonts.gstatic.com
// en tiempo de build: un 404 del CDN de Google tumbaba el build entero (2026-08-10).
// Para actualizarlas: bajar el .woff2 del bloque `/* latin */` que sirve
// fonts.googleapis.com/css2?family=<Familia>:wght@100..900 y reemplazar el archivo.
//
// Stack tipografico del sistema visual "Pino Profundo" (decision 2026-09-07).
// Las tres familias son SIL OFL 1.1: uso comercial permitido, sin regalias. Este
// repositorio REDISTRIBUYE los archivos de fuente, asi que el aviso de copyright
// tiene que viajar con ellos (condicion de Emilio, CLO):
//
//   Schibsted Grotesk — Copyright 2023 The Schibsted Grotesk Project Authors
//     https://github.com/schibsted/schibsted-grotesk
//   Newsreader — Copyright 2019 The Newsreader Project Authors
//     https://github.com/productiontype/Newsreader
//   Martian Mono — Copyright 2022 The Martian Mono Project Authors
//     https://github.com/evilmartians/mono
//
//   Los tres bajo SIL Open Font License 1.1 — https://scripts.sil.org/OFL
const schibsted = localFont({
  src: './fonts/SchibstedGrotesk-latin-variable.woff2',
  variable: '--font-schibsted',
  // Schibsted Grotesk no tiene Light: el eje arranca en 400. Declararlo
  // "100 900" haria que el navegador sintetice un falso Light donde el codigo
  // pida 300, que es justo lo que la decision de marca descarto.
  weight: '400 900',
  display: 'swap',
})

const newsreader = localFont({
  src: './fonts/Newsreader-latin-variable.woff2',
  variable: '--font-newsreader',
  weight: '200 800',
  display: 'swap',
})

const martianMono = localFont({
  src: './fonts/MartianMono-latin-variable.woff2',
  variable: '--font-martian-mono',
  weight: '100 800',
  // El archivo trae eje de ancho ademas del de peso. Sin fijarlo, el ancho que
  // sirve el navegador depende de la instancia por defecto del binario.
  declarations: [{ prop: 'font-stretch', value: '100%' }],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'MéTRIK one',
  description: 'Tus números claros para tomar mejores decisiones',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${schibsted.variable} ${newsreader.variable} ${martianMono.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <Splash />
          {children}
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  )
}
