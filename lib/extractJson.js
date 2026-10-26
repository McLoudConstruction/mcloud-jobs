// Parses a model reply as a JSON object. Falls back to the text between the first
// "{" and the last "}" when the model wrapped the JSON in prose. Returns null when
// nothing parses, so callers can decide how to fail.
export function extractJson(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return null;
}
