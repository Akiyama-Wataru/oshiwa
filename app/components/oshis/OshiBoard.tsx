"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { FormStatus } from "@/app/components/oshis/FormStatus";
import { OshiDeleteForm } from "@/app/components/oshis/OshiDeleteForm";
import { OshiEditForm } from "@/app/components/oshis/OshiEditForm";
import { OshiImageForm } from "@/app/components/oshis/OshiImageForm";
import type {
  OshiAction,
  OshiActionState,
} from "@/app/groups/[groupId]/oshis/actions";
import { memberColorClassName } from "@/lib/oshis/member-color";
import type { OshiBoardEntry } from "@/lib/oshis/oshi-board";

const initialState: OshiActionState = { status: "idle", message: "" };

function moveById(
  order: readonly string[],
  id: string,
  delta: number,
): string[] {
  const from = order.indexOf(id);
  const to = from + delta;

  if (from < 0 || to < 0 || to >= order.length) {
    return [...order];
  }

  const next = [...order];
  next[from] = order[to];
  next[to] = order[from];
  return next;
}

export function OshiBoard({
  canReorder,
  deleteAction,
  entries,
  groupId,
  reorderAction,
  updateAction,
  uploadAction,
}: {
  canReorder: boolean;
  deleteAction: OshiAction;
  entries: readonly OshiBoardEntry[];
  groupId: string;
  reorderAction: OshiAction;
  updateAction: OshiAction;
  uploadAction: OshiAction;
}) {
  const serverOrder = entries.map((entry) => entry.id);
  const serverOrderKey = serverOrder.join(":");
  const [order, setOrder] = useState(serverOrder);
  const [announcement, setAnnouncement] = useState("");
  const lastServerOrderKey = useRef(serverOrderKey);
  const [reorderState, reorderFormAction, isReordering] = useActionState(
    reorderAction,
    initialState,
  );

  // The server is the source of truth: adopt its order whenever it changes,
  // without remounting the whole board and losing the action status message.
  useEffect(() => {
    if (lastServerOrderKey.current !== serverOrderKey) {
      lastServerOrderKey.current = serverOrderKey;
      setOrder(serverOrderKey ? serverOrderKey.split(":") : []);
    }
  }, [serverOrderKey]);

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const ordered = order.flatMap((id) => {
    const entry = entriesById.get(id);
    return entry ? [entry] : [];
  });

  const move = (entry: OshiBoardEntry, delta: number) => {
    const next = moveById(order, entry.id, delta);
    const position = next.indexOf(entry.id) + 1;

    setOrder(next);
    setAnnouncement(
      `${entry.name}を${position}番目に移動しました。保存を押すと確定します。`,
    );
  };

  if (ordered.length === 0) {
    return (
      <div className="groups-empty">
        <span aria-hidden="true">✦</span>
        <p>
          <strong>まだ推しが登録されていません。</strong>
          最初のひとりを追加すると、みんなのタイムラインで色分けされます。
        </p>
      </div>
    );
  }

  return (
    <div className="oshi-board">
      <ul className="oshi-grid" aria-label="登録済みの推し">
        {ordered.map((entry) => (
          <li className="oshi-card" key={entry.id}>
            <div className="oshi-card-heading">
              <span
                className={`oshi-board-chip ${memberColorClassName(entry.color)}`}
              >
                {entry.name}
              </span>
              {canReorder ? (
                <span className="oshi-order-controls">
                  {/* Both buttons stay enabled: disabling the one under the
                      pointer or keyboard focus would drop focus to the body. */}
                  <button
                    aria-label={`${entry.name}を前へ`}
                    className="button button-secondary"
                    disabled={isReordering}
                    onClick={() => move(entry, -1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`${entry.name}を後ろへ`}
                    className="button button-secondary"
                    disabled={isReordering}
                    onClick={() => move(entry, 1)}
                    type="button"
                  >
                    ↓
                  </button>
                </span>
              ) : null}
            </div>

            {entry.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${entry.name}の写真`}
                className="oshi-photo"
                decoding="async"
                loading="lazy"
                src={entry.imageUrl}
              />
            ) : (
              <p className="oshi-photo-empty">写真はまだ登録されていません。</p>
            )}

            {entry.canManage ? (
              <details className="oshi-manage-panel">
                <summary>{`${entry.name}を編集`}</summary>
                <OshiEditForm
                  action={updateAction}
                  color={entry.color}
                  groupId={groupId}
                  name={entry.name}
                  oshiId={entry.id}
                />
                <OshiImageForm
                  action={uploadAction}
                  groupId={groupId}
                  name={entry.name}
                  oshiId={entry.id}
                />
                <OshiDeleteForm
                  action={deleteAction}
                  groupId={groupId}
                  name={entry.name}
                  oshiId={entry.id}
                />
              </details>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="visually-hidden" role="status">
        {announcement}
      </p>

      {canReorder ? (
        <form
          action={reorderFormAction}
          aria-describedby="oshi-reorder-status"
          className="oshi-reorder-form"
        >
          <input name="groupId" type="hidden" value={groupId} />
          {order.map((id) => (
            <input key={id} name="oshiId" type="hidden" value={id} />
          ))}
          <button
            className="button button-primary"
            disabled={isReordering}
            type="submit"
          >
            {isReordering ? "保存中" : "並び順を保存"}
          </button>
          <FormStatus
            id="oshi-reorder-status"
            message={reorderState.message}
            status={reorderState.status}
          />
        </form>
      ) : null}
    </div>
  );
}
