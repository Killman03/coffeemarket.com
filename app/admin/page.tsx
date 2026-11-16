import type { Metadata } from "next";
import { getAdminDependencies } from "./dependencies";
import { getAdminAccess } from "../../src/server/admin";
import { AdminEntry } from "../../src/presentation/AdminEntry";
import { AdminPanel } from "../../src/presentation/admin/AdminPanel";
import { chatGPTSignInPath, chatGPTSignOutPath } from "../chatgpt-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Панель управления — Coffee Market",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const signInPath = chatGPTSignInPath("/admin");
  const signOutPath = chatGPTSignOutPath("/admin");
  try {
    const deps = await getAdminDependencies();
    const access = await getAdminAccess(deps);
    if (deps && access === "authorized")
      return (
        <AdminPanel
          initial={await deps.repository.get()}
          status={deps.deliveryStatus}
          userDisplayName={deps.user!.displayName}
        />
      );
    return (
      <AdminEntry
        access={access === "authorized" ? "unconfigured" : access}
        signInPath={signInPath}
        signOutPath={signOutPath}
      />
    );
  } catch {
    return (
      <AdminEntry
        access="unconfigured"
        signInPath={signInPath}
        signOutPath={signOutPath}
      />
    );
  }
}
