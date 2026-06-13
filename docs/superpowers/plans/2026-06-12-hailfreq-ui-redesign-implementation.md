# Hailfreq UI Redesign: Text + Voice Channels & Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a unified text + voice communication UI with Lounge mode (casual nets) and Operations mode (hierarchical strike groups), featuring operation creation, crew rosters, invitations, and auto-placement.

**Architecture:** 
- Build on existing net architecture; text channels are Matrix rooms nested under net Spaces
- Operations are top-level Spaces with hierarchical children (Strike Groups → Ships → Circuits)
- Sidebar restructures based on mode (Lounge: flat net list; Operations: hierarchical)
- Auto-placement triggered via server webhook when operation transitions to ACTIVE
- Text/Voice toggle in main panel swaps content without changing selected channel

**Tech Stack:** 
- React 18, TypeScript, Vite
- Matrix.js client for Space hierarchies and room queries
- LiveKit for voice (existing integration)
- Electron for client app

---

## File Structure

**New files to create:**

```
src/types/
  channel.ts          # Channel, ChannelType, TextChannel, VoiceChannel
  operation.ts        # Operation, OperationState, Roster, RosterEntry
  hierarchy.ts        # HierarchyNode, FlatChannel (for sidebar rendering)

src/services/
  channelService.ts   # Fetch channels, create channels, query Space children
  operationService.ts # Create op, update op state, manage rosters
  autoPlacement.ts    # Webhook handler for ACTIVE transitions, join logic

src/components/
  Sidebar/
    index.tsx         # Main sidebar wrapper (routes to Lounge or Operations)
    LoungeSidebar.tsx # Ships, Your Nets, Available to Join
    OperationsSidebar.tsx # Hierarchy flattening, broadcast rendering
    ChannelList.tsx   # Nested channel rendering (text/voice)
  MainPanel/
    index.tsx         # Header + content area + text/voice toggle
    TextChannelView.tsx # Message history, input, rendering
    VoiceChannelView.tsx # PTT, controls, member list (reuse existing)
  Operations/
    CreateOperationDialog.tsx # Op creation form
    RosterBuilder.tsx  # Hierarchy editor, crew assignments
    InviteModal.tsx    # Search, invite from server
  Roster/
    index.tsx         # Member list with presence (reuse/adapt existing)

src/hooks/
  useChannels.ts      # Fetch channels under a net
  useOperations.ts    # Fetch all operations, current operation
  useRoster.ts        # Fetch operation roster, manage assignments
  useSidebarState.ts  # Selected channel, sidebar width, layout mode
  useHierarchy.ts     # Flatten Space hierarchy for sidebar rendering

src/utils/
  hierarchyFlattener.ts # Convert Space tree to flat list per user role
  roleChecker.ts      # Determine user's role in operation
  channelSorter.ts    # Sort channels by type (text vs voice), priority

src/tests/
  unit/
    channelService.test.ts
    hierarchyFlattener.test.ts
    roleChecker.test.ts
  integration/
    textChannelFlow.test.tsx
    operationCreation.test.tsx
    autoPlacement.test.ts

src/webhooks/
  operationStateChange.ts # Handle server push for op state transitions
```

---

## Phase 1: Type Definitions & Core Services

### Task 1: Define Channel Types

**Files:**
- Create: `src/types/channel.ts`
- Test: `src/types/channel.test.ts`

- [ ] **Step 1: Write failing test for ChannelType enum**

```typescript
// src/types/channel.test.ts
import { ChannelType } from './channel'

test('ChannelType enum has TEXT and VOICE', () => {
  expect(ChannelType.TEXT).toBe('text')
  expect(ChannelType.VOICE).toBe('voice')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/types/channel.test.ts
# Expected: ChannelType is not defined
```

- [ ] **Step 3: Create channel types file**

```typescript
// src/types/channel.ts

export enum ChannelType {
  TEXT = 'text',
  VOICE = 'voice'
}

export interface Channel {
  id: string              // Matrix room ID
  name: string           // Channel name (e.g., "general", "bridge")
  type: ChannelType      // TEXT or VOICE
  netId: string          // Parent net/Space ID
  topic?: string         // Channel description
  encrypted: boolean     // E2EE enabled
  createdAt: Date
  updatedAt: Date
}

export interface TextChannel extends Channel {
  type: ChannelType.TEXT
  messageCount: number
}

export interface VoiceChannel extends Channel {
  type: ChannelType.VOICE
  connectedMembers: string[]  // User IDs currently in voice
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/types/channel.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/types/channel.ts src/types/channel.test.ts
git commit -m "feat: add channel type definitions (text/voice)"
```

---

### Task 2: Define Operation & Roster Types

**Files:**
- Create: `src/types/operation.ts`
- Test: `src/types/operation.test.ts`

- [ ] **Step 1: Write failing test for OperationState enum**

```typescript
// src/types/operation.test.ts
import { OperationState } from './operation'

test('OperationState enum has PLANNING, ACTIVE, COMPLETED, ARCHIVED', () => {
  expect(OperationState.PLANNING).toBe('planning')
  expect(OperationState.ACTIVE).toBe('active')
  expect(OperationState.COMPLETED).toBe('completed')
  expect(OperationState.ARCHIVED).toBe('archived')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/types/operation.test.ts
# Expected: OperationState is not defined
```

- [ ] **Step 3: Create operation types file**

```typescript
// src/types/operation.ts

export enum OperationState {
  PLANNING = 'planning',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ARCHIVED = 'archived'
}

export interface Operation {
  id: string                    // Matrix Space ID
  name: string                  // Op name (e.g., "NIGHTFALL")
  description: string           // Op summary
  state: OperationState         // Current lifecycle state
  commanderId: string           // Creator/commander user ID
  scheduledStart?: Date         // Optional scheduled start time
  actualStart?: Date            // When op transitioned to ACTIVE
  actualEnd?: Date              // When op transitioned to COMPLETED
  createdAt: Date
  updatedAt: Date
}

export interface RosterEntry {
  userId: string                // User ID
  userName: string              // User display name
  strikeGroupId: string         // Strike Group Space ID
  shipId: string                // Ship Space ID
  circuitId: string             // Circuit/Channel ID (e.g., "bridge")
  role: string                  // Role/position (e.g., "Helm Operator", "Captain")
  status: 'pending' | 'assigned' | 'joined' // Pending invite/assignment, assigned, confirmed joined
}

export interface Roster {
  operationId: string           // Operation Space ID
  entries: RosterEntry[]        // All crew assignments
}

// Represents hierarchy tree for operations (for building/editing rosters)
export interface StrikeGroup {
  id: string                    // Space ID
  name: string                  // Group name (e.g., "ALPHA")
  captainId: string             // Captain user ID
  ships: Ship[]                 // Ships in group
}

export interface Ship {
  id: string                    // Space ID
  name: string                  // Ship designation (e.g., "Idris")
  callsign: string              // Call sign (e.g., "Resolute")
  captainId: string             // Captain user ID
  circuits: Circuit[]           // Circuits/positions in ship
}

export interface Circuit {
  id: string                    // Space ID
  name: string                  // Circuit name (e.g., "bridge", "engineering")
  positions: string[]           // Position titles in circuit (e.g., ["Helm Operator", "Navigator"])
  assignedUsers: string[]       // User IDs assigned to this circuit
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/types/operation.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/types/operation.ts src/types/operation.test.ts
git commit -m "feat: add operation and roster type definitions"
```

---

### Task 3: Define Hierarchy Types

**Files:**
- Create: `src/types/hierarchy.ts`
- Test: `src/types/hierarchy.test.ts`

- [ ] **Step 1: Write failing test for HierarchyNode**

```typescript
// src/types/hierarchy.test.ts
import { HierarchyNode, FlatChannel } from './hierarchy'

test('HierarchyNode can be a leaf or have children', () => {
  const leaf: HierarchyNode = {
    id: 'ch1',
    name: 'general',
    type: 'text',
    children: []
  }
  expect(leaf.children).toEqual([])

  const parent: HierarchyNode = {
    id: 'net1',
    name: 'Command Net',
    type: 'net',
    children: [leaf]
  }
  expect(parent.children.length).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/types/hierarchy.test.ts
# Expected: HierarchyNode is not defined
```

- [ ] **Step 3: Create hierarchy types file**

