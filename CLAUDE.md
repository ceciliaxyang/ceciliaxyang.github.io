# CLAUDE.md

## Figma source of truth (Mahjong Coach)

The design source of truth is the **SOT** section (node `2444:29968`) on the "mahjong coach" page of
https://www.figma.com/design/Cke0s1YA42C7gq6UHeZdGY/Cecilia-personal

- **Never clip groups that contain tiles.** Any frame, auto-layout group or component that holds tile
  instances (hands, discards, called sets, seats, sheets, cards) must have "Clip content" turned off,
  so tile edges, depth and shadows are never cut off. Only the top-level screen frames may clip.
