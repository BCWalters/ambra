import { clamp, shouldCommit, easedProgress } from "./motion.mjs";
import { createLeaf, createSlide, createFilmStrip, createGutter } from "./renderers.mjs";

const get = id => document.getElementById(id);
const book = get("book");
const base = get("base");
const moving = get("moving");
const progress = get("progress");
const status = get("status");
let spread = 0;
let turn;
let drag;
let animation = 0;
const rtl = () => get("direction").value === "rtl";
const sampleTitles = ["The quiet path", "Beyond the orchard", "A place to pause", "Across the water"];

function content(number) {
  const element = document.createElement("div");
  element.className = "page-content";
  const title = sampleTitles[(number - 1) % sampleTitles.length];
  if (get("content").value === "art") {
    element.classList.add("art");
    element.innerHTML = `<span class="running">An illustrated journey</span><h2>${title}</h2>
      <svg viewBox="0 0 240 300" aria-label="Original landscape illustration">
        <rect width="240" height="300" fill="${number % 2 ? "#cadcdb" : "#dfd4b4"}"/>
        <circle cx="${50 + number * 13 % 140}" cy="65" r="26" fill="#eabc75"/>
        <path d="M0 230 L70 90 L145 240 L205 120 L240 220 V300 H0" fill="#758e79"/>
        <path d="M0 275 Q90 160 240 260 V300 H0" fill="#405d50"/>
        <path d="M90 300 Q150 220 145 190" fill="none" stroke="#dfc69c" stroke-width="15"/>
      </svg><span class="folio">${number}</span>`;
  } else {
    element.innerHTML = `<span class="running">Field notes / motion study</span><h2>${title}</h2>
      <p>The path followed the edge of the orchard. Between the trees, late light lay quietly on the grass.</p>
      <p>There was no reason to hurry. Every few steps brought a different view: a stone wall, a bend in the lane, a small patch of open sky.</p>
      <p>At the gate we stopped, listening. A breeze moved through the leaves, and the afternoon seemed to turn a page of its own.</p>
      <span class="folio">${number}</span>`;
  }
  element.dataset.page = String(number);
  return element;
}

function page(number, side) {
  const element = document.createElement("div");
  element.className = `page ${side}`;
  element.append(content(number));
  return element;
}

function pages(index) {
  const first = index * 2 + 1;
  return rtl() ? { left: first + 1, right: first } : { left: first, right: first + 1 };
}

function idle() {
  turn = undefined;
  book.dataset.motion = get("style").value;
  moving.replaceChildren();
  const current = pages(spread);
  base.replaceChildren(page(current.left, "left"), page(current.right, "right"), createGutter());
  progress.value = "0";
  get("previous").disabled = spread === 0;
  get("next").disabled = spread === 3;
  get("cancel").disabled = true;
  get("commit").disabled = true;
  status.textContent = `Pages ${spread * 2 + 1}-${spread * 2 + 2}`;
  book.dataset.state = "idle";
  book.dataset.spread = String(spread);
}

function begin(direction) {
  if (turn || spread + direction < 0 || spread + direction > 3) return false;
  const side = direction * (rtl() ? -1 : 1);
  const oldPages = pages(spread);
  const newPages = pages(spread + direction);
  const style = get("style").value;
  const renderers = { curl: createLeaf, rigid: context => createLeaf(context, true), slide: createSlide, film: createFilmStrip };
  const paint = renderers[style]({ book, base, moving, side, oldPages, newPages, page, content, curl: () => Number(get("curl").value) });
  turn = { direction, side, progress: 0, paint };
  get("previous").disabled = true;
  get("next").disabled = true;
  get("cancel").disabled = false;
  get("commit").disabled = false;
  book.dataset.state = "turning";
  render(0);
  return true;
}

function render(value) {
  if (!turn) return;
  const p = clamp(value);
  turn.progress = p;
  progress.value = String(p);
  book.dataset.progress = String(p);
  turn.paint(p);
  status.textContent = `${turn.direction > 0 ? "Next" : "Previous"} / ${Math.round(p * 100)}%`;
}

