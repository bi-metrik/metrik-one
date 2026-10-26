---
name: reporte-supertransporte
description: Pestaña Reporte Supertransporte de /tableros (compliance, ALMA) y correo de los avisos del monitoreo R3 — reglas de conteo, cómo se excluye a MéTRIK y qué quedó fuera
metadata:
  type: project
---

Construido el 2026-10-08 (rama feat/reporte-supertransporte), spec de Lucia en
`proyectos/afi/alma/docs/entrada/2026-10-08_tablero-reporte-supertransporte.md`. Sin migración.

- **«Contrapartes» = todos** (proveedores, clientes y empleados), aclaración de Mauricio: no se
  filtra por `universo`. El desglose usa el NOMBRE de `compliance_segmentos`; tras el merge la
  sesión principal renombra «Contraparte»→«Proveedor» y crea «Cliente» en ALMA. Segmento activo
  sin consultas = 0 real; inactivo solo si tiene datos.
- **MéTRIK se excluye por `profiles.platform_admin` o correo @metrik.com.co** (Auth Admin). En
  ALMA las 12 consultas de agosto y 3 de junio son de Mauricio (platform_admin).
- `kyc_expediente_ref` no tiene `created_by`: los 2 expedientes de ALMA (Metrik IA y AFI, 10-sep,
  pendiente_revision) parecen pruebas y NO se pueden excluir. Solo se cuentan los decididos.
- Cambiar el periodo = `router.replace` → la página entera se recalcula. Barato solo porque ALMA
  es el único workspace con compliance; si otro workspace pesado lo enciende, mover el reporte a
  una ruta GET propia.
- Correo del monitoreo: un correo por barrido a `owner` (sin platform_admin), en `barrido.ts`
  (cron de Next, no edge function). Recordatorio de vencimiento NO hecho: `notificaciones.tipo`
  tiene CHECK y pediría migración.

**How to apply:** si piden la marca DDI, operación intentada o capacitaciones, las tarjetas ya
tienen su lugar (`conteo.ts`, literales d y f); se pasa de `sin_dato`/`parcial` a `dato`.
