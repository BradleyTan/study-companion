# Screen: Mindmap (`/subjects/[id]/mindmap`)

Step 2. Figma reference: "Mindmap" frame. One AI mindmap per subject, drawn with React Flow on the graph-paper background: the subject sits in the middle as a big sticker, topics branch out as smaller stickers joined by ink lines. Every topic that came from the notes can be tapped to read the passage it came from.

Widths: **phone** < 640 px (designed at 375), **tablet** 640–899, **laptop** ≥ 900.

## Data the screen needs
- Subject `name`, `colour`, `emoji`.
- The subject's `mindmaps` row (latest): `graph_json` = `{ nodes: [{ id, label, parentId|null, chunkId|null, position?: {x,y} }], version }`, `input_hash`, `created_at`, and which sources it was made from (ids + titles).
- Whether the subject's sources changed since the map was made (compare current input hash with `input_hash`).
- Quota for kind `mindmap` (3 per student per day) + app allowance flag.
- For a tapped node: chunk `text`, source type, title, page, and link target (same passage links as flashcards.md "Source links").

AI output limits the developer validates with zod: at most 40 nodes, depth ≤ 3 below the root, labels ≤ 60 chars (trimmed), every non-root node's `chunkId` must belong to this subject and user, otherwise it is set to `null`.

## Layout
**Header** (normal app bar + page header, compact): "← Biology", title "Mindmap" (marker), meta line "Made from 4 notes and 2 files · 2 days ago". Actions on the right (on phone, a row under the title): segmented toggle **Map | Outline**, "Regenerate" button with quota chip `2 of 3 left today`, overflow menu "⋯" with "Reset layout" and "Choose sources".

**Map view** fills the rest of the viewport (`height: calc(100dvh - header)`, min 420 px) inside a sticker frame (ink outline, 8 px radius, no offset shadow so it reads as a window). Phone: frame goes edge to edge (no side gutter, top and bottom outline only) to give the canvas every pixel.
- Background: React Flow `<Background variant="lines" gap={24}>` coloured `--grid` on `--paper`, so the map continues the notebook paper.
- **Root node:** subject-colour sticker, emoji + subject name in Permanent Marker 20 px, 4 px offset shadow, rotated -1° (0° under reduced motion).
- **Level 1 nodes:** `--card` sticker, 2.5 px ink outline, 6 px left band in `--subject`, 16 px bold text, max width 220 px (text wraps, never truncates).
- **Level 2–3 nodes:** `--card`, 2 px outline, 14 px text, max width 200 px, no shadow.
- **Details (2026-10-28, student test: "mindmap useless without details"):** every topic with a passage carries a one- or two-sentence detail (what it is, how it works, why it matters, key numbers) under its label in 12 px body text, at most 240 px wide. Level 3 nodes hold the specific facts (definitions, steps, examples, numbers, formulas). Details are checked against the cited passage like flashcard answers; an unsupported detail is left out and the node stays. Rings spread further apart when details show so outer topics don't overlap. "⋯" gets "Hide details on map" / "Show details on map" (remembered per device; default shown). Up to 50 nodes (was 40).
- Nodes that have a source passage show a small "quote" icon (decorative; the accessible name says it, see below). Grouping nodes without a passage have no icon.
- **Edges:** smooth bezier, 2 px `--ink`, no arrowheads.
- **Selected node:** 3 px `--focus` ring, shadow grows to 6 px.
- **Controls** bottom-right, stacked sticker icon buttons, 44 px: "Zoom in", "Zoom out", "Fit map to screen". Zoom range 0.3–2. React Flow's free attribution link stays visible bottom-left (we don't hide it; hiding it is meant for paid subscribers).
- First load: `fitView` with 24 px padding (phones: see "375 px phone specifics").

**Initial layout:** the AI returns only the tree; the client lays it out radially (root in the centre, level-1 nodes evenly around it, children fanned outward) using `d3-hierarchy` (free, ISC) or an equivalent small function. If saved positions exist they win.

**Outline view:** each topic's detail shows under its name (14 px). The same tree as a nested list (`<ul>` with `role="tree"` / `treeitem`, expandable groups), sticker cards per level-1 topic. Each item with a passage has "Show passage". This is the fully accessible, screen-reader and keyboard-first version, and the easiest way to read the map on a small phone. The Map/Outline choice is remembered in `localStorage` per device. Default: Map on all widths.

## Interactions
- **Pan:** drag the background (mouse or one finger). **Zoom:** wheel/trackpad pinch, two-finger pinch on touch, or the buttons. Page itself never scrolls while the pointer is on the canvas.
- **Drag nodes:** mouse or one finger on a node, `nodeDragThreshold: 4` px so a tap never moves a node. Children don't follow the parent (simple to reason about). 
- **Positions saved:** 800 ms after the last drag ends, the client sends all moved node positions (rounded to whole px) in one server action that updates `graph_json.nodes[].position`. A tiny status tag in the header shows "Saving…" → "Saved ✓" (fades after 2 s). On failure: "Layout not saved. Retrying…" and retry with backoff. No sound for saving.
- **Tap / click / Enter on a node** opens the **passage panel**:
  - Laptop/tablet: panel slides in from the right, 360 px wide, the map stays usable beside it.
  - Phone: bottom sheet, 60 % of the viewport height, drag handle + "Close" button, swipe down to close; the map behind is dimmed but visible.
  - Content: node label as heading; source chip "From **Cell structure** (note)" / "**Lecture 3.pdf**, page 12"; the passage text (the chunk, 16 px, `--card`, left border `--subject`, the most relevant sentence marked with `<mark>` if the AI gave a quote); buttons "Open in note" / "Open in file" (passage link, same tab) and "Read aloud" (read-aloud.md).
  - Grouping node without a passage: "This topic groups the ideas below it. Tap one of them to see where it came from."
  - Esc or "Close" closes and returns focus to the node.
