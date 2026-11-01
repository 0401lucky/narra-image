import { redirect } from "next/navigation";

import { AdminFrame } from "@/components/admin/admin-frame";
import { serializeUser } from "@/lib/prisma-mappers";
import { requireAdminRecord } from "@/lib/server/current-user";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  return (
    <AdminFrame currentUser={serializeUser(admin)}>
      {children}
    </AdminFrame>
  );
}
