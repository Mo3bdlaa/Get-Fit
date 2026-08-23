/**
 * Type-parser configuration shared by both drivers.
 *
 * Postgres hands back `timestamptz` as a driver-specific value — `pg` builds a
 * JS `Date`, PGlite does its own thing — and the domain model wants one ISO
 * string either way. Registering the parsers once here is what keeps the
 * repositories free of `instanceof Date` checks.
 */

export const TIMESTAMPTZ_OID = 1184;
export const TIMESTAMP_OID = 1114;
export const DATE_OID = 1082;

export function toIsoString(value: string): string {
  return new Date(value).toISOString();
}

/** `date` columns are calendar days: keep them as `YYYY-MM-DD`, not instants. */
export function toDateString(value: string): string {
  return value;
}
