import {
  BadgePercent,
  BookOpenText,
  ClipboardList,
  Gift,
  HardDrive,
  ImageIcon,
  KeyRound,
  LayoutDashboard,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AdminBadgeKey =
  | "coordination"
  | "pendingWorks"
  | "failedPrompts";

export type AdminNavItem = {
  badgeKey?: AdminBadgeKey;
  badgeTone?: "accent" | "warning" | "danger";
  exact?: boolean;
  excludePrefixes?: string[];
  href: string;
  icon: LucideIcon;
  keywords: string[];
  label: string;
};

export type AdminNavGroup = {
  id: string;
  items: AdminNavItem[];
  label: string;
};

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "hub",
    label: "运营中枢",
    items: [
      {
        exact: true,
        href: "/admin",
        icon: LayoutDashboard,
        keywords: ["overview", "dashboard", "概览", "大盘", "首页"],
        label: "控制台概览",
      },
    ],
  },
  {
    id: "content",
    label: "内容与风控",
    items: [
      {
        badgeKey: "coordination",
        badgeTone: "warning",
        href: "/admin/generations",
        icon: ClipboardList,
        keywords: ["generations", "jobs", "生成记录", "流水", "排障", "视频"],
        label: "生成流水",
      },
      {
        badgeKey: "pendingWorks",
        badgeTone: "accent",
        href: "/admin/works",
        icon: ImageIcon,
        keywords: ["works", "review", "showcase", "作品审核", "精选", "下架"],
        label: "作品审核",
      },
      {
        href: "/admin/moderation",
        icon: ShieldAlert,
        keywords: ["moderation", "sensitive", "内容风控", "内容审核", "敏感词", "封禁"],
        label: "内容风控",
      },
    ],
  },
  {
    id: "growth",
    label: "用户与增长",
    items: [
      {
        href: "/admin/users",
        icon: Users,
        keywords: ["users", "credits", "ban", "用户管理", "积分", "管理员"],
        label: "用户管理",
      },
      {
        href: "/admin/invites",
        icon: Ticket,
        keywords: ["invites", "claim", "邀请码", "准入", "批次"],
        label: "邀请码",
      },
      {
        href: "/admin/redeem-codes",
        icon: BadgePercent,
        keywords: ["redeem", "codes", "兑换码", "口令", "活动"],
        label: "兑换码",
      },
      {
        href: "/admin/benefits",
        icon: Gift,
        keywords: ["benefits", "checkin", "签到", "福利", "每日奖励"],
        label: "签到福利",
      },
    ],
  },
  {
    id: "infra",
    label: "模型与基建",
    items: [
      {
        href: "/admin/settings/channels",
        icon: Server,
        keywords: ["channels", "openai", "grok", "models", "生图渠道", "模型", "中转"],
        label: "生图渠道",
      },
      {
        href: "/admin/api",
        icon: KeyRound,
        keywords: ["api", "keys", "ratelimit", "开放api", "密钥", "限流"],
        label: "开放 API",
      },
      {
        badgeKey: "failedPrompts",
        badgeTone: "danger",
        href: "/admin/prompts",
        icon: BookOpenText,
        keywords: ["prompts", "github", "sync", "提示词库", "同步"],
        label: "提示词库",
      },
      {
        excludePrefixes: ["/admin/settings/channels"],
        href: "/admin/settings",
        icon: Settings,
        keywords: ["settings", "config", "系统设置", "配置"],
        label: "系统设置",
      },
    ],
  },
];

export type AdminSettingsTabItem = {
  description: string;
  href: string;
  icon: LucideIcon;
  keywords: string[];
  label: string;
};

