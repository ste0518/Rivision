export async function parseTextFile(file: File): Promise<string> { return file.text(); }
export async function parseMarkdownFile(file: File): Promise<string> { return file.text(); }
export async function parsePdfFile(file: File): Promise<string> {
  // TODO: Add robust PDF parsing, for example via pdf.js in the browser or a server-side parser.
  return `[PDF placeholder] ${file.name}\nPDF parsing is not implemented in the MVP. Export text or paste notes as TXT/Markdown for exact extraction.`;
}
export async function parseDocxFile(file: File): Promise<string> {
  // TODO: Add DOCX parsing, for example via mammoth.js, while preserving mathematical notation where possible.
  return `[DOCX placeholder] ${file.name}\nDOCX parsing is not implemented in the MVP. Export text or paste notes as TXT/Markdown for exact extraction.`;
}
export async function parseStudyFile(file: File): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "md" || file.type === "text/markdown") return parseMarkdownFile(file);
  if (extension === "pdf" || file.type === "application/pdf") return parsePdfFile(file);
  if (extension === "docx" || file.type.includes("wordprocessingml")) return parseDocxFile(file);
  return parseTextFile(file);
}
