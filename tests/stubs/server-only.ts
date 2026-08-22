// `server-only` throws when Node resolves it outside React's server condition,
// which is exactly what a plain Vitest run is. The guard still does its job in
// the Next build; here it is aliased to nothing so server modules are testable.
export {};
