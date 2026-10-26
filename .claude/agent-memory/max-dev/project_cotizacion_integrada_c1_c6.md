---
name: cotizacion-integrada-c1-c6
description: Etapa C de la cotización por pasos de Trappvel (2026-10-12) — pila de PRs #1135→#1146 + #1147 pastilla; modelo_destino nace apagada (M4); «Otro servicio» pide migración; marca incluye_origen en el dato; lote parte por imágenes
metadata:
  type: project
---

Pila apilada, en orden: #1135 C1 (base main) → #1136 C2 → #1137 C3 → #1143 C4 → #1144 C5 → #1146 C6. Aparte, desde main:
#1147 pastilla por vuelo. Sin migración en ninguna. La sesión principal mergea en orden y reapunta a main. El
2026-10-12 la pila entera, mezclada con origin/main, pasaba negocios + cotizaciones + pdf (3.054 pruebas).

**Why:** brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-12-cotizacion-integrada-c1-c6.md`; la
condición de Mauricio es que con `config_extra.cotizacion_por_pasos.activo` apagado ONE sea byte a byte el de hoy
(el fixture de C0 no se regenera, [[cotizacion-integrada-c0]]).

**How to apply (lo que no se ve en el código a primera vista):**
- **`modelo_destino` es la única pieza opt-in** (`PIEZAS_SOLO_CON_TRUE`): sin la corrida REAL de M1 con la llave de
  pruebas, M4 la deja apagada. Las respuestas «grabadas» de las pruebas son un doble, no una grabación. Modelo
  `gemini-2.5-flash-lite` sin pensamiento, corte 2,5 s: lo revisan Yuto/Max contra la doc antes de encender.
- **«Otro servicio» (asistencia médica, seguro) NO está**: `cotizacion_ranuras.tipo` tiene CHECK con 4 tipos →
  pide migración. «Asistencia médica → Documentos del viajero» (C6, Noor §11) quedó colgado de eso.
- **Un recálculo por lote**: `recalculo-diferido.ts` (AsyncLocalStorage) hace que `recalcularTotales` no corra dentro
  de `aceptar-lote`; fuera del lote no cuesta ni una ida. Pero la bandeja PARTE el lote por los 4,4 MB del borde
  (las imágenes viajan con cada fila): son N recálculos si hay N envíos.
- **«Incluye» por ONE se decide por la MARCA en el dato** (`documento_cliente.incluye_origen = 'one'`), nunca por el
  interruptor; una vez marcada, guardar o redactar con la pantalla vieja la conserva (si no, volvería la lista de IA).
- **`LecturaCasilla.sinPrecio`** (vuelo/actividad escritos a mano con niño o infante vacío) cambia
  `ocupacionObservada`: sin él la opción quedaba cubriendo solo a los adultos (6/0/0) en vez de «falta el precio».
- «Completa {opción}» escribe el precio en `costosAMano` con `desde: 'pantallazo'`: la resta por casillas no sirve
  ahí porque el pantallazo 1 de «solo adulto» trae un total más bajo que la búsqueda con el niño.
- Main subió +1 el presupuesto de idas del PDF en el merge de F3/F4/F6 (#1128…); el fix de C1 lo baja otra vez.
- Tiempos (no hay Playwright: el preview es la base de producción): doble en memoria, elegir opción por pasos 32 idas
  (vieja 27), deshacer 30, aceptar 11 en lote 286 idas / 1 sesión, recalcular la pantalla en el navegador 0,8 ms.

Relacionado: [[cotizacion-integrada-c0]], [[pruebas-por-mutacion]], [[project-preview-abre-workspace]].
