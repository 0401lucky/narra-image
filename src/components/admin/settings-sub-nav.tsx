"use client";

import { ADMIN_SETTINGS_LINKS } from "./constants";
import { AdminLinkTabs } from "./ui/admin-tabs";

type SettingsSubNavProps = {
  currentPath: string;
};

export function SettingsSubNav({ currentPath }: SettingsSubNavProps) {
  return (
    <AdminLinkTabs
      ariaLabel="系统设置二级导航"
      activeHref={currentPath}
      layoutId="admin-settings-sub-nav"
      items={ADMIN_SETTINGS_LINKS.map((item) => ({
        href: item.href,
        icon: item.icon,
        label: item.label,
      }))}
    />
  );
}
