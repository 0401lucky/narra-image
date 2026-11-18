"use client";

import { createContext } from "react";

export type AdminToastVariant = "success" | "error" | "warning" | "info";

export type AdminToastInput = {
  description?: string;
  durationMs?: number;
  title: string;
  variant?: AdminToastVariant;
};

export type AdminToastContextValue = {
  dismiss: (id: string) => void;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  push: (toast: AdminToastInput) => string;
  success: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
};

export const AdminToastContext = createContext<AdminToastContextValue | null>(null);
