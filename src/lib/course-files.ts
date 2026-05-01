import type { ParsedDocument, StudyFileRole } from "@/lib/types";

export function inferStudyFileRole(fileName: string): StudyFileRole {
  const name = fileName.toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(notes?|lecture|lectures?)\b/.test(name)) return "lecture_notes";
  if (/\b(exam format|guidance|syllabus)\b/.test(name)) return "exam_guidance";
  if (/\b(mark scheme|marking scheme|marks? scheme)\b/.test(name)) return "mark_scheme";
  if (/\b(past paper|exam|mock)\b/.test(name)) return "past_paper";
  if (/\b(problem sheet|problems?|worksheet|exercise sheet)\b/.test(name)) return "problem_sheet";
  if (/\b(solution|solutions|answers?)\b/.test(name)) return "solution_sheet";
  if (/\b(formula sheet|formulae|formulas)\b/.test(name)) return "formula_sheet";
  return "other";
}

export function withDocumentRole(document: ParsedDocument, role: StudyFileRole): ParsedDocument {
  return { ...document, role };
}

export function roleLabel(role: StudyFileRole) {
  return role.replace(/_/g, " ");
}
