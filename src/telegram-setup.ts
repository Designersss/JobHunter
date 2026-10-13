/**
 * Helpers for one-time local onboarding.
 * Deliberately exposes only chat metadata, never messages or bot secrets.
 */
export interface SetupUpdate {
  message?: {
    from?: { id: number; is_bot?: boolean };
    chat: { id: number; type: string; first_name?: string };
  };
  channel_post?: {
    chat: { id: number; type: string; title?: string };
  };
}

export interface DiscoveredIds {
  users: Array<{ id: number; display: string }>;
  channels: Array<{ id: number; title: string }>;
}

export function discoverIds(updates: SetupUpdate[]): DiscoveredIds {
  const users = new Map<number, string>();
  const channels = new Map<number, string>();
  for (const update of updates) {
    const message = update.message;
    if (message?.chat.type === "private" && !message.from?.is_bot) {
      const id = message.from?.id ?? message.chat.id;
      users.set(id, message.chat.first_name || "Private chat");
    }
    const post = update.channel_post;
    if (post?.chat.type === "channel") {
      channels.set(post.chat.id, post.chat.title || "Private channel");
    }
  }
  return {
    users: [...users].map(([id, display]) => ({ id, display })),
    channels: [...channels].map(([id, title]) => ({ id, title }))
  };
}

export function canPostToChannel(member: {
  status: string;
  can_post_messages?: boolean;
}): boolean {
  return member.status === "creator" ||
    (member.status === "administrator" && member.can_post_messages === true);
}
