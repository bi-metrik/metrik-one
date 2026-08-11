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
const geistSans = localFont({
  src: './fonts/Geist-latin-variable.woff2',
  variable: '--font-geist-sans',
  weight: '100 900',
  display: 'swap',
})

const geistMono = localFont({
  src: './fonts/GeistMono-latin-variable.woff2',
  variable: '--font-geist-mono',
  weight: '100 900',
  display: 'swap',
})

const montserrat = localFont({
  src: './fonts/Montserrat-latin-variable.woff2',
  variable: '--font-montserrat',
  weight: '100 900',
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
      <body className={`${geistSans.variable} ${geistMono.variable} ${montserrat.variable} antialiased`}>
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
