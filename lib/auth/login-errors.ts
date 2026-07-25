export type LoginErrorResult =
  | {
      kind: "invalid_credentials";
      status: 401;
      message: string;
    }
  | {
      kind: "rate_limited";
      status: 429;
      message: string;
    }
  | {
      kind: "unavailable";
      status: 503;
      message: string;
    };

type AuthErrorLike = {
  code?: unknown;
  status?: unknown;
};

const INVALID_CREDENTIALS_MESSAGE =
  "メールアドレスまたはパスワードが正しくありません。";
const RATE_LIMITED_MESSAGE =
  "試行回数が多すぎます。しばらく待ってからお試しください。";
const UNAVAILABLE_MESSAGE =
  "ログイン処理を完了できませんでした。しばらく待ってからお試しください。";

function isAuthErrorLike(error: unknown): error is AuthErrorLike {
  return typeof error === "object" && error !== null;
}

export function mapLoginError(error: unknown): LoginErrorResult {
  if (!isAuthErrorLike(error)) {
    return {
      kind: "unavailable",
      status: 503,
      message: UNAVAILABLE_MESSAGE,
    };
  }

  const code = typeof error.code === "string" ? error.code : "";
  const status = typeof error.status === "number" ? error.status : null;

  if (status === 429 || /rate[_-]?limit/u.test(code)) {
    return {
      kind: "rate_limited",
      status: 429,
      message: RATE_LIMITED_MESSAGE,
    };
  }

  if (status !== null && status >= 500) {
    return {
      kind: "unavailable",
      status: 503,
      message: UNAVAILABLE_MESSAGE,
    };
  }

  if (status !== null || code.length > 0) {
    return {
      kind: "invalid_credentials",
      status: 401,
      message: INVALID_CREDENTIALS_MESSAGE,
    };
  }

  return {
    kind: "unavailable",
    status: 503,
    message: UNAVAILABLE_MESSAGE,
  };
}
