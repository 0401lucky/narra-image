"use client";

import { useEffect, useRef, type RefObject } from "react";

import { HOME_MEDIA } from "../constants";

type UseHomeNavDialogOptions = { open: boolean; onClose: () => void };
type UseHomeNavDialogResult = {
  triggerRef: RefObject<HTMLButtonElement | null>;
  dialogRef: RefObject<HTMLDivElement | null>;
  portalRef: RefObject<HTMLDivElement | null>;
};

// 首页抽屉挂在 body，避免固定定位受毛玻璃/页面转场祖先限制；关闭归还焦点及滚动。
export function useHomeNavDialog({ open, onClose }: UseHomeNavDialogOptions): UseHomeNavDialogResult {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const portal = portalRef.current;
    const trigger = triggerRef.current;
    if (!dialog || !portal) return;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const inertSiblings = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== portal && !["SCRIPT", "STYLE", "LINK"].includes(node.tagName));
    const previousInert = inertSiblings.map((node) => ({ node, value: node.getAttribute("inert") }));
    document.body.style.overflow = "hidden";
    if (scrollbar > 0 && scrollbar < 100) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight || "0") + scrollbar}px`;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter((node) => !node.closest("[hidden], [inert]") && getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none");
    const focusFirst = () => (focusable()[0] ?? dialog).focus();
    focusFirst();
    inertSiblings.forEach((node) => node.setAttribute("inert", ""));
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        const targets = focusable();
        const first = targets[0];
        const last = targets.at(-1);
        if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const handleFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    const desktop = window.matchMedia?.(HOME_MEDIA.fullNavigation);
    const handleDesktop = () => { if (desktop?.matches) onClose(); };
    desktop?.addEventListener("change", handleDesktop);
    document.addEventListener("keydown", handleKey);
    document.addEventListener("focusin", handleFocus);
    return () => {
      desktop?.removeEventListener("change", handleDesktop);
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("focusin", handleFocus);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      previousInert.forEach(({ node, value }) => value === null ? node.removeAttribute("inert") : node.setAttribute("inert", value));
      if (trigger?.isConnected) trigger.focus();
    };
  }, [onClose, open]);

  return { triggerRef, dialogRef, portalRef };
}
