import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverIds, canPostToChannel } from "../src/telegram-setup.js";

test("extracts private user and channel IDs without exposing message contents", () => {
  const updates = [
    { message: { from: { id: 123, is_bot: false }, chat: { id: 123, type: "private", first_name: "Owner" }, text: "/start" } },
    { channel_post: { chat: { id: -100999, type: "channel", title: "Jobs" }, text: "Private content" } },
    { channel_post: { chat: { id: -100999, type: "channel", title: "Jobs" } } },
    { message: { from: { id: 42, is_bot: true }, chat: { id: 42, type: "private" } } }
  ];
  assert.deepEqual(discoverIds(updates), {
    users: [{ id: 123, display: "Owner" }],
    channels: [{ id: -100999, title: "Jobs" }]
  });
});

test("administrator without publish permission is rejected", () => {
  assert.equal(canPostToChannel({ status: "administrator", can_post_messages: false }), false);
  assert.equal(canPostToChannel({ status: "administrator", can_post_messages: true }), true);
  assert.equal(canPostToChannel({ status: "member" }), false);
});
