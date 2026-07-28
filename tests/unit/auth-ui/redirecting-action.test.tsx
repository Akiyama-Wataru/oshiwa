import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AcceptInvitationForm } from "@/app/components/auth/AcceptInvitationForm";
import { CreateGroupForm } from "@/app/components/auth/CreateGroupForm";
import { JoinForm } from "@/app/components/auth/JoinForm";
import { LoginForm } from "@/app/components/auth/LoginForm";
import { LogoutButton } from "@/app/components/auth/LogoutButton";

const token = "a".repeat(43);

/**
 * A server action that ends in `redirect()` never resolves to a state: the
 * redirect boundary takes over, but the form still renders once in that gap
 * with nothing to read. Every form whose action can redirect has to survive
 * that render, otherwise the member sees the error screen flash on their way
 * to the page they asked for.
 */
function redirectingAction() {
  return vi.fn(async () => undefined) as never;
}

async function submit(selector: string) {
  await act(async () => {
    fireEvent.submit(document.querySelector(selector)!);
  });
}

describe("forms whose action redirects", () => {
  it("keeps the login form standing while the redirect takes over", async () => {
    render(<LoginForm action={redirectingAction()} returnTo="/groups" />);

    await submit("form.auth-form");

    expect(
      screen.getByText("招待されたメールアドレスでログインしてください。"),
    ).toBeVisible();
  });

  it("keeps the group form standing while the redirect takes over", async () => {
    render(<CreateGroupForm action={redirectingAction()} />);

    await submit("form.group-create-form");

    expect(
      screen.getByRole("button", { name: "グループを作る" }),
    ).toBeEnabled();
  });

  it("keeps the logout button standing while the redirect takes over", async () => {
    render(<LogoutButton action={redirectingAction()} />);

    await submit("form");

    expect(screen.getByRole("button", { name: "ログアウト" })).toBeEnabled();
  });

  it("keeps the join form standing while the redirect takes over", async () => {
    render(<JoinForm action={redirectingAction()} token={token} />);

    await submit("form.auth-form");

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("keeps the invitation form standing while the redirect takes over", async () => {
    render(<AcceptInvitationForm action={redirectingAction()} token={token} />);

    await submit("form.auth-form");

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
