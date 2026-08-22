import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { assertCan, type Actor } from "@/lib/authz";

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

/** Idempotent: safe to run on every boot and in every test. */
export function seedCatalogue(): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO exercises (id, slug, name_en, name_ar, equipment, primary_muscle, visibility, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'global', NULL, ?, ?)`,
  );
  const exists = db.prepare("SELECT 1 FROM exercises WHERE slug = ?");

  db.transaction(() => {
    const now = nowIso();
    for (const item of SEED) {
      if (exists.get(item.slug)) continue;
      insert.run(
        newId(),
        item.slug,
        item.nameEn,
        item.nameAr,
        item.equipment,
        item.primaryMuscle,
        now,
        now,
      );
    }
  })();
}

export function listCatalogue(actor: Actor): Exercise[] {
  assertCan(actor, "read", { type: "exercise", visibility: "global", ownerId: null });
  const rows = getDb()
    .prepare(
      `${SELECT} WHERE deleted_at IS NULL AND (visibility = 'global' OR owner_id = ?)
       ORDER BY name_en`,
    )
    .all(actor.id) as ExerciseRow[];
  return rows.map(toExercise);
}

export function findExerciseById(id: string): Exercise | null {
  const row = getDb()
    .prepare(`${SELECT} WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as ExerciseRow | undefined;
  return row ? toExercise(row) : null;
}

export function findExerciseBySlug(slug: string): Exercise | null {
  const row = getDb()
    .prepare(`${SELECT} WHERE slug = ? AND deleted_at IS NULL`)
    .get(slug) as ExerciseRow | undefined;
  return row ? toExercise(row) : null;
}
