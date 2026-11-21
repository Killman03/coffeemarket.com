import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminLogin } from "./AdminLogin";
import { AdminSignOut } from "./AdminSignOut";

const { signIn, signOut } = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../../infrastructure/admin-auth-client", () => ({
  adminAuthClient: { signIn: { email: signIn }, signOut },
}));
beforeEach(() => vi.resetAllMocks());
const submit = () => {
  fireEvent.change(screen.getByLabelText("Email владельца"), {
    target: { value: "owner@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Пароль"), {
    target: { value: "a-test-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Войти в панель" }));
};

describe("Node owner sign-in", () => {
  it("supports password managers and an accessible password visibility toggle", () => {
    render(<AdminLogin returnTo="/admin" />);
    expect(screen.getByLabelText("Email владельца")).toHaveAttribute(
      "autocomplete",
      "username",
    );
    expect(screen.getByLabelText("Пароль")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText("Пароль")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Показать пароль" }));
    expect(screen.getByLabelText("Пароль")).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Скрыть пароль" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("prevents duplicate submissions and hides internal authentication errors", async () => {
    let resolve!: (value: unknown) => void;
    signIn.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<AdminLogin returnTo="/admin/analytics" />);
    submit();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Проверяем данные…" }),
      ).toBeDisabled(),
    );
    expect(signIn).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "a-test-password",
      rememberMe: true,
    });
    resolve({ error: { status: 401, message: "private database details" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Проверьте email и пароль",
    );
    expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Войти в панель" }),
    ).toBeEnabled();
  });

  it("explains throttling and preserves entered values for a later retry", async () => {
    signIn.mockResolvedValue({ error: { status: 429 } });
    render(<AdminLogin returnTo="/admin" />);
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Подождите минуту",
    );
    expect(screen.getByLabelText("Email владельца")).toHaveValue(
      "owner@example.com",
    );
  });

  it("handles network failures and enables another attempt", async () => {
    signIn.mockRejectedValue(new TypeError("network"));
    render(<AdminLogin returnTo="/admin" />);
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Проверьте соединение",
    );
    expect(
      screen.getByRole("button", { name: "Войти в панель" }),
    ).toBeEnabled();
  });

  it("keeps the sign-out control available when the server cannot revoke a session", async () => {
    signOut.mockResolvedValue({ error: { status: 503 } });
    render(<AdminSignOut />);
    fireEvent.click(screen.getByRole("button", { name: "Выйти из аккаунта" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Повторите попытку",
    );
    expect(
      screen.getByRole("button", { name: "Выйти из аккаунта" }),
    ).toBeEnabled();
  });
});
