import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import JoinPage from "@/app/join/page";
import LoginPage from "@/app/login/page";

describe("authentication entry pages", () => {
  it("provides an enabled email and password login form without public signup", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ returnTo: "/groups" }),
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "ログイン" }),
    ).toBeVisible();
    expect(screen.getByLabelText("メールアドレス")).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.getByLabelText("パスワード")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByRole("button", { name: "ログインする" }),
    ).toBeEnabled();
    expect(screen.queryByRole("link", { name: /新規登録/ })).not.toBeInTheDocument();
    expect(screen.getByText("WELCOME BACK")).toHaveAttribute("lang", "en");
  });

  it("explains that joining requires a private invitation", () => {
    render(<JoinPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "招待に参加" }),
    ).toBeVisible();
    expect(screen.getAllByText(/招待リンク/)).not.toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "ログインへ戻る" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.getByText("PRIVATE INVITATION")).toHaveAttribute(
      "lang",
      "en",
    );
  });
});
