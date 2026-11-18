"use client";

import { ListFilter, SlidersHorizontal } from "lucide-react";

import { AdminLinkTabs } from "../ui/admin-tabs";

type ModerationNavTabsProps = {
  activePath: "/admin/moderation" | "/admin/settings/moderation";
  totalReviewsCount?: number;
};

export function ModerationNavTabs({
  activePath,
  totalReviewsCount,
}: ModerationNavTabsProps) {
  return (
    <AdminLinkTabs
      ariaLabel="内容风控视图切换"
      activeHref={activePath}
      layoutId="moderation-module-tabs"
      items={[
        {
          badge: totalReviewsCount,
          href: "/admin/moderation",
          icon: ListFilter,
          label: "拦截记录与封禁",
        },
        {
          href: "/admin/settings/moderation",
          icon: SlidersHorizontal,
          label: "审核规则与敏感词库",
        },
      ]}
    />
  );
}
