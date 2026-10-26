---
name: project-trigger-staff-rol-sin-contador
description: trg_sync_staff_role no espeja 'contador' (lo deja NULL); por eso getWorkspace no autocrea staff de contador (#988)
metadata:
  type: project
---

`trg_sync_staff_role` (AFTER INSERT OR UPDATE OF rol_plataforma) reescribe `profiles.role` desde `staff.rol_plataforma` con un CASE SIN `WHEN 'contador'`: insertar staff con 'contador' y profile_id deja `profiles.role` en NULL. En #988 (2026-10-02) el autocreado de `getWorkspace` quedo: operator→ejecutor, read_only→campo, contador→NO se autocrea (warn una vez), desconocido→no (antes caia en dueno = owner).

**Why:** el mapa viejo mandaba 'operativo' (fuera del CHECK) → 23514 → 528 errores en alma-afi el 01-oct. El brief pedia contador→'contador'; se reto porque borraria el rol.

**How to apply:** todo valor de `rol_plataforma` que se escriba tiene que volver por el CASE al MISMO `profiles.role`. Para autocrear contadores hace falta una migracion que agregue `WHEN 'contador' THEN 'contador'` al trigger. Verificar el CASE vivo antes de asumir que sigue igual.
