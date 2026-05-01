import type { ParsedDocument, StudyFile } from "@/lib/types";

function toLegacyParsedDocument(sourceFile: string, fullText: string): ParsedDocument {
  return {
    sourceFile,
    fileType: "unknown",
    fullText,
    diagnostics: {
      success: Boolean(fullText.trim()),
      charCount: fullText.length,
      warnings: ["Legacy file without diagnostics. Re-upload for full parser diagnostics."],
      errors: [],
      extractionQuality: fullText.trim() ? "medium" : "failed",
    },
  };
}

function normaliseParsedDocument(document: ParsedDocument, sourceFile: string, fallbackText: string, role?: StudyFile["role"]): ParsedDocument {
  const fullText = typeof document.fullText === "string" ? document.fullText : fallbackText || "";
  const pages = Array.isArray(document.pages) ? document.pages : [];
  return {
    sourceFile: document.sourceFile || sourceFile || "Unknown source",
    fileType: document.fileType || "unknown",
    role: role ?? document.role,
    fullText,
    pages,
    sections: Array.isArray(document.sections) ? document.sections : [],
    diagnostics: {
      success: document.diagnostics?.success ?? Boolean(fullText.trim()),
      charCount: document.diagnostics?.charCount ?? fullText.length,
      pageCount: document.diagnostics?.pageCount ?? (pages.length || undefined),
      warnings: Array.isArray(document.diagnostics?.warnings) ? document.diagnostics.warnings : [],
      errors: Array.isArray(document.diagnostics?.errors) ? document.diagnostics.errors : [],
      likelyScannedPdf: document.diagnostics?.likelyScannedPdf,
      extractionQuality: document.diagnostics?.extractionQuality ?? (fullText.trim() ? "medium" : "failed"),
    },
  };
}

export function toRoleParsedDocument(file: StudyFile): ParsedDocument {
  return normaliseParsedDocument(file.parsedDocument ?? toLegacyParsedDocument(file.name, file.content), file.name, file.content, file.role);
}