```typescript
// src/types/hierarchy.ts

export type NodeType = 'net' | 'text' | 'voice' | 'strike-group' | 'ship' | 'circuit'

export interface HierarchyNode {
  id: string              // Space or room ID
  name: string            // Display name
  type: NodeType          // Type of node
  children: HierarchyNode[] // Child nodes
  expanded?: boolean      // For UI: is this node expanded in sidebar?
  priority?: number       // For nets: sort priority
  isBroadcast?: boolean   // For nets: is this a broadcast net (1MC, Fleet All-Hands)?
}

// Flattened representation of a channel for sidebar rendering
// (used after hierarchy has been flattened per user's role/permissions)
export interface FlatChannel {
  id: string              // Room ID
  name: string            // Channel name
  type: 'text' | 'voice'  // Channel type
  parentNetId: string     // Parent net Space ID
  indentLevel: number     // Nesting depth for visual indent (0 = top level, 1 = under net, etc.)
  parentName?: string     // Parent net name (for breadcrumb context)
  isBroadcast?: boolean   // Broadcast net marker
}

// For Lounge sidebar
export interface LoungeSidebarState {
  ships: HierarchyNode[]           // Ships section
  yourNets: HierarchyNode[]        // Your Nets section (with monitored net bubbled to top)
  availableToJoin: HierarchyNode[] // Available to Join section
  monitoredNetId?: string          // Currently monitored net ID (bubbles to top)
}

// For Operations sidebar
export interface OperationSidebarState {
  broadcastNets: HierarchyNode[]     // Fleet All-Hands, 1MC, etc.
  admiralsNet?: HierarchyNode        // Admirals/Command net if exists
  strikeGroups: HierarchyNode[]      // Strike Group hierarchy (with ships and circuits nested)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/types/hierarchy.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/types/hierarchy.ts src/types/hierarchy.test.ts
git commit -m "feat: add hierarchy node types for sidebar rendering"
```

---

### Task 4: Create Channel Service (Matrix Space Queries)

**Files:**
- Create: `src/services/channelService.ts`
- Test: `src/services/channelService.test.ts`

- [ ] **Step 1: Write failing test for fetching channels under a net**

```typescript
// src/services/channelService.test.ts
import { channelService } from './channelService'
import { ChannelType } from '../types/channel'

test('getChannelsInNet fetches text and voice channels under a Space', async () => {
  const mockMatrixClient = {
    getRoomHierarchy: jest.fn().mockResolvedValue({
      rooms: [
        {
          room_id: 'ch1',
          name: 'general',
          topic: 'General discussion',
          state: [
            { type: 'org.hailfreq.channel.type', content: { value: 'text' } }
          ]
        },
        {
          room_id: 'ch2',
          name: 'voice',
          state: [
            { type: 'org.hailfreq.channel.type', content: { value: 'voice' } }
          ]
        }
      ]
    })
  }

  const channels = await channelService.getChannelsInNet(
    mockMatrixClient,
    'net1'
  )
  
  expect(channels.length).toBe(2)
  expect(channels[0].type).toBe(ChannelType.TEXT)
  expect(channels[1].type).toBe(ChannelType.VOICE)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/services/channelService.test.ts
# Expected: channelService is not defined
```

- [ ] **Step 3: Create channel service**

```typescript
// src/services/channelService.ts
import { MatrixClient, Room } from 'matrix-js-sdk'
import { Channel, ChannelType, TextChannel, VoiceChannel } from '../types/channel'

interface ChannelServiceAPI {
  getChannelsInNet(client: MatrixClient, netId: string): Promise<Channel[]>
  createTextChannel(
    client: MatrixClient,
    netId: string,
    name: string,
    topic?: string
  ): Promise<TextChannel>
  createVoiceChannel(
    client: MatrixClient,
    netId: string,
    name: string
  ): Promise<VoiceChannel>
  getChannelType(room: Room): ChannelType | null
}

const getChannelType = (room: Room): ChannelType | null => {
  const stateEvent = room.currentState.getStateEvents(
    'org.hailfreq.channel.type'
  )[0]

  if (!stateEvent) return null

  const channelType = stateEvent.getContent()?.value
  return channelType === 'text' ? ChannelType.TEXT : 
         channelType === 'voice' ? ChannelType.VOICE : null
}

const getChannelsInNet = async (
  client: MatrixClient,
  netId: string
): Promise<Channel[]> => {
  try {
    const hierarchy = await client.getRoomHierarchy(netId)
    
    const channels: Channel[] = hierarchy.rooms
      .filter((room: any) => {
        // Skip the parent Space itself
        return room.room_id !== netId
      })
      .map((room: any) => {
        // Determine channel type from state event
        const channelTypeEvent = room.state?.find(
          (e: any) => e.type === 'org.hailfreq.channel.type'
        )
        const channelType = channelTypeEvent?.content?.value === 'text'
          ? ChannelType.TEXT
          : ChannelType.VOICE

        return {
          id: room.room_id,
          name: room.name || 'Unnamed',
          type: channelType,
          netId,
          topic: room.topic,
          encrypted: room.encryption !== undefined,
          createdAt: new Date(room.created_ts),
          updatedAt: new Date(room.updated_ts || room.created_ts),
          ...(channelType === ChannelType.TEXT && {
            messageCount: 0 // Will be fetched separately if needed
          }),
          ...(channelType === ChannelType.VOICE && {
            connectedMembers: room.join_members?.map((m: any) => m.user_id) || []
          })
        }
      })

    return channels
  } catch (error) {
    console.error(`Failed to fetch channels for net ${netId}:`, error)
    return []
  }
}

const createTextChannel = async (
  client: MatrixClient,
  netId: string,
  name: string,
  topic?: string
): Promise<TextChannel> => {
  const roomOptions = {
    name,
    topic,
    preset: 'private_chat',
    is_direct: false,
    encryption: { algorithm: 'm.megolm.v1.aes-sha2' },
    initial_state: [
      {
        type: 'org.hailfreq.channel.type',
        state_key: '',
        content: { value: 'text' }
      }
    ]
  }

  const room = await client.createRoom(roomOptions)
  
  // Add room as child of Space
  await client.sendStateEvent(
    netId,
    'm.space.child',
    room.room_id,
    { via: [client.getDomain()] }
  )

  return {
    id: room.room_id,
    name,
    type: ChannelType.TEXT,
    netId,
    topic,
    encrypted: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    messageCount: 0
  }
}

const createVoiceChannel = async (
  client: MatrixClient,
  netId: string,
  name: string
): Promise<VoiceChannel> => {
  const roomOptions = {
    name,
    preset: 'private_chat',
    is_direct: false,
    encryption: { algorithm: 'm.megolm.v1.aes-sha2' },
    initial_state: [
      {
        type: 'org.hailfreq.channel.type',
        state_key: '',
        content: { value: 'voice' }
      }
    ]
  }

  const room = await client.createRoom(roomOptions)

  // Add room as child of Space
  await client.sendStateEvent(
    netId,
    'm.space.child',
    room.room_id,
    { via: [client.getDomain()] }
  )

  return {
    id: room.room_id,
    name,
    type: ChannelType.VOICE,
    netId,
    encrypted: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    connectedMembers: []
  }
}

export const channelService: ChannelServiceAPI = {
  getChannelsInNet,
  createTextChannel,
  createVoiceChannel,
  getChannelType
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/services/channelService.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/services/channelService.ts src/services/channelService.test.ts
git commit -m "feat: add channel service for Matrix Space queries"
```

---

### Task 5: Create Operation Service

**Files:**
- Create: `src/services/operationService.ts`
- Test: `src/services/operationService.test.ts`

- [ ] **Step 1: Write failing test for creating an operation**

```typescript
// src/services/operationService.test.ts
import { operationService } from './operationService'
import { OperationState } from '../types/operation'

test('createOperation creates a Space with operation metadata', async () => {
  const mockMatrixClient = {
    createRoom: jest.fn().mockResolvedValue({ room_id: 'op1' }),
    sendStateEvent: jest.fn().mockResolvedValue({})
  }

  const op = await operationService.createOperation(
    mockMatrixClient,
    'NIGHTFALL',
    'Strike deep into contested space',
    new Date('2026-06-15T20:00:00Z')
  )

  expect(op.id).toBe('op1')
  expect(op.name).toBe('NIGHTFALL')
  expect(op.state).toBe(OperationState.PLANNING)
  expect(mockMatrixClient.createRoom).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/services/operationService.test.ts
# Expected: operationService is not defined
```

- [ ] **Step 3: Create operation service**

