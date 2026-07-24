import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import JoinPage from "@/app/join/page";
import LoginPage from "@/app/login/page";

describe("authentication entry pages", () => {
  it("provides an email and password login form", () => {
    render(<LoginPage />);

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
    ).toBeDisabled();
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
