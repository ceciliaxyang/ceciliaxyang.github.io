// Guanyin v1 (saved for reference, not used by the game): the original uniform-line portrait with the blue veil.
// The Coach pill's portrait: Guanyin in the tiles' woodblock colours. Two looks share one drawing:
// the everyday one on ivory, and a red seal (ivory on red, like a carved name stamp) when there's a new note.

const RED = "#c8141c";   // same inks as the tiles (Porcelain white palette)
const GREEN = "#00803d";
const BLUE = "#0b3fa8";
const IVORY = "#ffffff";
const INK = "#111111";

const PATHS = {
  veil: "M17.2 8.6 C12.6 10.8 10.2 18 9.6 26 C9.2 31 8.8 35.4 8.2 40 L31.8 40 C31.2 35.4 30.8 31 30.4 26 C29.8 18 27.4 10.8 22.8 8.6 Z",
  robe: "M8 40.5 C9.6 33 13.6 29 19 27.4 L21 27.4 C26.4 29 30.4 33 32 40.5 Z",
  collar: "M18.2 27.6 L20 32.6 L21.8 27.6 Z",
  hair: "M15.9 15.6 C13.6 18.6 13.1 25 13.6 31 C14 34.2 13.4 37.2 12.2 39.8 C15.4 37.8 16.4 34.2 16.4 30.2 C16.4 25.4 16.6 20.4 17.3 18Z " +
    "M24.1 15.6 C26.4 18.6 26.9 25 26.4 31 C26 34.2 26.6 37.2 27.8 39.8 C24.6 37.8 23.6 34.2 23.6 30.2 C23.6 25.4 23.4 20.4 22.7 18Z",
  face: "M16.1 16.8 C15.9 19.4 16.5 21.6 17.9 23.2 C18.6 24 19.3 24.4 20 24.4 C20.7 24.4 21.4 24 22.1 23.2 C23.5 21.6 24.1 19.4 23.9 16.8 Z",
  hairTop: "M15.5 18 C15.1 13.6 18 12 20 12 C22 12 24.9 13.6 24.5 18 C23.6 15.6 21.8 14.9 20 15.5 C18.2 14.9 16.4 15.6 15.5 18Z " +
    "M17.4 12.8 C17 9.8 18.4 8.2 20 8.2 C21.6 8.2 23 9.8 22.6 12.8 Z",
  crown: "M20 3.4 C21.5 5 22.1 6.8 21.6 8.8 L18.4 8.8 C17.9 6.8 18.5 5 20 3.4Z " +
    "M18.5 9 C17.1 7.6 15.8 7.6 14.9 8.2 C15.5 9.4 16.8 10 18.5 9.8Z M21.5 9 C22.9 7.6 24.2 7.6 25.1 8.2 C24.5 9.4 23.2 10 21.5 9.8Z",
  eyes: "M17.8 19.5 q.7 .32 1.4 0 M20.8 19.5 q.7 .32 1.4 0",
};

// no background of their own: she sits on the pill, which is white normally and red with a new note
const EVERYDAY = { bg: IVORY, veil: BLUE, veilOpacity: 0.14, robe: IVORY, robeLine: BLUE, collar: BLUE, hair: INK, skin: IVORY, crown: RED, band: GREEN, dot: RED, eyes: INK };
// a new note: white lines on the black pill, keeping her red crown, green band and red dot
const SEAL = { bg: INK, veil: IVORY, veilOpacity: 0.16, robe: INK, robeLine: IVORY, collar: IVORY, hair: IVORY, skin: INK, crown: RED, band: GREEN, dot: RED, eyes: IVORY };

function draw(c, cls) {
  return `<svg class="${cls}" viewBox="0 0 40 40" aria-hidden="true">
    <path d="${PATHS.veil}" fill="${c.veil}" opacity="${c.veilOpacity}"/>
    <path d="${PATHS.robe}" fill="${c.robe}" stroke="${c.robeLine}" stroke-width=".9" stroke-linejoin="round"/>
    <path d="${PATHS.collar}" fill="${c.collar}"/>
    <path d="${PATHS.hair}" fill="${c.hair}"/>
    <rect x="18.9" y="23" width="2.2" height="4.8" fill="${c.skin}"/>
    <path d="${PATHS.face}" fill="${c.skin}"/>
    <path d="${PATHS.hairTop}" fill="${c.hair}"/>
    <path d="${PATHS.crown}" fill="${c.crown}"/>
    <rect x="16.7" y="9" width="6.6" height="1" rx=".5" fill="${c.band}"/>
    <circle cx="20" cy="17.3" r=".45" fill="${c.dot}"/>
    <path d="${PATHS.eyes}" stroke="${c.eyes}" stroke-width=".55" fill="none" stroke-linecap="round"/>
  </svg>`;
}

/* Both looks stacked in one round avatar; the pill's `has-note` class flips between them. */
export function coachAvatarHtml() {
  return `<span class="coach-av">${draw(EVERYDAY, "coach-av-day")}${draw(SEAL, "coach-av-seal")}</span>`;
}

/* A large portrait for the top of the coach panel: the everyday look on a soft grey disc (her robe runs
   off its lower edge, like a bust). */
export function coachPortraitHtml() {
  return `<div class="coach-portrait" aria-hidden="true">${draw(EVERYDAY, "")}</div>`;
}
