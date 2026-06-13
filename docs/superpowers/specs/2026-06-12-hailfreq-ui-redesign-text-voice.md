# Hailfreq UI Redesign: Text + Voice Channels with Operations Support

**Date:** 2026-06-12  
**Status:** Approved design — pending spec review  
**Supersedes:** Partial aspects of the 2026-05-31 Net Experience Redesign (integration layer only; foundation is reused)  
**Related:** [2026-05-31-operations-design.md](2026-05-31-operations-design.md), [2026-05-31-full-compact-view-design.md](2026-05-31-full-compact-view-design.md)

## Goal

Extend the approved Net Experience Redesign (rail + sidebar + main panel) to support **text channels nested under nets**, allowing guilds to use Hailfreq for both **tactical voice comms** (real-time PTT) and **persistent text discussion** (planning, announcements, async coordination). The same layout and toggle mechanism work seamlessly for both **Lounge mode** (casual flat nets) and **Operations mode** (hierarchical fleet/strike-group structure with circuit accountability).

## Background

The 2026-05-31 Net Experience Redesign established a solid three-region shell: **rail | sidebar | main panel | roster panel**. This spec builds on that foundation by:
- Adding **text channels** as nested items under nets in the sidebar (like Discord)
- Enabling a **text / voice toggle** in the main panel header
- Defining how **Operations mode** (strike groups → ships → circuits) restructures the sidebar while keeping the same layout
- Documenting how **Full / Compact view modes** interact with the text + voice feature

## Architecture Overview

### Core Layout (unchanged from Net Experience Redesign, Part 1)

```
┌──────┬───────────────────┬──────────────────────┬───────────┐
│ rail │   net sidebar     │    main panel        │  roster   │
│(60px)│(240px, resizable) │      (flex)          │ (200px)   │
│  ↑   │ ‖ drag handle     │                      │           │
│mode  │                   │                      │           │
│tabs  │                   │                      │           │
└──────┴───────────────────┴──────────────────────┴───────────┘
```

- **Server rail** (60px, at top): 
  - **Mode tabs** (🏠 Lounge | ⚡ Ops) — toggle between Lounge and Operations modes
  - **Operation selector** (when Ops tab active): dropdown/list showing all active operations; user selects one to enter
  - **Server avatars** (below mode tabs): select which server to connect to
  - **Settings gear** (bottom): global settings

- **Net sidebar** (240px, resizable): 
  - **Lounge mode:** three sections (Ships | Your Nets | Available) with expandable nets showing nested text/voice channels
  - **Operations mode:** operation hierarchy (Broadcast nets → Admirals → Strike Groups → Ships → Circuits)

- **Main panel** (flex): active channel content with text/voice toggle
- **Roster panel** (200px): net members with presence indicators
- **Resizer** (4px): drag to adjust sidebar width; persisted

### Two Operational Modes

