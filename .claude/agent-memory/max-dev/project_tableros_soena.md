---
name: tableros-soena-ola-1
description: Frente de tableros de SOENA — qué quedó cerrado en la ola 1 (2026-08-22), qué del inventario está desactualizado, y los dos huecos abiertos que deciden plata
metadata:
  type: project
---

Primera ola del frente de TABLEROS de SOENA entregada el 2026-08-22 en el **PR #357**
(`feat/tableros-soena-ola-1`), 6 checks verdes. **Mergeada** a `main` como `bd40d93`.
Cubre los puntos 21, 23, 25, 27, 35 y 41 de la sección 3 del inventario.

⚠️ **El código se mergeó y desplegó antes de aplicar las migraciones**, y eso degradó la
pestaña Comercial en producción sin ruido: el front llama
`get_comercial_ventas_mes_soena` con 8 argumentos (en base hay 6) y llama
`get_comercial_origen_mes_soena` / `get_comercial_perdidos_mes_soena`, que no existen.
Las tres rutas de error devuelven `[]`/`null`, así que la pantalla dice "no hay casos"
sobre una cifra que dice que sí los hay. Lección: cuando un PR trae RPC nuevas o cambia
firmas, **la migración va antes del merge**, no después.

**Why:** el bono de operaciones de SOENA se liquida con estos indicadores y el tablero
comercial decide comisiones. Un indicador mal medido no es un bug de pantalla: es plata mal
repartida sobre un mes ya trabajado.

**How to apply:** antes de tocar cualquier punto de la sección 3 del inventario
(`proyectos/soena/ve/2026-08-10_inventario-pendientes-soena.md`), leer primero la tabla
"Tableros — primera ola" del `CONTEXT.md` del frente, que es el registro vivo. La
numeración 1-79 no se renumera nunca.

## ⚠️ El inventario declara abiertos puntos que ya estaban hechos

Pasó con **tres** de seis en una sola ola. Antes de construir cualquier punto de esa lista,
comprobar el EFECTO en el código, no el estado en la tabla:

- **#25** (fecha de creación vs última conversión): cerrado desde el 2026-08-12.
- **#27** (periodo por defecto = mes actual): ya usaba `bogotaYearMonth()`.
- **#35** decía *"el dato de asignación no existe"*: `negocio_responsables.assigned_at`
  está poblado **al 100%** desde el 2026-07-08.

## Dos huecos abiertos que deciden dinero

1. **21 negocios con el origen declarado en desacuerdo con el rastro de Meta**, 14 de ellos
   marcados como `promotor` (20% a terceros contra 16% de marketing). El tablero los marca
   y **no los corrige**: es decisión de una persona. Engancha con el punto #46.
2. **97 filas de `negocio_responsables` con `rol` NULL** (deuda #57; eran 53 el 11-ago).
   Invisibles para el motor. En el bono se cuentan aparte, nunca como asignación.

## Dos cosas que hay que confirmar con el cliente

- **Qué cuenta como hora hábil** en el plazo de radicación (jornada y si el sábado entra).
  Quedó como configuración en `config_bono_operaciones` con el default declarado en pantalla
  como supuesto. Mueve el indicador varios puntos: medido en agosto, 93,9% con día completo,
  87,9% con sábado hábil, 97,0% con jornada 8-18.
- **`festivos_colombia` solo llega hasta 2027.** Desde 2028 los festivos contarían como
  hábiles, en contra del operativo. La pantalla avisa; sembrar los años sigue pendiente.

Relacionado: [[soena-ve-pipeline]], [[casillas-gate-faltantes]].
