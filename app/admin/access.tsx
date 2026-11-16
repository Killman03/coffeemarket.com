import type { ReactNode } from "react";
import { getAdminDependencies } from "./dependencies";
import { getAdminAccess, type AdminDependencies } from "../../src/server/admin";
import { AdminEntry } from "../../src/presentation/AdminEntry";
import { chatGPTSignInPath, chatGPTSignOutPath } from "../chatgpt-auth";

/** Renders protected pages through one fail-closed owner authorization boundary.
 *
 * Args:
 *   returnTo: Relative destination for the platform sign-in flow.
 *   render: Server rendering callback, invoked only for the pinned owner.
 *
 * Returns:
 *   Protected content or a safe sign-in/access state.
 */
export async function renderOwnerPage(
  returnTo: string,
  render: (deps: AdminDependencies) => Promise<ReactNode>,
) {
  const paths = {
    signInPath: chatGPTSignInPath(returnTo),
    signOutPath: chatGPTSignOutPath(returnTo),
  };
  try {
    const deps = await getAdminDependencies(),
      access = await getAdminAccess(deps);
    if (deps && access === "authorized") return await render(deps);
    return (
      <AdminEntry
        access={access === "authorized" ? "unconfigured" : access}
        {...paths}
      />
    );
  } catch {
    return <AdminEntry access="unconfigured" {...paths} />;
  }
}
