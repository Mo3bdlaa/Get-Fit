import type { MessageKey } from "@/lib/i18n";

/**
 * Server actions return message *keys*, never prose: the UI renders them in the
 * viewer's locale. A "use server" module may only export async functions, so
 * this type and constant live outside `src/app/actions.ts`.
 */
export type FormState = { error: MessageKey | null; ok?: boolean };

export const EMPTY_FORM_STATE: FormState = { error: null };
