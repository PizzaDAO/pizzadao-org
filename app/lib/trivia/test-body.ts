// Test helper: flatten a Discord message body to plain text (content + embed text) so tests can search it.
type EmbedLike = { title?: string; description?: string; fields?: Array<{ name: string; value: string }>; footer?: { text: string } };

export function bodyText(body: { content?: string; embeds?: unknown[] }): string {
  const parts: string[] = [body.content ?? ""];
  for (const e of (body.embeds ?? []) as EmbedLike[]) {
    parts.push(e.title ?? "", e.description ?? "");
    for (const f of e.fields ?? []) parts.push(f.name, f.value);
    parts.push(e.footer?.text ?? "");
  }
  return parts.filter(Boolean).join("\n");
}
