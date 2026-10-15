# Design: case file

**Concept:** an investigator's case file. The product's value is *receipts*, so the UI is made of evidence: stamped verdicts,
quote strips with sources, a board of threads. Not a neon agent dashboard.

## Tokens
```
--paper:   #F4F0E6   page
--card:    #FBF9F3   panels
--ink:     #14130F   text, lines, primary
--ink-2:   #5C5849   secondary text
--rule:    #CFC8B5   1px dividers
--alarm:   #D63A1F   disqualified, failed, errors  (the ONLY loud colour)
--ok:      #2F6B3F   qualified (muted forest)
--wait:    #B7791F   unknown / awaiting vendor (ochre)
```
No gradients, no glow, no blur, no drop shadows (use 1px ink offset border for raised items), radius max 2px, no emoji, no icon-in-circle.

## Type
Display: **Newsreader** (serif, 500) for headlines and verdicts. Data/labels: **IBM Plex Mono** 12–13px, uppercase labels with 0.06em tracking.
Body: Newsreader 17px. Numerals tabular. Sentence case everywhere except mono labels.

## Components
- **Verdict stamp**: rotated -2deg, 2px ink border, mono caps: QUALIFIED / DISQUALIFIED / UNVERIFIED. Stamps in alarm/ok/wait colour. This is the hero element.
- **Receipt strip**: card with perforated left edge (CSS mask), mono quote in quotes, source domain underlined, channel tag [WEB] [EMAIL] [FORM] [CALL], time.
- **Fit matrix**: ruled table, cells = ✓-less text: `PASS` `FAIL` `UNKNOWN` in mono; unknown cells have dashed ochre border and a "ask vendor" tag; when answered the cell re-stamps.
- **Graph**: React Flow on a faint 24px dot grid. Nodes = rectangles with 1px ink border, mono title, serif subtitle. Running = a 2px ink bar sweeping along the bottom edge (no pulse/glow).
  Failed = alarm border + diagonal hatch. Recovering = dashed ochre edge to the fallback node. Edges 1px ink, curved.
- **Event feed**: monospaced ledger, `seq  node  verb  detail`, new rows slide 4px and fade in. No avatars.
- **Deck**: 16:9 paper slides, big serif sentence as slide title ("Drata fits. Vanta doesn't, and here's the receipt."), evidence below. One idea per slide.
- **Replay scrubber**: thin ruled timeline with tick per event, failures as alarm ticks.

## Motion
Only state changes move. 150ms linear. Stamps land with a 100ms scale 1.08 -> 1 thud. Respect prefers-reduced-motion.

## Voice UI
Voice state is a plain waveform line in ink at the bottom of the deck, label "ANALYST · LIVE" in mono. While on a phone call, a call card shows
the live transcript lines as receipts.
