// Every test file runs in its own forked process (see vitest.config.ts), so an
// in-memory database gives each file a clean, isolated schema.
process.env.GETFIT_DB_PATH = ":memory:";
process.env.SESSION_SECRET = "test-secret-not-used-anywhere-else";
