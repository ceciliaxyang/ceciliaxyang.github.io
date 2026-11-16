# Mahjong Coach

Hong Kong style Chinese mahjong for one player against three bots (named by seat wind, e.g. "Player 北"), with a coach.
When one of your moves was clearly worse than the best one, the coach chathead (bottom right)
lights up. Tap it to see why, and **Take it back** to replay the move.

Will live at `ceciliayang.com/mahjong-coach`. It's a static folder inside the portfolio, with no build step.

## Run it

From the portfolio root:

```bash
npm run dev
```

Then open http://localhost:3000/mahjong-coach/

## Rules (modelled on mahjong4friends' Chinese / Hong Kong mode)

- 144 tiles: three suits, winds, dragons, plus flowers and seasons (set aside and replaced automatically).
- Four sets and a pair wins. Seven pairs and thirteen orphans count too.
- Pung, kong or win can be claimed from anyone's discard; chow only from the player before you.
  Priority: win > pung/kong > chow.
- The game never suggests a pung, chow or kong. After each discard you press **Continue** (or Space).
  To call, tap tiles in your hand: they lift and Continue becomes **Call**. The game works out whether
  it's a pung, chow or kong and explains if it isn't a valid call. **Mahjong** appears only when you can win.
- **Difficulty** (Settings): Easy bots make looser discards, play no defense and call less; Normal (default)
  play efficient, fast hands with basic defense; Hard defend earlier, keep scoring pairs and take every call
  that speeds them up. In 800-hand simulations a Normal-strength player wins ~45% of hands against Easy
  bots and ~25% against Normal (the fair share at a four-player table); Hard is only slightly tougher.
- A win needs at least 1 fan (`minFan` in `createGame`). The Fan guide button lists every fan.
- The last 14 tiles are the dead wall. A hand with no winner when the live wall runs out is a draw.
- The dealer keeps the deal after a dealer win or a draw. Otherwise it passes, and the round wind
  moves on once every seat has dealt.

## What the coach checks

- **Discards**: shanten (how many tiles from ready) and how many unseen tiles would improve the
  hand after each possible discard. It flags yours when it set you back a step, or when another
  discard had clearly more ways in (at least 4 more, and 25% or more).
- **Defence**: when an opponent shows three sets and you're 2+ from ready, it flags discards
  that aren't safe against them.
- **Claims**: passing on a scoring pung (dragons, your seat wind, the round wind), passing on a
  claim that makes you ready, and claiming when it doesn't get you any closer (opening your hand
  for nothing).
- **Missed wins**: self-drawn or off a discard.
- **Hints**: tap the chathead on your turn, then "What would you do?".

## Files

- `js/engine.js`: tiles, shanten, tile acceptance, winning-hand decomposition, fan scoring
- `js/game.js`: the game state machine (deal, draw, discard, claims, kongs, scoring, dealer rotation)
- `js/strategy.js`: move evaluation shared by the bots and the coach
- `js/coach.js`: reviews your moves and writes the explanations
- `js/tiles.js`: tile names and SVG tile faces
- `js/ui.js`: rendering, input, bot timing, take-backs
- `css/style.css`: all styles

The game in progress is saved in this browser (localStorage). Coach notes and take-backs last
until you reload.

`?autoplay` plays your seat automatically with occasional deliberate mistakes. It's for testing the
flow and the coach's notes.
`?sandbox` is a normal game for manual testing. Both test modes save to their own slot, so they
never touch your real game or your settings.
