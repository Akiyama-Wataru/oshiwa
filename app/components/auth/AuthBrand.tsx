import Link from "next/link";

export function AuthBrand() {
  return (
    <Link className="auth-brand" href="/" aria-label="推し輪のホームへ戻る">
      <span className="brand-mark" aria-hidden="true">
        推
      </span>
      <span>推し輪</span>
    </Link>
  );
}