export const ADMIN_SETTINGS_LINKS: AdminSettingsTabItem[] = [
  {
    description: "查看全部系统级配置模块与实时运行状态",
    href: "/admin/settings",
    icon: Settings,
    keywords: ["settings", "总览", "系统设置"],
    label: "总览",
  },
  {
    description: "查看图片用量，配置容量与保留期限，安全清理历史图片",
    href: "/admin/settings/storage",
    icon: HardDrive,
    keywords: ["storage", "s3", "cleanup", "图片存储", "清理", "容量"],
    label: "图片存储",
  },
  {
    description: "管理 OpenAI / Grok / 中转等生图 API 渠道与模型目录",
    href: "/admin/settings/channels",
    icon: Server,
    keywords: ["channels", "provider", "生图渠道", "模型"],
    label: "生图渠道",
  },
  {
    description: "配置第三方 OAuth 登录源（如 LinuxDo 快捷登录）",
    href: "/admin/settings/oauth",
    icon: KeyRound,
    keywords: ["oauth", "linuxdo", "登录源", "第三方登录"],
    label: "登录源",
  },
  {
    description: "配置 Cloudflare Turnstile 防护登录、注册与公开领取",
    href: "/admin/settings/turnstile",
    icon: ShieldCheck,
    keywords: ["turnstile", "captcha", "cloudflare", "人机验证", "安全"],
    label: "人机验证",
  },
  {
    description: "配置登录与注册页左侧展示封面（精选随机或指定图片）",
    href: "/admin/settings/login-cover",
    icon: Sparkles,
    keywords: ["cover", "login", "登录封面", "海报"],
    label: "登录封面",
  },
  {
    description: "配置敏感词开关、AI 审核端点阈值及检索内置词库",
    href: "/admin/settings/moderation",
    icon: ShieldAlert,
    keywords: ["moderation", "words", "内容审核规则", "敏感词库", "ai审核"],
    label: "内容审核",
  },
];

export type AdminBreadcrumbTrail = {
  items: Array<{ href?: string; label: string }>;
  sectionCode: string;
  title: string;
};

const BREADCRUMB_MAP: Array<{
  match: (pathname: string) => boolean;
  trail: AdminBreadcrumbTrail;
}> = [
  {
    match: (p) => p === "/admin/settings/storage" || p.startsWith("/admin/settings/storage/"),
    trail: {
      items: [
        { href: "/admin", label: "管理台" },
        { href: "/admin/settings", label: "系统设置" },
        { label: "图片存储" },
      ],
      sectionCode: "SETTINGS / STORAGE",
      title: "图片存储与清理",
    },
  },
  {
    match: (p) => p === "/admin/settings/channels" || p.startsWith("/admin/settings/channels/"),
    trail: {
      items: [
        { href: "/admin", label: "管理台" },
        { href: "/admin/settings", label: "系统设置" },
        { label: "生图渠道" },
      ],
      sectionCode: "INFRA / CHANNELS",
      title: "生图渠道管理",
    },
  },
  {
    match: (p) => p === "/admin/settings/oauth" || p.startsWith("/admin/settings/oauth/"),
    trail: {
      items: [
        { href: "/admin", label: "管理台" },
        { href: "/admin/settings", label: "系统设置" },
        { label: "登录源" },
      ],
      sectionCode: "SETTINGS / OAUTH",
      title: "第三方登录源",
    },
  },
  {
    match: (p) => p === "/admin/settings/turnstile" || p.startsWith("/admin/settings/turnstile/"),
    trail: {
      items: [
        { href: "/admin", label: "管理台" },
        { href: "/admin/settings", label: "系统设置" },
        { label: "人机验证" },
      ],
      sectionCode: "SETTINGS / SECURITY",
      title: "人机验证防护",
    },
  },
  {
    match: (p) => p === "/admin/settings/login-cover" || p.startsWith("/admin/settings/login-cover/"),
    trail: {
      items: [
        { href: "/admin", label: "管理台" },
        { href: "/admin/settings", label: "系统设置" },
        { label: "登录封面" },
      ],
      sectionCode: "SETTINGS / COVER",
      title: "登录封面配置",
    },
  },
  {
    match: (p) => p === "/admin/settings/moderation" || p.startsWith("/admin/settings/moderation/"),
    trail: {
      items: [
        { href: "/admin", label: "管理台" },
        { href: "/admin/moderation", label: "内容风控" },
        { label: "审核规则与词库" },
      ],
      sectionCode: "MODERATION / RULES",
      title: "内容审核规则与词库",
    },
  },
  {
    match: (p) => p === "/admin/settings" || p.startsWith("/admin/settings/"),
    trail: {
      items: [{ href: "/admin", label: "管理台" }, { label: "系统设置" }],
      sectionCode: "SETTINGS",
      title: "系统设置总览",
    },
  },
  {
    match: (p) => p.startsWith("/admin/users"),
    trail: {
      items: [{ href: "/admin", label: "管理台" }, { label: "用户管理" }],
      sectionCode: "USERS",
      title: "用户管理",
    },
  },
  {
    match: (p) => p.startsWith("/admin/invites"),
    trail: {
      items: [{ href: "/admin", label: "管理台" }, { label: "邀请码" }],
      sectionCode: "INVITES",
      title: "准入邀请码管理",
    },
  },
  {
    match: (p) => p.startsWith("/admin/redeem-codes"),
    trail: {
      items: [{ href: "/admin", label: "管理台" }, { label: "兑换码" }],
      sectionCode: "REDEEM CODES",
      title: "积分兑换码管理",
    },
  },
  {
    match: (p) => p.startsWith("/admin/generations"),
    trail: {
      items: [{ href: "/admin", label: "管理台" }, { label: "生成流水" }],
      sectionCode: "GENERATIONS",
      title: "生成记录流水",
    },
  },
  {
    match: (p) => p.startsWith("/admin/works"),
    trail: {
      items: [{ href: "/admin", label: "管理台" }, { label: "作品审核" }],
      sectionCode: "WORKS REVIEW",
      title: "作品投稿审核",
    },
  },
  {
    match: (p) => p.startsWith("/admin/moderation"),
    trail: {
      items: [{ href: "/admin", label: "管理台" }, { label: "内容风控" }],
      sectionCode: "MODERATION",
      title: "内容风控与拦截记录",
    },
  },
  {
    match: (p) => p.startsWith("/admin/prompts"),
    trail: {
      items: [{ href: "/admin", label: "管理台" }, { label: "提示词库" }],
      sectionCode: "PROMPTS",
      title: "提示词库同步管理",
    },
  },
  {
    match: (p) => p.startsWith("/admin/benefits"),
    trail: {
      items: [{ href: "/admin", label: "管理台" }, { label: "签到福利" }],
      sectionCode: "BENEFITS",
      title: "每日签到福利配置",
    },
  },
  {
    match: (p) => p.startsWith("/admin/api"),
    trail: {
      items: [{ href: "/admin", label: "管理台" }, { label: "开放 API" }],
      sectionCode: "OPEN API",
      title: "开放 API 密钥与速率限制",
    },
  },
];

