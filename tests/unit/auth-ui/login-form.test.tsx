import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/app/components/auth/LoginForm";
import type { LoginAction } from "@/app/login/actions";

describe("LoginForm", () => {
  it("states the password length rule before the button is pressed", () => {
    const action = vi.fn() as unknown as LoginAction;

    render(<LoginForm action={action} returnTo="/groups" />);

    const password = screen.getByLabelText("パスワード");

    // The browser blocks a short password with no visible message of its own,
    // so the requirement has to be on screen and tied to the field.
    expect(password).toHaveAttribute("minLength", "12");
    expect(password).toHaveAccessibleDescription(
      "12文字以上で入力してください。",
    );
    expect(screen.getByText("12文字以上で入力してください。")).toBeVisible();
  });

  it("announces the pending state and disables repeat submission", async () => {
    let finish: ((value: {
      status: "error";
      message: string;
    }) => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<{ status: "error"; message: string }>((resolve) => {
          finish = resolve;
        }),
    ) as LoginAction;
    const user = userEvent.setup();

    render(<LoginForm action={action} returnTo="/groups" />);
    await user.type(screen.getByLabelText("メールアドレス"), "fan@example.com");
    await user.type(screen.getByLabelText("パスワード"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "ログインする" }));

    const pending = await screen.findByText("ログインしています…");

    // `role="status"` already implies a polite live region; pairing it with
    // aria-live adds nothing, and pairing aria-live="polite" with an `alert`
    // would quietly demote the very message that needed announcing.
    expect(pending).toHaveAttribute("role", "status");
    expect(pending).not.toHaveAttribute("aria-live");
    expect(screen.getByRole("button", { name: "ログイン中" })).toBeDisabled();

    await act(async () => {
      finish?.({
        status: "error",
        message: "メールアドレスまたはパスワードを確認してください。",
      });
    });
  });

  it("renders only the generalized error returned by the server action", async () => {
    const action = vi.fn(async () => ({
      status: "error" as const,
      message: "メールアドレスまたはパスワードを確認してください。",
    })) as LoginAction;
    const user = userEvent.setup();

    render(<LoginForm action={action} returnTo="/groups" />);
    await user.type(screen.getByLabelText("メールアドレス"), "fan@example.com");
    await user.type(screen.getByLabelText("パスワード"), "wrong password");
    await user.click(screen.getByRole("button", { name: "ログインする" }));

    expect(
      await screen.findByText(
        "メールアドレスまたはパスワードを確認してください。",
      ),
    ).toHaveAttribute("role", "status");
  });

  it("keeps one live region registered while the message changes", async () => {
    const action = vi.fn(async () => ({
      status: "error" as const,
      message: "メールアドレスまたはパスワードを確認してください。",
    })) as LoginAction;
    const user = userEvent.setup();

    render(<LoginForm action={action} returnTo="/groups" />);
    const region = screen.getByRole("status");

    await user.type(screen.getByLabelText("メールアドレス"), "fan@example.com");
    await user.type(screen.getByLabelText("パスワード"), "wrong password");
    await user.click(screen.getByRole("button", { name: "ログインする" }));

    // Swapping the role between `status` and `alert` re-registers the region in
    // several screen readers, which drops the message it was meant to announce.
    // The same element, with the same role, has to carry every message.
    expect(await screen.findByRole("status")).toBe(region);
    expect(region).toHaveTextContent(
      "メールアドレスまたはパスワードを確認してください。",
    );
    expect(region).toHaveClass("is-error");
  });
});
