import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeOshiRows } from "@/lib/oshis/oshi-board";
import type { TimelineOshi } from "@/lib/posts/timeline";

/**
 * What the timeline and a single post both need before they can render: who the
 * reader is in this circle, and the circle's oshis for the pickers and chips.
 */

export type TimelineMembershipRole = "owner" | "admin" | "member";

export type TimelineMembership = {
  role: TimelineMembershipRole;
  groupName: string;
};

export function readTimelineMembership(
  value: unknown,
): TimelineMembership | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const membership = value as Record<string, unknown>;
  const relation = Array.isArray(membership.groups)
    ? membership.groups[0]
    : membership.groups;
  const group = (relation ?? {}) as Record<string, unknown>;
  const role = membership.role;

  if (
    typeof group.name !== "string" ||
    (role !== "owner" && role !== "admin" && role !== "member")
  ) {
    return null;
  }

  return { role, groupName: group.name };
}

export async function loadTimelineOshis(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<TimelineOshi[]> {
  const { data, error } = await supabase
    .from("oshis")
    .select("id, name, member_color, image_path, created_by")
    .eq("group_id", groupId)
    .order("sort_order", { ascending: true });

  if (error) {
    return [];
  }

  return normalizeOshiRows(data, { userId, isManager: false }).map((oshi) => ({
    id: oshi.id,
    name: oshi.name,
    color: oshi.color,
  }));
}
