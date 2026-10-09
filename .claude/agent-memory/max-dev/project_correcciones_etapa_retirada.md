---
name: correcciones-etapa-retirada
description: SOE-006 (2026-10-10) — cambio_etapa guarda NOMBRES; migración 20261010113000 (tabla de nombres anteriores + trigger + resolver) SIN aplicar; destino sin resolver CUENTA; calificados = primera etapa
metadata:
  type: project
---

El renombre «Seguimiento» → «Entrega a la DIAN» (#1067, 7-oct) dejó en cero Correcciones del bono
de agosto y septiembre. Arreglo: `etapas_nombres_anteriores` (la llena un trigger en
`etapas_negocio` al renombrar o borrar) + `etapa_orden_registrada(linea, valor, momento)`.
Semilla de 4 renombres SOENA previos al trigger: Radicación→Pago UPME (8), Precobro→Segundo cobro
(10), Cobro→Cartera (11), Seguimiento→Entrega a la DIAN (19), medidos en activity_log.

**Estado (2026-10-10):** migración SIN aplicar, PR sin mergear. Dry-run en
`sql/soena/2026-10-10_dry-run_correcciones-etapa-retirada.sql`. md5 vivos al medir: resumen
e7b2e02c…, detalle 2d983ef8…, directivo 93328c46….

**Why:** se descartó guardar id/orden en activity_log: 9+ escritores y la historia igual necesita
el mapa de nombres. El trigger hace que el próximo renombre no rompa nada.

**How to apply:**
- Regla de Correcciones: cuenta salvo retroceso; destino SIN resolver cuenta (brief: «una etapa que
  ya no existe no puede hacer caer el conteo»). Hoy 0 sin resolver.
- Octubre SÍ cambia el denominador (Camila 8→29, salidas a «Seguimiento» del 1 al 6-oct) aunque no el
  puntaje ni el bono. El brief decía «octubre no debería cambiar».
- `get_directivo_soena` calificados pasó a «salida de la primera etapa de la línea» (oct 37→33).
- Sin tocar, frágiles por nombre: `get_capacidad_seccional_soena` (entrada a Certificación por
  nombre de hoy), `tasaDeCierre` en `src/lib/tableros/bandejas.ts` (fase por nombre), y
  `reapertura.ts` usa `valor_anterior` como si fuera un id de etapa (bug previo, no de #1067).
- Supervisora de la tarjeta: NO se tocó (regla de Mauricio). Su bono sale 0 por salario sin registrar.

Relacionado: [[historico-inactivos-soe006]], [[soe001-seguimiento-operaciones]].
