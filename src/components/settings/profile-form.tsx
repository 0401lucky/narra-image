"use client";

import { useState, useRef } from "react";
import { Camera, Save, Loader2, User, Sparkles } from "lucide-react";

import { RedeemCodeForm } from "@/components/settings/redeem-code-form";

type ProfileFormProps = {
  user: {
    id: string;
    email: string;
    nickname: string | null;
    avatarUrl: string | null;
    credits: number;
    role: "user" | "admin";
  };
};

export function ProfileForm({ user }: ProfileFormProps) {
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [credits, setCredits] = useState(user.credits);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleAvatarUpload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/me/avatar", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ text: json.error || "上传失败", type: "error" });
        return;
      }
      setAvatarUrl(json.data.user.avatarUrl);
      setMessage({ text: "头像更新成功！", type: "success" });
    } catch {
      setMessage({ text: "上传头像时发生错误", type: "error" });
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveProfile() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nickname.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ text: json.error || "保存失败", type: "error" });
        return;
      }
      setMessage({ text: "个人资料已更新！", type: "success" });
    } catch {
      setMessage({ text: "保存时发生错误", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  const displayName = nickname.trim() || user.email.split("@")[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr] xl:grid-cols-[360px_1fr]">
      {/* 左侧 — 头像 & 身份卡 */}
      <div className="grid gap-5 self-start">
        <div className="studio-card rounded-[1.8rem] p-6">
          <div className="flex flex-col items-center gap-5">
            {/* 头像 */}
            <div className="relative group">
              <div className="size-28 overflow-hidden rounded-full border-[3px] border-[var(--accent-soft)] bg-[var(--surface-strong)] shadow-lg">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt="头像"
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-gradient-to-br from-[var(--accent)] to-[var(--accent-soft)]">
                    <User className="size-12 text-white" />
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 flex size-9 items-center justify-center rounded-full border-2 border-white bg-[var(--ink)] text-white shadow-md transition hover:bg-[var(--accent)] disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Camera className="size-4" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAvatarUpload(file);
                  e.target.value = "";
                }}
              />
            </div>

            {/* 身份信息 */}
            <div className="text-center">
              <p className="text-lg font-semibold text-[var(--ink)]">
                {displayName}
              </p>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                {user.email}
              </p>
              {user.role === "admin" && (
                <span className="mt-2 inline-block rounded-full bg-[var(--accent)]/15 px-3 py-1 text-xs font-medium text-[var(--accent)]">
                  管理员
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 积分卡 */}
        <div className="studio-card overflow-hidden rounded-[1.8rem]">
          <div className="relative px-6 py-5">
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent)]/8 to-transparent" />
            <div className="relative flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/15">
                <Sparkles className="size-6 text-[var(--accent)]" />
              </div>
              <div>
                <p className="text-sm text-[var(--ink-soft)]">我的积分</p>
                <p className="text-3xl font-bold tracking-tight text-[var(--accent)]">
                  {credits}
                </p>
              </div>
            </div>
            <p className="relative mt-3 text-xs leading-relaxed text-[var(--ink-soft)]">
              积分可用于使用内置渠道生成图片。每日签到可获得积分奖励。
            </p>
          </div>
        </div>

        <RedeemCodeForm onRedeemed={setCredits} />
      </div>

      {/* 右侧 — 表单 */}
      <div className="grid gap-5 self-start">
        <div className="studio-card rounded-[1.8rem] p-6">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--ink)]">
            个人资料
          </h2>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            设置昵称后，你的公开作品和首页画廊将优先展示昵称。
          </p>

          <div className="mt-6 grid gap-5">
            {/* 昵称 */}
            <div>
              <label
                htmlFor="nickname"
                className="mb-2 block text-sm font-medium text-[var(--ink)]"
              >
                昵称
              </label>
              <input
                id="nickname"
                type="text"
                placeholder="2-20 个字符"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)]/60 px-4 py-3 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)]/60 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
              />
              <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
                {nickname.trim()
                  ? `公开展示名称：${nickname.trim()}`
                  : "未设置时将显示为「匿名创作者」"}
              </p>
            </div>

            {/* 邮箱（只读） */}
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-[var(--ink)]"
              >
                邮箱
              </label>
              <input
                id="email"
                type="email"
                value={user.email}
                disabled
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-4 py-3 text-sm text-[var(--ink-soft)] outline-none"
              />
              <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
                邮箱为登录凭证，暂不支持修改。
              </p>
            </div>
          </div>

          {/* 消息反馈 */}
          {message && (
            <div
              className={`mt-5 rounded-xl px-4 py-3 text-sm ${
                message.type === "success"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {message.text}
            </div>
          )}

          {/* 保存按钮 */}
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveProfile()}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[var(--accent)] disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存修改
          </button>
        </div>

        {/* 头像上传提示 */}
        <div className="studio-card rounded-[1.8rem] p-6">
          <h3 className="font-semibold text-[var(--ink)]">头像说明</h3>
          <ul className="mt-3 grid gap-2 text-sm text-[var(--ink-soft)]">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              支持 JPG、PNG、WebP 格式
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              文件大小不超过 2MB
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              建议使用正方形图片，效果最佳
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
