/**
 * Nol-Post sidepanel — Sync / 예약 / NOL Rec / Progress
 */

const STORAGE_KEY = "serverTimeUrl";
const SCHED_REC_KEY = "schedRecInputs";
const NOL_REC_FIELDS_KEY = "nolRecFields";

const urlInput = document.getElementById("url-input");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const timeDisplay = document.getElementById("time-display");
const statusText = document.getElementById("status-text");
const rttValue = document.getElementById("rtt-value");

const nolAutoUrl = document.getElementById("nol-auto-url");
const nolAutoIndex = document.getElementById("nol-auto-index");
const nolAutoText = document.getElementById("nol-auto-text");
const nolGoodsCode = document.getElementById("nol-goods-code");
const nolPlaceCode = document.getElementById("nol-place-code");
const nolBtnPick = document.getElementById("nol-btn-pick");
const nolBtnScanBtn = document.getElementById("nol-btn-scan-btn");
const nolActivateBtn = document.getElementById("nol-activate-btn");
const nolAutoClickBtn = document.getElementById("nol-auto-click-btn");
const nolAutoStatus = document.getElementById("nol-auto-status");
const nolActivateStatus = document.getElementById("nol-activate-status");
const nolRecState = document.getElementById("nol-rec-state");

let nolScannedButtons = [];

const schedHh = document.getElementById("sched-hh");
const schedMm = document.getElementById("sched-mm");
const schedSs = document.getElementById("sched-ss");
const schedMs = document.getElementById("sched-ms");
const schedRecArmBtn = document.getElementById("sched-rec-arm-btn");
const schedRecClearBtn = document.getElementById("sched-rec-clear-btn");
const schedRecState = document.getElementById("sched-rec-state");
const schedRecStatus = document.getElementById("sched-rec-status");

const progressLogEl = document.getElementById("progress-log");
const progressLogWrap = document.getElementById("progress-log-wrap");
const progressLogToggle = document.getElementById("progress-log-toggle");
const progressLogBody = document.getElementById("progress-log-body");
const progressLogCount = document.getElementById("progress-log-count");
const clearProgressBtn = document.getElementById("clear-progress-btn");
const copyProgressBtn = document.getElementById("copy-progress-btn");

let offsetMs = null;
let rafId = null;
let running = false;
let scheduleRecArmed = false;
let scheduleRecTargetMs = null;
let nolRecArmed = false;

function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}

function formatServerTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(
    d.getMilliseconds(),
    3
  )}`;
}

function setStatus(message, type = "") {
  if (!statusText) return;
  statusText.textContent = message;
  statusText.className = type ? `status ${type}` : "status";
}

function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("URL을 입력해주세요.");
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).href;
  } catch {
    throw new Error("올바른 URL 형식이 아닙니다.");
  }
}

function isProgressOpen() {
  return Boolean(progressLogWrap?.classList.contains("is-open"));
}

function setProgressOpen(open) {
  if (!progressLogWrap || !progressLogToggle || !progressLogBody) return;
  progressLogWrap.classList.toggle("is-open", open);
  progressLogToggle.setAttribute("aria-expanded", open ? "true" : "false");
  progressLogBody.hidden = !open;
  if (open) {
    progressLogCount?.classList.remove("has-new");
    if (progressLogEl) progressLogEl.scrollTop = progressLogEl.scrollHeight;
  }
}

function updateProgressCount() {
  if (!progressLogCount || !progressLogEl) return;
  progressLogCount.textContent = String(progressLogEl.querySelectorAll(".plog").length);
}

function appendProgressLog(text, level = "info", source = "ui") {
  if (!progressLogEl || !text) return;
  const row = document.createElement("div");
  row.className = `plog ${level}`;
  const now = new Date();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const mark = level === "ok" ? "OK" : level === "error" ? "ERR" : level === "warn" ? "!" : "·";
  row.dataset.raw = `[${time}] ${mark} ${source} ${String(text)}`;
  row.innerHTML =
    `<span class="plog-time">${time}</span>` +
    `<span class="plog-mark">${mark}</span>` +
    `<span class="plog-src">${source}</span>` +
    `<span class="plog-msg"></span>`;
  row.querySelector(".plog-msg").textContent = String(text);
  progressLogEl.appendChild(row);
  progressLogEl.scrollTop = progressLogEl.scrollHeight;
  while (progressLogEl.children.length > 200) {
    progressLogEl.removeChild(progressLogEl.firstChild);
  }
  updateProgressCount();
  if (!isProgressOpen()) progressLogCount?.classList.add("has-new");
}

async function copyProgressLogAll() {
  if (!progressLogEl) return;
  const lines = [...progressLogEl.querySelectorAll(".plog")]
    .map((row) => row.dataset.raw || row.textContent || "")
    .filter(Boolean);
  if (!lines.length) {
    appendProgressLog("복사할 로그 없음", "warn", "ui");
    return;
  }
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    appendProgressLog(`로그 ${lines.length}줄 복사됨`, "ok", "ui");
  } catch (error) {
    appendProgressLog(`복사 실패: ${error.message || error}`, "error", "ui");
  }
}

progressLogToggle?.addEventListener("click", () => setProgressOpen(!isProgressOpen()));
copyProgressBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  void copyProgressLogAll();
});
clearProgressBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (progressLogEl) progressLogEl.innerHTML = "";
  updateProgressCount();
  progressLogCount?.classList.remove("has-new");
});

function startClock() {
  if (rafId !== null) return;
  const tick = () => {
    if (offsetMs === null) {
      rafId = null;
      return;
    }
    if (timeDisplay) timeDisplay.textContent = formatServerTime(Date.now() + offsetMs);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopClock({ resetDisplay = false } = {}) {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (resetDisplay && timeDisplay) timeDisplay.textContent = "--:--:-- ---";
}

function setNolRecUi(armed) {
  nolRecArmed = Boolean(armed);
  if (nolRecState) {
    nolRecState.textContent = nolRecArmed ? "ON" : "Idle";
    nolRecState.classList.toggle("on", nolRecArmed);
  }
  if (nolAutoClickBtn) {
    nolAutoClickBtn.textContent = nolRecArmed ? "■ Stop" : "● NOL Rec";
    nolAutoClickBtn.classList.toggle("is-on", nolRecArmed);
  }
}

function buildNolPayload() {
  return {
    type: "START_AUTO_REC",
    site: "nol",
    url: nolAutoUrl?.value?.trim() || "",
    index: nolAutoIndex?.value || "1",
    text: nolAutoText?.value?.trim() || "예매하기",
    goodsCode: nolGoodsCode?.value?.trim() || "",
    placeCode: nolPlaceCode?.value?.trim() || "",
  };
}

function setActivateStatus(text, level = "") {
  if (!nolActivateStatus) return;
  nolActivateStatus.textContent = text;
  nolActivateStatus.className = level ? `status ${level}` : "status";
}

function fillNolBtnPick(buttons) {
  if (!nolBtnPick) return;
  nolBtnPick.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = buttons.length ? `스캔 ${buttons.length}개 — 선택` : "목록 스캔 후 선택";
  nolBtnPick.appendChild(ph);
  for (const b of buttons) {
    const opt = document.createElement("option");
    opt.value = String(b.index);
    const flag = b.forced ? "[ON] " : b.disabled ? "[?] " : "";
    const name = (b.goodsName || b.text || "").slice(0, 36);
    opt.textContent = `#${b.index} ${flag}${name} · ${b.goodsCode || "?"}`;
    nolBtnPick.appendChild(opt);
  }
}

function applyNolBtnPick(indexStr) {
  const b = nolScannedButtons.find((x) => String(x.index) === String(indexStr));
  if (!b) return;
  if (nolAutoIndex) nolAutoIndex.value = String(b.index);
  if (nolGoodsCode) nolGoodsCode.value = b.goodsCode || "";
  if (nolPlaceCode) nolPlaceCode.value = b.placeCode || "";
  if (nolAutoText && b.text) {
    // 오픈예정이어도 Rec 라벨은 예매하기로 — 활성화 후 맞춤
    nolAutoText.value = /예매하기/.test(b.text) ? "예매하기" : b.text.slice(0, 20);
  }
  setActivateStatus(
    `${b.goodsName || b.text || ""} · open ${b.bookingOpenTime || "-"} · ${b.disabled ? "비활성" : "활성"}`,
    b.disabled ? "warn" : "ok"
  );
}

