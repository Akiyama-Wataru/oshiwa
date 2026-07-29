"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  JoinLinkAction,
  JoinLinkActionState,
} from "@/app/groups/[groupId]/members/join-links";
import {
  JOIN_LINK_LIFETIME_HOURS,
  JOIN_LINK_LIFETIME_LABELS,
} from "@/lib/validation/join-links";

const initialState: JoinLinkActionState = {
  status: "idle",
  message: "",
  linkUrl: null,
};

export function JoinLinkPanel({
  action,
  groupId,
}: {
  action: JoinLinkAction;
  groupId: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );

  return (
    <section className="join-link-panel" aria-labelledby="join-link-title">
      <h2 className="eyebrow" id="join-link-title">
        参加リンクを作る
      </h2>
      <p className="post-field-hint">
        リンクを渡した相手が最初に開いたときだけ参加できます。渡した先で転送されても、2人目は入れません。
      </p>

      <form action={formAction} className="join-link-form">
        <input name="groupId" type="hidden" value={groupId} />

        <div className="post-field">
          <label htmlFor="join-link-role">権限</label>
          <select
            defaultValue="member"
            disabled={isPending}
            id="join-link-role"
            name="role"
          >
            <option value="member">メンバー</option>
            <option value="admin">管理者</option>
          </select>
        </div>

        <div className="post-field">
          <label htmlFor="join-link-lifetime">有効期限</label>
          <select
            defaultValue="24"
            disabled={isPending}
            id="join-link-lifetime"
            name="lifetimeHours"
          >
            {JOIN_LINK_LIFETIME_HOURS.map((hours) => (
              <option key={hours} value={hours}>
                {JOIN_LINK_LIFETIME_LABELS[hours]}
              </option>
            ))}
          </select>
        </div>

        <button
          className="button button-secondary"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "作成中" : "リンクを作る"}
        </button>
      </form>

      {/* Shown once and never again: the database keeps only the digest, so
          this is the only moment the link exists anywhere. */}
      {state.linkUrl ? (
        <div className="join-link-result">
          <label htmlFor="join-link-url">作成したリンク（1回限り）</label>
          <input
            id="join-link-url"
            readOnly
            value={state.linkUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="post-field-hint">
            この画面を離れると二度と表示できません。いま相手に送ってください。
          </p>
        </div>
      ) : null}

      <FormStatus
        className="post-inline-status"
        message={state.message}
        status={state.status}
      />
    </section>
  );
}
