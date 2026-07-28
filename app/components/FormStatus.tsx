export type FormStatusLevel = "idle" | "success" | "warning" | "error";

/**
 * One live region per form. The role stays `status` for the whole lifetime of
 * the element: swapping between `status` and `alert` re-registers the region in
 * several screen readers, which drops the very message it was meant to
 * announce. `role="status"` already implies a polite live region, so no
 * `aria-live` is set alongside it.
 */
export function FormStatus({
  className = "auth-inline-status",
  id,
  message,
  status,
}: {
  className?: string;
  id?: string;
  message: string;
  status: FormStatusLevel;
}) {
  return (
    <p
      className={`${className} ${status === "error" ? "is-error" : ""}`}
      id={id}
      role="status"
    >
      {message}
    </p>
  );
}
