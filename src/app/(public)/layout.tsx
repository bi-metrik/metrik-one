// Layout publico — sin AppShell ni guard de sesion. Para paginas read-only
// accesibles sin login (ej. certificacion via QR). El root layout ya aporta
// html/body + la sans de marca.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-schibsted), system-ui, sans-serif',
        background: 'var(--papel)',
        color: 'var(--tinta)',
        minHeight: '100vh',
      }}
    >
      {children}
    </div>
  )
}