```typescript
// src/services/operationService.ts
import { MatrixClient } from 'matrix-js-sdk'
import { Operation, OperationState, Roster, RosterEntry } from '../types/operation'

interface OperationServiceAPI {
  createOperation(
    client: MatrixClient,
    name: string,
    description: string,
    scheduledStart?: Date
  ): Promise<Operation>
  getOperation(client: MatrixClient, operationId: string): Promise<Operation>
  getAllOperations(client: MatrixClient, userId: string): Promise<Operation[]>
  updateOperationState(
    client: MatrixClient,
    operationId: string,
    newState: OperationState
  ): Promise<void>
  getRoster(client: MatrixClient, operationId: string): Promise<Roster>
  addRosterEntry(
    client: MatrixClient,
    operationId: string,
    entry: RosterEntry
  ): Promise<void>
  updateRosterEntry(
    client: MatrixClient,
    operationId: string,
    userId: string,
    updates: Partial<RosterEntry>
  ): Promise<void>
}

const createOperation = async (
  client: MatrixClient,
  name: string,
  description: string,
  scheduledStart?: Date
): Promise<Operation> => {
  const commanderId = client.getUserId()

  const roomOptions = {
    name,
    preset: 'private_chat',
    is_direct: false,
    encryption: { algorithm: 'm.megolm.v1.aes-sha2' },
    initial_state: [
      {
        type: 'org.hailfreq.operation',
        state_key: '',
        content: {
          name,
          description,
          state: OperationState.PLANNING,
          commanderId,
          scheduledStart: scheduledStart?.toISOString(),
          createdAt: new Date().toISOString()
        }
      }
    ]
  }

  const room = await client.createRoom(roomOptions)

  return {
    id: room.room_id,
    name,
    description,
    state: OperationState.PLANNING,
    commanderId,
    scheduledStart,
    createdAt: new Date(),
    updatedAt: new Date()
  }
}

const getOperation = async (
  client: MatrixClient,
  operationId: string
): Promise<Operation> => {
  const room = client.getRoom(operationId)
  if (!room) {
    throw new Error(`Operation ${operationId} not found`)
  }

  const opEvent = room.currentState.getStateEvents('org.hailfreq.operation')[0]
  const opContent = opEvent?.getContent() || {}

  return {
    id: operationId,
    name: opContent.name || '',
    description: opContent.description || '',
    state: opContent.state || OperationState.PLANNING,
    commanderId: opContent.commanderId || '',
    scheduledStart: opContent.scheduledStart ? new Date(opContent.scheduledStart) : undefined,
    actualStart: opContent.actualStart ? new Date(opContent.actualStart) : undefined,
    actualEnd: opContent.actualEnd ? new Date(opContent.actualEnd) : undefined,
    createdAt: opContent.createdAt ? new Date(opContent.createdAt) : new Date(),
    updatedAt: new Date()
  }
}

const getAllOperations = async (
  client: MatrixClient,
  userId: string
): Promise<Operation[]> => {
  const spaces = client.getRooms()
    .filter(room => {
      const opEvent = room.currentState.getStateEvents('org.hailfreq.operation')[0]
      return opEvent !== undefined
    })

  return Promise.all(
    spaces.map(space => getOperation(client, space.roomId))
  )
}

const updateOperationState = async (
  client: MatrixClient,
  operationId: string,
  newState: OperationState
): Promise<void> => {
  const op = await getOperation(client, operationId)

  const content = {
    ...op,
    state: newState,
    ...(newState === OperationState.ACTIVE && {
      actualStart: new Date().toISOString()
    }),
    ...(newState === OperationState.COMPLETED && {
      actualEnd: new Date().toISOString()
    })
  }

  await client.sendStateEvent(
    operationId,
    'org.hailfreq.operation',
    '',
    content
  )
}

const getRoster = async (
  client: MatrixClient,
  operationId: string
): Promise<Roster> => {
  const room = client.getRoom(operationId)
  if (!room) {
    throw new Error(`Operation ${operationId} not found`)
  }

  const rosterEvent = room.currentState.getStateEvents('org.hailfreq.roster')[0]
  const rosterContent = rosterEvent?.getContent() || { entries: [] }

  return {
    operationId,
    entries: rosterContent.entries || []
  }
}

const addRosterEntry = async (
  client: MatrixClient,
  operationId: string,
  entry: RosterEntry
): Promise<void> => {
  const roster = await getRoster(client, operationId)
  roster.entries.push(entry)

  await client.sendStateEvent(
    operationId,
    'org.hailfreq.roster',
    '',
    { entries: roster.entries }
  )
}

const updateRosterEntry = async (
  client: MatrixClient,
  operationId: string,
  userId: string,
  updates: Partial<RosterEntry>
): Promise<void> => {
  const roster = await getRoster(client, operationId)
  const entryIndex = roster.entries.findIndex(e => e.userId === userId)

  if (entryIndex === -1) {
    throw new Error(`User ${userId} not in roster`)
  }

  roster.entries[entryIndex] = {
    ...roster.entries[entryIndex],
    ...updates
  }

  await client.sendStateEvent(
    operationId,
    'org.hailfreq.roster',
    '',
    { entries: roster.entries }
  )
}

export const operationService: OperationServiceAPI = {
  createOperation,
  getOperation,
  getAllOperations,
  updateOperationState,
  getRoster,
  addRosterEntry,
  updateRosterEntry
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/services/operationService.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/services/operationService.ts src/services/operationService.test.ts
git commit -m "feat: add operation service for CRUD and lifecycle"
```

---

## Phase 2: Sidebar Components & Channel Selection

### Task 6: Create Sidebar Base Component

