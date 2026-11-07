---
name: recomendada-bloqueo-presupuesto
description: M-H2-2 (6-nov) — Recomendada del bloqueo = mayor total al cliente DENTRO del presupuesto de la solicitud; precio como proxy de experiencia (no hay puntaje)
metadata:
  type: project
---

Decisión de Mauricio 2026-11-06: «dentro del presupuesto» (regla Trappvel 2026-09-14). Rama
`fix/bloqueo-recomendada-dentro-del-presupuesto` (antes `fix/bloqueo-recomendada-por-precio`). Regla en
`paqueteRecomendado` (tarifas-por-pasos.ts): total al cliente ≤ tope → el de mayor total, empate → mayor margen,
empate → orden; ninguno dentro → el más barato; sin presupuesto → intermedia (`indiceRecomendada`, con 2 la más
cara). Tope = techo del select `presupuesto` de `negocio_bloques.data` (`presupuesto-del-viaje.ts`; `mas_20m` = Infinity).
Total por paquete = `cascadaDeItinerario(items, [paquete])` en `fotoDeTarifas` (solo si hay ranura de paquete).

**Why:** `puntaje_experiencia`/`nivel_servicio` de la decisión del 09-14 NUNCA se construyeron; el precio es el único
dato que distingue paquetes del mismo destino y fechas. Choca con «un Qatar barato puntúa alto»: es sustituto declarado.
Error mío del reporte anterior: el fixture tenía las cifras de Tu Reserva y Aliados VOLTEADAS (Tu Reserva 10,67 M).

**How to apply:** cuando exista un puntaje de experiencia, entra en `paqueteRecomendado`. Batería e2e: casos de
bloqueo sin presupuesto tienen Recomendada intermedia (Coral en «a», Decamar en #1359; ahí la asesora escoge Gaviota).
Cifras de un fixture «real»: cruzarlas contra la bitácora antes de reportar.
