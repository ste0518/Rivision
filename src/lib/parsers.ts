import type { ParsedDocument, ParsedPage, ParsedSection } from "@/lib/types";

const MIN_PDF_CHARS_PER_PAGE = 80;

export async function parseTextFile(file: File): Promise<ParsedDocument> {
  const fullText = await file.text();
  return finalizeParsedDocument({
    sourceFile: file.name,
    fileType: "txt",
    fullText,
  });
}

export async function parseMarkdownFile(file: File): Promise<ParsedDocument> {
  const fullText = await file.text();
  return finalizeParsedDocument({
    sourceFile: file.name,
    fileType: "md",
    fullText,
  });
}

export async function parsePdfFile(file: File): Promise<ParsedDocument> {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const [{ getDocument, GlobalWorkerOptions }, arrayBuffer] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      file.arrayBuffer(),
    ]);
    // Configure worker in browser builds; without this, pdf.js throws:
    // "No 'GlobalWorkerOptions.workerSrc' specified."
    if (!GlobalWorkerOptions.workerSrc) {
      GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
    }

    const pdf = await getDocument({ data: arrayBuffer }).promise;
    const pages: ParsedPage[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ("str" in item ? String(item.str) : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({ pageNumber, text, charCount: text.length });
    }

    const fullText = renderPages(file.name, pages);
    const charCount = fullText.length;
    const pageCount = pages.length;
    const avgCharsPerPage = pageCount > 0 ? charCount / pageCount : 0;
    const likelyScannedPdf = pageCount > 0 && avgCharsPerPage < MIN_PDF_CHARS_PER_PAGE;
    if (likelyScannedPdf) {
      warnings.push("This PDF may be scanned or image-based. Text extraction returned very little content.");
    }

    const parsed = finalizeParsedDocument({
      sourceFile: file.name,
      fileType: "pdf",
      fullText,
      pages,
      warnings,
      errors,
    });
    parsed.diagnostics.pageCount = pageCount;
    parsed.diagnostics.likelyScannedPdf = likelyScannedPdf;
    return parsed;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unknown PDF parsing error.");
    return finalizeParsedDocument({
      sourceFile: file.name,
      fileType: "pdf",
      fullText: "",
      warnings,
      errors,
    });
  }
}

export async function parseDocxFile(file: File): Promise<ParsedDocument> {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const [mammoth, arrayBuffer] = await Promise.all([import("mammoth"), file.arrayBuffer()]);
    const result = await mammoth.extractRawText({ arrayBuffer });
    const fullText = (result.value ?? "").replace(/\r\n/g, "\n").trim();

    if (fullText.length < 120) {
      warnings.push("DOCX extraction returned very little text. Please verify the preview before extraction.");
    }
    if (result.messages?.length) {
      warnings.push(...result.messages.map((message) => `[mammoth] ${message.message}`));
    }

    return finalizeParsedDocument({
      sourceFile: file.name,
      fileType: "docx",
      fullText,
      warnings,
      errors,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unknown DOCX parsing error.");
    return finalizeParsedDocument({
      sourceFile: file.name,
      fileType: "docx",
      fullText: "",
      warnings,
      errors,
    });
  }
}

export async function parseStudyFile(file: File): Promise<ParsedDocument> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "md" || file.type === "text/markdown") return parseMarkdownFile(file);
  if (extension === "pdf" || file.type === "application/pdf") return parsePdfFile(file);
  if (extension === "docx" || file.type.includes("wordprocessingml")) return parseDocxFile(file);
  if (extension === "txt" || file.type.startsWith("text/")) return parseTextFile(file);
  return finalizeParsedDocument({
    sourceFile: file.name,
    fileType: "unknown",
    fullText: await file.text(),
  });
}

function renderPages(sourceFile: string, pages: ParsedPage[]) {
  const chunks = [`[Source file: ${sourceFile}]`];
  for (const page of pages) {
    chunks.push(`[Page ${page.pageNumber}]`, page.text || "");
  }
  return chunks.join("\n\n").trim();
}

function finalizeParsedDocument(input: {
  sourceFile: string;
  fileType: ParsedDocument["fileType"];
  fullText: string;
  pages?: ParsedPage[];
  warnings?: string[];
  errors?: string[];
}): ParsedDocument {
  const warnings = input.warnings ?? [];
  const errors = input.errors ?? [];
  const fullText = input.fullText ?? "";
  const sections = detectSections(fullText);
  const charCount = fullText.length;
  const success = errors.length === 0 && charCount > 0;
  const extractionQuality = computeExtractionQuality(charCount, warnings, errors);

  return {
    sourceFile: input.sourceFile,
    fileType: input.fileType,
    fullText,
    pages: input.pages,
    sections,
    diagnostics: {
      success,
      charCount,
      warnings,
      errors,
      extractionQuality,
    },
  } satisfies ParsedDocument;
}

function computeExtractionQuality(charCount: number, warnings: string[], errors: string[]): ParsedDocument["diagnostics"]["extractionQuality"] {
  if (errors.length > 0 || charCount === 0) return "failed";
  if (charCount < 250 || warnings.length >= 3) return "low";
  if (charCount < 1500 || warnings.length >= 1) return "medium";
  return "high";
}

function detectSections(fullText: string): ParsedSection[] {
  const lines = fullText.replace(/\r\n/g, "\n").split("\n");
  const sectionRegexes = [
    /^(?:#{1,6}\s*)(.+)$/i,
    /^(Chapter|Section)\s+(\d+(?:\.\d+)*)\s*[:.-]?\s*(.*)$/i,
    /^(\d+(?:\.\d+)*)\s+(.+)$/,
    /^(Definition|Theorem|Lemma|Proposition|Corollary)\s+(\d+(?:\.\d+)*)\s*[:.-]?\s*(.*)$/i,
  ];

  const found: Array<{ title: string; sectionNumber?: string; startOffset: number }> = [];
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      for (const regex of sectionRegexes) {
        const match = trimmed.match(regex);
        if (!match) continue;
        if (regex === sectionRegexes[0]) {
          found.push({ title: match[1].trim(), startOffset: offset });
        } else {
          const sectionNumber = match[2] && /\d/.test(match[2]) ? match[2] : undefined;
          const suffix = match[3] ? ` ${match[3].trim()}` : "";
          const title = `${match[1]}${sectionNumber ? ` ${sectionNumber}` : ""}${suffix}`.trim();
          found.push({ title, sectionNumber, startOffset: offset });
        }
        break;
      }
    }
    offset += line.length + 1;
  }

  return found.map((section, index) => {
    const endOffset = index + 1 < found.length ? found[index + 1].startOffset : fullText.length;
    return {
      sectionTitle: section.title,
      sectionNumber: section.sectionNumber,
      startOffset: section.startOffset,
      endOffset,
      text: fullText.slice(section.startOffset, endOffset).trim(),
    };
  });
}
