import Link from 'next/link'
import MetrikLockup from '@/components/metrik-lockup'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="flex flex-col items-center space-y-8">
        <MetrikLockup size="lg" />

        <p
          className="max-w-xs text-center text-lg"
          style={{
            fontFamily: 'var(--font-montserrat), Montserrat, sans-serif',
            fontWeight: 400,
            color: '#6B7280',
          }}
        >
          Tus numeros claros para tomar mejores decisiones.
        </p>

        <div className="flex gap-4">
          <Link
            href="/registro"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-emerald-500 px-8 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
            style={{ fontFamily: 'var(--font-montserrat), Montserrat, sans-serif' }}
          >
            Crear cuenta
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-gray-200 px-8 text-sm font-semibold transition-colors hover:bg-gray-50"
            style={{
              color: '#1A1A1A',
              fontFamily: 'var(--font-montserrat), Montserrat, sans-serif',
            }}
          >
            Iniciar sesion
          </Link>
        </div>
      </div>
    </div>
  )
}
