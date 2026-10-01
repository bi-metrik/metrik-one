---
name: project-tarjeta-relee-sin-recargar
description: Trappvel 2026-10-01, PR 2 del brief preview-y-refresco: el editor del viaje relee la cotización por fetch tras cada acción y pinta la lectura más nueva; causa raíz del «no refresca» sigue sin reproducir
metadata:
  type: project
---

El editor de cotización, en el flujo de viaje (`lineasPorTipo`), ya no depende solo de
`router.refresh()`: `refrescar()` además hace `GET /api/cotizaciones/[id]/vista` y
`lineasParaPintar` (`lib/cotizaciones/vista-fresca.ts`) elige entre esa lectura y la de la página
por la hora del servidor (`leidaEn`, que la página toma ANTES de leer). Fuera del viaje
`refrescar` es solo el refresco: genérica/Termotech iguales (golden R6 en verde).

**Why:** tercera vez (2026-09-16, #963, #967) que «guardado en la base, pantalla vieja hasta
recargar» con el GET del refresco visible en los registros de Vercel. Nunca se reprodujo fuera de
producción. La regla de [[tarifa-por-pasajero]] («no perseguir el router, que la acción devuelva lo
escrito») se generalizó a la cotización entera.

**How to apply:**
- Una pantalla nueva del viaje que muestre algo derivado de `items`/`rubros` debe colgar de
  `initialItems` del editor (el efectivo), no de props propias, o se queda vieja.
- Una acción nueva de la tarjeta debe terminar en `onCambio` (que es el `refrescar` del editor); un
  `router.refresh()` suelto lo detecta el contrato de `tarjeta-se-refresca-e2e.test.ts`.
- La columna derecha lee `valor_total` vía `total-vivo.tsx`, solo con `ProveedorTotalVivo` (página
  de la cotización dentro del marco del negocio).
- Desde #967 corregir check-in/out de un hotel costeado a mano RECONFIRMA solo: el aviso de
  reconfirmar solo aparece si no pudo (pantallazo = caso dorado C). El criterio 6 del brief lo pedía
  visible: avisado a la sesión principal.
- «Quitar habitación» de la tarjeta escribe al vencer el «Deshacer» (6 s): el total cambia ahí.
- El arnés de render que fuerza la tarjeta abierta (`vi.mock` de `tarjeta-opcion` con
  `abierta: true`) deja leer tabla, hoja y total del editor real en un render estático.

Relacionado: [[project-corregir-fechas-recalcula]], [[project-foto-hotel-y-fila-de-acciones]].