function settle(commit) {
  if (!turn) return;
  cancelAnimationFrame(animation);
  const start = turn.progress;
  const target = commit ? 1 : 0;
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 :
    Number(get("duration").value) * Math.max(0.25, Math.abs(target - start));
  const started = performance.now();
  book.dataset.state = "settling";
  get("cancel").disabled = true;
  get("commit").disabled = true;
  const tick = now => {
    const t = duration ? clamp((now - started) / duration) : 1;
    render(start + (target - start) * easedProgress(t));
    if (t < 1) animation = requestAnimationFrame(tick);
    else {
      if (commit) spread += turn.direction;
      idle();
    }
  };
  animation = requestAnimationFrame(tick);
}

get("next").onclick = () => { if (begin(1)) settle(true); };
get("previous").onclick = () => { if (begin(-1)) settle(true); };
get("cancel").onclick = () => settle(false);
get("commit").onclick = () => settle(true);
progress.oninput = () => {
  if (book.dataset.state === "settling") {
    progress.value = String(turn.progress);
    return;
  }
  const value = Number(progress.value);
  if (turn || begin(spread < 3 ? 1 : -1)) render(value);
};
for (const id of ["style", "content", "direction"]) {
  get(id).onchange = () => {
    cancelAnimationFrame(animation);
    if (drag) {
      book.releasePointerCapture(drag.id);
      drag = undefined;
    }
    idle();
  };
}
for (const id of ["duration", "curl"]) {
  get(id).oninput = () => {
    get(`${id}-value`).value = id === "duration" ? `${get(id).value} ms` : get(id).value;
    if (turn && book.dataset.state !== "settling") render(turn.progress);
  };
}
book.onpointerdown = event => {
  if (turn || !event.isPrimary || event.button !== 0) return;
  const bounds = book.getBoundingClientRect();
  const side = event.clientX > bounds.left + bounds.width / 2 ? 1 : -1;
  const direction = side * (rtl() ? -1 : 1);
  if (!begin(direction)) return;
  drag = { id: event.pointerId, startX: event.clientX, x: event.clientX, time: event.timeStamp, velocity: 0, travel: 0 };
  book.setPointerCapture(event.pointerId);
};
book.onpointermove = event => {
  if (!drag || event.pointerId !== drag.id) return;
  const dt = event.timeStamp - drag.time;
  if (dt > 0) drag.velocity = turn.side * (drag.x - event.clientX) / dt;
  drag.x = event.clientX;
  drag.time = event.timeStamp;
  drag.travel = Math.max(drag.travel, Math.abs(drag.startX - event.clientX));
  render(turn.side * (drag.startX - event.clientX) / book.clientWidth);
};
function endDrag(event, cancelled) {
  if (!drag || event.pointerId !== drag.id) return;
  const velocity = event.timeStamp - drag.time > 100 ? 0 : drag.velocity;
  const commit = !cancelled && (drag.travel < 6 || shouldCommit(turn.progress, velocity));
  const id = drag.id;
  drag = undefined;
  if (book.hasPointerCapture(id)) book.releasePointerCapture(id);
  settle(commit);
}
book.onpointerup = event => endDrag(event, false);
book.onpointercancel = event => endDrag(event, true);
book.onlostpointercapture = event => endDrag(event, true);
document.addEventListener("keydown", event => {
  if (event.target.closest("input, select, button")) return;
  if (event.key === "Escape" && turn) {
    const pointerId = drag?.id;
    drag = undefined;
    if (pointerId !== undefined && book.hasPointerCapture(pointerId)) book.releasePointerCapture(pointerId);
    settle(false);
  } else if (!turn && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const direction = (event.key === "ArrowRight" ? 1 : -1) * (rtl() ? -1 : 1);
    if (begin(direction)) settle(true);
  }
});
new ResizeObserver(() => { if (turn) render(turn.progress); }).observe(book);
idle();
