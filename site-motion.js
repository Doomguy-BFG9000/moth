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

  // The top of the page: the nav, then the heading word by word, then the rest; on the front page the lamp
  // lights, the moth flies in, and the example's lines appear one at a time, then what it says. Only when the
  // head is still waiting: if GSAP was slow and the head showed the page itself, it stays as it is.
  function bringIn() {
    const hero = $(".hero");
    if (!hero) return show();
    const heading = words(hero.querySelector("h1"));
    const parts = [".nav", ...hero.querySelectorAll(".pill, .eyebrow, h1, h1 ~ p, .cta > *, .install, .facts li, .card")];
    gsap.set(parts, { autoAlpha: 0 });
    show();
    const up = { autoAlpha: 1, y: 0 };
    const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.8 } });
    // a step for the parts this page has (the Learn page has no facts or code card, say)
    const step = (targets, from, to, at) => {
      const parts = typeof targets === "string" ? $$(targets) : [...targets];
      if (parts.length) tl.fromTo(parts, from, to, at);
    };
    step(".nav", { y: -14 }, { ...up, duration: 0.7 }, 0);
    step(".lamp", { scale: 0 }, { scale: 1, duration: 1.6, ease: "expo.out" }, 0.1);
    step(".flight", { x: 180, y: -70, autoAlpha: 0 }, { x: 0, y: 0, autoAlpha: 1, duration: 2, ease: "power2.out" }, 0.3);
    step(hero.querySelectorAll(".pill, .eyebrow"), { y: 16 }, up, 0.15);
    tl.set(hero.querySelector("h1"), { autoAlpha: 1 }, 0.25);
    step(heading, { autoAlpha: 0, yPercent: 70, rotate: 3 }, { autoAlpha: 1, yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.07 }, 0.25);
    step(hero.querySelectorAll("h1 ~ p, .cta > *, .install"), { y: 18 }, { ...up, stagger: 0.08 }, 0.55);
    step(hero.querySelectorAll(".facts li"), { y: 10, scale: 0.94 }, { ...up, scale: 1, duration: 0.5, stagger: 0.05 }, 0.85);
    const card = hero.querySelector(".card");
    if (card) {
      tl.fromTo(card, { y: 50, rotationX: 12, transformPerspective: 1000, transformOrigin: "50% 100%" }, { ...up, rotationX: 0, duration: 1.2 }, 0.35);
      for (const [pre, at] of [[$("#sample"), 0.9], [$("#sample-said"), 1.9]]) {
        const lines = Math.max(1, pre.textContent.split("\n").length);
        tl.fromTo(pre, { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)", duration: lines * 0.12, ease: `steps(${lines})` }, at);
      }
    }
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

  // The moth can't stay away from a light: while the mouse is over the top of the front page, the moth flies
  // after the cursor, stopping just short of it, and the lamp in the corner dims; when it leaves, it goes home
  function mothFollows() {
    const flight = $(".flight");
    const top = $(".intro");
    if (!flight || !top) return;
    const [toX, toY] = ["x", "y"].map((axis) => gsap.quickTo(flight, axis, { duration: 1.8, ease: "power2.out" }));
    top.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const box = flight.getBoundingClientRect();
      const homeX = box.left + box.width / 2 - gsap.getProperty(flight, "x");
      const homeY = box.top + box.height / 2 - gsap.getProperty(flight, "y");
      toX(e.clientX - homeX + 34);
      toY(e.clientY - homeY - 26);
    });
    top.addEventListener("pointerenter", () => gsap.to(".lamp", { scale: 0.7, duration: 1.2, ease: "power2.out", overwrite: "auto" }));
    top.addEventListener("pointerleave", () => {
      toX(0);
      toY(0);
      gsap.to(".lamp", { scale: 1, duration: 1.2, ease: "power2.out", overwrite: "auto" });
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
    if (waiting && root.classList.contains("motion")) bringIn();
    rises(".section-head, .feature, .shot, .down, .path, .foot, .toc, .lesson, .next");
    if (mouse) {
      lampCursor();
      mothFollows();
      leaning();
    }
  }
  // the lessons on the Learn page are made by its own script, which has run by DOMContentLoaded
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
