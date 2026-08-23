// No DATABASE_URL: the database layer starts an in-memory PGlite instance —
// PostgreSQL 18 in-process — so the tests run the same SQL that production does.
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-not-used-anywhere-else";

// scrypt at production cost is ~100ms a call and this suite registers users in
// the hundreds. The cost is recorded in the hash, so verification still works.
process.env.SCRYPT_COST_LOG2 = "10";