async function scanNolButtons() {
  setActivateStatus("스캔 중…", "");
  appendProgressLog("NOL 버튼 목록 스캔", "info", "ui");
  const result = await chrome.runtime.sendMessage({ type: "NOL_SCAN_BUTTONS" });
  if (!result?.ok) {
    const err = result?.error || "스캔 실패";
    setActivateStatus(err, "error");
    appendProgressLog(err, "error", "ui");
    return;
  }
  nolScannedButtons = result.buttons || [];
  fillNolBtnPick(nolScannedButtons);
  setActivateStatus(`${nolScannedButtons.length}개 · 선택 후 값 수정/활성화`, "ok");
  appendProgressLog(`스캔 ${nolScannedButtons.length}개`, "ok", "ui");
}

async function activateNolButton() {
  const goodsCode = nolGoodsCode?.value?.trim() || "";
  const placeCode = nolPlaceCode?.value?.trim() || "";
  const index = nolAutoIndex?.value || "1";
  // 스캔 원본 goodsCode로 대상을 찾고, 입력칸 값으로 패치
  const picked = nolScannedButtons.find((x) => String(x.index) === String(index));
  const findGoods = picked?.goodsCode || goodsCode;
  setActivateStatus("활성화·패치 중…", "");
  appendProgressLog(
    `활성화 · find=${findGoods || `index ${index}`} → gc=${goodsCode || "-"} pc=${placeCode || "-"}`,
    "info",
    "ui"
  );
  const result = await chrome.runtime.sendMessage({
    type: "NOL_ACTIVATE_PATCH",
    goodsCode: findGoods,
    index,
    text: "",
    patchGoodsCode: goodsCode,
    patchPlaceCode: placeCode,
    forceLabel: "예매하기",
  });
  if (!result?.ok) {
    const err = result?.error || "활성화 실패";
    setActivateStatus(err, "error");
    appendProgressLog(err, "error", "ui");
    return;
  }
  if (nolAutoText) nolAutoText.value = "예매하기";
  if (goodsCode && nolGoodsCode) nolGoodsCode.value = result.after?.goodsCode || goodsCode;
  if (result.after?.placeCode && nolPlaceCode) nolPlaceCode.value = result.after.placeCode;
  setActivateStatus(
    `OK · ${result.before?.goodsCode || "?"}→${result.after?.goodsCode || "?"} · disabled ${result.wasDisabled ? "해제" : "그대로"}`,
    "ok"
  );
  appendProgressLog("활성화·값교체 완료 — Rec 가능", "ok", "ui");
  // 목록 갱신
  void scanNolButtons();
}

async function startNolRecFromUi({ source = "ui" } = {}) {
  const payload = buildNolPayload();
  appendProgressLog(
    `NOL Rec 시작 (goodsCode=${payload.goodsCode || "-"}, index=${payload.index})`,
    "info",
    source
  );
  void chrome.storage.local.set({
    [NOL_REC_FIELDS_KEY]: {
      url: payload.url,
      index: payload.index,
      text: payload.text,
      goodsCode: payload.goodsCode,
      placeCode: payload.placeCode,
    },
  });
  const result = await chrome.runtime.sendMessage(payload);
  if (result?.ok) {
    setNolRecUi(true);
    appendProgressLog("NOL · 예매 버튼 대기 중", "ok", source);
    if (nolAutoStatus) {
      nolAutoStatus.textContent = "감시 중…";
      nolAutoStatus.className = "status ok";
    }
    return { ok: true };
  }
  const err = result?.error || "Rec 시작 실패";
  if (nolAutoStatus) {
    nolAutoStatus.textContent = err;
    nolAutoStatus.className = "status error";
  }
  appendProgressLog(err, "error", source);
  return { ok: false, error: err };
}

async function stopNolRecFromUi({ source = "ui" } = {}) {
  appendProgressLog("NOL Rec 중지", "info", source);
  const result = await chrome.runtime.sendMessage({ type: "STOP_AUTO_REC", site: "nol" });
  if (result?.ok) setNolRecUi(false);
}

nolAutoClickBtn?.addEventListener("click", () => {
  if (nolRecArmed) void stopNolRecFromUi();
  else void startNolRecFromUi();
});

nolBtnScanBtn?.addEventListener("click", () => void scanNolButtons());
nolActivateBtn?.addEventListener("click", () => void activateNolButton());
nolBtnPick?.addEventListener("change", () => {
  if (nolBtnPick.value) applyNolBtnPick(nolBtnPick.value);
});

