// Tests del helper src/lib/dates/bogota.ts
// Correr: npx tsx scripts/test-bogota-dates.ts
//
// Casos borde criticos:
//   - 18:59 Bogota = aun el mismo dia
//   - 19:00 Bogota = 00:00 UTC del dia siguiente, pero sigue siendo MISMO dia Bogota
//   - 00:00 Bogota (dia nuevo en Bogota) = 05:00 UTC del mismo dia calendario UTC

import {
  todayBogotaISO,
  bogotaYear,
  bogotaYearMonth,
  formatBogotaEs,
  bogotaParts,
  nowBogotaTimestamp,
} from '../src/lib/dates/bogota'

import assert from 'node:assert/strict'

let passed = 0
let failed = 0

function t(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (e) {
    failed++
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`  FAIL ${name}`)
    console.log(`       ${msg}`)
  }
}

console.log('Helper Bogota dates — casos borde\n')

// 12 may 2026, 23:59 UTC = 18:59 Bogota — sigue siendo 12 may en Bogota
t('23:59 UTC del 12-may → "2026-05-12" en Bogota', () => {
  const d = new Date('2026-05-12T23:59:00Z')
  assert.equal(todayBogotaISO(d), '2026-05-12')
  assert.equal(bogotaYear(d), 2026)
  assert.equal(bogotaYearMonth(d), '2026-05')
})

// 13 may 2026, 00:00 UTC = 19:00 Bogota del 12-may — sigue siendo 12 may
t('00:00 UTC del 13-may → "2026-05-12" en Bogota (limite tarde)', () => {
  const d = new Date('2026-05-13T00:00:00Z')
  assert.equal(todayBogotaISO(d), '2026-05-12')
  const p = bogotaParts(d)
  assert.equal(p.hour, 19)
  assert.equal(p.day, 12)
})

// 13 may 2026, 04:59 UTC = 23:59 Bogota del 12-may — todavia 12 may
t('04:59 UTC del 13-may → "2026-05-12" en Bogota (justo antes de medianoche)', () => {
  const d = new Date('2026-05-13T04:59:59Z')
  assert.equal(todayBogotaISO(d), '2026-05-12')
})

// 13 may 2026, 05:00 UTC = 00:00 Bogota del 13-may — ya es 13 may
t('05:00 UTC del 13-may → "2026-05-13" en Bogota (medianoche Bogota)', () => {
  const d = new Date('2026-05-13T05:00:00Z')
  assert.equal(todayBogotaISO(d), '2026-05-13')
  const p = bogotaParts(d)
  assert.equal(p.hour, 0)
  assert.equal(p.day, 13)
})

// Borde de ano: 1 ene 2027 03:00 UTC = 31 dic 2026 22:00 Bogota
t('Borde de ano: 01-ene 2027 03:00 UTC → "2026-12-31" en Bogota', () => {
  const d = new Date('2027-01-01T03:00:00Z')
  assert.equal(todayBogotaISO(d), '2026-12-31')
  assert.equal(bogotaYear(d), 2026)
  assert.equal(bogotaYearMonth(d), '2026-12')
})

// 1 ene 2027 05:00 UTC = 00:00 Bogota del 01-ene-2027 — ya es nuevo ano
t('Borde de ano: 01-ene 2027 05:00 UTC → "2027-01-01" en Bogota', () => {
  const d = new Date('2027-01-01T05:00:00Z')
  assert.equal(todayBogotaISO(d), '2027-01-01')
  assert.equal(bogotaYear(d), 2027)
})

// formatBogotaEs
t('formatBogotaEs: "12 de mayo de 2026"', () => {
  const d = new Date('2026-05-13T00:00:00Z') // 19:00 Bogota 12-may
  assert.equal(formatBogotaEs(d), '12 de mayo de 2026')
})

t('formatBogotaEs: enero', () => {
  const d = new Date('2026-01-15T15:00:00Z')
  assert.equal(formatBogotaEs(d), '15 de enero de 2026')
})

// nowBogotaTimestamp incluye offset -05:00
t('nowBogotaTimestamp: incluye offset -05:00', () => {
  const d = new Date('2026-05-13T00:00:00Z') // 19:00 Bogota 12-may
  assert.equal(nowBogotaTimestamp(d), '2026-05-12T19:00:00-05:00')
})

// bogotaParts horas
t('bogotaParts: hora correcta a las 18:59 Bogota', () => {
  const d = new Date('2026-05-12T23:59:00Z')
  const p = bogotaParts(d)
  assert.equal(p.hour, 18)
  assert.equal(p.minute, 59)
})

console.log(`\n${passed} ok, ${failed} fail`)
if (failed > 0) process.exit(1)
