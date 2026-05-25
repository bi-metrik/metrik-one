// Layout publico — sin AppShell ni guard de sesion. Para paginas read-only
// accesibles sin login (ej. certificacion via QR). El root layout ya aporta
// html/body + Montserrat.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
        background: '#F5F4F2',
        color: '#1A1A1A',
        minHeight: '100vh',
      }}
    >
      {children}
    </div>
  )
}
