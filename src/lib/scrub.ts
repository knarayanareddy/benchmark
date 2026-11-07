/** Re-identification guard: warns the author BEFORE posting and hard-redacts direct identifiers. */

export type Leak = { kind: string; snippet: string; tip: string };

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?:\+?\d[\s().-]?){9,}/g;

export function redact(text: string): string {
  return text.replace(EMAIL, "[email removed]").replace(PHONE, "[number removed]");
}

export function detectLeaks(text: string): Leak[] {
  const out: Leak[] = [];
  const add = (kind: string, m: RegExpMatchArray | null, tip: string) => {
    if (m) out.push({ kind, snippet: m[0].slice(0, 60), tip });
  };
  add("contact", text.match(EMAIL), "Email addresses are removed automatically.");
  add("contact", text.match(PHONE), "Phone numbers are removed automatically.");
  add(
    "employer",
    text.match(/\b(?:i|we)\s+(?:work|worked|am based|are based|live|lead|run|manage)\s+(?:at|for|in|with)\s+[^.,;]{3,40}/i),
    "This reveals where you work or live. Consider “a partner in the area” instead."
  );
  add(
    "role",
    text.match(/\bmy\s+(?:organi[sz]ation|ngo|team|staff|office|colleague|brother|sister|village|district|compound)\b[^.,;]{0,40}/i),
    "Mentions of ‘my team/office/village’ narrow you down in a small circle."
  );
  add("title", text.match(/\b(?:mr|mrs|ms|dr|prof|colonel|commander|chief|sheikh)\.?\s+[A-Z][a-z]+/), "Named individuals can expose you or them. Describe the role instead.");
  add("timeplace", text.match(/\bon (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday) (?:morning|night|evening)\b[^.,;]{0,30}/i), "Very precise time + place details can fingerprint an eyewitness.");
  return out;
}
