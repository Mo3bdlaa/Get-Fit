const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres rejects a malformed uuid with a type error rather than an empty
 * result, so lookups screen the shape before asking. Ids themselves come from
 * `gen_random_uuid()` in the database, not from the application.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
