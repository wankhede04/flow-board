# Linking a Slack channel to FlowBoard

This guide walks through wiring a Slack channel — we'll use `#flowboard` as
the example — to a FlowBoard project so that:

- **Every message posted in the channel creates a ticket** in the linked
  project (the bot confirms in the message's thread with the ticket key).
- **Replying in that thread with a status keyword moves the ticket**:
  `todo`, `pending`, `in progress`, or `done` (synonyms like `wip`,
  `doing`, `complete`, `finished`, `closed` work too, as does an exact
  column name such as `review`).
- **Notifications post back to the channel**: due-date alerts (due within
  24h and overdue), stale-ticket alerts (in progress and unmoved for
  7 days), and planner reminders at their set time.

## Prerequisites

1. The FlowBoard Slack app is installed in your Slack workspace
   ([`DEPLOYMENT.md`](../DEPLOYMENT.md) Step 5) with `SLACK_SIGNING_SECRET`
   and `SLACK_BOT_TOKEN` set on the server.
2. The app's **Event Subscriptions** are enabled, pointing at
   `https://<your-host>/api/v1/slack/events`, and include these **bot
   events** (Slack app settings → Event Subscriptions → Subscribe to bot
   events):
   - `message.channels` — messages in public channels the bot is in
   - `message.groups` — messages in private channels the bot is in
     *(only needed if you link private channels)*
3. The bot has the matching **scopes** (add under OAuth & Permissions,
   then reinstall the app): `channels:history` (public) and/or
   `groups:history` (private), in addition to the base scopes from
   Step 5 (`commands`, `chat:write`, `im:write`, `users:read`,
   `users:read.email`).

> After adding scopes or events, Slack requires a **reinstall** of the app
> to the workspace — use the banner Slack shows, or Install App → Reinstall.

## Link the channel (2 minutes)

1. **Create the channel** (e.g. `#flowboard`) if it doesn't exist.
2. **Invite the bot** to the channel — in the channel, type:

   ```
   /invite @flowboard
   ```

   (The bot cannot read messages in channels it isn't a member of.)

3. **Link it to a project** — in the channel, run:

   ```
   /flowboard link FB
   ```

   `FB` is the project key shown next to the project name in FlowBoard.
   Omit the key (`/flowboard link`) to link your default project. The bot
   answers in-channel confirming the link.

   The first linked channel also becomes the workspace's **default
   notification channel**, used for reminders that aren't tied to any
   project's ticket.

4. **Try it** — post a message in the channel:

   ```
   Fix the login redirect loop on Safari
   ```

   Within a second or two the bot replies in the thread:

   > 🎫 Created **FB-27: Fix the login redirect loop on Safari** in
   > **Backlog**. Reply in this thread with `todo`, `pending`,
   > `in progress`, or `done` to move it.

5. **Move it from the thread** — reply in that thread:

   ```
   in progress
   ```

   > 🔀 Moved **FB-27** to **In Progress**.

   Later, reply `done` and the ticket lands in the Done column.

## Message → ticket rules

| Message | Result |
| --- | --- |
| Single-line message | Title of the new ticket (truncated at 200 chars) |
| Multi-line message | First line becomes the title, the rest the description |
| Thread replies | Never create tickets — only status keywords act, everything else is ignored |
| Bot messages / edits / joins | Ignored |

The ticket's reporter is the FlowBoard user whose email matches the Slack
poster's email; if there is no match, the workspace admin is used so the
message is never lost.

Status replies are deliberately strict: the **whole reply** (minus an
optional `status:` / `move to` prefix) must be the keyword, so ordinary
thread conversation never moves tickets.

## What posts back to the channel

| Event | Message | Cadence |
| --- | --- | --- |
| Ticket due within 24h | 📅 *[FB-12] Title* is due 2026-07-15. | Once per ticket |
| Ticket overdue | 🔥 *[FB-12] Title* is overdue (was due …). | Once per ticket |
| Ticket in progress, unmoved for 7 days | 🐢 *[FB-12] Title* has been sitting in *In Progress* for 7 days without moving. | Once per stall — moving the ticket re-arms it |
| Planner reminder reaches its time | ⏰ Reminder for @you: *title* | At the set time (recurring reminders repeat) |

Reminders attached to a ticket post to that project's channel; standalone
reminders post to the workspace default channel.

## Unlinking

In the channel:

```
/flowboard unlink
```

Ticket creation and notifications for that channel stop immediately.
Existing tickets are untouched.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Messages don't create tickets | Is the bot **in the channel** (`/invite @flowboard`)? Is the channel linked (`/flowboard link`)? Are `message.channels` events subscribed and `channels:history` scope granted (reinstall after changes)? |
| `dispatch_failed` when running `/flowboard` | Slash command URL wrong or server unreachable — verify `https://<host>/api/v1/slack/commands` |
| Bot replies but statuses don't move tickets | The reply must be *only* the keyword (`done`, not `ok done ✔`) and must be **in the thread** of the original message |
| Notifications never arrive | `SLACK_BOT_TOKEN` set? Scheduler running (`ENABLE_SCHEDULER=true` or external cron on `/api/v1/jobs/tick`)? Channel linked? |
| Duplicate tickets from one message | Shouldn't happen — deliveries are deduped by Slack event id; check server logs |
