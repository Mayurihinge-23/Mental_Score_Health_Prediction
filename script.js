"use strict";

/* ---------- Config ---------- */
const API_BASE_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 20000;

// Same list used by the backend's `top_countries` plus a few common extras.
// The field is free text on the backend (`country: str`), so any value is allowed.
const COUNTRIES = [
  "India", "USA", "Canada", "Australia", "UK", "Germany", "Mexico", "Turkey", "France", "Other",
  "Brazil", "China", "Japan", "South Korea", "Russia", "Pakistan", "Bangladesh", "Nigeria",
  "Italy", "Spain", "Netherlands", "Indonesia", "Egypt", "South Africa",
];

// Fields in the order of the StudentData Pydantic model
const NUMERIC_FIELDS = {
  age: "int",
  avg_daily_usage_hours: "float",
  daily_unlocks: "int",
  study_hours: "float",
  physical_activity_hours: "float",
  sleep_hours_per_night: "float",
};

const LABELS = {
  age: "Age", gender: "Gender", country: "Country", academic_level: "Academic level",
  most_used_platform: "Platform", purpose_of_use: "Purpose",
  avg_daily_usage_hours: "Daily usage", daily_unlocks: "Unlocks",
  study_hours: "Study", physical_activity_hours: "Activity",
  sleep_hours_per_night: "Sleep", stress_level: "Stress",
};

const SAMPLE = {
  age: 20, gender: "Female", country: "India", academic_level: "Undergraduate",
  most_used_platform: "Instagram", purpose_of_use: "Entertainment",
  avg_daily_usage_hours: 5.5, daily_unlocks: 90, study_hours: 4,
  physical_activity_hours: 1, sleep_hours_per_night: 6.5, stress_level: "High",
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const form = $("predictForm");
const submitBtn = $("submitBtn");
const formAlert = $("formAlert");
const states = {
  idle: $("stateIdle"), loading: $("stateLoading"),
  error: $("stateError"), result: $("stateResult"),
};

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  $("apiBaseLabel").textContent = API_BASE_URL;
  $("countryList").innerHTML = COUNTRIES.map((c) => `<option value="${c}"></option>`).join("");
  checkApi();
});

form.addEventListener("submit", onSubmit);
$("resetBtn").addEventListener("click", resetAll);
$("sampleBtn").addEventListener("click", fillSample);
$("retryBtn").addEventListener("click", () => form.requestSubmit());

// Clear a field's error as soon as the user edits it
form.addEventListener("input", (e) => clearFieldError(e.target.name));
form.addEventListener("change", (e) => clearFieldError(e.target.name));

