import assert from "node:assert/strict";

// Independent acceptance values, not imported from the implementation under test.
export const REQUEST_TARGET_BUDGET = 8192;
const prefix = "/create?prompt=";

export function requestTarget(prompt) {
  try { return `${prefix}${encodeURIComponent(prompt)}`; }
  catch { return null; }
}

function atBudget(bytes) {
  const start = "  budget & + # / ? = %\n" + "\u754c".repeat(900);
  const end = "\n  ";
  const padding = bytes - Buffer.byteLength(requestTarget(start + end));
  assert(padding >= 0);
  const prompt = start + "a".repeat(padding) + end;
  assert.equal(Buffer.byteLength(requestTarget(prompt)), bytes);
  assert(prompt.length < 8000, "Byte-boundary cases must not rely on create's input slicing");
  return prompt;
}

export const LONG_URL_CASES = [
  { id: "home-001", label: "chinese8000", prompt: "\u6c5f".repeat(8000), manual: true },
  { id: "home-002", label: "emoji8000units", prompt: "\ud83c\udf27\ufe0f".repeat(2666) + "\u96e8\u96e8", manual: true },
  { id: "home-004", label: "manual-over-input-limit", prompt: "  \u96e8".repeat(2667) + "\n&+#?=%  ", manual: true },
  { id: "home-005", label: "budget8191", prompt: atBudget(8191), manual: false },
  { id: "home-006", label: "budget8192", prompt: atBudget(8192), manual: false },
  { id: "home-007", label: "budget8193", prompt: atBudget(8193), manual: true },
  { id: "home-009", label: "reserved-whitespace", prompt: "  \u96e8\u5df7\n+ & # / ? = % \ud83c\udf27\ufe0f\n  ", manual: false },
  { id: "home-010", label: "ascii8000", prompt: "a".repeat(8000), manual: false },
  { id: "home-011", label: "ascii8001", prompt: "a".repeat(8001), manual: false },
  { id: "home-012", label: "malformed-high", prompt: "  original \ud800 text\n  ", manual: true },
  { id: "home-014", label: "malformed-low", prompt: "  original \udc00 text\n  ", manual: true },
  { id: "home-015", label: "blank", prompt: " \t\n  ", manual: false, unavailable: true },
];

for (const item of LONG_URL_CASES) {
  const target = requestTarget(item.prompt);
  if (!item.unavailable) assert.equal(item.manual, target === null || Buffer.byteLength(target) > REQUEST_TARGET_BUDGET);
}
