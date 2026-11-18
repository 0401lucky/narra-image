"use client";

import { motion } from "motion/react";

import { cn } from "@/lib/utils";

type AdminSwitchProps = {
  ariaLabel?: string;
  checked: boolean;
  className?: string;
  disabled?: boolean;
  hint?: string;
  id?: string;
  label?: string;
  onCheckedChange: (checked: boolean) => void;
  size?: "sm" | "md";
};

export function AdminSwitch({
  ariaLabel,
  checked,
  className,
  disabled = false,
  hint,
  id,
  label,
  onCheckedChange,
  size = "md",
}: AdminSwitchProps) {
  const isSmall = size === "sm";

  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c85a32] disabled:cursor-not-allowed disabled:opacity-55",
        isSmall ? "h-5 w-9 p-0.5" : "h-6 w-11 p-0.5",
        checked
          ? "border-[#c85a32] bg-[#c85a32]"
          : "border-[var(--line)] bg-[#e4dcd0]",
      )}
    >
      <motion.div
        layout
        transition={{ damping: 28, stiffness: 420, type: "spring" }}
        className={cn(
          "rounded-full bg-white shadow-xs",
          isSmall ? "size-3.5" : "size-4.5",
          checked ? (isSmall ? "ml-auto" : "ml-auto") : "mr-auto",
        )}
      />
    </button>
  );

  if (!label) {
    return control;
  }

  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div
        onClick={() => {
          if (!disabled) onCheckedChange(!checked);
        }}
        className={cn("min-w-0 flex-1 select-none", !disabled && "cursor-pointer")}
      >
        <div className="text-sm font-medium text-[var(--ink)]">{label}</div>
        {hint ? (
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-soft)]">{hint}</p>
        ) : null}
      </div>
      {control}
    </div>
  );
}