chrome.storage.local.get(NOL_REC_FIELDS_KEY).then((data) => {
  const f = data[NOL_REC_FIELDS_KEY];
  if (!f) return;
  if (nolAutoUrl && f.url != null) nolAutoUrl.value = String(f.url);
  if (nolAutoIndex && f.index != null) nolAutoIndex.value = String(f.index);
  if (nolAutoText && f.text != null) nolAutoText.value = String(f.text);
  if (nolGoodsCode && f.goodsCode != null) nolGoodsCode.value = String(f.goodsCode);
  if (nolPlaceCode && f.placeCode != null) nolPlaceCode.value = String(f.placeCode);
}).catch(() => {});

function clampInt(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function readSchedParts() {
  return {
    hh: clampInt(schedHh?.value, 0, 23, 0),
    mm: clampInt(schedMm?.value, 0, 59, 0),
    ss: clampInt(schedSs?.value, 0, 59, 0),
    ms: clampInt(schedMs?.value, 0, 999, 0),
  };
}

function syncSchedInputs() {
  const p = readSchedParts();
  if (schedHh) schedHh.value = String(p.hh);
  if (schedMm) schedMm.value = String(p.mm);
  if (schedSs) schedSs.value = String(p.ss);
  if (schedMs) schedMs.value = String(p.ms);
  return p;
}

function formatSchedLabel(p) {
  return `${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}.${pad(p.ms, 3)}`;
}

function setSchedRecStatus(text, level = "") {
  if (schedRecStatus) {
    schedRecStatus.textContent = text;
    schedRecStatus.className = level ? `status ${level}` : "status";
  }
  if (schedRecState) {
    schedRecState.textContent = scheduleRecArmed ? "Armed" : "Idle";
    schedRecState.classList.toggle("on", scheduleRecArmed);
  }
  if (schedRecArmBtn) {
    schedRecArmBtn.textContent = scheduleRecArmed ? "예약중" : "예약";
    schedRecArmBtn.classList.toggle("is-on", !scheduleRecArmed);
  }
}

async function armScheduleRec() {
  const parts = syncSchedInputs();
  const recPayload = buildNolPayload();
  void chrome.storage.local.set({ [SCHED_REC_KEY]: { ...parts, site: "nol" } });
  const result = await chrome.runtime.sendMessage({
    type: "ARM_SCHED_REC",
    parts,
    site: "nol",
    recPayload,
  });
  if (!result?.ok) {
    setSchedRecStatus(result?.error || "예약 실패", "error");
    scheduleRecArmed = false;
    return;
  }
  scheduleRecArmed = true;
  scheduleRecTargetMs = result.targetMs ?? null;
  setSchedRecStatus(`예약 대기 → ${formatSchedLabel(parts)} · NOL`, "ok");
  appendProgressLog(`예약 설정 · ${formatSchedLabel(parts)} · NOL`, "ok", "sched");
}

function disarmScheduleRec() {
  scheduleRecArmed = false;
  scheduleRecTargetMs = null;
  void chrome.runtime.sendMessage({ type: "DISARM_SCHED_REC" }).catch(() => {});
  setSchedRecStatus("예약 해제됨", "");
}

schedRecArmBtn?.addEventListener("click", () => void armScheduleRec());
schedRecClearBtn?.addEventListener("click", () => {
  disarmScheduleRec();
  appendProgressLog("예약 해제", "info", "sched");
});

for (const el of [schedHh, schedMm, schedSs, schedMs]) {
  el?.addEventListener("change", () => {
    const parts = syncSchedInputs();
    void chrome.storage.local.set({ [SCHED_REC_KEY]: { ...parts, site: "nol" } });
    if (scheduleRecArmed) void armScheduleRec();
  });
}

chrome.storage.local.get(SCHED_REC_KEY).then((data) => {
  const p = data[SCHED_REC_KEY];
  if (!p) return;
  if (schedHh && p.hh != null) schedHh.value = String(clampInt(p.hh, 0, 23, 0));
  if (schedMm && p.mm != null) schedMm.value = String(clampInt(p.mm, 0, 59, 0));
  if (schedSs && p.ss != null) schedSs.value = String(clampInt(p.ss, 0, 59, 0));
  if (schedMs && p.ms != null) schedMs.value = String(clampInt(p.ms, 0, 999, 0));
}).catch(() => {});

async function startSync() {
  try {
    const url = normalizeUrl(urlInput?.value);
    if (urlInput) urlInput.value = url;
    setStatus("연결 중…", "");
    const result = await chrome.runtime.sendMessage({ type: "START_SERVER_SYNC", url });
    if (!result?.ok) throw new Error(result?.error || "Sync 실패");
    offsetMs = result.offsetMs;
    if (rttValue && result.rttMs != null) rttValue.textContent = `RTT ${result.rttMs} ms`;
    running = true;
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (urlInput) urlInput.disabled = true;
    startClock();
    setStatus("연결됨 · 서버 시간 맞춤 중", "ok");
    void chrome.storage.local.set({ [STORAGE_KEY]: url });
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
}

async function stopSync() {
  await chrome.runtime.sendMessage({ type: "STOP_SERVER_SYNC" }).catch(() => {});
  running = false;
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  if (urlInput) urlInput.disabled = false;
  setStatus("중지됨", "");
}

startBtn?.addEventListener("click", () => void startSync());
stopBtn?.addEventListener("click", () => void stopSync());

chrome.storage.local.get(STORAGE_KEY).then((data) => {
  if (data[STORAGE_KEY] && urlInput && !urlInput.value) {
    urlInput.value = String(data[STORAGE_KEY]);
  }
}).catch(() => {});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PROGRESS_LOG") {
    appendProgressLog(message.text, message.level || "info", message.source || "bg");
  }
  if (message?.type === "SERVER_SYNC_STATE") {
    if (message.offsetMs != null) {
      offsetMs = message.offsetMs;
      startClock();
    }
    if (rttValue && message.rttMs != null) rttValue.textContent = `RTT ${message.rttMs} ms`;
    if (message.running) {
      running = true;
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      if (urlInput) urlInput.disabled = true;
      if (message.ok !== false && message.serverDate) {
        setStatus("연결됨 · 서버 시간 맞춤 중", "ok");
      }
    } else if (message.stopped) {
      running = false;
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      if (urlInput) urlInput.disabled = false;
    }
    if (message.ok === false && message.error) setStatus(message.error, "error");
  }
  if (message?.type === "SCHED_REC_STATE") {
    scheduleRecArmed = Boolean(message.armed);
    scheduleRecTargetMs = message.targetMs ?? null;
    if (message.fired) {
      setSchedRecStatus(`발화! ${message.label || ""} → Rec`, "ok");
    } else if (scheduleRecArmed) {
      setSchedRecStatus("예약 대기 중", "ok");
    } else if (message.disarmed) {
      setSchedRecStatus("예약 해제됨", "");
    }
  }
  if (message?.type === "AUTO_REC_STATE") {
    setNolRecUi(Boolean(message.armed));
  }
});

