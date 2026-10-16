/**
 * Arnés del «+» del shell sobre la barra de «Lo que suma» en celular (brief del 2026-10-16, punto
 * 2). Monta el `FAB` REAL y el `LoQueSuma` REAL sobre una réplica de la barra de navegación de abajo
 * del shell (`h-14`, solo en celular). Lo mide `scripts/boton-mas-barra.e2e.mjs`.
 *
 * `?barra=0`: sin «Lo que suma» (como cualquier otra pantalla, o con el interruptor apagado).
 */
import '../../src/app/globals.css'

import { createRoot } from 'react-dom/client'

import FAB from '@/app/(app)/fab'
import { LoQueSuma, type DatosLoQueSuma } from '@/app/(app)/negocios/por-pasos/lo-que-suma'

const conBarra = new URLSearchParams(location.search).get('barra') !== '0'

const datos: DatosLoQueSuma = {
  renglones: [],
  nombreDeOpcion: id => id,
  faltaPrecio: () => null,
  total: 22448922,
  costo: 19081584,
  margenPct: 15,
  otrasQueVan: [{ nombre: 'Premium', precio: 27756852 }],
  pantallazosEnBandeja: 0,
  incompleto: false,
  rojos: 0,
}

function Pantalla() {
  return (
    <div className="min-h-dvh bg-background p-6 pb-24">
      <p className="text-sm">Cotización por pasos (relleno)</p>
      <div style={{ height: 1600 }} />
      {conBarra && <LoQueSuma datos={datos} />}
      <FAB role="owner" timerActivo={null} />
      {/* La barra de navegación de abajo del shell, en celular. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t bg-card md:hidden" data-nav-celular>
        <span className="text-xs">Negocios</span>
        <span className="text-xs">Más</span>
      </nav>
    </div>
  )
}

createRoot(document.getElementById('raiz')!).render(<Pantalla />)
