---
name: project-actividad-infante-gratis
description: Trappvel 2026-10-01 — en una ACTIVIDAD el infante va gratis (solo con infantes y sin niños); la casilla de la tarifa fallaba muda si la server action lanzaba; pegar sin foco cae en la bandeja
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-01-actividad-por-pantallazo.md`, rama `max/actividad-pantallazo-infante`. Sin migración. NO mergear: espera C3.

- Decisión de Mauricio (2026-10-01): **en una actividad el infante no paga**; el total del pantallazo es del grupo y se reparte entre los adultos. `infanteGratisEnActividad` (tarifa-pasajero.ts) vale SOLO con infantes y cero niños. Con niños NO está decidido cómo se reparte: se dejó el camino de siempre (pide «sin el infante» / «solo adultos»).
- Abierto, no pedido: una actividad cuyo pantallazo dice «2 personas» (solo los que pagan) en un grupo 2A+1I la sigue rechazando TP3. El brief solo cubre N que incluye al infante.
- Punto 7, la causa más probable (no reproducible sin producción): la casilla de `tarifa-pasajero-item.tsx` hacía `try/finally` sin `catch`; si `leerCasillaDeItem` lanza (corte, tiempo de la función), no queda mensaje ni dato. Segunda vía: pegar sin foco en la casilla manda la imagen a la bandeja (listener en `window`) que puede estar fuera de vista. Y la única vía por archivo para el «solo adultos» de hotel era «Cambiar pantallazo», que reemplaza el 1.
- Redondeo heredado: el unitario en moneda extranjera se redondea al centavo antes de pasar a pesos (EUR 233,37/2 → 116,69 → +45 COP a 4.500). No se tocó.

**Why:** «pegué el pantallazo 2 y no pasó nada» sin rastro en la base = una excepción tragada, no un rechazo (los rechazos ya se pintaban).
**How to apply:** toda zona de pegado que llame a una server action debe pasar por `leerSinSilencio` (`lib/cotizaciones/lectura-sin-silencio.ts`). Un reparto nuevo de actividad con niños espera decisión de Mauricio: no inventarlo.

Relacionado: [[tarifa-por-pasajero]], [[project-detalles-pantalla-va-no-va]], [[project-tarjeta-relee-sin-recargar]].