#### 1. **Lounge Mode** (casual day-to-day)
- Sidebar shows flat net list: Ships → Your Nets → Available to Join
- Each net expands to show its text channels (#) and voice channel (🎤)
- Selecting a text channel shows message history in main panel
- Selecting the voice channel shows voice controls (PTT, mode, monitor, volume, chirps)

#### 2. **Operations Mode** (formal hierarchical)
- Sidebar shows hierarchical operation structure: Broadcast nets → Admirals net → Strike Groups → Ships → Circuits
- Each circuit shows nested text and voice channels
- Same toggle mechanism: select any channel → main panel shows that channel's content
- Circuit leads visible (accountability); broadcast nets marked with priority badges

## Components and Data Structures

### Mode Toggle & Operation Selector (New)

**Location:** Top of server rail, above server avatars  
**Design:** Two icon buttons stacked vertically

#### Lounge Tab (🏠)
- Label: "Lounge"
- Icon: 🏠 (house)
- Active state: highlighted (blue background)
- Click: switches to Lounge mode, shows Ships | Your Nets | Available sidebar

#### Operations Tab (⚡)
- Label: "Ops"
- Icon: ⚡ (lightning bolt)
- Active state: highlighted when in Operations mode
- Click: switches to Operations mode, shows operation selector

#### Operation Selector (when Ops tab active)
- **Always visible:** even if only one operation exists, show the selector/list
- **Display:** dropdown or list showing:
  - Active operations (status: PLANNING, ACTIVE, ARCHIVED)
  - Current operation name and status
  - One-click selection to enter an operation
  - Example:
    ```
    ⚡ Op NIGHTFALL (ACTIVE) ← selected
    ⚡ Op DELTA (PLANNING)
    ⚡ Op SCOUT (ARCHIVED)
    ```
- **Interaction:** 
  - Click an operation to enter it (switch sidebar to that operation's hierarchy)
  - Sidebar immediately restructures to show that operation's strike groups/ships/circuits
  - User is auto-placed into their assigned channels per the operation roster

### Sidebar Sections

#### Ships Section (Lounge + Operations)
- **Lounge:** Auto-detected ship-nets (via `org.hailfreq.ship.type` marker), sorted alphabetically
- **Operations:** Ships grouped under their parent Strike Group in the hierarchy
- Each ship expands to show nested text and voice channels (auto-created per ship, or custom per captain setup)

#### Your Nets Section (Lounge)
- Joined non-ship nets, sorted by priority descending
- **Monitored bubble:** the currently-monitored net always bubbles to the top of this section (user awareness)
- Each net expands to show text channels and one voice channel
- Selected net highlighted in main panel

#### Available to Join Section (Lounge + Operations)
- Discoverable nets (per 2026-05-31 Net Experience Redesign Part 2)
- Shows name + member count + "＋ Join" button
- No expansion; clicking Join adds it to Your Nets

#### Admirals / Group Nets Section (Operations only)
- Nets whose scope is the operation or a strike group (e.g., "Admirals Net", "Captains — SG Alpha")
- Shown inline in the hierarchy; non-expandable (these are comms channels, not organizational units)

### Nested Channels (New)

Each net can contain:
- **Text channels** (`#channel-name`): persistent discussion, announcements, planning. Organized by thread/topic.
- **Voice channel** (singular `🎤 voice`): real-time PTT, voice controls, member list during voice session.

**Default structure** (per net):
- `#general` (always present)
- `🎤 voice` (always present)
- Additional text channels per admin/captain config (e.g., `#announcements`, `#operations`, `#squad-roster`)

**Ships (Operations)** may have multiple circuits/channels:
- Bridge: `#bridge` + `🎤 bridge`
- Engineering: `#engineering` + `🎤 engineering`
- Flight Ops: `#flight` + `🎤 flight`
- (Set up by captain per circuit)

### Main Panel

#### Header (persistent)
- **Channel name & net context:** e.g., `#general` in 📢 Command Net
- **Text / Voice toggle buttons:** 📝 Text (active) | 🎤 Voice (inactive)
- **Description:** brief channel purpose
- **Settings icon** (net-level admin actions, if permitted)

#### Content Area (varies by channel type)

**Text Channel:**
- Message history scrollable
- User avatar + name + timestamp per message
- Sender role/status indicators (e.g., "[Captain]", "[Admin]")
- Message input at bottom with Send button

**Voice Channel:**
- Voice status card (🔴 LIVE, 🟢 IDLE, 🔵 REHEARSAL) showing connected members
- **Controls row:** PTT button, Monitor toggle, Voice mode (Hot Mic / Push-to-Talk), In/Out chirp selectors
- Member list integrated (showing real-time speaking indicators)
- On-air transmit indicator (who is currently transmitting; 🔊 pulsing red dot)

### Roster Panel (Right, 200px)

- **Member header:** "[Channel] Members (N)"
- **Member cards:** avatar, name, status badge (🔊 speaking, 🎤 listening, ⚪ offline)
- **Role badges** (if Operations): role/position label (e.g., "[Captain]", "[Lead]")
- **Actions** (if admin): invite, remove, change role

---

## Lounge Mode: Detailed Flow

### Example: Casual Nets Sidebar

```
SHIPS
  ▼ 🚢 Idris
      # general
      🎤 voice
  ▶ 🎯 Gladius

YOUR NETS
  ▼ 📢 Command Net
      # general
      # announcements
      🎤 voice
  ▶ 🔊 General
  ▶ 🤫 Squad

AVAILABLE TO JOIN
  + Mess Hall (4 members)
```

### Interaction

1. **Select a net's text channel** (e.g., `# announcements` in Command Net)
   - Main panel shows message history for that channel
   - Roster panel shows all Command Net members
   - Toggle buttons available; Text is active, Voice is grayed out

2. **Switch to voice**
   - Click 🎤 Voice toggle
   - Main panel shows voice controls + member list with live status (who's speaking/listening)
   - PTT button ready; roster shows status indicators

3. **Switch back to text**
   - Click 📝 Text toggle
   - Main panel returns to message history
   - Roster still shows member status for context

4. **Select a different net**
   - Clicking another net in the sidebar changes the main panel and roster to that net's content
   - Text/voice toggle resets based on what you select

---

## Operations Mode: Detailed Flow

### Example: Operations Sidebar (Hierarchical)

```
⚡ Op NIGHTFALL (Status: ACTIVE, Your Role: Admiral)

📢 Fleet All-Hands [P90]
👑 Admirals Net

▼ Strike Group ALPHA
    🎖 Captains — SG Alpha
    ▼ 🚢 Idris · Resolute (Captain: Sarah)
        📢 1MC — All Hands [P95]
        # bridge
        🎤 bridge
        # engineering
        🎤 engineering
        # flight-ops
        🎤 flight-ops
    ▼ 🎯 Gladius · Wasp-1 (Captain: James)
        # ship-net
        🎤 ship-net
    ▼ ✈️ Fighter Flight Talon
        # talon-net
        🎤 talon-net

▼ Strike Group BRAVO
    ...
```

### Interaction

Same toggle mechanism as Lounge:
1. Select a channel (text or voice) from the hierarchy
2. Main panel shows that channel's content
3. Toggle between text and voice as needed
4. Roster panel shows members assigned to that circuit/channel + their status

**Additionally (Operations):**
- **Broadcast nets** (📢) are high-priority; clicking them applies ducking (overrides other nets when transmitting)
- **Circuit leads** shown in channel header (e.g., "🎤 bridge [Lead: Sarah]") for accountability
- **Auto-placement** on join puts you in your assigned channels per the operation's roster

---

## Full / Compact View Integration

The 2026-05-31 Full/Compact spec defines two layout modes:

- **Full View** (default): rail | sidebar | main | roster | resizer. Everything visible.
- **Compact View**: left bar only (rail + sidebar stacked), no roster panel, voice/text controls pinned to bottom of sidebar.

**With text channels, Compact mode adapts:**
- Sidebar shows the same net/channel list
- Selecting a **text channel** pins the message input box to the bottom of the sidebar (quick reply without expanding)
- Selecting a **voice channel** pins the PTT button + mode toggle to the bottom (voice-first minimalist)
- Main panel is hidden; roster is hidden
- Toggling back to Full View restores the full layout

This keeps Compact as a **minimal, unobtrusive sidebar** suitable for in-game use while retaining text+voice access.

---

## Data Model & State

### Text Channels (new Matrix room type)
- Standard Matrix room with `m.room.encryption` (E2EE by default)
- State event `org.hailfreq.channel.type = { value: "text" }` (marks as text channel)
- Parent: the net (room or Space, depending on architecture)
- Topic: channel description

### Voice Channel (existing net, marked as voice)
- Standard Matrix room with E2EE
- State event `org.hailfreq.channel.type = { value: "voice" }`
- Parent: the net
- Uses LiveKit for voice comms (separate from Matrix messaging)

### Net / Circuit
- Matrix room carrying `org.hailfreq.net.priority`, `.name`, `.color`, `.self-monitor`, etc. (existing)
- Can now **contain** text channels + a voice channel (children via Matrix Space hierarchy or direct room relations)

### UI State (Client)
- **selected channel ID** (text or voice; replaces the old "selected net")
- **sidebar width** (persisted, existing)
- **layout mode** (full / compact; existing)
- **monitored nets** (unchanged; users still monitor entire nets, not individual channels)

---

## Error Handling / Edge Cases

### Text Channel

- **No messages yet:** Show a placeholder: "No messages. Be the first to say something."
- **Permissions denied:** Show "You don't have permission to post here."
- **Encryption not ready:** Spinner + "Setting up encryption…" (inherited from E2EE impl)

### Voice Channel

- **No one connected:** Show "No one is in this voice channel. Start talking to invite others."
- **Server unreachable:** "Can't reach the voice server. Check your connection."
- **PTT on wrong mode:** Disable PTT when mode = Monitor-only (user has only listen permission)

### Channel Selection

- **Net deleted while viewing its channel:** Fallback to the highest-priority net in Your Nets
- **Channel deleted while viewing:** Fallback to the net's default text channel (#general)
- **Operations ended while viewing:** Fallback to Lounge mode; operations net becomes read-only

---

## Testing Strategy

### Unit Tests (vitest)
- **Channel sort order** (Operations hierarchy flattening, Ships → Circuits)
- **Text / voice toggle state** (persistence across channel changes)
- **Fallback logic** (missing net / missing channel)
- **Permissions** (who can post/voice in a channel based on operation role)

### Integration Tests (container-backed)
- Build a small operation with ships and circuits; assign user to a ship
- Verify auto-placement lands the user in the correct circuits' text and voice channels
- Verify text channel message history persists; verify voice connection works
- Verify broadcast (1MC) ducking overrides other voice channels when transmitting

### Manual / E2E
- **Lounge mode:** Create a net, add text channels, post messages, switch to voice, verify PTT works
- **Operations mode:** Stage an operation, assign crew, verify auto-placement, verify circuit leads are visible, verify 1MC broadcasts
- **Full / Compact:** Toggle between modes; verify text input and voice controls remain accessible
- **Cross-channel:** Monitor multiple nets; verify transmit targeting works correctly; verify other nets' messages still arrive while focused on one channel

---

## Decomposition into Implementation Plans

This is a medium-sized feature. Decompose into focused, independently-testable sub-projects:

### Plan 1: Text Channel Foundation
- Matrix room structure for text channels (new state event `org.hailfreq.channel.type`)
- Text channel creation UI (per-net "＋ Channel" button)
- Message rendering in main panel (reply form, message history, timestamps)
- Depends on: existing net creation, Matrix E2EE

### Plan 2: Text / Voice Toggle & Channel Selection
- Toggle button in main panel header (text ↔ voice)
- Channel selection in sidebar (clicking a text or voice channel)
- State management (selected channel ID, switching between channel types)
- Main panel content swap (text messages ↔ voice controls)
- Depends on: Plan 1, existing voice controls

### Plan 3: Lounge Sidebar Rendering
- Expand/collapse nets to show nested text and voice channels
- Bubble the monitored net to the top of Your Nets
- Render Ships, Your Nets, Available sections with channels nested
- Depends on: Plan 2

### Plan 4: Operations Integration
- Hierarchy flattening (Space tree → channel list per user's role)
- Broadcast net rendering (📢 icon, priority badges)
- Circuit lead indicators
- Auto-placement: seed user's monitored channels on op start
- Depends on: Plan 3, 2026-05-31 Operations spec implementation

### Plan 5: Full / Compact Adaptation
- Compact sidebar with pinned text input (text mode) or PTT button (voice mode)
- Toggle between Full and Compact with persistent state
- Depends on: Plan 2, 2026-05-31 Full/Compact spec implementation

### Plan 6: Polish & Testing
- E2E tests (operations with multi-user voice and text)
- Manual testing across modes
- Accessibility audit (screen reader, keyboard nav)
- Performance (message history pagination, large rosters)

---

## Out of Scope

- **Rich text formatting** (bold, italic, code blocks, links) — start with plain text
- **Message reactions** (emoji reacts, threading) — deferred
- **Search across messages** — deferred
- **Media upload** (images, videos in chat) — deferred
- **Voice recording / playback** (async voice messages) — separate feature
- **Integrated video** (alongside voice) — deferred
- **Moderation tools** (mute, kick, ban from channel) — admin panel later

---

## Summary

This design extends the approved Net Experience Redesign by adding **persistent text communication** alongside **real-time voice**, enabling guilds to use Hailfreq as a complete comms platform. The same three-region layout (rail | sidebar | main | roster) handles both casual and formal (operations) use cases through a simple **text / voice toggle**. Integration with the Full/Compact view modes keeps the design flexible for both in-game overlay and desktop use.

Includes operational workflows for **creating operations, inviting crew from the server, and managing rosters** with auto-placement on activation.

---

## Operations Management

### Creating an Operation

**Admin / Organizer Flow:**

1. Click "⚡ ＋ New Op" in the Operations selector
2. Dialog appears with:
   - **Operation name** (e.g., "NIGHTFALL", "OPERATIONS-DELTA")
   - **Scheduled start time** (optional; used for reminders and planning)
   - **Description** (brief op summary: goals, scale, expected duration)
3. Click "Create Operation" — operation enters **PLANNING** state
4. Admin is taken to **Roster Builder** to define strike groups, ships, and assign crew

### Building the Roster

**Admin / Captain Flow:**

After creating an operation, the admin/captain edits the roster:

1. **Define hierarchy:** Create strike groups, add ships under each group, define circuits/positions per ship
   - Bridge, Engineering, Flight Ops (or custom per ship captain)
2. **Assign crew:**
   - **Passive signup:** Crew members see "Available Operations" in the sidebar and sign up. Admin reviews signups and assigns them to ships/positions.
   - **Active invitation:** Admin clicks "＋ Invite from Server" → searchable dialog of all server members → select who to invite → they appear in "Unassigned Crew"
3. **Assign positions:** Drag unassigned crew into ships and assign them specific circuit/role (e.g., "Alex → Helm Operator")
4. Click "Save Roster" to lock assignments
5. Click "Activate Op" to transition to **ACTIVE** state

**Crew Member Flow (Passive Signup):**

1. Crew sees "⚡ Available Operations" section in sidebar (Lounge mode)
2. Operation card shows: name, scheduled time, status (PLANNING), member count (12/24), brief description, commander name
3. Click "Sign Up for Operation" → crew appears in admin's "Unassigned Crew" roster as "Pending"
4. Admin assigns them to a ship + position
5. Crew receives notification: "You've been assigned to 🚢 Idris · Bridge"
6. When operation transitions to **ACTIVE**, crew auto-joins all their assigned channels

### Invitation Modal

**Triggered by:** "＋ Invite from Server" button in roster editor

**Features:**
- Search by name or @mention
- Shows all server members with role/specialty
- Already-invited members are grayed out
- Click "＋ Add" on each member to invite them
- Members appear in "Unassigned Crew" list after invitation
- Invited members get a notification immediately
- Admin still needs to assign them to ships/positions in main roster view

---

## Operation Lifecycle

Operations progress through four states:

### PLANNING
- Roster is being built and assignments are being made
- Channels exist but are locked (read-only)
- Crew can sign up or be invited
- Admin assigns people to ships and positions
- Ready to transition to ACTIVE once all assignments are complete

### ACTIVE
- All assignments are finalized
- Auto-placement is engaged: each crew member is automatically joined to their assigned channels
- Voice and text comms are live
- Monitor/PTT functionality is active
- Broadcast nets (Fleet All-Hands, 1MC) may override other transmissions (ducking)

### COMPLETED
- Operation has ended (admin manually marks as complete, or based on scheduled end time)
- All channels locked to read-only
- Message history is preserved for after-action review
- Crew can read/review but not post

### ARCHIVED
- Removed from the active operations list
- Searchable if needed for historical reference
- Can be cloned/duplicated as template for future operations with same structure

---

