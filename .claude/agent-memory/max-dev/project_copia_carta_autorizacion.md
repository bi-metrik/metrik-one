---
name: project-copia-carta-autorizacion
description: Copia readonly (documento) de la carta de autorización generada (formulario) en etapas posteriores de SOENA; INSERT del bloque_config pendiente tras el merge
metadata:
  type: project
---

2026-10-06: Mauricio recortó el encargo a mitad de camino. Se pidió primero extender `compartido_con_origen` a formularios (generar desde el espejo escribiendo en el origen); se descartó y quedó SOLO una copia `documento` readonly que lee el `drive_url` del formulario `carta_autorizacion_generar` (`src/lib/negocios/copia-de-formulario.ts`).

**Why:** el equipo no encontraba el borrador en el historial cerrado; generar desde otra etapa no hacía falta.

**How to apply:** el código queda inerte hasta que la sesión principal inserte el `bloque_configs` de la copia (SQL en la descripción del PR, `etapa_id` de parámetro, `estado='visible'`, def de documento copiada de las copias de `carta_autorizacion_notariada`). Si vuelven a pedir «generar desde la copia», es el alcance descartado: confirmar con Mauricio antes. Relacionado: [[project-factura-copia-escribe-origen]].