chrome.runtime.sendMessage({ type: "GET_SERVER_SYNC_STATE" }).then((st) => {
  if (!st?.ok) return;
  if (st.url && urlInput && !urlInput.value) urlInput.value = st.url;
  if (st.running) {
    if (st.offsetMs != null) {
      offsetMs = st.offsetMs;
      if (rttValue && st.rttMs != null) rttValue.textContent = `RTT ${st.rttMs} ms`;
      startClock();
    }
    running = true;
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (urlInput) urlInput.disabled = true;
    setStatus("서버 시간 맞춤 중", "ok");
  } else if (st.url) {
    setStatus("URL 저장됨 — Start 버튼을 누르세요", "");
  }
}).catch(() => {});

chrome.runtime.sendMessage({ type: "GET_SCHED_REC_STATE" }).then((st) => {
  if (!st?.ok) return;
  scheduleRecArmed = Boolean(st.armed);
  scheduleRecTargetMs = st.targetMs ?? null;
  if (st.parts) {
    if (schedHh && st.parts.hh != null) schedHh.value = String(st.parts.hh);
    if (schedMm && st.parts.mm != null) schedMm.value = String(st.parts.mm);
    if (schedSs && st.parts.ss != null) schedSs.value = String(st.parts.ss);
    if (schedMs && st.parts.ms != null) schedMs.value = String(st.parts.ms);
  }
  if (scheduleRecArmed && st.parts) {
    setSchedRecStatus(`예약 대기 → ${formatSchedLabel(st.parts)} · NOL`, "ok");
  } else {
    setSchedRecStatus(schedRecStatus?.textContent || "Start 후 예약", "");
  }
}).catch(() => {});

chrome.runtime.sendMessage({ type: "GET_AUTO_REC_STATE" }).then((result) => {
  if (!result?.ok) return;
  setNolRecUi(Boolean(result.nol?.armed ?? result.armed));
}).catch(() => {});