- **Regenerate:** confirm dialog first.
  - Sources changed: "Make a new map from your latest notes? Moved topics will go back to their places. Uses 1 of today's 3."
  - Sources unchanged: "Your notes haven't changed. Make a fresh version anyway? Uses 1 of today's 3." (the developer bypasses the cache for this; see hand-off notes).
  - Buttons "Make new map" (primary), "Cancel". The old map stays on screen (dimmed, non-interactive) until the new one arrives; if generation fails, the old map comes back untouched.
- **Sources changed hint:** when the map is older than the notes, a slim highlight banner over the map: "Your notes changed since this map was made. Tap ↻ above to update it." No button of its own: the header's ↻ Regenerate ("New map" on phones) does it (Bradley, 2026-10-28: two Regenerate buttons looked doubled).
- **Reset layout:** puts every node back to the auto layout, saves, toast "Layout reset".
- **Choose sources:** dialog with checkboxes for notes and ready files (default all). If the selection is too long for one map (over `MINDMAP_MAX_CHARS`, the developer sets it from the model's token budget), a hint appears under the list: "That's a lot of reading! Untick a few so the map stays clear." and the primary button is disabled.

## States
- **Empty, no map yet:** inside the canvas frame, centred: a dashed root sticker with the subject emoji, marker line "No mindmap yet", sub-line "We'll turn your notes into a map of the big ideas.", primary "Make a mindmap" + quota chip `3 of 3 left today`.
- **Empty, nothing to map** (no notes, no ready files): "Add a note or a lecture file first, then we can map it." + "Back to Biology".
- **Generating:** root sticker in the centre with dashed branches that draw in one by one (stroke-dashoffset loop, 1.6 s), lines under it rotating every 3 s: "Reading your notes…" → "Finding the big ideas…" → "Drawing branches…". Polite live region once: "Making your mindmap. This takes about 20 seconds." Reduced motion / focus mode: static root + the same text. The student can leave; a toast "Your Biology mindmap is ready" appears if they're still in the app when it finishes.
- **Success:** nodes fade and scale in from the root outward, 30 ms stagger, 250 ms each (reduced motion: appear at once). `pop`.
- **Too little text:** "There isn't enough in your notes for a mindmap yet. Add a bit more and try again." + "Back to Biology". `boop`.
- **Daily limit used:** "You've made 3 mindmaps today. More tomorrow! Your current map is still here." (Regenerate disabled with that reason as its description, chip `0 of 3 left today` in `--danger`.) `boop` only when they press it.
- **App-wide allowance used:** "Today's free AI allowance is used up. Try again tomorrow. Your notes are safe." `boop`.
- **AI failed:** "The map maker got tangled up. Try again. This one didn't use up a go." + "Try again". `boop`.
- **Loading the page:** frame with a pulsing root skeleton (no pulse under reduced motion).
- **Load error:** "We couldn't load your mindmap." + "Try again".

## 375 px phone specifics
- Header actions wrap to one row: [Map | Outline] toggle (left), "Regenerate" (right, icon + "New map" label), ⋯ menu. Quota chip moves into the Regenerate confirm dialog and the ⋯ menu to save width.
- Zoom on a phone (below 640 px, polish pass): `fitView` with 24 px padding and `minZoom: 0.7`, then centre on the root node, so the root and level-1 topics are readable and the student pans to explore. `0` does the same; "Fit map to screen" keeps the 0.7 minimum.
- Under the Map | Outline toggle, a hint line (map view only): "Tip: Outline is easier to read on a phone."
- Canvas: full-bleed, min 420 px tall, controls 44 px stacked bottom-right with 12 px inset, clear of the iOS home bar (`env(safe-area-inset-bottom)`).
- On first visit on a touch device, a one-time hint sticker over the map: "Pinch to zoom, drag to move around, tap a topic to see its notes." with "Got it" (remembered in `localStorage`).
- Passage panel is a bottom sheet (see above), focus trapped while open.
- Outline view is offered prominently because a 40-node map is hard to read at 375 px.

## Sounds
`click` on buttons and on opening a node's passage; `pop` when a new map arrives; `boop` on the error messages. Panning, zooming and dragging are silent. Focus mode: only `chime`.

## Accessibility
- Canvas wrapper: `aria-label="Mindmap of Biology. Use Tab to move between topics, Enter to open a topic, arrow keys to move a selected topic."` with `nodesFocusable` on. Each node's accessible name: "Photosynthesis, topic, 3 subtopics, has a source passage".
- Keyboard: Tab / Shift+Tab move through nodes in tree order (root, then depth-first); Enter opens the passage; arrow keys move the selected node 10 px (Shift = 50 px) and save like a drag; `+` / `-` zoom; `0` fits the map.
- Outline view is the equivalent for screen readers; the Map | Outline toggle is the first control after the title.
- Text contrast: `--ink` on `--card` in all nodes, `--on-colour` on the subject-colour root. Selected state uses the focus ring, not colour alone.
- Bottom sheet / side panel: `role="dialog"`, labelled by the node label, focus trapped (sheet) or moved into the panel (side panel), returns to the node on close.

## Changelog
- 2026-10-28: Details on every topic (map, outline, passage panel, where the detail leads the panel as a bold sticker line above the passage); "Hide/Show details on map"; up to 50 nodes; maps made on `openai/gpt-oss-120b` with 12,000 characters of notes per map (was 16,000) so the longer reply fits the free plan's per-minute limit. Empty-state copy: "We'll turn your notes into a map of the big ideas, with the key facts under each one."
