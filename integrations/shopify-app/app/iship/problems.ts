import type { MessageKey, Translate } from "./i18n";

export interface ProblemLike {
  field: string;
  code: string;
}

/** One sentence describing a problem in the page's language. */
export function describeProblem(t: Translate, problem: ProblemLike): string {
  const field = t(`field.${problem.field}` as MessageKey);
  const key = `problem.${problem.code}` as MessageKey;
  return t(key, { field });
}

export function parseProblems(value: string | null): ProblemLike[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
