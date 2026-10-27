// Start screen: credits the author, asks for a GitHub star, then the logo floats
// like a ghost into the credit badge at the bottom right of the app.

import { invoke } from "@tauri-apps/api/core";

import logoUrl from "../assets/logo-256.png";

export const AUTHOR = "Janitha Illankoon";

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>';

export function splashHtml(): string {
  return `
  <div class="splash" id="splash" role="dialog" aria-modal="true" aria-labelledby="splash-title" aria-describedby="splash-ask">
    <div class="splash-card">
      <img class="splash-logo" id="splash-logo" src="${logoUrl}" alt="" />
      <h1 id="splash-title">Ghost In The Script</h1>
      <p class="splash-made">Made by <strong>${AUTHOR}</strong></p>
      <p class="splash-ask" id="splash-ask">If it saves you a retake, a star on GitHub helps other presenters find it.</p>
      <div class="splash-actions">
        <button class="btn splash-star" id="splash-star">${STAR}<span>Star on GitHub</span></button>
        <button class="btn primary splash-continue" id="splash-continue" aria-disabled="true">Continue to the app</button>
      </div>
      <p class="splash-status" id="splash-status" role="status">Opening your scripts…</p>
    </div>
  </div>`;
}

export function creditHtml(): string {
  return `
  <div class="credit" id="credit">
    <img class="credit-logo" id="credit-logo" src="${logoUrl}" alt="" />
    <div class="credit-text"><span>Made by</span><b>${AUTHOR}</b></div>
    <button class="btn small credit-star" id="credit-star" title="Opens the project on GitHub" aria-label="Star Ghost In The Script on GitHub">${STAR}<span>Star</span></button>
  </div>`;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface SplashOptions {
  /** Called once the splash is gone and the app is showing. */
  onContinue: () => void;
  onError: (message: string) => void;
}

export function initSplash(opts: SplashOptions) {
  const splash = $("splash");
  const cont = $<HTMLButtonElement>("splash-continue");
  let isReady = false;
  let leaving = false;

  const openGithub = () =>
    invoke("open_github").catch((e) => opts.onError(`Couldn't open GitHub: ${e}`));
  $("splash-star").onclick = openGithub;
  $("credit-star").onclick = openGithub;

  cont.onclick = () => {
    if (!isReady || leaving) return;
    leaving = true;
    leave();
  };

  // Keep keyboard focus on the splash while it's up.
  splash.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = [$("splash-star"), cont];
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
  });
  $("splash-star").focus();

  function leave() {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = $("splash-logo");
    const to = $("credit-logo");
    const credit = $("credit");
    to.scrollIntoView({ block: "nearest" });

    const done = () => {
      splash.hidden = true;
      to.style.visibility = "";
      credit.classList.add("highlight");
      credit.addEventListener("animationend", () => credit.classList.remove("highlight"), { once: true });
      opts.onContinue();
    };

    if (reduce) {
      splash.hidden = true;
      done();
      return;
    }

    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const ghost = from.cloneNode() as HTMLImageElement;
    ghost.removeAttribute("id");
    ghost.className = "ghost-flight";
    Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
    document.body.appendChild(ghost);
    from.style.visibility = "hidden";
    to.style.visibility = "hidden";
    splash.classList.add("leaving");

    // A drifting path: an upward arc with a side-to-side sway that settles as it lands,
    // and a little transparency mid-flight, the way a ghost would wander off.
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const endScale = b.width / a.width;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const frames: Keyframe[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = ease(t);
      const sway = Math.sin(t * Math.PI * 3) * 46 * (1 - t);
      const lift = -Math.sin(t * Math.PI) * 120;
      const bob = Math.sin(t * Math.PI * 5) * 8 * (1 - t);
      const x = dx * p + sway;
      const y = dy * p + lift + bob;
      const s = 1 + (endScale - 1) * p;
      const r = Math.sin(t * Math.PI * 3) * 9 * (1 - t);
      frames.push({
        transform: `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`,
        opacity: 1 - 0.4 * Math.sin(t * Math.PI),
        offset: t,
      });
    }
    const flight = ghost.animate(frames, { duration: 1500, easing: "linear", fill: "forwards" });
    flight.onfinish = () => {
      ghost.remove();
      done();
    };
  }

  return {
    ready() {
      isReady = true;
      cont.removeAttribute("aria-disabled");
      $("splash-status").textContent = "";
      cont.focus();
    },
    failed(message: string) {
      const status = $("splash-status");
      status.classList.add("error");
      status.textContent = message;
    },
  };
}