**Files:**
- Modify: `src/components/Sidebar/index.tsx` (create if doesn't exist)
- Create: `src/components/Sidebar/LoungeSidebar.tsx`
- Create: `src/components/Sidebar/OperationsSidebar.tsx`
- Test: `src/components/Sidebar/index.test.tsx`

- [ ] **Step 1: Write failing test for sidebar mode routing**

```typescript
// src/components/Sidebar/index.test.tsx
import { render, screen } from '@testing-library/react'
import { Sidebar } from './index'

test('Sidebar renders LoungeSidebar when mode is lounge', () => {
  render(<Sidebar mode="lounge" selectedChannelId="ch1" />)
  expect(screen.getByTestId('lounge-sidebar')).toBeInTheDocument()
})

test('Sidebar renders OperationsSidebar when mode is operations', () => {
  render(
    <Sidebar mode="operations" operationId="op1" selectedChannelId="ch1" />
  )
  expect(screen.getByTestId('operations-sidebar')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/components/Sidebar/index.test.tsx
# Expected: Sidebar is not defined
```

- [ ] **Step 3: Create sidebar wrapper component**

```typescript
// src/components/Sidebar/index.tsx
import React, { useMemo } from 'react'
import { LoungeSidebar } from './LoungeSidebar'
import { OperationsSidebar } from './OperationsSidebar'

interface SidebarProps {
  mode: 'lounge' | 'operations'
  operationId?: string
  selectedChannelId: string
  onSelectChannel: (channelId: string) => void
  width: number
  onResizeWidth: (newWidth: number) => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  mode,
  operationId,
  selectedChannelId,
  onSelectChannel,
  width,
  onResizeWidth
}) => {
  return (
    <div
      style={{
        width: `${width}px`,
        background: '#2c2f33',
        borderRight: '1px solid #202225',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {mode === 'lounge' ? (
        <LoungeSidebar
          selectedChannelId={selectedChannelId}
          onSelectChannel={onSelectChannel}
        />
      ) : (
        <OperationsSidebar
          operationId={operationId!}
          selectedChannelId={selectedChannelId}
          onSelectChannel={onSelectChannel}
        />
      )}

      {/* Resize handle */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '4px',
          background: '#1a1a1d',
          cursor: 'col-resize',
          opacity: 0.5
        }}
        onMouseDown={(e) => {
          const startX = e.clientX
          const startWidth = width

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX
            onResizeWidth(Math.max(200, startWidth + delta))
          }

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
          }

          document.addEventListener('mousemove', handleMouseMove)
          document.addEventListener('mouseup', handleMouseUp)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Create LoungeSidebar stub**

```typescript
// src/components/Sidebar/LoungeSidebar.tsx
import React from 'react'

interface LoungeSidebarProps {
  selectedChannelId: string
  onSelectChannel: (channelId: string) => void
}

export const LoungeSidebar: React.FC<LoungeSidebarProps> = ({
  selectedChannelId,
  onSelectChannel
}) => {
  return (
    <div data-testid="lounge-sidebar" style={{ flex: 1, overflow: 'auto' }}>
      {/* To be implemented in Task 7 */}
    </div>
  )
}
```

- [ ] **Step 5: Create OperationsSidebar stub**

```typescript
// src/components/Sidebar/OperationsSidebar.tsx
import React from 'react'

interface OperationsSidebarProps {
  operationId: string
  selectedChannelId: string
  onSelectChannel: (channelId: string) => void
}

export const OperationsSidebar: React.FC<OperationsSidebarProps> = ({
  operationId,
  selectedChannelId,
  onSelectChannel
}) => {
  return (
    <div data-testid="operations-sidebar" style={{ flex: 1, overflow: 'auto' }}>
      {/* To be implemented in Task 8 */}
    </div>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm test -- src/components/Sidebar/index.test.tsx
# Expected: PASS
```

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar/index.tsx \
        src/components/Sidebar/LoungeSidebar.tsx \
        src/components/Sidebar/OperationsSidebar.tsx \
        src/components/Sidebar/index.test.tsx
git commit -m "feat: add sidebar component with mode routing"
```

---

### Task 7: Implement Text Channel Rendering Component

**Files:**
- Create: `src/components/Sidebar/ChannelList.tsx`
- Test: `src/components/Sidebar/ChannelList.test.tsx`

- [ ] **Step 1: Write failing test for channel list with text/voice indicators**

```typescript
// src/components/Sidebar/ChannelList.test.tsx
import { render, screen } from '@testing-library/react'
import { ChannelList } from './ChannelList'
import { HierarchyNode } from '../../types/hierarchy'
import { ChannelType } from '../../types/channel'

test('ChannelList renders text channels with # icon and voice channels with 🎤', () => {
  const nodes: HierarchyNode[] = [
    {
      id: 'net1',
      name: 'Command Net',
      type: 'net',
      children: [
        {
          id: 'ch1',
          name: 'general',
          type: 'text',
          children: []
        },
        {
          id: 'ch2',
          name: 'voice',
          type: 'voice',
          children: []
        }
      ]
    }
  ]

  render(
    <ChannelList nodes={nodes} selectedChannelId="ch1" onSelectChannel={() => {}} />
  )

  expect(screen.getByText('# general')).toBeInTheDocument()
  expect(screen.getByText('🎤 voice')).toBeInTheDocument()
})

test('ChannelList expands/collapses net when clicking expand arrow', async () => {
  const nodes: HierarchyNode[] = [
    {
      id: 'net1',
      name: 'Command Net',
      type: 'net',
      children: [
        {
          id: 'ch1',
          name: 'general',
          type: 'text',
          children: []
        }
      ],
      expanded: false
    }
  ]

  const { rerender } = render(
    <ChannelList nodes={nodes} selectedChannelId="ch1" onSelectChannel={() => {}} />
  )

  // Click expand arrow
  const expandBtn = screen.getByRole('button', { name: '▶' })
  expandBtn.click()

  // Rerender with expanded: true
  const updatedNodes = [{
    ...nodes[0],
    expanded: true
  }]
  rerender(
    <ChannelList nodes={updatedNodes} selectedChannelId="ch1" onSelectChannel={() => {}} />
  )

  expect(screen.getByText('# general')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/components/Sidebar/ChannelList.test.tsx
# Expected: ChannelList is not defined
```

- [ ] **Step 3: Create channel list component**

```typescript
// src/components/Sidebar/ChannelList.tsx
import React, { useState } from 'react'
import { HierarchyNode } from '../../types/hierarchy'

interface ChannelListProps {
  nodes: HierarchyNode[]
  selectedChannelId: string
  onSelectChannel: (channelId: string) => void
  indentLevel?: number
  expandedNodes?: Set<string>
  onToggleExpand?: (nodeId: string) => void
}

export const ChannelList: React.FC<ChannelListProps> = ({
  nodes,
  selectedChannelId,
  onSelectChannel,
  indentLevel = 0,
  expandedNodes = new Set(),
  onToggleExpand = () => {}
}) => {
  const renderNode = (node: HierarchyNode) => {
    const isExpanded = expandedNodes.has(node.id)
    const hasChildren = node.children.length > 0
    const isSelected = selectedChannelId === node.id

    // Determine icon based on type
    let icon = ''
    if (node.type === 'text') icon = '#'
    else if (node.type === 'voice') icon = '🎤'
    else if (node.type === 'net') icon = ''
    else if (node.type === 'strike-group') icon = ''
    else if (node.type === 'ship') icon = '🚢'
    else if (node.type === 'circuit') icon = ''

    return (
      <div key={node.id}>
        {/* Node item */}
        <div
          style={{
            paddingLeft: `${indentLevel * 12}px`,
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: isSelected ? '#3e4147' : 'transparent',
            color: '#fff',
            fontSize: '12px',
            cursor: 'pointer',
            userSelect: 'none',
            borderRadius: '3px'
          }}
          onClick={() => {
            if (node.type === 'text' || node.type === 'voice' || node.type === 'circuit') {
              onSelectChannel(node.id)
            }
          }}
        >
          {/* Expand/collapse arrow */}
          {hasChildren && (
            <button
              style={{
                background: 'none',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                padding: 0,
                width: '16px',
                textAlign: 'center',
                fontSize: '10px'
              }}
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand(node.id)
              }}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          {!hasChildren && <span style={{ width: '16px' }}></span>}

          {/* Icon + name */}
          {icon && <span>{icon}</span>}
          <span style={{ flex: 1 }}>{node.name}</span>

          {/* Broadcast badge */}
          {node.isBroadcast && (
            <span
              style={{
                fontSize: '10px',
                background: '#faa61a',
                color: '#000',
                padding: '2px 4px',
                borderRadius: '2px',
                marginLeft: '4px'
              }}
            >
              P{Math.floor(Math.random() * 100)}
            </span>
          )}
        </div>

        {/* Children */}
        {isExpanded && hasChildren && (
          <ChannelList
            nodes={node.children}
            selectedChannelId={selectedChannelId}
            onSelectChannel={onSelectChannel}
            indentLevel={indentLevel + 1}
            expandedNodes={expandedNodes}
            onToggleExpand={onToggleExpand}
          />
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {nodes.map(renderNode)}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/components/Sidebar/ChannelList.test.tsx
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar/ChannelList.tsx src/components/Sidebar/ChannelList.test.tsx
git commit -m "feat: add channel list component with expand/collapse"
```

---

### Task 8: Create Text Channel View Component

**Files:**
- Create: `src/components/MainPanel/TextChannelView.tsx`
- Test: `src/components/MainPanel/TextChannelView.test.tsx`

- [ ] **Step 1: Write failing test for rendering messages**

```typescript
// src/components/MainPanel/TextChannelView.test.tsx
import { render, screen } from '@testing-library/react'
import { TextChannelView } from './TextChannelView'

test('TextChannelView renders message history', () => {
  const messages = [
    {
      eventId: 'm1',
      sender: 'user1',
      senderName: 'Alice',
      content: 'Hello team',
      timestamp: new Date('2026-06-12T14:00:00Z'),
      type: 'message'
    },
    {
      eventId: 'm2',
      sender: 'user2',
      senderName: 'Bob',
      content: 'Hi Alice',
      timestamp: new Date('2026-06-12T14:01:00Z'),
      type: 'message'
    }
  ]

  render(
    <TextChannelView
      channelName="general"
      netName="Command Net"
      messages={messages}
      onSendMessage={() => {}}
    />
  )

  expect(screen.getByText('Hello team')).toBeInTheDocument()
  expect(screen.getByText('Hi Alice')).toBeInTheDocument()
  expect(screen.getByText('Alice')).toBeInTheDocument()
  expect(screen.getByText('Bob')).toBeInTheDocument()
})

test('TextChannelView shows placeholder when no messages', () => {
  render(
    <TextChannelView
      channelName="general"
      netName="Command Net"
      messages={[]}
      onSendMessage={() => {}}
    />
  )

  expect(screen.getByText(/No messages yet/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/components/MainPanel/TextChannelView.test.tsx
# Expected: TextChannelView is not defined
```

- [ ] **Step 3: Create text channel view component**

```typescript
// src/components/MainPanel/TextChannelView.tsx
import React, { useState } from 'react'

interface Message {
  eventId: string
  sender: string
  senderName: string
  content: string
  timestamp: Date
  type: 'message' | 'state'
  role?: string // e.g., "[Captain]"
}

interface TextChannelViewProps {
  channelName: string
  netName: string
  messages: Message[]
  onSendMessage: (content: string) => Promise<void>
  isLoading?: boolean
}

export const TextChannelView: React.FC<TextChannelViewProps> = ({
  channelName,
  netName,
  messages,
  onSendMessage,
  isLoading = false
}) => {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!input.trim() || sending) return

    setSending(true)
    try {
      await onSendMessage(input)
      setInput('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          padding: '12px',
          borderBottom: '1px solid #202225',
          flexShrink: 0
        }}
      >
        <div style={{ fontWeight: 'bold', fontSize: '13px' }}>
          # {channelName}
        </div>
        <div style={{ fontSize: '10px', opacity: 0.7 }}>
          📢 {netName} · Text discussion
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>
            No messages yet. Be the first to say something.
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.eventId}
              style={{
                background: '#2c2f33',
                padding: '10px',
                borderRadius: '4px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <div style={{ fontWeight: 'bold', fontSize: '11px' }}>
                  {msg.senderName}
                </div>
                {msg.role && (
                  <div style={{ fontSize: '9px', opacity: 0.6 }}>
                    {msg.role}
                  </div>
                )}
              </div>
              <div style={{ fontSize: '11px', opacity: 0.9, marginTop: '4px' }}>
                {msg.content}
              </div>
              <div style={{ fontSize: '9px', opacity: 0.5, marginTop: '4px' }}>
                {msg.timestamp.toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div
        style={{
          padding: '12px',
          borderTop: '1px solid #202225',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder={`Send a message to #${channelName}...`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            style={{
              flex: 1,
              background: '#2c2f33',
              border: '1px solid #202225',
              padding: '10px',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '11px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            style={{
              background: '#5865f2',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '4px',
              color: '#fff',
              cursor: sending ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              opacity: !input.trim() || sending ? 0.5 : 1
            }}
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/components/MainPanel/TextChannelView.test.tsx
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/TextChannelView.tsx \
        src/components/MainPanel/TextChannelView.test.tsx
git commit -m "feat: add text channel view with message history and input"
```

---

## Phase 3: Operation Management UI

### Task 9: Create Operation Creation Dialog

**Files:**
- Create: `src/components/Operations/CreateOperationDialog.tsx`
- Test: `src/components/Operations/CreateOperationDialog.test.tsx`

- [ ] **Step 1: Write failing test for operation creation form**

```typescript
// src/components/Operations/CreateOperationDialog.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateOperationDialog } from './CreateOperationDialog'

test('CreateOperationDialog submits form with operation details', async () => {
  const onSubmit = jest.fn()

  render(
    <CreateOperationDialog isOpen={true} onClose={() => {}} onSubmit={onSubmit} />
  )

  fireEvent.change(screen.getByLabelText(/Operation Name/i), {
    target: { value: 'NIGHTFALL' }
  })
  fireEvent.change(screen.getByLabelText(/Description/i), {
    target: { value: 'Strike mission' }
  })

  fireEvent.click(screen.getByRole('button', { name: /Create Operation/i }))

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'NIGHTFALL',
      description: 'Strike mission',
      scheduledStart: expect.any(Date)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/components/Operations/CreateOperationDialog.test.tsx
# Expected: CreateOperationDialog is not defined
```

- [ ] **Step 3: Create dialog component**

```typescript
// src/components/Operations/CreateOperationDialog.tsx
import React, { useState } from 'react'

interface CreateOperationDialogProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: {
    name: string
    description: string
    scheduledStart?: Date
  }) => Promise<void>
}

export const CreateOperationDialog: React.FC<CreateOperationDialogProps> = ({
  isOpen,
  onClose,
  onSubmit
}) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scheduledStart, setScheduledStart] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!isOpen) return null

  const handleSubmit = async () => {
    if (!name.trim() || !description.trim()) return

    setSubmitting(true)
    try {
      await onSubmit({
        name,
        description,
        scheduledStart: scheduledStart ? new Date(scheduledStart) : undefined
      })
      // Reset form
      setName('')
      setDescription('')
      setScheduledStart('')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#313338',
          border: '1px solid #5865f2',
          borderRadius: '8px',
          padding: '20px',
          maxWidth: '500px',
          width: '90%',
          color: '#fff'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '16px' }}>
          Create New Operation
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', opacity: 0.7, marginBottom: '6px', textTransform: 'uppercase' }}>
            Operation Name
          </label>
          <input
            type="text"
            placeholder="e.g., NIGHTFALL, OPERATIONS-DELTA"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: '100%',
              background: '#2c2f33',
              border: '1px solid #202225',
              padding: '10px',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '11px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', opacity: 0.7, marginBottom: '6px', textTransform: 'uppercase' }}>
            Scheduled Start (Optional)
          </label>
          <input
            type="datetime-local"
            value={scheduledStart}
            onChange={(e) => setScheduledStart(e.target.value)}
            style={{
              width: '100%',
              background: '#2c2f33',
              border: '1px solid #202225',
              padding: '10px',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '11px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '11px', opacity: 0.7, marginBottom: '6px', textTransform: 'uppercase' }}>
            Description
          </label>
          <textarea
            placeholder="Brief op summary. Goals, scale, duration..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{
              width: '100%',
              background: '#2c2f33',
              border: '1px solid #202225',
              padding: '10px',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '11px',
              boxSizing: 'border-box',
              minHeight: '80px',
              fontFamily: 'inherit'
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: '#3e4147',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '11px'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !description.trim() || submitting}
            style={{
              background: '#5865f2',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '4px',
              color: '#fff',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              fontWeight: 'bold',
              opacity: (!name.trim() || !description.trim() || submitting) ? 0.5 : 1
            }}
          >
            {submitting ? 'Creating...' : 'Create Operation'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/components/Operations/CreateOperationDialog.test.tsx
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Operations/CreateOperationDialog.tsx \
        src/components/Operations/CreateOperationDialog.test.tsx
git commit -m "feat: add operation creation dialog"
```

---

### Task 10: Create Invitation Modal

**Files:**
- Create: `src/components/Operations/InviteModal.tsx`
- Test: `src/components/Operations/InviteModal.test.tsx`

- [ ] **Step 1: Write failing test for invite search and selection**

```typescript
// src/components/Operations/InviteModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { InviteModal } from './InviteModal'

test('InviteModal searches server members by name', () => {
  const serverMembers = [
    { userId: 'u1', name: 'Alice Chen', role: 'Pilot' },
    { userId: 'u2', name: 'Bob Smith', role: 'Engineer' },
    { userId: 'u3', name: 'Jordan Lee', role: 'Comms' }
  ]

  render(
    <InviteModal
      isOpen={true}
      operationName="NIGHTFALL"
      serverMembers={serverMembers}
      onClose={() => {}}
      onInvite={() => {}}
    />
  )

  const searchInput = screen.getByPlaceholderText(/Search by name/i)
  fireEvent.change(searchInput, { target: { value: 'Alice' } })

  expect(screen.getByText('Alice Chen')).toBeInTheDocument()
  expect(screen.queryByText('Bob Smith')).not.toBeInTheDocument()
})

test('InviteModal calls onInvite with selected members', () => {
  const onInvite = jest.fn()
  const serverMembers = [
    { userId: 'u1', name: 'Alice', role: 'Pilot' },
    { userId: 'u2', name: 'Bob', role: 'Engineer' }
  ]

  render(
    <InviteModal
      isOpen={true}
      operationName="NIGHTFALL"
      serverMembers={serverMembers}
      onClose={() => {}}
      onInvite={onInvite}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: /Add/ }))
  fireEvent.click(screen.getByRole('button', { name: /Done/i }))

  expect(onInvite).toHaveBeenCalledWith(expect.arrayContaining(['u1']))
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/components/Operations/InviteModal.test.tsx
# Expected: InviteModal is not defined
```

- [ ] **Step 3: Create invite modal component**

```typescript
// src/components/Operations/InviteModal.tsx
import React, { useState, useMemo } from 'react'

interface ServerMember {
  userId: string
  name: string
  role: string
}

interface InviteModalProps {
  isOpen: boolean
  operationName: string
  serverMembers: ServerMember[]
  onClose: () => void
  onInvite: (userIds: string[]) => Promise<void>
  alreadyInvited?: Set<string>
}

export const InviteModal: React.FC<InviteModalProps> = ({
  isOpen,
  operationName,
  serverMembers,
  onClose,
  onInvite,
  alreadyInvited = new Set()
}) => {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const filtered = useMemo(() => {
    return serverMembers.filter((member) => {
      const query = search.toLowerCase()
      return (
        member.name.toLowerCase().includes(query) ||
        member.userId.toLowerCase().includes(query)
      )
    })
  }, [serverMembers, search])

  const handleToggle = (userId: string) => {
    const newSelected = new Set(selected)
    if (newSelected.has(userId)) {
      newSelected.delete(userId)
    } else {
      newSelected.add(userId)
    }
    setSelected(newSelected)
  }

  const handleSubmit = async () => {
    if (selected.size === 0) return

    setSubmitting(true)
    try {
      await onInvite(Array.from(selected))
      setSelected(new Set())
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#313338',
          border: '1px solid #5865f2',
          borderRadius: '8px',
          padding: '20px',
          maxWidth: '500px',
          width: '90%',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '80vh'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '16px' }}>
          Invite Members to Operation {operationName}
        </div>

        {/* Search */}
        <div style={{ marginBottom: '12px' }}>
          <input
            type="text"
            placeholder="Search by name or @mention..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              background: '#2c2f33',
              border: '1px solid #202225',
              padding: '10px',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '11px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* Member list */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid #202225',
            borderRadius: '4px',
            background: '#2c2f33',
            marginBottom: '16px'
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>
              No members found
            </div>
          ) : (
            filtered.map((member) => {
              const isAlreadyInvited = alreadyInvited.has(member.userId)
              const isSelected = selected.has(member.userId)

              return (
                <div
                  key={member.userId}
                  style={{
                    padding: '10px',
                    borderBottom: '1px solid #1a1a1d',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    opacity: isAlreadyInvited ? 0.5 : 1
                  }}
                >
                  <div>
                    <div style={{ fontSize: '10px', fontWeight: 'bold' }}>
                      {member.name}
                    </div>
                    <div style={{ fontSize: '9px', opacity: 0.7 }}>
                      @{member.userId} · {member.role}
                    </div>
                  </div>

                  {isAlreadyInvited ? (
                    <span style={{ fontSize: '10px', opacity: 0.7 }}>
                      ✓ Assigned
                    </span>
                  ) : (
                    <button
                      onClick={() => handleToggle(member.userId)}
                      style={{
                        background: isSelected ? '#5865f2' : '#5865f2',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: '3px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '9px',
                        fontWeight: 'bold',
                        opacity: isSelected ? 1 : 1
                      }}
                    >
                      {isSelected ? '✓ Selected' : '＋ Add'}
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: '#3e4147',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '11px'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={selected.size === 0 || submitting}
            style={{
              background: '#5865f2',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '4px',
              color: '#fff',
              cursor: submitting || selected.size === 0 ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              fontWeight: 'bold',
              opacity: (submitting || selected.size === 0) ? 0.5 : 1
            }}
          >
            {submitting ? 'Inviting...' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/components/Operations/InviteModal.test.tsx
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Operations/InviteModal.tsx \
        src/components/Operations/InviteModal.test.tsx
git commit -m "feat: add invite modal with member search"
```

---

## Phase 4: Auto-Placement & State Management

### Task 11: Create Auto-Placement Webhook Handler

**Files:**
- Create: `src/webhooks/operationStateChange.ts`
- Test: `src/webhooks/operationStateChange.test.ts`

- [ ] **Step 1: Write failing test for auto-placement on ACTIVE transition**

```typescript
// src/webhooks/operationStateChange.test.ts
import { handleOperationStateChange } from './operationStateChange'
import { OperationState } from '../types/operation'

test('handleOperationStateChange auto-joins users to assigned channels when transitioning to ACTIVE', async () => {
  const mockMatrixClient = {
    joinRoom: jest.fn().mockResolvedValue({}),
    getRoomById: jest.fn().mockReturnValue({
      getJoinedMembers: jest.fn().mockReturnValue([
        { userId: 'u1', name: 'Alice' }
      ])
    })
  }

  const webhookData = {
    operationId: 'op1',
    newState: OperationState.ACTIVE,
    roster: [
      {
        userId: 'u1',
        userName: 'Alice',
        strikeGroupId: 'sg1',
        shipId: 'ship1',
        circuitId: 'ch1',
        role: 'Helm Operator',
        status: 'assigned' as const
      }
    ]
  }

  await handleOperationStateChange(mockMatrixClient, webhookData)

  expect(mockMatrixClient.joinRoom).toHaveBeenCalledWith('ch1')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/webhooks/operationStateChange.test.ts
# Expected: handleOperationStateChange is not defined
```

- [ ] **Step 3: Create webhook handler**

```typescript
// src/webhooks/operationStateChange.ts
import { MatrixClient } from 'matrix-js-sdk'
import { OperationState, RosterEntry } from '../types/operation'

interface OperationStateChangeWebhook {
  operationId: string
  newState: OperationState
  roster: RosterEntry[]
}

export const handleOperationStateChange = async (
  client: MatrixClient,
  data: OperationStateChangeWebhook
): Promise<void> => {
  const { operationId, newState, roster } = data

  if (newState === OperationState.ACTIVE) {
    // Auto-join all crew members to their assigned channels
    const userChannelMap = new Map<string, Set<string>>()

    for (const entry of roster) {
      if (entry.status === 'assigned' || entry.status === 'joined') {
        if (!userChannelMap.has(entry.userId)) {
          userChannelMap.set(entry.userId, new Set())
        }
        userChannelMap.get(entry.userId)!.add(entry.circuitId)
      }
    }

    // Join each user to their assigned channels
    for (const [userId, channelIds] of userChannelMap) {
      for (const channelId of channelIds) {
        try {
          await client.joinRoom(channelId)
        } catch (error) {
          console.error(
            `Failed to auto-join user ${userId} to channel ${channelId}:`,
            error
          )
        }
      }
    }
  }

  if (newState === OperationState.COMPLETED) {
    // Lock all channels to read-only
    // (This would require permissions/role changes, implementation depends on Matrix config)
    console.log(`Operation ${operationId} completed. Channels should be locked to read-only.`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/webhooks/operationStateChange.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/webhooks/operationStateChange.ts src/webhooks/operationStateChange.test.ts
git commit -m "feat: add webhook handler for operation state transitions"
```

---

### Task 12: Create Custom Hooks for State Management

**Files:**
- Create: `src/hooks/useSidebarState.ts`
- Create: `src/hooks/useOperations.ts`
- Test: `src/hooks/useSidebarState.test.ts`

- [ ] **Step 1: Write failing test for useSidebarState hook**

```typescript
// src/hooks/useSidebarState.test.ts
import { renderHook, act } from '@testing-library/react'
import { useSidebarState } from './useSidebarState'

test('useSidebarState tracks selected channel and sidebar width', () => {
  const { result } = renderHook(() => useSidebarState())

  expect(result.current.selectedChannelId).toBeNull()
  expect(result.current.sidebarWidth).toBe(240)

  act(() => {
    result.current.selectChannel('ch1')
  })

  expect(result.current.selectedChannelId).toBe('ch1')

  act(() => {
    result.current.setSidebarWidth(300)
  })

  expect(result.current.sidebarWidth).toBe(300)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/hooks/useSidebarState.test.ts
# Expected: useSidebarState is not defined
```

- [ ] **Step 3: Create hooks**

```typescript
// src/hooks/useSidebarState.ts
import { useState, useCallback } from 'react'

export const useSidebarState = () => {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  const selectChannel = useCallback((channelId: string) => {
    setSelectedChannelId(channelId)
  }, [])

  const toggleExpandNode = useCallback((nodeId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }, [expandedNodes])

  return {
    selectedChannelId,
    selectChannel,
    sidebarWidth,
    setSidebarWidth,
    expandedNodes,
    toggleExpandNode
  }
}

// src/hooks/useOperations.ts
import { useState, useEffect } from 'react'
import { MatrixClient } from 'matrix-js-sdk'
import { Operation } from '../types/operation'
import { operationService } from '../services/operationService'

export const useOperations = (client: MatrixClient | null) => {
  const [operations, setOperations] = useState<Operation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!client) return

    const fetchOperations = async () => {
      setLoading(true)
      try {
        const userId = client.getUserId()
        const ops = await operationService.getAllOperations(client, userId)
        setOperations(ops)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch operations')
      } finally {
        setLoading(false)
      }
    }

    fetchOperations()
  }, [client])

  return { operations, loading, error }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/hooks/useSidebarState.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSidebarState.ts src/hooks/useOperations.ts src/hooks/useSidebarState.test.ts
git commit -m "feat: add custom hooks for sidebar and operation state"
```

---

## Phase 5: Integration & Polish

### Task 13: Create Hierarchy Flattener Utility

**Files:**
- Create: `src/utils/hierarchyFlattener.ts`
- Test: `src/utils/hierarchyFlattener.test.ts`

- [ ] **Step 1: Write failing test for flattening Space hierarchy**

```typescript
// src/utils/hierarchyFlattener.test.ts
import { flattenHierarchy } from './hierarchyFlattener'
import { HierarchyNode, LoungeSidebarState } from '../types/hierarchy'

test('flattenHierarchy converts Space tree to Lounge sidebar structure', () => {
  const hierarchy: HierarchyNode[] = [
    {
      id: 'ship1',
      name: 'Idris',
      type: 'ship',
      children: [
        { id: 'ch1', name: 'general', type: 'text', children: [] },
        { id: 'ch2', name: 'voice', type: 'voice', children: [] }
      ]
    }
  ]

  const result = flattenHierarchy(hierarchy, 'lounge')

  expect(result.ships).toHaveLength(1)
  expect(result.ships[0].name).toBe('Idris')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/utils/hierarchyFlattener.test.ts
# Expected: flattenHierarchy is not defined
```

- [ ] **Step 3: Create flattener utility**

```typescript
// src/utils/hierarchyFlattener.ts
import { HierarchyNode, LoungeSidebarState, OperationSidebarState } from '../types/hierarchy'

export const flattenHierarchy = (
  nodes: HierarchyNode[],
  mode: 'lounge' | 'operations',
  monitoredNetId?: string
): LoungeSidebarState | OperationSidebarState => {
  if (mode === 'lounge') {
    return flattenForLounge(nodes, monitoredNetId)
  } else {
    return flattenForOperations(nodes)
  }
}

const flattenForLounge = (
  nodes: HierarchyNode[],
  monitoredNetId?: string
): LoungeSidebarState => {
  const ships: HierarchyNode[] = []
  const yourNets: HierarchyNode[] = []
  const availableToJoin: HierarchyNode[] = []

  for (const node of nodes) {
    if (node.type === 'ship') {
      ships.push(node)
    } else if (node.type === 'net') {
      if (node.isBroadcast) {
        // Broadcast nets don't go in sidebar sections
        continue
      }
      yourNets.push(node)
    }
  }

  // Bubble monitored net to top of yourNets
  if (monitoredNetId) {
    const monitoredIndex = yourNets.findIndex(n => n.id === monitoredNetId)
    if (monitoredIndex > 0) {
      const [monitored] = yourNets.splice(monitoredIndex, 1)
      yourNets.unshift(monitored)
    }
  }

  // Sort your nets by priority
  yourNets.sort((a, b) => (b.priority || 0) - (a.priority || 0))

  return { ships, yourNets, availableToJoin }
}

const flattenForOperations = (
  nodes: HierarchyNode[]
): OperationSidebarState => {
  const broadcastNets: HierarchyNode[] = []
  let admiralsNet: HierarchyNode | undefined
  const strikeGroups: HierarchyNode[] = []

  for (const node of nodes) {
    if (node.isBroadcast) {
      broadcastNets.push(node)
    } else if (node.type === 'net' && node.name.toLowerCase().includes('admiral')) {
      admiralsNet = node
    } else if (node.type === 'strike-group') {
      strikeGroups.push(node)
    }
  }

  return { broadcastNets, admiralsNet, strikeGroups }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/utils/hierarchyFlattener.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/hierarchyFlattener.ts src/utils/hierarchyFlattener.test.ts
git commit -m "feat: add hierarchy flattener for sidebar rendering"
```

---

### Task 14: Implement Lounge Sidebar

**Files:**
- Modify: `src/components/Sidebar/LoungeSidebar.tsx`
- Test: `src/components/Sidebar/LoungeSidebar.test.tsx`

- [ ] **Step 1: Write failing test for Lounge sidebar sections**

```typescript
// src/components/Sidebar/LoungeSidebar.test.tsx
import { render, screen } from '@testing-library/react'
import { LoungeSidebar } from './LoungeSidebar'

test('LoungeSidebar renders Ships, Your Nets, and Available sections', () => {
  const networks = [
    {
      id: 'ship1',
      name: 'Idris',
      type: 'ship' as const,
      children: [],
      priority: 10
    },
    {
      id: 'net1',
      name: 'Command Net',
      type: 'net' as const,
      children: [],
      priority: 5
    }
  ]

  render(
    <LoungeSidebar
      selectedChannelId="ch1"
      onSelectChannel={() => {}}
      networks={networks}
    />
  )

  expect(screen.getByText(/SHIPS/i)).toBeInTheDocument()
  expect(screen.getByText(/YOUR NETS/i)).toBeInTheDocument()
  expect(screen.getByText(/AVAILABLE/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/components/Sidebar/LoungeSidebar.test.tsx
# Expected: SHIPS is not found in the document
```

- [ ] **Step 3: Implement Lounge sidebar**

```typescript
// src/components/Sidebar/LoungeSidebar.tsx
import React, { useMemo, useState } from 'react'
import { HierarchyNode } from '../../types/hierarchy'
import { flattenHierarchy } from '../../utils/hierarchyFlattener'
import { ChannelList } from './ChannelList'

interface LoungeSidebarProps {
  selectedChannelId: string
  onSelectChannel: (channelId: string) => void
  networks?: HierarchyNode[]
  monitoredNetId?: string
}

export const LoungeSidebar: React.FC<LoungeSidebarProps> = ({
  selectedChannelId,
  onSelectChannel,
  networks = [],
  monitoredNetId
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  const sidebarState = useMemo(() => {
    return flattenHierarchy(networks, 'lounge', monitoredNetId)
  }, [networks, monitoredNetId])

  const handleToggleExpand = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }

  return (
    <div
      data-testid="lounge-sidebar"
      style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}
    >
      {/* Ships */}
      {sidebarState.ships.length > 0 && (
        <div style={{ padding: '8px', borderBottom: '1px solid #202225' }}>
          <div
            style={{
              fontWeight: 'bold',
              fontSize: '10px',
              marginBottom: '6px',
              opacity: 0.7,
              textTransform: 'uppercase'
            }}
          >
            SHIPS
          </div>
          <ChannelList
            nodes={sidebarState.ships}
            selectedChannelId={selectedChannelId}
            onSelectChannel={onSelectChannel}
            expandedNodes={expandedNodes}
            onToggleExpand={handleToggleExpand}
          />
        </div>
      )}

      {/* Your Nets */}
      {sidebarState.yourNets.length > 0 && (
        <div style={{ padding: '8px', borderBottom: '1px solid #202225', flex: 1, overflow: 'auto' }}>
          <div
            style={{
              fontWeight: 'bold',
              fontSize: '10px',
              marginBottom: '6px',
              opacity: 0.7,
              textTransform: 'uppercase'
            }}
          >
            YOUR NETS
          </div>
          <ChannelList
            nodes={sidebarState.yourNets}
            selectedChannelId={selectedChannelId}
            onSelectChannel={onSelectChannel}
            expandedNodes={expandedNodes}
            onToggleExpand={handleToggleExpand}
          />
        </div>
      )}

      {/* Available to Join */}
      {sidebarState.availableToJoin.length > 0 && (
        <div style={{ padding: '8px', borderTop: '1px solid #202225' }}>
          <div
            style={{
              fontWeight: 'bold',
              fontSize: '10px',
              marginBottom: '6px',
              opacity: 0.7,
              textTransform: 'uppercase'
            }}
          >
            AVAILABLE TO JOIN
          </div>
          <ChannelList
            nodes={sidebarState.availableToJoin}
            selectedChannelId={selectedChannelId}
            onSelectChannel={onSelectChannel}
            expandedNodes={expandedNodes}
            onToggleExpand={handleToggleExpand}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/components/Sidebar/LoungeSidebar.test.tsx
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar/LoungeSidebar.tsx src/components/Sidebar/LoungeSidebar.test.tsx
git commit -m "feat: implement lounge sidebar with Ships, Your Nets, Available sections"
```

---

### Task 15: Implement Operations Sidebar

**Files:**
- Modify: `src/components/Sidebar/OperationsSidebar.tsx`
- Test: `src/components/Sidebar/OperationsSidebar.test.tsx`

- [ ] **Step 1: Write failing test for Operations sidebar hierarchy**

```typescript
// src/components/Sidebar/OperationsSidebar.test.tsx
import { render, screen } from '@testing-library/react'
import { OperationsSidebar } from './OperationsSidebar'

test('OperationsSidebar renders broadcast nets and strike group hierarchy', () => {
  const operationHierarchy = [
    {
      id: 'bcast1',
      name: 'Fleet All-Hands',
      type: 'net' as const,
      children: [],
      isBroadcast: true
    },
    {
      id: 'sg1',
      name: 'Strike Group ALPHA',
      type: 'strike-group' as const,
      children: [
        {
          id: 'ship1',
          name: 'Idris',
          type: 'ship' as const,
          children: []
        }
      ]
    }
  ]

  render(
    <OperationsSidebar
      operationId="op1"
      selectedChannelId="ch1"
      onSelectChannel={() => {}}
      operationHierarchy={operationHierarchy}
    />
  )

  expect(screen.getByText('Fleet All-Hands')).toBeInTheDocument()
  expect(screen.getByText('Strike Group ALPHA')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/components/Sidebar/OperationsSidebar.test.tsx
# Expected: Fleet All-Hands is not found
```

- [ ] **Step 3: Implement Operations sidebar**

```typescript
// src/components/Sidebar/OperationsSidebar.tsx
import React, { useMemo, useState } from 'react'
import { HierarchyNode } from '../../types/hierarchy'
import { flattenHierarchy } from '../../utils/hierarchyFlattener'
import { ChannelList } from './ChannelList'

interface OperationsSidebarProps {
  operationId: string
  selectedChannelId: string
  onSelectChannel: (channelId: string) => void
  operationHierarchy?: HierarchyNode[]
}

export const OperationsSidebar: React.FC<OperationsSidebarProps> = ({
  operationId,
  selectedChannelId,
  onSelectChannel,
  operationHierarchy = []
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  const sidebarState = useMemo(() => {
    return flattenHierarchy(operationHierarchy, 'operations')
  }, [operationHierarchy])

  const handleToggleExpand = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }

  return (
    <div
      data-testid="operations-sidebar"
      style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}
    >
      {/* Broadcast Nets */}
      {sidebarState.broadcastNets.length > 0 && (
        <div style={{ padding: '8px', borderBottom: '1px solid #202225' }}>
          <ChannelList
            nodes={sidebarState.broadcastNets}
            selectedChannelId={selectedChannelId}
            onSelectChannel={onSelectChannel}
            expandedNodes={expandedNodes}
            onToggleExpand={handleToggleExpand}
          />
        </div>
      )}

      {/* Admirals Net */}
      {sidebarState.admiralsNet && (
        <div style={{ padding: '8px', borderBottom: '1px solid #202225' }}>
          <ChannelList
            nodes={[sidebarState.admiralsNet]}
            selectedChannelId={selectedChannelId}
            onSelectChannel={onSelectChannel}
            expandedNodes={expandedNodes}
            onToggleExpand={handleToggleExpand}
          />
        </div>
      )}

      {/* Strike Groups */}
      {sidebarState.strikeGroups.length > 0 && (
        <div style={{ padding: '8px', flex: 1, overflow: 'auto' }}>
          <div
            style={{
              fontWeight: 'bold',
              fontSize: '10px',
              marginBottom: '6px',
              opacity: 0.7,
              textTransform: 'uppercase'
            }}
          >
            Strike Groups
          </div>
          <ChannelList
            nodes={sidebarState.strikeGroups}
            selectedChannelId={selectedChannelId}
            onSelectChannel={onSelectChannel}
            expandedNodes={expandedNodes}
            onToggleExpand={handleToggleExpand}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/components/Sidebar/OperationsSidebar.test.tsx
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar/OperationsSidebar.tsx src/components/Sidebar/OperationsSidebar.test.tsx
git commit -m "feat: implement operations sidebar with hierarchy rendering"
```

---

### Task 16: Create Main Panel with Text/Voice Toggle

**Files:**
- Create: `src/components/MainPanel/index.tsx`
- Test: `src/components/MainPanel/index.test.tsx`

- [ ] **Step 1: Write failing test for text/voice toggle**

```typescript
// src/components/MainPanel/index.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MainPanel } from './index'

test('MainPanel shows text channel by default and toggles to voice', () => {
  const onSendMessage = jest.fn()

  render(
    <MainPanel
      channelId="ch1"
      channelName="general"
      channelType="text"
      netName="Command Net"
      messages={[]}
      onSendMessage={onSendMessage}
    />
  )

  expect(screen.getByText(/# general/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /📝 Text/i })).toHaveStyle('background: #5865f2')

  fireEvent.click(screen.getByRole('button', { name: /🎤 Voice/i }))

  expect(screen.getByRole('button', { name: /🎤 Voice/i })).toHaveStyle('background: #5865f2')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/components/MainPanel/index.test.tsx
# Expected: MainPanel is not defined
```

- [ ] **Step 3: Create main panel wrapper**

```typescript
// src/components/MainPanel/index.tsx
import React, { useState } from 'react'
import { TextChannelView } from './TextChannelView'
import { VoiceChannelView } from './VoiceChannelView'
import { Channel, ChannelType } from '../../types/channel'

interface Message {
  eventId: string
  sender: string
  senderName: string
  content: string
  timestamp: Date
  type: 'message' | 'state'
  role?: string
}

interface MainPanelProps {
  channelId: string
  channelName: string
  channelType: 'text' | 'voice'
  netName: string
  messages: Message[]
  onSendMessage: (content: string) => Promise<void>
  isLoading?: boolean
}

export const MainPanel: React.FC<MainPanelProps> = ({
  channelId,
  channelName,
  channelType: initialChannelType,
  netName,
  messages,
  onSendMessage,
  isLoading = false
}) => {
  const [viewType, setViewType] = useState<'text' | 'voice'>(initialChannelType)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1 }}>
      {/* Header with toggle */}
      <div
        style={{
          padding: '12px',
          borderBottom: '1px solid #202225',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}
      >
        <div>
          <div style={{ fontWeight: 'bold', fontSize: '13px' }}>
            {viewType === 'text' ? '#' : '🎤'} {channelName}
          </div>
          <div style={{ fontSize: '10px', opacity: 0.7 }}>
            📢 {netName}
          </div>
        </div>

        {/* Text/Voice toggle */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => setViewType('text')}
            style={{
              background: viewType === 'text' ? '#5865f2' : '#3e4147',
              border: 'none',
              padding: '6px 10px',
              borderRadius: '3px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 'bold'
            }}
          >
            📝 Text
          </button>
          <button
            onClick={() => setViewType('voice')}
            style={{
              background: viewType === 'voice' ? '#5865f2' : '#3e4147',
              border: 'none',
              padding: '6px 10px',
              borderRadius: '3px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 'bold'
            }}
          >
            🎤 Voice
          </button>
        </div>
      </div>

      {/* Content */}
      {viewType === 'text' ? (
        <TextChannelView
          channelName={channelName}
          netName={netName}
          messages={messages}
          onSendMessage={onSendMessage}
          isLoading={isLoading}
        />
      ) : (
        <VoiceChannelView channelName={channelName} netName={netName} />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create Voice channel view stub**

```typescript
// src/components/MainPanel/VoiceChannelView.tsx
import React from 'react'

interface VoiceChannelViewProps {
  channelName: string
  netName: string
}

export const VoiceChannelView: React.FC<VoiceChannelViewProps> = ({
  channelName,
  netName
}) => {
  return (
    <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px' }}>
        🎤 {channelName}
      </div>
      <div style={{ fontSize: '12px', opacity: 0.7 }}>
        Voice controls and PTT interface
      </div>
      {/* Reuse existing voice controls from current implementation */}
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- src/components/MainPanel/index.test.tsx
# Expected: PASS
```

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/index.tsx src/components/MainPanel/VoiceChannelView.tsx src/components/MainPanel/index.test.tsx
git commit -m "feat: add main panel with text/voice toggle"
```

---

### Task 17: E2E Test: Complete Workflow

**Files:**
- Create: `src/tests/integration/completeFlow.test.tsx`

- [ ] **Step 1: Write integration test for complete flow**

```typescript
// src/tests/integration/completeFlow.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from '../../App'

test('User can create operation, invite crew, and access text channels', async () => {
  const { container } = render(<App />)

  // Start in Lounge mode
  expect(screen.getByText(/🏠 Lounge/i)).toBeInTheDocument()

  // Switch to Operations mode
  fireEvent.click(screen.getByRole('button', { name: /⚡/ }))

  // Create operation
  fireEvent.click(screen.getByRole('button', { name: /\+ New Op/ }))
  fireEvent.change(screen.getByLabelText(/Operation Name/i), {
    target: { value: 'NIGHTFALL' }
  })
  fireEvent.change(screen.getByLabelText(/Description/i), {
    target: { value: 'Test operation' }
  })
  fireEvent.click(screen.getByRole('button', { name: /Create Operation/i }))

  // Wait for operation to appear
  await waitFor(() => {
    expect(screen.getByText('NIGHTFALL')).toBeInTheDocument()
  })

  // Open invite dialog
  fireEvent.click(screen.getByRole('button', { name: /\+ Invite from Server/i }))

  // Select a crew member
  fireEvent.click(screen.getByRole('button', { name: /\+ Add/ }))
  fireEvent.click(screen.getByRole('button', { name: /Done/i }))

  // Verify operations sidebar shows hierarchy
  await waitFor(() => {
    expect(screen.getByTestId('operations-sidebar')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm test -- src/tests/integration/completeFlow.test.tsx
# Expected: PASS
```

- [ ] **Step 3: Commit**

```bash
git add src/tests/integration/completeFlow.test.tsx
git commit -m "test: add integration test for complete user flow"
```

---

## Summary

This implementation plan covers **8 major phases**:

1. **Type Definitions & Core Services** — TypeScript types, Matrix service methods, operation CRUD
2. **Sidebar Components** — Sidebar routing, channel list rendering, hierarchy support
3. **Text Channel Support** — Text channel views, message rendering, input
4. **Operation Management** — Creation dialog, roster builder, invitation modal
5. **Auto-Placement** — Webhook handlers, state transitions, auto-join logic
6. **State Management** — Custom hooks, expanded nodes, selected channel tracking
7. **Sidebar Implementations** — Lounge sidebar (Ships/Your Nets/Available), Operations sidebar (hierarchy)
8. **Main Panel & Integration** — Text/Voice toggle, integration tests

**Total tasks:** 17  
**Estimated implementation time:** 4-6 weeks (2-3 tasks per day)  
**Testing:** TDD throughout — every task has unit + integration tests

---

**Plan saved to:** `docs/superpowers/plans/2026-06-12-hailfreq-ui-redesign-implementation.md`

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

---

## Deferred / Not Yet Wired

The following items are known gaps as of the 2026-06-12 branch review. They are intentionally deferred and should be tracked here to avoid re-discovering them on future passes.

- **Mode/sidebar persistence** — `mode` and `selectedOperationId` are session-only React state in `Home.tsx`. They reset on reload. No per-server settings field is reachable from `Home` to persist them; deferred until settings API is extended.

- **Per-net "＋ text channel" creation UI** — `createTextChannel` and `createVoiceChannel` services exist in `client/src/renderer/matrix/channels.ts` but there is no UI to invoke them. The lounge and operations sidebars show existing channels only.

- **Full/Compact view adaptation** — The spec references a Full/Compact layout toggle. No toggle or layout adaptation logic exists yet; the layout is fixed.

- **Roster builder UI** — Crew can be invited to an operation via `InviteToOperationModal`, but there is no UI for assigning crew to specific ships or positions within an operation. The `org.hailfreq.opnode` events are read by `hierarchyBuilder` but nothing in the UI writes them yet.

- **Available-to-Join discovery in LoungeSidebar** — `LoungeSidebar` receives an `availableNets` prop but it is hardcoded to `[]` in `Home.tsx`. The discovery query (public rooms or server-announced nets) is not yet implemented.

- **Monitored-net bubbling** — `LoungeSidebar` accepts a `monitoredNetId` prop that is supposed to bubble the monitored net to the top of the list, but the prop is never passed from `Home.tsx`; the monitored net ID is not surfaced from `NetListPanel`/`VoiceEngine` to `Home`.

- **Rail-level ModeTabBar placement** — Per the spec, the mode tab bar should live in the global multi-server `Sidebar` rail alongside server icons. Currently `ModeTabBar` is rendered inside `Home.tsx` as a per-server mini-rail, meaning each server gets its own mode switcher rather than a single global one.