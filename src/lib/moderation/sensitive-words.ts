import "server-only";

/**
 * 内置敏感词库：按类别分组的中英文违规词。
 *
 * 匹配策略：
 * - 英文词/短语：整体小写后用 `\b` 词边界匹配，避免子串误杀（如 "sex" 不会命中 "sexy" 之外、艺术词 "nude/naked" 不入库）。
 * - 中文词：直接子串匹配（中文无词边界）。
 *
 * 误杀控制：艺术/常态词汇（nude、naked、blood、erotic 等）不入库；
 * 词库聚焦明确露骨/暴力/仇恨/违法表达，避免宽泛词。
 */

export type SensitiveCategory = "NSFW" | "VIOLENCE" | "HATE" | "ILLEGAL";

export const SENSITIVE_CATEGORIES: SensitiveCategory[] = [
  "NSFW",
  "VIOLENCE",
  "HATE",
  "ILLEGAL",
];

export const SENSITIVE_CATEGORY_LABELS: Record<SensitiveCategory, string> = {
  NSFW: "色情内容",
  VIOLENCE: "暴力内容",
  HATE: "仇恨言论",
  ILLEGAL: "违法内容",
};

export const SENSITIVE_WORDS: Record<SensitiveCategory, string[]> = {
  NSFW: [
    // 英文（露骨性内容，含常见词形变体）
    "porn", "pornographic", "porno", "pornography", "hentai", "futanari",
    "blowjob", "handjob", "penis", "vagina", "clitoris", "anal", "cumshot",
    "orgasm", "semen", "dick", "cock", "pussy", "busty nude", "sex toy",
    "sexual acts", "nsfw", "explicit sex", "hardcore sex", "nude selfie",
    "rape", "raped", "raping", "rapist", "incest", "loli", "child porn",
    // 中文（露骨性内容）
    "性爱", "做爱", "性交", "交媾", "色情", "情色", "裸照", "裸图",
    "阴茎", "阴道", "精液", "口交", "肛交", "自慰", "手淫", "乳交",
    "色图", "幼女", "幼童色情", "强奸", "轮奸", "嫖娼",
  ],
  VIOLENCE: [
    // 英文
    "gore", "guro", "dismemberment", "decapitation", "evisceration",
    "disembowelment", "mutilation", "torture", "snuff film",
    "human sacrifice", "massacre", "slaughter of",
    // 中文
    "碎尸", "分尸", "斩首", "酷刑", "虐杀", "肢解", "活剥", "奸杀",
    "食人", "灭门", "屠杀",
  ],
  HATE: [
    // 英文（种族/取向/宗教贬损）
    "nigger", "faggot", "kike", "spic", "chink", "wetback", "gook",
    "tranny", "white power", "racial slur", "gas the jews",
    // 中文（歧视/仇恨）
    "黑鬼", "支那", "白皮猪", "黑皮猪", "绿教", "废青",
  ],
  ILLEGAL: [
    // 英文（毒品/武器/违法；用明确词组避免误杀）
    "cocaine", "heroin", "meth", "methamphetamine", "fentanyl", "crack cocaine",
    "ecstasy", "mdma", "how to make a bomb", "plutonium", "cyanide",
    // 中文（毒品/武器/违法）
    "可卡因", "海洛因", "冰毒", "摇头丸", "芬太尼", "制毒", "贩毒",
    "制弹", "买凶",
  ],
};

type SensitiveHit = {
  category: SensitiveCategory;
  word: string;
};

function isPureAscii(word: string) {
  return /^[\x00-\x7F]+$/.test(word);
}

function toBoundaryRegex(word: string) {
  // 词内小写化（调用方已 lower），短语的空格转 \s+，并对正则元字符转义
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b(?:${escaped})\\b`, "i");
}

/**
 * 匹配文本中的敏感词，返回命中列表（词 + 类别），按类别稳定去重。
 */
export function matchSensitiveWords(
  ...texts: Array<string | null | undefined>
): SensitiveHit[] {
  const combined = texts.filter((text): text is string => Boolean(text)).join("\n");
  if (!combined) return [];

  const lower = combined.toLowerCase();
  const hits: SensitiveHit[] = [];
  const seen = new Set<string>();

  for (const category of SENSITIVE_CATEGORIES) {
    for (const word of SENSITIVE_WORDS[category]) {
      let matched: boolean;
      if (isPureAscii(word)) {
        matched = toBoundaryRegex(word).test(lower);
      } else {
        matched = lower.includes(word.toLowerCase());
      }

      if (matched && !seen.has(`${category}:${word}`)) {
        seen.add(`${category}:${word}`);
        hits.push({ category, word });
      }
    }
  }

  return hits;
}

/** 词库只读快照（后台展示用） */
export function getSensitiveWordsSnapshot() {
  return SENSITIVE_CATEGORIES.map((category) => ({
    category,
    label: SENSITIVE_CATEGORY_LABELS[category],
    count: SENSITIVE_WORDS[category].length,
    words: [...SENSITIVE_WORDS[category]],
  }));
}