export function resolveAdminBreadcrumb(pathname: string): AdminBreadcrumbTrail {
  const matched = BREADCRUMB_MAP.find((entry) => entry.match(pathname));
  if (matched) return matched.trail;
  return {
    items: [{ label: "控制台概览" }],
    sectionCode: "OVERVIEW",
    title: "控制台概览",
  };
}

export function isAdminNavItemActive(item: AdminNavItem, pathname: string): boolean {
  if (item.excludePrefixes?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }
  if (item.exact) {
    return pathname === item.href;
  }
  if (item.href === "/admin/moderation" && pathname.startsWith("/admin/settings/moderation")) {
    return true;
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export type AdminCommandItem = {
  description: string;
  group: string;
  href: string;
  icon: LucideIcon;
  id: string;
  keywords: string[];
  label: string;
};

export const ADMIN_COMMAND_ITEMS: AdminCommandItem[] = [
  ...ADMIN_NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => ({
      description: `前往${group.label} · ${item.label}`,
      group: group.label,
      href: item.href,
      icon: item.icon,
      id: `nav-${item.href}`,
      keywords: item.keywords,
      label: item.label,
    })),
  ),
  ...ADMIN_SETTINGS_LINKS.filter(
    (s) => s.href !== "/admin/settings" && s.href !== "/admin/settings/channels",
  ).map((setting) => ({
    description: setting.description,
    group: "系统设置子项",
    href: setting.href,
    icon: setting.icon,
    id: `setting-${setting.href}`,
    keywords: setting.keywords,
    label: `设置 · ${setting.label}`,
  })),
];
