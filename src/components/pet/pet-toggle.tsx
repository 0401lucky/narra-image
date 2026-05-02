"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";

import { getPetById, PETS, type PetId } from "@/components/pet/pet-catalog";
import {
  usePetEnabled,
  useSelectedPetId,
  writePetEnabled,
  writeSelectedPetId,
} from "@/components/pet/pet-state";

// 桌面宠物开关：支持开关 + 当前宠物头像 + 多宠物选择
export function PetToggle() {
  const enabled = usePetEnabled();
  const selectedPetId = useSelectedPetId();
  const selectedPet = getPetById(selectedPetId);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  function clearCloseTimer() {
    if (!closeTimerRef.current) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function openSelector() {
    clearCloseTimer();
    setSelectorOpen(true);
  }

  function closeSelectorSoon() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setSelectorOpen(false);
      closeTimerRef.current = null;
    }, 160);
  }

  function handleToggle() {
    writePetEnabled(!enabled);
  }

  function handleSelectPet(petId: PetId) {
    writeSelectedPetId(petId);
    writePetEnabled(true);
    setSelectorOpen(false);
  }

  useEffect(() => {
    function handleDocumentPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setSelectorOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectorOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      clearCloseTimer();
    };
  }, []);

  const label = enabled ? "宠物：开" : "宠物：关";
  const title = enabled ? "关闭桌面宠物" : "开启桌面宠物";

  return (
    <div
      ref={rootRef}
      className="relative inline-flex items-center gap-1"
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") openSelector();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") closeSelectorSoon();
      }}
    >
      <button
        type="button"
        onClick={handleToggle}
        title={title}
        aria-pressed={enabled}
        className={
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition " +
          (enabled
            ? "border-[var(--accent)] text-[var(--accent)]"
            : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)]")
        }
      >
        <UserRound aria-hidden="true" className="size-3.5" strokeWidth={1.6} />
        <span>{label}</span>
      </button>

      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={selectorOpen}
        aria-label={`选择宠物，当前是${selectedPet.label}`}
        title="选择宠物"
        onClick={() => setSelectorOpen(true)}
        className={
          "grid size-10 shrink-0 place-items-center rounded-full border bg-[var(--card-strong)] shadow-sm transition hover:-translate-y-0.5 " +
          (selectorOpen || enabled
            ? "border-[var(--accent)]"
            : "border-[var(--line)]")
        }
      >
        <img
          src={selectedPet.thumbUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="size-9 object-contain"
        />
      </button>

      {selectorOpen ? (
        <div
          role="listbox"
          aria-label="选择桌面宠物"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-[var(--line)] bg-[var(--card-strong)] p-2 shadow-[var(--shadow)]"
        >
          <div className="grid grid-cols-4 gap-1.5">
            {PETS.map((pet) => {
              const active = pet.id === selectedPet.id;
              return (
                <button
                  key={pet.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-label={`选择${pet.label}`}
                  onClick={() => handleSelectPet(pet.id as PetId)}
                  className={
                    "flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-[11px] transition " +
                    (active
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-transparent text-[var(--ink-soft)] hover:border-[var(--line)] hover:bg-white/50 hover:text-[var(--ink)]")
                  }
                >
                  <span className="grid size-11 place-items-center rounded-full bg-white/50">
                    <img
                      src={pet.thumbUrl}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      className="size-10 object-contain"
                    />
                  </span>
                  <span className="w-full truncate text-center">{pet.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