/* ---------- API status ping ---------- */
async function checkApi() {
  const box = $("apiStatus"), text = $("apiStatusText");
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/`, {}, 5000);
    if (!res.ok) throw new Error();
    box.className = "status online";
    text.textContent = "API online";
  } catch {
    box.className = "status offline";
    text.textContent = "API offline – start uvicorn on port 8000";
  }
}

/* ---------- Submit ---------- */
async function onSubmit(e) {
  e.preventDefault();
  hideAlert();
  clearAllErrors();

  const { payload, errors } = collectAndValidate();
  if (Object.keys(errors).length) {
    Object.entries(errors).forEach(([f, m]) => setFieldError(f, m));
    showAlert("Please fix the highlighted fields and try again.");
    focusFirstInvalid();
    return;
  }

  setLoading(true);
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }, REQUEST_TIMEOUT_MS);

    const data = await res.json().catch(() => null);

    if (res.ok) {
      const score = data?.predicted_mental_health_score;
      if (typeof score !== "number") throw new ApiError("Unexpected response", "The server returned an unexpected response format.");
      $("apiStatus").className = "status online";
      $("apiStatusText").textContent = "API online";
      showResult(score, payload);
    } else if (res.status === 422 && Array.isArray(data?.detail)) {
      handleValidationErrors(data.detail);
    } else {
      const detail = typeof data?.detail === "string" ? data.detail : null;
      throw new ApiError(`Server error (${res.status})`,
        detail || "The server could not process this request. Check the backend terminal for details.");
    }
  } catch (err) {
    handleFailure(err);
  } finally {
    setLoading(false);
  }
}

/* ---------- Validation (mirrors the Pydantic constraints) ---------- */
function collectAndValidate() {
  const fd = new FormData(form);
  const payload = {}, errors = {};
  const get = (k) => (fd.get(k) ?? "").toString().trim();

  // Numbers
  const rules = {
    age: [10, 100], avg_daily_usage_hours: [0, 24], daily_unlocks: [0, Infinity],
    study_hours: [0, 24], physical_activity_hours: [0, 24], sleep_hours_per_night: [0, 24],
  };
  for (const [name, type] of Object.entries(NUMERIC_FIELDS)) {
    const raw = get(name);
    const [min, max] = rules[name];
    if (raw === "") { errors[name] = "This field is required."; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { errors[name] = "Enter a valid number."; continue; }
    if (type === "int" && !Number.isInteger(n)) { errors[name] = "Must be a whole number."; continue; }
    if (n < min) { errors[name] = `Must be at least ${min}.`; continue; }
    if (n > max) { errors[name] = `Must be at most ${max}.`; continue; }
    payload[name] = n;
  }

  // Strings / enums
  ["gender", "country", "academic_level", "most_used_platform", "purpose_of_use", "stress_level"].forEach((name) => {
    const v = get(name);
    if (!v) errors[name] = "This field is required.";
    else payload[name] = v;
  });

  // Return payload in model order
  const ordered = {};
  Object.keys(LABELS).forEach((k) => { if (k in payload) ordered[k] = payload[k]; });
  return { payload: ordered, errors };
}

/* FastAPI 422: detail = [{ loc: ["body","age"], msg, type }, ...] */
function handleValidationErrors(detail) {
  let unmatched = [];
  detail.forEach((d) => {
    const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
    const msg = prettyMessage(d);
    if (field && form.elements[field]) setFieldError(field, msg);
    else unmatched.push(msg);
  });
  showAlert(unmatched.length ? unmatched.join(" ") : "The server rejected some of the values. Please review the highlighted fields.");
  showState("idle");
  focusFirstInvalid();
}

function prettyMessage(d) {
  const ctx = d.ctx || {};
  switch (d.type) {
    case "greater_than_equal": return `Must be at least ${ctx.ge}.`;
    case "less_than_equal": return `Must be at most ${ctx.le}.`;
    case "literal_error": return `Choose one of the available options.`;
    case "missing": return "This field is required.";
    case "int_parsing": case "int_from_float": return "Must be a whole number.";
    case "float_parsing": return "Enter a valid number.";
    default: return d.msg || "Invalid value.";
  }
}

/* ---------- Failure handling ---------- */
class ApiError extends Error {
  constructor(title, message) { super(message); this.title = title; }
}

function handleFailure(err) {
  let title = "Something went wrong", msg = err.message || "Unknown error.";
  if (err instanceof ApiError) {
    title = err.title;
  } else if (err.name === "AbortError") {
    title = "Request timed out";
    msg = "The server took too long to respond. Please try again.";
  } else if (err instanceof TypeError) {
    // fetch() network failure (server down, wrong port, CORS blocked)
    title = "Can't reach the server";
    msg = `Could not connect to ${API_BASE_URL}. Make sure FastAPI is running: uvicorn main:app --port 8000 --reload`;
    $("apiStatus").className = "status offline";
    $("apiStatusText").textContent = "API offline";
  }
  $("errorTitle").textContent = title;
  $("errorMessage").textContent = msg;
  showState("error");
  scrollToResultOnMobile();
}

/* ---------- Result rendering ---------- */
const GAUGE_LEN = 252; // approx. length of the semicircle path

function showResult(score, payload) {
  const clamped = Math.max(0, Math.min(10, score));
  const tier = getTier(score);

  $("resultChip").textContent = tier.chip;
  $("resultChip").style.background = tier.color;
  $("resultTitle").textContent = tier.title;
  $("resultText").textContent = tier.text;

  $("inputSummary").innerHTML = ["age", "country", "avg_daily_usage_hours", "sleep_hours_per_night", "stress_level"]
    .map((k) => {
      const suffix = k.endsWith("hours") ? " h" : "";
      return `<span>${LABELS[k]}: <b>${escapeHtml(String(payload[k]))}${suffix}</b></span>`;
    }).join("");

  showState("result");

  // Animate gauge + counter
  const fill = $("gaugeFill");
  fill.style.strokeDashoffset = GAUGE_LEN;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.strokeDashoffset = GAUGE_LEN * (1 - clamped / 10);
  }));
  animateNumber($("scoreValue"), score, 1200);
  scrollToResultOnMobile();
}

// In the training data (Students' Social Media Addiction), a higher score = better mental health.
function getTier(s) {
  if (s >= 8) return { chip: "Excellent", color: "#22c55e", title: "Great mental wellbeing", text: "The model predicts a high score. Current habits look supportive of good mental health." };
  if (s >= 6) return { chip: "Good", color: "#84cc16", title: "Generally healthy", text: "A fairly positive outlook, with some room to improve sleep, activity or screen time." };
  if (s >= 4) return { chip: "Moderate", color: "#f59e0b", title: "Moderate wellbeing", text: "Some patterns may be affecting wellbeing. Consider reducing usage and prioritising rest." };
  return { chip: "Needs attention", color: "#ef4444", title: "Low predicted score", text: "The model flags a lower score. Healthier sleep, less screen time and support can help." };
}

function animateNumber(el, to, duration) {
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = (to * eased).toFixed(2);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = to.toFixed(2);
  };
  requestAnimationFrame(tick);
}

/* ---------- UI helpers ---------- */
function showState(name) {
  Object.entries(states).forEach(([k, el]) => { el.hidden = k !== name; });
}

function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle("loading", on);
  submitBtn.querySelector(".btn-label").textContent = on ? "Predicting…" : "Predict Score";
  if (on) { showState("loading"); scrollToResultOnMobile(); }
}

function setFieldError(name, msg) {
  const holder = form.querySelector(`[data-error-for="${name}"]`);
  if (!holder) { showAlert(msg); return; }
  holder.textContent = msg;
  holder.closest(".field")?.classList.add("invalid");
}

function clearFieldError(name) {
  if (!name) return;
  const holder = form.querySelector(`[data-error-for="${name}"]`);
  if (!holder) return;
  holder.textContent = "";
  holder.closest(".field")?.classList.remove("invalid");
}

function clearAllErrors() {
  form.querySelectorAll("[data-error-for]").forEach((h) => (h.textContent = ""));
  form.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
}

function focusFirstInvalid() {
  const f = form.querySelector(".field.invalid");
  f?.scrollIntoView({ behavior: "smooth", block: "center" });
  f?.querySelector("input, select")?.focus({ preventScroll: true });
}

function showAlert(msg) { formAlert.textContent = msg; formAlert.hidden = false; }
function hideAlert() { formAlert.hidden = true; }

function resetAll() {
  form.reset();
  clearAllErrors();
  hideAlert();
  showState("idle");
}

function fillSample() {
  resetAll();
  Object.entries(SAMPLE).forEach(([name, value]) => {
    const els = form.elements[name];
    if (!els) return;
    if (els instanceof RadioNodeList) els.value = value;
    else els.value = value;
  });
  toast("Sample data filled in");
}

function scrollToResultOnMobile() {
  if (window.matchMedia("(max-width: 920px)").matches) {
    $("resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2000);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fetchWithTimeout(url, options = {}, ms = 15000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}
