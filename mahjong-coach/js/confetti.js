// Mahjong confetti: when you win, small tiles from your hand burst up out of the Mahjong button, tumble,
// and fall off the bottom of the screen. Each one is a solid little block, not a flat card: a face, a green
// back and four sides (white porcelain at the front, green at the back, like a real tile), so it keeps its
// thickness as it turns. It sits above everything (the results card included) and ignores
// taps. Turned off for people who ask their system for reduced motion.
import { tileHtml } from "./tiles.js";

const COUNT = 46;
const GRAVITY = 2200;  // px/s²

export function tileConfetti(from, kinds) {
  if (!kinds.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div");
  box.className = "confetti";
  box.setAttribute("aria-hidden", "true");
  document.body.appendChild(box);

  // start from the middle of the button (or the middle of the screen if it's gone)
  const x0 = from ? from.left + from.width / 2 : innerWidth / 2;
  const y0 = from ? from.top + from.height / 2 : innerHeight * 0.6;
  const reach = Math.min(innerWidth, 900);
  let longest = 0;

  for (let i = 0; i < COUNT; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.innerHTML = `<span class="cf-face cf-front">${tileHtml(kinds[i % kinds.length], { size: "sm", title: false })}</span>
      <span class="cf-face cf-back"></span><span class="cf-face cf-top"></span><span class="cf-face cf-bottom"></span>
      <span class="cf-face cf-left"></span><span class="cf-face cf-right"></span>`;
    piece.style.left = `${x0}px`;
    piece.style.top = `${y0}px`;
    box.appendChild(piece);

    // a fan of launches, mostly upward, wider at the sides; some go higher than others
    const angle = (-90 + (Math.random() - 0.5) * 110) * Math.PI / 180;
    const speed = (0.9 + Math.random() * 0.7) * Math.max(900, innerHeight * 1.35);
    const vx = Math.cos(angle) * speed * (reach / 900) * 0.75;
    const vy = Math.sin(angle) * speed;
    // tumbling on all three axes, from a random starting angle, so you see faces, backs and sides
    const spin = (Math.random() - 0.5) * 540;
    const flipX = (Math.random() - 0.5) * 900, flipY = (Math.random() - 0.5) * 700;
    const x0r = (Math.random() - 0.5) * 60, y0r = (Math.random() - 0.5) * 60;
    const scale = 0.7 + Math.random() * 0.45;
    // long enough to fall past the bottom of the screen
    const t = (-vy + Math.sqrt(vy * vy + 2 * GRAVITY * (innerHeight - y0 + 120))) / GRAVITY;
    const dur = t * 1000;
    const delay = Math.random() * 140;
    longest = Math.max(longest, dur + delay);

    const frames = [];
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps, tt = f * t;
      const dx = vx * tt * (1 - 0.25 * f);           // a little air drag on the sideways drift
      const dy = vy * tt + 0.5 * GRAVITY * tt * tt;
      frames.push({
        transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotateZ(${spin * f}deg) rotateX(${x0r + flipX * f}deg) rotateY(${y0r + flipY * f}deg) scale(${f < 0.08 ? scale * (0.4 + 7.5 * f) : scale})`,
      });
    }
    piece.animate(frames, { duration: dur, delay, easing: "linear", fill: "both" });
  }
  setTimeout(() => box.remove(), longest + 100);
}
