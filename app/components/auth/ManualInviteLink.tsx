"use client";

import { useState, useSyncExternalStore } from "react";

type CopyStatus = "idle" | "success" | "error";

function subscribeToOrigin() {
  return () => undefined;
}

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand?.("copy") ?? false;
  } finally {
    textarea.remove();
  }
}

export function ManualInviteLink({ path }: { path: string }) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    () => window.location.origin,
    () => "",
  );
  const absoluteUrl = origin
    ? new URL(path, origin).toString()
    : path;

  async function copyLink() {
    let copied = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absoluteUrl);
        copied = true;
      } else {
        copied = fallbackCopy(absoluteUrl);
      }
    } catch {
      copied = fallbackCopy(absoluteUrl);
    }

    setCopyStatus(copied ? "success" : "error");
  }

  return (
    <div className="manual-invite-copy">
      <a className="manual-invite-url" href={absoluteUrl}>
        {absoluteUrl}
      </a>
      <button
        className="button button-secondary copy-invite-button"
        type="button"
        onClick={copyLink}
      >
        手動リンクをコピー
      </button>
      <p
        className={`copy-feedback is-${copyStatus}`}
        aria-live="polite"
        role={copyStatus === "error" ? "alert" : "status"}
      >
        {copyStatus === "success"
          ? "リンクをコピーしました。"
          : copyStatus === "error"
            ? "コピーできませんでした。リンクを選択してコピーしてください。"
            : ""}
      </p>
    </div>
  );
}
