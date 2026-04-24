import "server-only";

import { db } from "@/lib/db";

export type OAuthProviderInfo = {
  type: string;
  displayName: string;
  clientId: string;
  clientSecret: string;
  isEnabled: boolean;
};

export async function getEnabledOAuthProviders() {
  const providers = await db.oAuthProvider.findMany({
    where: { isEnabled: true },
    select: {
      type: true,
      displayName: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return providers;
}

export async function getOAuthProvider(type: string): Promise<OAuthProviderInfo | null> {
  const provider = await db.oAuthProvider.findUnique({
    where: { type },
    select: {
      clientId: true,
      clientSecret: true,
      displayName: true,
      isEnabled: true,
      type: true,
    },
  });

  return provider;
}

export async function getAllOAuthProviders() {
  return db.oAuthProvider.findMany({
    select: {
      clientId: true,
      createdAt: true,
      displayName: true,
      id: true,
      isEnabled: true,
      type: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function upsertOAuthProvider(data: {
  type: string;
  displayName: string;
  clientId: string;
  clientSecret: string;
  isEnabled: boolean;
}) {
  return db.oAuthProvider.upsert({
    where: { type: data.type },
    update: {
      clientId: data.clientId,
      ...(data.clientSecret ? { clientSecret: data.clientSecret } : {}),
      displayName: data.displayName,
      isEnabled: data.isEnabled,
    },
    create: data,
  });
}

export async function deleteOAuthProvider(type: string) {
  return db.oAuthProvider.delete({ where: { type } });
}
