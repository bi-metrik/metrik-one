---
name: project-numero-vuelo-por-tramo
description: Fila de vuelo de negocio_servicios toma número por tramo de items.tramos; filas viejas se releen al abrir el tablero por contenido, sin marca nueva ni migración
metadata:
  type: project
---

Desde fix/numero-vuelo-por-tramo (2026-10-22), los tramos de la fila de vuelo salen de `items.tramos` (ya repartido con `numerosDeVuelo`); sin la columna, la lectura de siempre (número entero en la ida, sin partir).

**Why:** el regreso quedaba sin número y los hitos de check-in/pasabordo lo necesitan.

**How to apply:**
- `items.tramos` se lee APARTE en `generarServiciosDesdeTarifa` (`tramosDeItems`), NO en `contextoDeCotizacion`: la pantalla por pasos espeja ese contexto campo a campo (P3 de por-pasos-vista-e2e) y agregar un campo tumba 8 pruebas.
- Filas ya generadas: `vueloSinNumeroDeRegreso` (vuelo con un tramo tras el primero sin número) hace que abrir el tablero las relea aunque tengan `fechas_leidas_at`. Sin `items.tramos` se releen en cada apertura sin escribir (costo: 2 lecturas).
- El doble de servicios-viaje-e2e recorta columnas solo en `items` con lista plana; los demás selects siguen trayendo la fila entera. Ver [[project-hitos-de-gestion]].
