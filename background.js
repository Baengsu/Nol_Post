/**
 * Nol-Post — Sync / 예약 Rec / NOL MAIN onClick
 */

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function progressLog(text, level = "info", source = "bg") {
  broadcast({ type: "PROGRESS_LOG", text, level, source, at: Date.now() });
}

function pad2(n, width = 2) {
  return String(n).padStart(width, "0");
}

function formatServerClock(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${pad2(
    d.getMilliseconds(),
    3
  )}`;
}

function enableChromeSidePanelOnAction() {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  } catch {
    /* ignore */
  }
}
chrome.runtime.onInstalled.addListener(() => enableChromeSidePanelOnAction());
chrome.runtime.onStartup.addListener(() => enableChromeSidePanelOnAction());
enableChromeSidePanelOnAction();

async function probeServerTime(url, signal) {
  const t0 = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      redirect: "follow",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal,
    });
  }
  const t1 = Date.now();
  const dateHeader = response.headers.get("Date");
  if (!dateHeader) throw new Error("응답에 Date 헤더가 없습니다.");
  const serverMs = Date.parse(dateHeader);
  if (Number.isNaN(serverMs)) throw new Error("Date 헤더를 해석할 수 없습니다.");
  const rtt = Math.max(0, t1 - t0);
  return {
    ok: true,
    offsetMs: serverMs + rtt / 2 - t1,
    rttMs: Math.round(rtt),
    serverDate: dateHeader,
    status: response.status,
  };
}

async function fetchServerTime(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    let best = null;
    let lastError = null;
    for (let i = 0; i < 3; i += 1) {
      try {
        const sample = await probeServerTime(url, controller.signal);
        if (!best || sample.rttMs < best.rttMs) best = sample;
      } catch (error) {
        lastError = error;
      }
    }
    if (!best) throw lastError || new Error("서버 시간을 가져오지 못했습니다.");
    return best;
  } finally {
    clearTimeout(timeoutId);
  }
}

const STS_SYNC_ALARM = "sts-server-sync";
const STS_SCHED_ALARM = "sts-sched-fire";
const STS_SCHED_PREP_ALARM = "sts-sched-prep";
const STS_SYNC_STORAGE = "stsServerSync";
const STS_SCHED_STORAGE = "stsSchedRec";

let stsSync = {
  running: false,
  url: "",
  offsetMs: null,
  rttMs: null,
  serverDate: "",
  lastOkAt: 0,
};

let stsSched = {
  armed: false,
  targetMs: null,
  site: "nol",
  parts: null,
  recPayload: null,
  firing: false,
};

let stsSyncLoopTimer = null;
let stsSchedWatchTimer = null;

function serverNowMs() {
  if (stsSync.offsetMs == null) return null;
  return Date.now() + stsSync.offsetMs;
}

function broadcastSyncState(extra = {}) {
  broadcast({
    type: "SERVER_SYNC_STATE",
    running: stsSync.running,
    url: stsSync.url,
    offsetMs: stsSync.offsetMs,
    rttMs: stsSync.rttMs,
    serverDate: stsSync.serverDate,
    serverNowMs: serverNowMs(),
    ...extra,
  });
}

function broadcastSchedState(extra = {}) {
  broadcast({
    type: "SCHED_REC_STATE",
    armed: stsSched.armed,
    targetMs: stsSched.targetMs,
    site: "nol",
    parts: stsSched.parts,
    ...extra,
  });
  updateActionBadge();
}

function updateActionBadge() {
  try {
    if (stsSched.armed) {
      chrome.action.setBadgeText({ text: "ARM" });
      chrome.action.setBadgeBackgroundColor({ color: "#0d9488" });
    } else if (stsSync.running) {
      chrome.action.setBadgeText({ text: "SYNC" });
      chrome.action.setBadgeBackgroundColor({ color: "#334155" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  } catch {
    /* ignore */
  }
}

async function persistSyncState() {
  await chrome.storage.local.set({
    [STS_SYNC_STORAGE]: {
      running: stsSync.running,
      url: stsSync.url,
      offsetMs: stsSync.offsetMs,
      rttMs: stsSync.rttMs,
      serverDate: stsSync.serverDate,
      lastOkAt: stsSync.lastOkAt,
    },
  });
}

async function persistSchedState() {
  await chrome.storage.local.set({
    [STS_SCHED_STORAGE]: {
      armed: stsSched.armed,
      targetMs: stsSched.targetMs,
      site: "nol",
      parts: stsSched.parts,
      recPayload: stsSched.recPayload,
    },
  });
}

async function refreshServerOffset() {
  if (!stsSync.url) throw new Error("Sync URL이 없습니다.");
  const result = await fetchServerTime(stsSync.url);
  if (!result?.ok) throw new Error(result?.error || "서버 시간 동기화 실패");
  stsSync.offsetMs = result.offsetMs;
  stsSync.rttMs = result.rttMs;
  stsSync.serverDate = result.serverDate;
  stsSync.lastOkAt = Date.now();
  await persistSyncState();
  broadcastSyncState({ ok: true });
  return result;
}

function clearStsSyncLoop() {
  if (stsSyncLoopTimer != null) {
    clearInterval(stsSyncLoopTimer);
    stsSyncLoopTimer = null;
  }
}

function clearStsSchedWatch() {
  if (stsSchedWatchTimer != null) {
    clearInterval(stsSchedWatchTimer);
    stsSchedWatchTimer = null;
  }
}

async function ensureSyncAlarms() {
  await chrome.alarms.clear(STS_SYNC_ALARM);
  if (!stsSync.running) return;
  await chrome.alarms.create(STS_SYNC_ALARM, { periodInMinutes: 1 });
}

function startStsSyncLoop() {
  clearStsSyncLoop();
  stsSyncLoopTimer = setInterval(() => {
    if (!stsSync.running) return;
    refreshServerOffset().catch((err) => {
      progressLog(`Sync 실패: ${err.message}`, "error", "sync");
      broadcastSyncState({ ok: false, error: err.message });
    });
  }, 1000);
}

async function startServerSync(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) throw new Error("URL을 입력해주세요.");
  stsSync.running = true;
  stsSync.url = trimmed;
  await chrome.storage.local.set({ serverTimeUrl: trimmed });
  await persistSyncState();
  const result = await refreshServerOffset();
  startStsSyncLoop();
  await ensureSyncAlarms();
  updateActionBadge();
  progressLog(`서버 시간 맞춤 시작 (RTT ${result.rttMs}ms)`, "ok", "sync");
  return result;
}

async function stopServerSync({ keepOffset = true } = {}) {
  stsSync.running = false;
  clearStsSyncLoop();
  await chrome.alarms.clear(STS_SYNC_ALARM);
  if (!keepOffset) {
    stsSync.offsetMs = null;
    stsSync.rttMs = null;
    stsSync.serverDate = "";
  }
  await persistSyncState();
  broadcastSyncState({ stopped: true });
  updateActionBadge();
  progressLog("서버 시간 맞춤 중지", "info", "sync");
}

function computeSchedTargetMs(parts, serverNow) {
  const d = new Date(serverNow);
  d.setHours(parts.hh, parts.mm, parts.ss, parts.ms);
  return d.getTime();
}

async function clearSchedAlarms() {
  await chrome.alarms.clear(STS_SCHED_ALARM);
  await chrome.alarms.clear(STS_SCHED_PREP_ALARM);
}

function startSchedWatchLoop() {
  clearStsSchedWatch();
  stsSchedWatchTimer = setInterval(() => {
    void checkAndFireSchedRec();
  }, 50);
}

async function armSchedRec({ parts, recPayload }) {
  if (stsSync.offsetMs == null) throw new Error("먼저 Sync 하세요");
  const p = {
    hh: Math.min(23, Math.max(0, Math.trunc(Number(parts?.hh) || 0))),
    mm: Math.min(59, Math.max(0, Math.trunc(Number(parts?.mm) || 0))),
    ss: Math.min(59, Math.max(0, Math.trunc(Number(parts?.ss) || 0))),
    ms: Math.min(999, Math.max(0, Math.trunc(Number(parts?.ms) || 0))),
  };
  const now = serverNowMs();
  const target = computeSchedTargetMs(p, now);
  if (target <= now) {
    throw new Error(
      `이미 지난 시각 (${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}.${pad2(p.ms, 3)})`
    );
  }

  stsSched.armed = true;
  stsSched.targetMs = target;
  stsSched.site = "nol";
  stsSched.parts = p;
  stsSched.recPayload = recPayload || null;
  stsSched.firing = false;
  await persistSchedState();
  await clearSchedAlarms();

  const waitMs = Math.max(0, target - now);
  await chrome.alarms.create(STS_SCHED_ALARM, {
    when: Date.now() + Math.max(0, waitMs - 5),
  });
  if (waitMs > 9000) {
    await chrome.alarms.create(STS_SCHED_PREP_ALARM, {
      when: Date.now() + Math.max(0, waitMs - 8000),
    });
  } else {
    startSchedWatchLoop();
  }

  if (!stsSync.running && stsSync.url) {
    await startServerSync(stsSync.url);
  }

  broadcastSchedState();
  const label = `${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}.${pad2(p.ms, 3)}`;
  progressLog(`예약 설정 · ${label} · NOL`, "ok", "sched");
  return { ok: true, targetMs: target, waitMs, label, site: "nol" };
}

async function disarmSchedRec({ silent = false } = {}) {
  stsSched.armed = false;
  stsSched.targetMs = null;
  stsSched.firing = false;
  clearStsSchedWatch();
  await clearSchedAlarms();
  await persistSchedState();
  broadcastSchedState({ disarmed: true });
  if (!silent) progressLog("예약 해제", "info", "sched");
}

async function resolveSchedRecPayload() {
  if (stsSched.recPayload && typeof stsSched.recPayload === "object") {
    return { ...stsSched.recPayload, site: "nol", type: "START_AUTO_REC" };
  }
  const data = await chrome.storage.local.get(["nolAutoRecConfig"]);
  const c = data.nolAutoRecConfig || {};
  return {
    type: "START_AUTO_REC",
    site: "nol",
    url: String(c.url || "").trim(),
    index: String(c.index || "1"),
    text: String(c.text || "예매하기").trim(),
    goodsCode: String(c.goodsCode || "").trim(),
  };
}

async function startNolRecInternal(payload) {
  const config = {
    site: "nol",
    url: String(payload.url || "").trim(),
    index: String(payload.index || "1"),
    text: String(payload.text || "예매하기").trim(),
    goodsCode: String(payload.goodsCode || "").trim(),
  };

  await chrome.storage.local.set({
    nolAutoRecArmed: true,
    nolAutoRecConfig: config,
  });

  progressLog(
    `NOL Rec ON — goodsCode=${config.goodsCode || "-"} index=${config.index}`,
    "ok",
    "auto"
  );

  let tab = null;
  const nolTabs = await chrome.tabs.query({
    url: ["*://nol.yanolja.com/*", "*://*.yanolja.com/*"],
  });
  if (nolTabs.length) {
    tab = nolTabs.find((t) => t.active) || nolTabs[0];
  }
  if (!tab?.id) {
    const active = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active[0];
  }
  if (!tab?.id) throw new Error("NOL 탭을 찾을 수 없습니다.");

  if (config.url && config.url.startsWith("http")) {
    const cur = String(tab.url || "");
    const hint = config.url.replace(/^https?:\/\//, "").slice(0, 48);
    if (!cur.startsWith(config.url) && !cur.includes(hint)) {
      progressLog(`NOL URL 이동: ${config.url}`, "warn", "auto");
      await chrome.tabs.update(tab.id, { url: config.url });
    } else {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "NOL_REC_RESTART" });
      } catch {
        progressLog("NOL content 미연결 — 로드 후 감시", "warn", "auto");
      }
    }
  } else {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "NOL_REC_RESTART" });
    } catch {
      progressLog("NOL content 미연결 — 로드 후 감시", "warn", "auto");
    }
  }

  broadcast({ type: "AUTO_REC_STATE", armed: true, site: "nol", config });
  return { ok: true, armed: true, site: "nol", tabId: tab.id };
}

async function stopNolRecInternal() {
  await chrome.storage.local.set({ nolAutoRecArmed: false });
  progressLog("NOL Rec OFF", "info", "auto");
  broadcast({ type: "AUTO_REC_STATE", armed: false, site: "nol" });
  return { ok: true, armed: false, site: "nol" };
}

/** MAIN: 예매/오픈예정 버튼 + fiber match 스캔·패치·invoke 공통 주입 함수 */
function nolMainPageFunc(mode, opts) {
  const wantGoods = String(opts.goodsCode || "").trim();
  const wantIndex = String(opts.index || "1");
  const wantText = String(opts.text || "").trim();
  const patchGoods = String(opts.patchGoodsCode || "").trim();
  const patchPlace = String(opts.patchPlaceCode || "").trim();
  const patchOpen = String(opts.patchBookingOpenTime || "").trim();
  const forceLabel = String(opts.forceLabel || "예매하기").trim();

  function fiberOf(el) {
    if (!el) return null;
    for (const k of Object.keys(el)) {
      if (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) {
        return el[k];
      }
    }
    return null;
  }

  function matchFiberNode(el) {
    let f = fiberOf(el);
    for (let i = 0; i < 24 && f; i += 1, f = f.return) {
      if (f.memoizedProps?.match && typeof f.memoizedProps.match === "object") {
        return { fiber: f, depth: i, match: f.memoizedProps.match };
      }
    }
    return null;
  }

  function goodsFromFiber(el) {
    return String(matchFiberNode(el)?.match?.goodsCode || "");
  }

  function rootEl() {
    return (
      document.querySelector('[id^="GOODS_RESERVATION"]') ||
      document.querySelector("#GOODS_RESERVATION-492") ||
      document.body
    );
  }

  function collectButtons({ includeDisabled = true } = {}) {
    const root = rootEl();
    return [...root.querySelectorAll("button")].filter((btn) => {
      const t = String(btn.innerText || "").replace(/\s+/g, " ").trim();
      if (!t) return false;
      const hit =
        /예매|오픈\s*예정|판매\s*예정|Sold\s*Out|매진/i.test(t) ||
        btn.hasAttribute("data-nol-post-active") ||
        btn.classList.contains("__nol_post_forced");
      if (!hit) return false;
      if (!includeDisabled && btn.disabled && !btn.hasAttribute("data-nol-post-active")) {
        return false;
      }
      return true;
    });
  }

  function pickTarget(buttons) {
    if (wantGoods) {
      const hit = buttons.find((b) => goodsFromFiber(b) === wantGoods);
      if (hit) return hit;
      const forced = buttons.find(
        (b) =>
          b.getAttribute("data-nol-post-active") === "1" &&
          (b.getAttribute("data-nol-goods") === wantGoods || goodsFromFiber(b) === wantGoods)
      );
      if (forced) return forced;
      return null;
    }
    const idx = Math.max(1, Number(wantIndex) || 1) - 1;
    return buttons[idx] || null;
  }

  function invokeOnClick(el) {
    let f = fiberOf(el);
    for (let i = 0; i < 12 && f; i += 1, f = f.return) {
      const fn = f.memoizedProps?.onClick;
      if (typeof fn === "function") {
        fn({
          type: "click",
          bubbles: true,
          cancelable: true,
          target: el,
          currentTarget: el,
          preventDefault() {},
          stopPropagation() {},
        });
        return { ok: true, method: `fiberDepth${i}.onClick`, hrefAfter: location.href };
      }
    }
    el.click();
    return { ok: true, method: "el.click()", hrefAfter: location.href };
  }

  function patchMatchOn(el) {
    const found = matchFiberNode(el);
    if (!found) return { ok: false, error: "fiber match 없음" };
    const m = found.match;
    const before = {
      goodsCode: m.goodsCode != null ? String(m.goodsCode) : "",
      placeCode: m.placeCode != null ? String(m.placeCode) : "",
      bookingOpenTime: m.bookingOpenTime != null ? String(m.bookingOpenTime) : "",
    };
    if (patchGoods) m.goodsCode = patchGoods;
    if (patchPlace) m.placeCode = patchPlace;
    if (patchOpen) m.bookingOpenTime = patchOpen;
    // 오픈 전이면 과거로 밀어 클라이언트 가드 우회 시도
    if (!patchOpen && m.bookingOpenTime) {
      try {
        const openMs = Date.parse(String(m.bookingOpenTime).replace(" ", "T"));
        if (Number.isFinite(openMs) && openMs > Date.now()) {
          m.bookingOpenTime = new Date(Date.now() - 60_000).toISOString().slice(0, 19);
        }
      } catch {
        /* ignore */
      }
    }
    return {
      ok: true,
      depth: found.depth,
      before,
      after: {
        goodsCode: m.goodsCode != null ? String(m.goodsCode) : "",
        placeCode: m.placeCode != null ? String(m.placeCode) : "",
        bookingOpenTime: m.bookingOpenTime != null ? String(m.bookingOpenTime) : "",
      },
    };
  }

  function activateButton(el) {
    const wasDisabled = Boolean(el.disabled);
    el.disabled = false;
    el.removeAttribute("disabled");
    el.setAttribute("aria-disabled", "false");
    el.classList.remove("joint-rectangle-button--disabled");
    el.classList.add("__nol_post_forced");
    el.setAttribute("data-nol-post-active", "1");
    const g = patchGoods || goodsFromFiber(el);
    if (g) el.setAttribute("data-nol-goods", g);
    if (forceLabel) {
      // 텍스트 노드만 교체 (아이콘 자식 유지)
      const textNodes = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE);
      if (textNodes.length) {
        textNodes[0].textContent = forceLabel;
      } else if (el.childElementCount === 0) {
        el.textContent = forceLabel;
      } else {
        const span = el.querySelector("span") || el;
        if (span !== el || /예매|오픈|예정|매진/i.test(span.textContent || "")) {
          span.textContent = forceLabel;
        }
      }
    }
    el.style.outline = "2px solid #0d9488";
    const patch = patchMatchOn(el);
    return { wasDisabled, patch };
  }

  try {
    if (mode === "scan") {
      const buttons = collectButtons({ includeDisabled: true });
      const list = buttons.map((btn, i) => {
        const found = matchFiberNode(btn);
        const m = found?.match || {};
        const text = String(btn.innerText || "").replace(/\s+/g, " ").trim();
        const disabled =
          btn.disabled ||
          btn.getAttribute("aria-disabled") === "true" ||
          /disabled|예정|매진|sold/i.test(btn.className + text);
        return {
          index: i + 1,
          text: text.slice(0, 48),
          disabled,
          forced: btn.hasAttribute("data-nol-post-active"),
          goodsCode: m.goodsCode != null ? String(m.goodsCode) : "",
          placeCode: m.placeCode != null ? String(m.placeCode) : "",
          goodsName: m.goodsName != null ? String(m.goodsName).slice(0, 80) : "",
          bookingOpenTime: m.bookingOpenTime != null ? String(m.bookingOpenTime) : "",
          bookingEndTime: m.bookingEndTime != null ? String(m.bookingEndTime) : "",
          placeName: m.placeName != null ? String(m.placeName) : "",
        };
      });
      return { ok: true, count: list.length, buttons: list };
    }

    const buttons = collectButtons({
      includeDisabled: mode === "activate" || mode === "patch",
    });
    // invoke: 활성 + forced 우선
    let pool = buttons;
    if (mode === "invoke") {
      pool = collectButtons({ includeDisabled: true }).filter(
        (b) => !b.disabled || b.hasAttribute("data-nol-post-active")
      );
      if (wantText) {
        const filtered = pool.filter((b) => String(b.innerText || "").includes(wantText));
        if (filtered.length) pool = filtered;
      }
    }

    const target = pickTarget(pool);
    if (!target) {
      return {
        ok: false,
        error: wantGoods
          ? `goodsCode=${wantGoods} 버튼 없음 (후보 ${pool.length})`
          : `index=${wantIndex} 버튼 없음 (후보 ${pool.length})`,
        candidates: pool.slice(0, 8).map((b) => ({
          text: String(b.innerText || "").trim().slice(0, 40),
          goodsCode: goodsFromFiber(b),
          disabled: b.disabled,
        })),
      };
    }

    if (mode === "activate" || mode === "patch") {
      const act = activateButton(target);
      return {
        ok: Boolean(act.patch?.ok),
        mode,
        wasDisabled: act.wasDisabled,
        text: String(target.innerText || "").trim().slice(0, 40),
        ...act.patch,
        error: act.patch?.ok ? undefined : act.patch?.error,
      };
    }

    // invoke
    if (patchGoods || patchPlace || patchOpen || target.hasAttribute("data-nol-post-active")) {
      patchMatchOn(target);
    }
    const out = invokeOnClick(target);
    out.goodsCode = goodsFromFiber(target) || wantGoods || "";
    out.text = String(target.innerText || "").trim().slice(0, 40);
    out.forced = target.hasAttribute("data-nol-post-active");
    return out;
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function nolRunMain(tabId, mode, opts = {}) {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [mode, opts],
    func: nolMainPageFunc,
  });
  return injected?.result || { ok: false, error: "executeScript 결과 없음" };
}

async function resolveNolTabId(preferredId) {
  if (preferredId != null) return preferredId;
  const tabs = await chrome.tabs.query({
    url: ["*://nol.yanolja.com/*", "*://*.yanolja.com/*"],
  });
  return (tabs.find((t) => t.active) || tabs[0])?.id ?? null;
}

async function nolInvokeMain(tabId, { goodsCode = "", index = "1", text = "예매하기" } = {}) {
  return nolRunMain(tabId, "invoke", { goodsCode, index, text });
}

async function nolScanMain(tabId) {
  return nolRunMain(tabId, "scan", {});
}

async function nolActivateMain(tabId, opts) {
  return nolRunMain(tabId, "activate", opts);
}

async function fireSchedRec() {
  if (!stsSched.armed || stsSched.firing) return;
  stsSched.firing = true;
  const label =
    stsSched.targetMs != null ? formatServerClock(stsSched.targetMs).replace(" ", ".") : "?";

  try {
    if (stsSync.url) {
      try {
        await refreshServerOffset();
      } catch {
        /* keep */
      }
    }
    const data = await chrome.storage.local.get(["nolAutoRecArmed"]);
    if (data.nolAutoRecArmed) {
      progressLog("이미 NOL Rec ON — 예약 발화 스킵", "warn", "sched");
    } else {
      const payload = await resolveSchedRecPayload();
      progressLog(`예약 시각 · NOL Rec 시작 (${label})`, "ok", "sched");
      await startNolRecInternal(payload);
    }
    broadcastSchedState({ fired: true, label });
  } catch (error) {
    progressLog(`예약 Rec 실패: ${error.message}`, "error", "sched");
  } finally {
    await disarmSchedRec({ silent: true });
  }
}

async function checkAndFireSchedRec() {
  if (!stsSched.armed || stsSched.targetMs == null || stsSched.firing) return;
  const now = serverNowMs();
  if (now == null) return;
  const remain = stsSched.targetMs - now;
  if (remain <= 0) {
    await fireSchedRec();
    return;
  }
  if (remain <= 8000 && !stsSchedWatchTimer) {
    startSchedWatchLoop();
  }
}

async function restorePersistedState() {
  const data = await chrome.storage.local.get([STS_SYNC_STORAGE, STS_SCHED_STORAGE, "serverTimeUrl"]);
  const sync = data[STS_SYNC_STORAGE];
  if (sync?.url) {
    stsSync.url = String(sync.url);
    stsSync.offsetMs = sync.offsetMs ?? null;
    stsSync.rttMs = sync.rttMs ?? null;
    stsSync.serverDate = sync.serverDate || "";
    stsSync.lastOkAt = sync.lastOkAt || 0;
    // running은 자동 재개 안 함 (PostLab과 동일)
  } else if (data.serverTimeUrl) {
    stsSync.url = String(data.serverTimeUrl);
  }

  const sched = data[STS_SCHED_STORAGE];
  if (sched?.armed && sched.targetMs != null) {
    stsSched.armed = true;
    stsSched.targetMs = sched.targetMs;
    stsSched.site = "nol";
    stsSched.parts = sched.parts || null;
    stsSched.recPayload = sched.recPayload || null;
    const now = serverNowMs();
    if (now != null && sched.targetMs <= now) {
      void fireSchedRec();
    } else {
      const waitMs = now != null ? Math.max(0, sched.targetMs - now) : 0;
      await clearSchedAlarms();
      await chrome.alarms.create(STS_SCHED_ALARM, {
        when: Date.now() + Math.max(0, waitMs - 5),
      });
      if (waitMs > 9000) {
        await chrome.alarms.create(STS_SCHED_PREP_ALARM, {
          when: Date.now() + Math.max(0, waitMs - 8000),
        });
      } else {
        startSchedWatchLoop();
      }
    }
  }
  updateActionBadge();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === STS_SYNC_ALARM) {
    if (!stsSync.running) return;
    refreshServerOffset().catch((err) => {
      progressLog(`Sync 실패: ${err.message}`, "error", "sync");
      broadcastSyncState({ ok: false, error: err.message });
    });
    return;
  }
  if (alarm.name === STS_SCHED_PREP_ALARM) {
    startSchedWatchLoop();
    void checkAndFireSchedRec();
    return;
  }
  if (alarm.name === STS_SCHED_ALARM) {
    void checkAndFireSchedRec();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PROGRESS_LOG") {
    broadcast(message);
    return false;
  }

  if (message?.type === "START_SERVER_SYNC") {
    startServerSync(message.url)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "STOP_SERVER_SYNC") {
    stopServerSync()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_SERVER_SYNC_STATE") {
    sendResponse({
      ok: true,
      running: stsSync.running,
      url: stsSync.url,
      offsetMs: stsSync.offsetMs,
      rttMs: stsSync.rttMs,
      serverDate: stsSync.serverDate,
      serverNowMs: serverNowMs(),
    });
    return false;
  }

  if (message?.type === "ARM_SCHED_REC") {
    armSchedRec({ parts: message.parts, recPayload: message.recPayload })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "DISARM_SCHED_REC") {
    disarmSchedRec()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_SCHED_REC_STATE") {
    sendResponse({
      ok: true,
      armed: stsSched.armed,
      targetMs: stsSched.targetMs,
      site: "nol",
      parts: stsSched.parts,
      serverNowMs: serverNowMs(),
    });
    return false;
  }

  if (message?.type === "START_AUTO_REC") {
    startNolRecInternal(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "STOP_AUTO_REC") {
    stopNolRecInternal()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_AUTO_REC_STATE") {
    chrome.storage.local.get(["nolAutoRecArmed", "nolAutoRecConfig"]).then((data) => {
      sendResponse({
        ok: true,
        nol: {
          armed: Boolean(data.nolAutoRecArmed),
          config: data.nolAutoRecConfig || null,
        },
        armed: Boolean(data.nolAutoRecArmed),
        config: data.nolAutoRecConfig || null,
      });
    });
    return true;
  }

  if (message?.type === "NOL_INVOKE_MAIN") {
    (async () => {
      try {
        const tabId = await resolveNolTabId(sender.tab?.id);
        if (tabId == null) throw new Error("NOL 탭 없음");
        const result = await nolInvokeMain(tabId, {
          goodsCode: message.goodsCode,
          index: message.index,
          text: message.text,
        });
        if (result?.ok) {
          progressLog(`NOL MAIN OK · ${result.method} · ${result.goodsCode || ""}`, "ok", "auto");
        } else {
          progressLog(`NOL MAIN fail · ${result?.error || "?"}`, "error", "auto");
        }
        sendResponse(result);
      } catch (e) {
        progressLog(`NOL MAIN exception: ${e.message}`, "error", "auto");
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (message?.type === "NOL_SCAN_BUTTONS") {
    (async () => {
      try {
        const tabId = await resolveNolTabId(sender.tab?.id);
        if (tabId == null) throw new Error("NOL 탭 없음 — 포스트시즌 페이지를 여세요");
        const result = await nolScanMain(tabId);
        if (result?.ok) {
          progressLog(`NOL 스캔 ${result.count}개`, "ok", "auto");
        } else {
          progressLog(`NOL 스캔 실패: ${result?.error || "?"}`, "error", "auto");
        }
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (message?.type === "NOL_ACTIVATE_PATCH") {
    (async () => {
      try {
        const tabId = await resolveNolTabId(sender.tab?.id);
        if (tabId == null) throw new Error("NOL 탭 없음 — 포스트시즌 페이지를 여세요");
        const result = await nolActivateMain(tabId, {
          goodsCode: message.goodsCode,
          index: message.index,
          text: message.text,
          patchGoodsCode: message.patchGoodsCode,
          patchPlaceCode: message.patchPlaceCode,
          patchBookingOpenTime: message.patchBookingOpenTime,
          forceLabel: message.forceLabel || "예매하기",
        });
        if (result?.ok) {
          progressLog(
            `NOL 활성화 · gc ${result.before?.goodsCode || "?"}→${result.after?.goodsCode || "?"} · pc ${result.after?.placeCode || "-"}`,
            "ok",
            "auto"
          );
        } else {
          progressLog(`NOL 활성화 실패: ${result?.error || "?"}`, "error", "auto");
        }
        sendResponse(result);
      } catch (e) {
        progressLog(`NOL 활성화 exception: ${e.message}`, "error", "auto");
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (message?.type === "AUTO_REC_RESULT") {
    if (message.ok) {
      progressLog("NOL 자동 클릭에 성공했습니다", "ok", "auto");
    } else {
      progressLog(message.error || "자동 클릭에 실패했습니다", "error", "auto");
    }
    return false;
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab?.url || !/yanolja\.com/i.test(tab.url)) return;
  chrome.storage.local.get(["nolAutoRecArmed"]).then((data) => {
    if (!data.nolAutoRecArmed) return;
    chrome.tabs.sendMessage(tabId, { type: "NOL_REC_RESTART" }).catch(() => {});
  });
});

void restorePersistedState();
