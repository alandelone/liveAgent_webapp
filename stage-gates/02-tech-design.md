# 02 - Technical Design: Phase 3 Panels & Layout
 
## Architecture & Data Flow
- **Transcript Store (`src/state/transcriptStore.ts`)**:
  - Collects and aggregates turns from `USER_TEXT`, `STT_PARTIAL`, `STT_FINAL`, `TEXT_DELTA`, `ARTIFACT`, and `ERROR`.
  - Turns are structured as `{ id: turnId, userText?: string, isFinalUserText: boolean, agentResponses: Map<string, { delta: string, isFinal: boolean }>, artifacts: ArtifactEvent[], timestamp: number }`.
  - Incremental typewriter streaming: updates text buffer chunk-by-chunk on `TEXT_DELTA`.
- **Task Tree Store (`src/state/taskTreeStore.ts`)**:
  - Maintains hierarchical task graph populated strictly from Hermes events:
    - Root tasks (`TASK_START` where `fromAgentId === 'hermes'`).
    - Subtasks / delegations (`toAgentId`).
    - Progress & logs (`TASK_PROGRESS`).
    - Completion status & summary (`TASK_COMPLETE`).
  - Read-only invariant: no local modifications permitted.
- **Layout Manager & Drawer Store (`src/state/layoutStore.ts`)**:
  - Detects viewport breakpoint (`isMobile`: width < 1024px vs desktop).
  - Desktop 3-pane layout:
    - Left Pane: `TranscriptPanel` (collapsible, width: 320px..400px).
    - Center Pane: `ConstellationView` + `InputFallbackBar` (spatial voice room).
    - Right Pane: `TaskTreePanel` (collapsible, width: 320px..400px).
  - Mobile layout:
    - Full-screen spatial voice room.
    - Bottom action bar toggles bottom-sheet slide-over drawers for Transcript and Task Tree.
- **UI Panel Components (`src/components/panels/`)**:
  - `TranscriptPanel.tsx`: Live streaming chat transcript with message bubbles, timestamps, agent badges, artifact previews.
  - `TaskTreePanel.tsx`: Hierarchical task list with animated progress bars, status icons, expandable execution logs.
  - `MobileDrawer.tsx`: Touch-friendly slide-up modal bottom sheet for mobile viewports.

## System Invariants
- Task tree is strictly read-only (Red Line 8).
- Transcripts and logs never block UI audio rendering (Red Line 5).

## Completion Checklist
- [x] Transcript streaming data structures and auto-scroll behaviors specified.
- [x] Read-only task execution hierarchy designed.
- [x] Responsive 3-pane desktop and mobile drawer transition mechanics defined.



