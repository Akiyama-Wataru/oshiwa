import { MemberRemoveForm } from "@/app/components/members/MemberRemoveForm";
import { MemberRoleForm } from "@/app/components/members/MemberRoleForm";
import type { MemberAction } from "@/app/groups/[groupId]/members/actions";
import { ROLE_LABELS, type RosterMember } from "@/lib/members/roster";

export function MemberRoster({
  groupId,
  members,
  removeAction,
  roleAction,
}: {
  groupId: string;
  members: readonly RosterMember[];
  removeAction: MemberAction;
  roleAction: MemberAction;
}) {
  return (
    <ul className="member-list" aria-label="参加中のメンバー">
      {members.map((entry) => (
        <li className="member-card" key={entry.userId}>
          <div className="member-card-heading">
            <span className={`role-badge role-${entry.role}`}>
              {ROLE_LABELS[entry.role]}
            </span>
            <span className="member-name">{entry.displayName}</span>
            {entry.isSelf ? (
              <span className="member-self">あなた</span>
            ) : null}
          </div>

          {entry.canChangeRole ? (
            <MemberRoleForm
              action={roleAction}
              displayName={entry.displayName}
              groupId={groupId}
              role={entry.role}
              userId={entry.userId}
            />
          ) : null}

          {/* Leaving is offered once, as its own panel, rather than as a
              second way to remove yourself from the list. */}
          {entry.canRemove && !entry.isSelf ? (
            <MemberRemoveForm
              action={removeAction}
              displayName={entry.displayName}
              groupId={groupId}
              userId={entry.userId}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
