/// <reference types="next" />
/// <reference types="next/image-types/global" />

// Next generates `next-env.d.ts` with these same references, but that file is
// gitignored and only appears after a build — so `npm run typecheck` would fail
// on a fresh clone. This committed copy makes the typecheck standalone.

declare module "*.css";
