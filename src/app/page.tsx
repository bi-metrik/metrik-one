import Link from 'next/link'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="mx-auto max-w-md text-center space-y-6 px-4">
        <h1 className="text-4xl font-bold tracking-tight">
          MéTRIK <span className="text-muted-foreground">ONE</span>
        </h1>
        <p className="text-lg text-muted-foreground">
          Tus números claros para tomar mejores decisiones.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/registro"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Crear cuenta
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-6 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Iniciar sesión
          </Link>
        </div>
      </div>
    </div>
  )
}
