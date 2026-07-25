import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/app/components/auth/LoginForm";
import type { LoginAction } from "@/app/login/actions";

describe("LoginForm", () => {
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

    expect(await screen.findByText("ログインしています…")).toHaveAttribute(
      "aria-live",
      "polite",
    );
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
    ).toHaveAttribute("role", "alert");
  });
});
