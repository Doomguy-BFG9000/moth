// The site's motion, on index.html and learn.html, and never on a page `moth build --web` makes (make-web.mjs
// leaves it out). GSAP and its ScrollTrigger, loaded from jsDelivr by each page's head, bring the page in,
// show each part as it's scrolled to, and give a mouse a small lamp for a cursor, which the moth in the corner
// of the front page flies after. None of it is needed: without GSAP, or where reduced motion is asked for,
// the pages are just as they are without it.
(() => {
  const root = document.documentElement;
  const { gsap, ScrollTrigger } = window;
  const waiting = root.classList.contains("motion"); // the head hides the top of the page until it's brought in
  const show = () => root.classList.remove("motion");
  if (!gsap || !ScrollTrigger || matchMedia("(prefers-reduced-motion: reduce)").matches) return show();
  gsap.registerPlugin(ScrollTrigger);
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const mouse = matchMedia("(hover: hover) and (pointer: fine)").matches;

  // a heading's words, each in a box of its own so they can rise one at a time; the text stays the same
  function words(heading) {
    const boxes = [];
    for (const node of [...heading.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE) boxes.push(...words(node));
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const pieces = document.createDocumentFragment();
      for (const piece of node.textContent.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) pieces.append(piece);
        else pieces.append(boxes[boxes.push(Object.assign(document.createElement("span"), { className: "word", textContent: piece })) - 1]);
      }
      node.replaceWith(pieces);
    }
    return boxes;
  }

  // The top of the page: the nav, then the heading word by word, then the rest. On the front page the
  // lantern drops in on its cord and its light spreads; on the Learn page the lamp lights. Only when the head
  // is still waiting: if GSAP was slow and the head showed the page itself, it stays as it is.
  function bringIn() {
    const hero = $(".hero");
    if (!hero) return show();
    const heading = words(hero.querySelector("h1"));
    const parts = [".nav", ...hero.querySelectorAll(".eyebrow, h1, h1 ~ p, .cta > *, .install, .facts li, .card")];
    gsap.set(parts, { autoAlpha: 0 });
    show();
    const up = { autoAlpha: 1, y: 0 };
    const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.8 } });
    // a step for the parts this page has (the Learn page has no lantern or code window, say)
    const step = (targets, from, to, at) => {
      const parts = typeof targets === "string" ? $$(targets) : [...targets];
      if (parts.length) tl.fromTo(parts, from, to, at);
    };
    step(".nav", { y: -14 }, { ...up, duration: 0.7 }, 0);
    step(".lantern", { y: -260 }, { y: 0, duration: 2.2, ease: "elastic.out(1, 0.42)" }, 0);
    step(".halo", { scale: 0.2 }, { scale: 1, duration: 2.4, ease: "power2.out" }, 0.35);
    step(".lamp", { scale: 0 }, { scale: 1, duration: 1.6, ease: "expo.out" }, 0.1);
    step(hero.querySelectorAll(".eyebrow"), { y: 16 }, up, 0.15);
    tl.set(hero.querySelector("h1"), { autoAlpha: 1 }, 0.45);
    step(heading, { autoAlpha: 0, yPercent: 70, rotate: 3 }, { autoAlpha: 1, yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.08 }, 0.45);
    step(hero.querySelectorAll("h1 ~ p, .cta > *, .install"), { y: 18 }, { ...up, stagger: 0.08 }, 0.8);
    step(hero.querySelectorAll(".facts li"), { y: 10, scale: 0.94 }, { ...up, scale: 1, duration: 0.5, stagger: 0.05 }, 1.1);
    step(hero.querySelectorAll(".card"), { y: 70 }, { ...up, duration: 1.2 }, 1.0);
  }

  // The code window under the headline starts tipped back, and stands up as it's scrolled to; when it's in
  // view its lines appear one at a time, then what it says
  function stage() {
    const card = $(".hero .card");
    if (!card) return;
    gsap.fromTo(card, { rotationX: 24, scale: 0.9, transformPerspective: 1400, transformOrigin: "50% 0%" }, {
      rotationX: 0, scale: 1, ease: "none",
      scrollTrigger: { trigger: card, start: "top bottom", end: "top 30%", scrub: 0.6 },
    });
    const typing = gsap.timeline({ paused: true });
    for (const [pre, at] of [[$("#sample"), 0.2], [$("#sample-said"), 1.4]]) {
      const lines = Math.max(1, pre.textContent.split("\n").length);
      gsap.set(pre, { clipPath: "inset(0 0 100% 0)" });
      typing.to(pre, { clipPath: "inset(0 0 0% 0)", duration: lines * 0.13, ease: `steps(${lines})` }, at);
    }
    ScrollTrigger.create({ trigger: card, start: "top 75%", once: true, onEnter: () => typing.play() });
  }

  // Each part further down rises into view as it's scrolled to, a few at a time
  function rises(selector) {
    const parts = $$(selector);
    if (!parts.length) return;
    gsap.set(parts, { autoAlpha: 0, y: 36 });
    ScrollTrigger.batch(parts, {
      start: "top 92%",
      once: true,
      onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power3.out", stagger: 0.08, overwrite: true }),
    });
  }

  // The cursor, for a mouse: a small lamp, and a ring that follows it a moment behind and opens up over
  // anything that can be clicked. Over the playground and anything to type in, the usual cursor comes back.
  function lampCursor() {
    const dot = Object.assign(document.createElement("div"), { className: "cursor-dot" });
    const ring = Object.assign(document.createElement("div"), { className: "cursor-ring" });
    for (const part of [dot, ring]) part.setAttribute("aria-hidden", "true");
    document.body.append(ring, dot);
    root.classList.add("has-cursor");
    gsap.set([dot, ring], { xPercent: -50, yPercent: -50, autoAlpha: 0 });
    const follow = (part, duration) => [gsap.quickTo(part, "x", { duration, ease: "power3" }), gsap.quickTo(part, "y", { duration, ease: "power3" })];
    const [dotX, dotY] = follow(dot, 0.06);
    const [ringX, ringY] = follow(ring, 0.42);
    let shown = false;
    const showCursor = (on) => {
      if (on === shown) return;
      shown = on;
      gsap.to([dot, ring], { autoAlpha: on ? 1 : 0, duration: 0.2, overwrite: "auto" });
    };
    // what's under the cursor decides whether it shows, and whether the ring opens
    const under = (target) => {
      showCursor(!target?.closest(".playground, textarea, input, select, [contenteditable]"));
      ring.classList.toggle("hot", !!target?.closest("a, button, label, summary, [role='button']"));
    };
    let at = null;
    addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      if (!shown) gsap.set([dot, ring], { x: e.clientX, y: e.clientY });
      at = [e.clientX, e.clientY];
      dotX(e.clientX); dotY(e.clientY);
      ringX(e.clientX); ringY(e.clientY);
      under(e.target instanceof Element ? e.target : null);
    }, { passive: true });
    // the page can move under a cursor that stays still
    let looking = false;
    addEventListener("scroll", () => {
      if (!at || looking) return;
      looking = true;
      requestAnimationFrame(() => {
        looking = false;
        under(document.elementFromPoint(...at));
      });
    }, { passive: true });
    root.addEventListener("mouseleave", () => showCursor(false));
    addEventListener("pointerdown", () => gsap.to(ring, { scale: 0.75, duration: 0.15 }));
    addEventListener("pointerup", () => gsap.to(ring, { scale: 1, duration: 0.4, ease: "back.out(3)" }));
  }

  // The moth can't stay away from a light. It flies in and circles the lantern, passing behind it on the far
  // side, its head turned the way it's flying. While a mouse is over the top of the front page, the cursor is
  // the brighter light: the moth flies after it, stopping just short, and the lantern's glow dims; when the
  // mouse leaves, the moth goes back to circling. Nothing moves while the top of the page is out of view.
  function mothFlies() {
    const flight = $(".flight");
    const top = $(".intro");
    if (!flight || !top) return;
    root.classList.add("moving"); // the moth's own drift (in the stylesheet) gives way to this
    const small = innerWidth < 640;
    const [rx, ry] = small ? [86, 26] : [136, 38]; // the circle, seen from a little below
    let follow = null; // the cursor, from the moth's home beside the lantern, while it's over the top of the page
    let [x, y] = [innerWidth * 0.55, -280]; // it comes in from up and to the right
    let turn = 0;
    let clock = 0;
    let inView = true;
    ScrollTrigger.create({ trigger: top, start: "top top", end: "bottom top", onToggle: (self) => (inView = self.isActive) });
    gsap.ticker.add((time, ms) => {
      if (!inView) return;
      const dt = Math.min(ms, 50) / 1000;
      clock += dt;
      const angle = clock * 0.55; // once round in about 11 seconds
      const [toX, toY] = follow ?? [rx * Math.cos(angle), ry * Math.sin(angle) + Math.sin(clock * 6.5) * 3];
      const k = 1 - Math.exp(-dt * (follow ? 2.6 : 1.5));
      const [dx, dy] = [(toX - x) * k, (toY - y) * k];
      x += dx;
      y += dy;
      const heading = Math.hypot(dx, dy) / dt > 30 ? (Math.atan2(dy, dx) * 180) / Math.PI + 90 : 0;
      turn += ((((heading - turn + 540) % 360) - 180) * Math.min(1, dt * 4));
      const far = !follow && Math.sin(angle) < 0; // the far side of the circle is behind the lantern
      gsap.set(flight, { x, y, rotation: turn, scale: follow ? 1 : 0.9 + 0.1 * Math.sin(angle), zIndex: far ? -3 : -1 });
    });
    const halo = $(".halo");
    top.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const box = flight.getBoundingClientRect();
      const homeX = box.left + box.width / 2 - gsap.getProperty(flight, "x");
      const homeY = box.top + box.height / 2 - gsap.getProperty(flight, "y");
      follow = [e.clientX - homeX + 30, e.clientY - homeY - 24];
    });
    top.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && halo && gsap.to(halo, { scale: 0.86, duration: 1.4, ease: "power2.out", overwrite: "auto" }));
    top.addEventListener("pointerleave", () => {
      follow = null;
      if (halo) gsap.to(halo, { scale: 1, duration: 1.4, ease: "power2.out", overwrite: "auto" });
    });
  }

  // Buttons that lean a little toward the cursor, and cards lit where the cursor is, as if by the lamp
  function leaning() {
    for (const button of $$(".btn, .nav a.outlined, .card-head button")) {
      const [toX, toY] = ["x", "y"].map((axis) => gsap.quickTo(button, axis, { duration: 0.5, ease: "power3" }));
      button.addEventListener("pointermove", (e) => {
        const box = button.getBoundingClientRect();
        toX((e.clientX - box.left - box.width / 2) * 0.22);
        toY((e.clientY - box.top - box.height / 2) * 0.32);
      });
      button.addEventListener("pointerleave", () => { toX(0); toY(0); });
    }
    for (const card of $$(".feature, .path, .shot, .next li")) {
      card.classList.add("lit");
      card.addEventListener("pointermove", (e) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - box.left}px`);
        card.style.setProperty("--my", `${e.clientY - box.top}px`);
      });
    }
  }

  // Embers drifting up behind the top of the page, each a few seconds from the bottom to somewhere above, and
  // fading as it goes; none start while the top of the page is scrolled out of view
  function embers() {
    const home = $(".front") ?? $("body > header");
    if (!home) return;
    const box = Object.assign(document.createElement("div"), { className: "embers" });
    box.setAttribute("aria-hidden", "true");
    if (home.matches("header")) box.style.height = "100%";
    home.prepend(box);
    let inView = true;
    ScrollTrigger.create({ trigger: box, start: "top bottom", end: "bottom top", onToggle: (self) => (inView = self.isActive) });
    const { random } = gsap.utils;
    for (let i = 0; i < (innerWidth < 640 ? 12 : 26); i++) {
      const ember = box.appendChild(Object.assign(document.createElement("span"), { className: "ember" }));
      const rise = () => {
        if (!inView) return gsap.delayedCall(2, rise);
        const [width, height] = [box.clientWidth, box.clientHeight];
        const size = random(2, 5);
        const seconds = random(6, 12);
        gsap.set(ember, { x: random(0, width), y: height + 10, width: size, height: size, autoAlpha: 0 });
        gsap.timeline({ delay: random(0, 5), onComplete: rise })
          .to(ember, { x: `+=${random(-120, 120)}`, y: random(height * 0.05, height * 0.6), duration: seconds, ease: "sine.out" }, 0)
          .to(ember, { autoAlpha: random(0.45, 1), duration: 1.4 }, 0)
          .to(ember, { autoAlpha: 0, duration: 2.5 }, seconds - 2.5);
      };
      rise();
    }
  }

  function start() {
    embers();
    mothFlies();
    stage();
    if (waiting && root.classList.contains("motion")) bringIn();
    rises(".section-head, .feature, .shot, .down, .path, .foot, .toc, .lesson, .next");
    if (mouse) {
      lampCursor();
      leaning();
    }
  }
  // the lessons on the Learn page are made by its own script, which has run by DOMContentLoaded
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
