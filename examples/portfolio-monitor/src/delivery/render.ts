import { AppError, type NotificationContent } from "../contracts.js";

export const MAX_TELEGRAM_CHARACTERS = 4096;

/** Plain text only: formatting and destination selection never come from a model. */
export function renderNotification(content: NotificationContent): string {
  if (!content || typeof content !== "object") throw invalid("Notification content is required");
  const title = text(content.title, "title");
  const body = text(content.body, "body");
  if (content.links !== undefined && !Array.isArray(content.links)) throw invalid("Notification links must be an array");
  const links = (content.links ?? []).map((link) => {
    if (!link || typeof link !== "object") throw invalid("Notification link is invalid");
    const label = text(link.label, "link label");
    if (/[\r\n]/u.test(label)) throw invalid("Notification link labels must be single-line");
    const urlText = text(link.url, "link URL");
    let url: URL;
    try { url = new URL(urlText); } catch { throw invalid("Notification link must be an absolute HTTP(S) URL"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || /\s/u.test(urlText)) {
      throw invalid("Notification link must be an absolute HTTP(S) URL without credentials or whitespace");
    }
    return `${label}: ${urlText}`;
  });
  const rendered = [title, body, ...links].join("\n\n");
  // Telegram counts text after entity parsing; no parse_mode or entities are sent.
  // Use the conservative UTF-16 length too, so supplementary characters never
  // exceed a provider implementation's 4096-unit boundary.
  if (Array.from(rendered).length > MAX_TELEGRAM_CHARACTERS || rendered.length > MAX_TELEGRAM_CHARACTERS) {
    throw invalid(`Notification exceeds ${MAX_TELEGRAM_CHARACTERS} characters; content was not truncated`);
  }
  return rendered;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw invalid(`Notification ${field} must be nonempty text`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) throw invalid(`Notification ${field} contains unsupported control characters`);
  return value;
}

function invalid(message: string): AppError { return new AppError("invalid_notification", message); }
