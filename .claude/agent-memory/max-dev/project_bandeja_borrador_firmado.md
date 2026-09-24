---
name: project-bandeja-borrador-firmado
description: Bandeja de capturas Trappvel (#889): leer no escribe, la lectura es un borrador firmado HMAC y solo «Aceptar» toca Componentes
metadata:
  type: project
---

Desde el PR #889 (2026-09-24, squash 20583c4f), la bandeja de capturas de Trappvel ya no crea ranura, opción ni habitación al mirar o leer. `leerCapturaEnBorrador` devuelve la lectura firmada (`firma-borrador.ts`: HMAC con SUPABASE_SERVICE_ROLE_KEY, vence en 24 h). `aceptarCapturaDeBandeja` verifica esa firma y recién ahí escribe, ubicando la captura con `ubicarLectura` contra la cotización del momento. Aceptar va por fetch a `/api/cotizaciones/[id]/aceptar-captura` y las aceptaciones van en fila en el cliente.

**Why:** H2 de Mauricio en la prueba de COT-2026-0015: nada de lo que siga en la bandeja puede tocar Componentes. Se escogió la firma para evitar una tabla de staging con su migración. La firma también cierra el hueco de seguridad: una server action exportada que escribiera una lectura sin verificar es un endpoint alcanzable.

**How to apply:**
- Si cambias la forma de `LecturaCasilla`, un borrador firmado antes del deploy sigue siendo válido 24 h y se parsea con la forma vieja.
- H4 («Aceptar con cambios») tiene que guardar las correcciones aparte de `lecturaJson`, porque ese JSON es lo que va firmado.
- `revisarBorrador` es solo un pronóstico: lo que decide es el servidor al aceptar.
- H6, H7 y H8 quedaron en pausa a la espera del rediseño de la tarjeta (Noor). H4 y H5 siguen pendientes.

Related: [[project-habitaciones-hotel-r8]]
