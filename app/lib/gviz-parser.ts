/**
 * Parses Google Visualization (GViz) JSON responses
 * GViz wraps JSON responses in a comment wrapper that needs to be stripped
 */
export function parseGvizJson(text: string) {
  const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("GViz: Unexpected response");
  return JSON.parse(cleaned.slice(start, end + 1));
}
