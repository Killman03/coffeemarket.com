import type { Metadata } from "next";
import { renderOwnerPage } from "./access";
import { AdminPanel } from "../../src/presentation/admin/AdminPanel";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Панель управления — Coffee Market",
  robots: { index: false, follow: false },
};
export default async function AdminPage() {
  return renderOwnerPage("/admin", async (deps) => (
    <AdminPanel
      initial={await deps.repository.get()}
      status={deps.deliveryStatus}
      userDisplayName={deps.user!.displayName}
    />
  ));
}
