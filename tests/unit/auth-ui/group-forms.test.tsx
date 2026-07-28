import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreateGroupForm } from "@/app/components/auth/CreateGroupForm";
import { InviteMemberForm } from "@/app/components/auth/InviteMemberForm";
import type {
  CreateGroupAction,
  InviteMemberAction,
} from "@/app/groups/actions";

describe("group forms", () => {
  it("exposes accessible validation boundaries for group creation", () => {
    render(
      <CreateGroupForm
        action={vi.fn() as unknown as CreateGroupAction}
      />,
    );

    expect(screen.getByLabelText("グループ名")).toHaveAttribute(
      "maxLength",
      "100",
    );
    expect(screen.getByRole("button", { name: "グループを作る" })).toBeEnabled();
  });

  it("offers only member/admin roles and one live region for invitations", () => {
    render(
      <InviteMemberForm
        action={vi.fn() as unknown as InviteMemberAction}
        groupId="2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd"
        groupName="ライブ遠征組"
      />,
    );

    expect(screen.getByLabelText("招待するメールアドレス")).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.getByRole("option", { name: "メンバー" })).toBeVisible();
    expect(screen.getByRole("option", { name: "管理者" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "オーナー" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("権限")).toBeEnabled();
    expect(screen.getByTestId("invite-status")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("invite-status")).not.toHaveAttribute(
      "aria-live",
    );
  });
});
