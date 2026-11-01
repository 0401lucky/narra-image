export type HomeSceneId = "film" | "storybook" | "oriental";

export type HomeScene = Readonly<{
  id: HomeSceneId;
  label: string;
  image: string;
  width: number;
  height: number;
  alt: string;
  lightLabel: string;
  preset: string;
  prompt: string;
}>;

export type HeaderVariant = "default" | "home";

export type HeaderUser = {
  id: string;
  credits: number;
  role: "user" | "admin";
  nickname?: string | null;
  avatarUrl?: string | null;
};

export type HeaderLink = Readonly<{ href: string; label: string }>;

export type HomeHeaderProps = {
  currentUser: HeaderUser | null;
  links: readonly HeaderLink[];
  activeHref?: string;
  className?: string;
  checkInSummary: {
    checkedInToday: boolean;
    checkInReward: number;
  } | null;
};

export type HomeMotionState = {
  reducedMotion: boolean;
  paused: boolean;
  pageVisible: boolean;
  finePointer: boolean;
  enabled: boolean;
  togglePaused: () => void;
};
