"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  JoinLinkAction,
  JoinLinkActionState,
} from "@/app/groups/[groupId]/members/join-links";
import { ROLE_LABELS } from "@/lib/members/roster";
import type { LiveJoinLink } from "@/lib/members/join-links";
import { formatPostTimestamp } from "@/lib/posts/format";

const initialState: JoinLinkActionState = {
  status: "idle",
  message: "",
  linkUrl: null,
};

function RevokeForm({
  action,
  groupId,
  link,
}: {
  action: JoinLinkAction;
  groupId: string;
  link: LiveJoinLink;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );
  const statusId = `join-link-revoke-status-${link.id}`;

  return (
    <form action={formAction} aria-describedby={statusId} className="join-link-revoke-form">
      <input name="groupId" type="hidden" value={groupId} />
      <input name="linkId" type="hidden" value={link.id} />
      <button className="button button-quiet" disabled={isPending} type="submit">
        {isPending ? "取り消し中" : "このリンクを取り消す"}
      </button>
      <FormStatus
        className="post-inline-status"
        id={statusId}
        message={state.message}
        status={state.status}
      />
    </form>
  );
}

/**
 * Only links that somebody could still walk through. A spent or revoked link is
 * history, and offering to revoke it again would suggest it were still open.
 */
export function JoinLinkList({
  action,
  groupId,
  links,
}: {
  action: JoinLinkAction;
  groupId: string;
  links: readonly LiveJoinLink[];
}) {
  if (links.length === 0) {
    return (
      <p className="post-field-hint">
        使われていない参加リンクはありません。
      </p>
    );
  }

  return (
    <ul className="join-link-list" aria-label="有効な参加リンク">
      {links.map((link) => (
        <li className="join-link-card" key={link.id}>
          <div className="invitation-card-heading">
            <span className={`role-badge role-${link.role}`}>
              {ROLE_LABELS[link.role]}
            </span>
            <span className="post-field-hint">
              {`${formatPostTimestamp(link.expiresAt)}まで有効`}
            </span>
          </div>
          <RevokeForm action={action} groupId={groupId} link={link} />
        </li>
      ))}
    </ul>
  );
}
