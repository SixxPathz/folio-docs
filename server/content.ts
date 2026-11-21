import path from "node:path";
import mammoth from "mammoth";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Everything that enters the database as document HTML goes through `cleanHtml`.
 * The allowlist mirrors what the editor can actually produce, so stored content
 * can never carry markup the editor would not render (and never carries scripts).
 */
export function cleanHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["h1", "h2", "h3", "p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "blockquote", "code", "pre", "hr", "a"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      b: "strong",
      i: "em",
      h4: "h3",
      h5: "h3",
      h6: "h3",
    },
  }).trim();
}

export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown", ".docx"] as const;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export class UnsupportedFileError extends Error {}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain text: blank lines separate paragraphs, single newlines become <br>. */
function textToHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Convert an uploaded file into sanitized editor HTML. */
export async function fileToHtml(filename: string, buffer: Buffer): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  let html: string;
  switch (ext) {
    case ".txt":
      html = textToHtml(buffer.toString("utf8"));
      break;
    case ".md":
    case ".markdown":
      html = await marked.parse(buffer.toString("utf8"), { gfm: true });
      break;
    case ".docx": {
      const result = await mammoth.convertToHtml({ buffer });
      html = result.value;
      break;
    }
    default:
      throw new UnsupportedFileError(`Unsupported file type "${ext || "(none)"}". Use .txt, .md or .docx.`);
  }
  return cleanHtml(html);
}

/**
 * Title for an imported doc. If the file opens with a heading, that heading becomes the
 * title and is removed from the body (otherwise it would render twice). Else: filename.
 */
export function splitImportTitle(filename: string, html: string): { title: string; html: string } {
  const lead = html.match(/^<h[1-3][^>]*>(.*?)<\/h[1-3]>/is);
  const fromHeading = lead ? sanitizeHtml(lead[1], { allowedTags: [] }).trim() : "";
  if (fromHeading) return { title: fromHeading.slice(0, 120), html: html.slice(lead![0].length).trim() };
  const base = path.basename(filename, path.extname(filename));
  return { title: (base || "Imported document").slice(0, 120), html };
}
