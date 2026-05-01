import type { ParsedDocument, StudyFileRole } from "@/lib/types";

export function inferStudyFileRole(fileName: string): StudyFileRole {
  const name = fileName.toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(chapter|notes?|lecture|lectures?)\b/.test(name)) return "lecture_notes";
  if (/\b(format|guidance|syllabus)\b/.test(name)) return "exam_guidance";
  if (/\b(mark scheme|marking scheme|marks? scheme)\b/.test(name)) return "mark_scheme";
  if (/\b(past|paper|exam|mock)\b/.test(name)) return "past_paper";
  if (/\b(problem sheet|problems?|worksheet|exercise sheet|\bps\b)\b/.test(name)) return "problem_sheet";
  if (/\b(solution|solutions|answers?|answer)\b/.test(name)) return "solution_sheet";
  if (/\b(formula sheet|formulae|formulas)\b/.test(name)) return "formula_sheet";
  return "other";
}

export function withDocumentRole(document: ParsedDocument, role: StudyFileRole): ParsedDocument {
  return { ...document, role };
}

export function roleLabel(role: StudyFileRole) {
  return role.replace(/_/g, " ");
}

const ROLE_UI: Record<StudyFileRole, string> = {
  lecture_notes: "Lecture notes",
  exam_guidance: "Exam guidance / format",
  past_paper: "Past papers",
  problem_sheet: "Problem sheets",
  solution_sheet: "Solutions",
  formula_sheet: "Formula sheet",
  mark_scheme: "Mark schemes",
  other: "Other",
};

export function studyFileRoleLabel(role: StudyFileRole) {
  return ROLE_UI[role] ?? roleLabel(role);
}
