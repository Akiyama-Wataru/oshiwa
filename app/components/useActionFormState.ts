"use client";

import { useActionState } from "react";

/**
 * `useActionState` with a state that is always there to read.
 *
 * A server action that ends in `redirect()` never resolves to a state: the
 * redirect boundary takes over the navigation, but React still renders the
 * form once with nothing in place of the state. Reading a field off it there
 * throws, and the member sees an error screen flash on the way to the page
 * they asked for. Falling back to the initial state makes that render
 * uneventful, which is what it looks like to someone who is already leaving.
 */
export function useActionFormState<State>(
  action: (state: Awaited<State>, formData: FormData) => State | Promise<State>,
  initialState: Awaited<State>,
) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return [state ?? initialState, formAction, isPending] as const;
}
