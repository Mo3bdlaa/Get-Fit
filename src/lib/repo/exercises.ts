import { query, queryOne } from "@/lib/db";
import { assertCan, type Actor } from "@/lib/authz";
import { isUuid } from "@/lib/ids";

export type Exercise = {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  equipment: string;
  primaryMuscle: string;
  visibility: "global" | "private";
  ownerId: string | null;
};

type ExerciseRow = {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  equipment: string;
  primary_muscle: string;
  visibility: "global" | "private";
  owner_id: string | null;
};

const SELECT =
  `SELECT id, slug, name_en, name_ar, equipment, primary_muscle, visibility, owner_id
   FROM exercises`;

function toExercise(row: ExerciseRow): Exercise {
  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    equipment: row.equipment,
    primaryMuscle: row.primary_muscle,
    visibility: row.visibility,
    ownerId: row.owner_id,
  };
}

/**
 * R0 seed. The shape mirrors `free-exercise-db` (public domain, §6) so the full
 * import normalises into these columns rather than the source's own shape.
 * Arabic names are hand-written, per §6 step 2.
 */
const SEED: ReadonlyArray<Omit<Exercise, "id" | "visibility" | "ownerId">> = [
  {
    slug: "barbell-back-squat",
    nameEn: "Barbell Back Squat",
    nameAr: "سكوات بالبار خلفي",
    equipment: "barbell",
    primaryMuscle: "quadriceps",
  },
  {
    slug: "barbell-bench-press",
    nameEn: "Barbell Bench Press",
    nameAr: "ضغط بنش بالبار",
    equipment: "barbell",
    primaryMuscle: "chest",
  },
  {
    slug: "conventional-deadlift",
    nameEn: "Conventional Deadlift",
    nameAr: "رفعة ميتة تقليدية",
    equipment: "barbell",
    primaryMuscle: "hamstrings",
  },
];

/**
 * Idempotent: safe to run on every boot and in every test.
 *
 * No `assertCan`: the catalogue is reference data, not a user's record, and the
 * seed runs at startup where there is no actor. Carried as a named exemption in
 * `tests/authz-enforcement.test.ts`.
 *
 * `ON CONFLICT (slug) WHERE deleted_at IS NULL` — the arbiter index is partial,
 * so the predicate has to be restated for Postgres to infer it.
 */
export async function seedCatalogue(): Promise<void> {
  for (const item of SEED) {
    await query(
      `INSERT INTO exercises (slug, name_en, name_ar, equipment, primary_muscle)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING`,
      [item.slug, item.nameEn, item.nameAr, item.equipment, item.primaryMuscle],
    );
  }
}

export async function listCatalogue(actor: Actor): Promise<Exercise[]> {
  await assertCan(actor, "read", {
    type: "exercise",
    visibility: "global",
    ownerId: null,
  });
  const rows = await query<ExerciseRow>(
    `${SELECT} WHERE deleted_at IS NULL AND (visibility = 'global' OR owner_id = $1)
     ORDER BY name_en`,
    [actor.id],
  );
  return rows.map(toExercise);
}

/**
 * No `assertCan`: an id lookup against reference data, used to validate input.
 *
 * The uuid screen matters: unlike SQLite, Postgres raises a type error for a
 * malformed uuid rather than returning no rows, and this is fed straight from a
 * form field.
 */
export async function findExerciseById(id: string): Promise<Exercise | null> {
  if (!isUuid(id)) return null;

  const row = await queryOne<ExerciseRow>(
    `${SELECT} WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return row ? toExercise(row) : null;
}

/** No `assertCan`: reference data lookup by slug, used by seeds and tests. */
export async function findExerciseBySlug(slug: string): Promise<Exercise | null> {
  const row = await queryOne<ExerciseRow>(
    `${SELECT} WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );
  return row ? toExercise(row) : null;
}
