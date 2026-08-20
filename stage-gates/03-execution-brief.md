# 03 - Execution Brief: Phase 3 Panels & Layout
 
## Work Breakdown & Tasks
- [ ] Task 1 (FEAT-012): Implement `src/state/transcriptStore.ts` tracking user turns, partial/final STT, streaming text deltas, artifacts, errors, and unread badges.
- [ ] Task 2 (FEAT-013): Implement `src/state/taskTreeStore.ts` maintaining hierarchical task trees, progress levels, logs, and completion summaries from Hermes events.
- [ ] Task 3 (FEAT-011): Implement `src/state/layoutStore.ts` for managing viewport breakpoints (mobile vs desktop 3-pane) and drawer states.
- [ ] Task 4 (FEAT-012): Implement `src/components/panels/TranscriptPanel.tsx` with streaming typewriter text, markdown/code chips, artifact attachments, and scroll lock.
- [ ] Task 5 (FEAT-013): Implement `src/components/panels/TaskTreePanel.tsx` with collapsible task branches, progress indicators, execution logs, and output summaries.
- [ ] Task 6 (FEAT-011): Implement `src/components/panels/MobileDrawer.tsx` and integrate 3-pane desktop vs mobile drawers into `src/App.tsx`.
- [ ] Task 7: Write Vitest unit and integration test suites for transcriptStore, taskTreeStore, layoutStore, TranscriptPanel, and TaskTreePanel.

## Definition of Done (DoD)
- On desktop viewports (≥1024px), 3-pane layout displays left transcript, center constellation, right task tree with independent collapse/expand buttons.
- On mobile viewports (<1024px), full-screen spatial voice room is maintained with toggleable bottom drawers.
- Zero TypeScript compiler or lint errors (`npm test` and `npm run lint`).



