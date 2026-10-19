/**
 * content-nol.js — NOL(야놀자 티켓) Auto Click Rec
 * 버튼 감시 → background MAIN fiber onClick 위임
 */

const NOL_ARMED_KEY = "nolAutoRecArmed";
const NOL_CONFIG_KEY = "nolAutoRecConfig";

const nolRec = {
  armed: false,
  config: null,
  running: false,
  observer: null,
  pollTimer: null,
};

function progressLog(text, level = "info") {
  chrome.runtime.sendMessage({ type: "PROGRESS_LOG", text, level, source: "content-nol" }).catch(() => {});
}

function collectReserveButtons() {
  const root =
    document.querySelector('[id^="GOODS_RESERVATION"]') ||
    document.querySelector("#GOODS_RESERVATION-492") ||
    document.body;
  const want = String(nolRec.config?.text || "예매하기").trim();
  const goodsCode = String(nolRec.config?.goodsCode || "").trim();
  return [...root.querySelectorAll("button")].filter((btn) => {
    const forced = btn.hasAttribute("data-nol-post-active") || btn.classList.contains("__nol_post_forced");
    if (btn.disabled && !forced) return false;
    const t = String(btn.innerText || "").replace(/\s+/g, " ").trim();
    if (!t) return false;
    if (forced) {
      if (goodsCode && btn.getAttribute("data-nol-goods") === goodsCode) return true;
      if (!goodsCode) return true;
    }
    if (want) return t.includes(want);
    return /예매/.test(t);
  });
}

function hasTargetReady() {
  const buttons = collectReserveButtons();
  if (!buttons.length) return false;
  const goodsCode = String(nolRec.config?.goodsCode || "").trim();
  if (goodsCode) {
    // forced 스탬프 또는 활성 예매 버튼이 있으면 MAIN이 찾음
    return (
      buttons.some(
        (b) =>
          b.getAttribute("data-nol-goods") === goodsCode ||
          b.hasAttribute("data-nol-post-active")
      ) || buttons.length > 0
    );
  }
  const index = Math.max(1, Number(nolRec.config?.index) || 1);
  return buttons.length >= index;
}

function stopNolWatch() {
  nolRec.observer?.disconnect();
  nolRec.observer = null;
  if (nolRec.pollTimer) {
    clearInterval(nolRec.pollTimer);
    nolRec.pollTimer = null;
  }
}

function tryNolRec() {
  if (!nolRec.armed || nolRec.running || !nolRec.config) return false;
  if (!hasTargetReady()) return false;

  nolRec.running = true;
  const cfg = nolRec.config;
  progressLog(
    `[NOL] 타겟 포착 — MAIN onClick (goodsCode=${cfg.goodsCode || "-"}, index=${cfg.index || 1})`,
    "ok"
  );

  chrome.runtime.sendMessage(
    {
      type: "NOL_INVOKE_MAIN",
      goodsCode: String(cfg.goodsCode || "").trim(),
      index: String(cfg.index || "1"),
      text: String(cfg.text || "예매하기").trim(),
    },
    (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        progressLog(`[NOL] 통신 오류: ${err.message}`, "error");
        nolRec.running = false;
        return;
      }
      if (result?.ok) {
        progressLog(`[NOL] ${result.method || "invoke"} → 진입`, "ok");
        chrome.runtime
          .sendMessage({ type: "AUTO_REC_RESULT", ok: true, msg: result.method, site: "nol" })
          .catch(() => {});
      } else {
        progressLog(`[NOL] ${result?.error || "실패"}`, "error");
        chrome.runtime
          .sendMessage({
            type: "AUTO_REC_RESULT",
            ok: false,
            error: result?.error || "실패",
            site: "nol",
          })
          .catch(() => {});
        nolRec.running = false;
      }
    }
  );
  return true;
}

function startNolWatch({ resetRunning = true } = {}) {
  if (!nolRec.armed || !nolRec.config) {
    stopNolWatch();
    return;
  }
  if (nolRec.observer || nolRec.pollTimer || nolRec.running) {
    if (!nolRec.running) tryNolRec();
    return;
  }
  if (resetRunning) nolRec.running = false;

  progressLog(
    `[NOL] Rec ON — 감시 (goodsCode=${nolRec.config.goodsCode || "-"}, index=${nolRec.config.index || 1})`,
    "info"
  );
  if (tryNolRec()) return;

  nolRec.observer = new MutationObserver(() => tryNolRec());
  nolRec.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
  });
  nolRec.pollTimer = setInterval(() => {
    if (!nolRec.armed || nolRec.running) {
      if (!nolRec.armed) stopNolWatch();
      return;
    }
    tryNolRec();
  }, 250);
}

function syncFromStorage(data) {
  nolRec.armed = Boolean(data[NOL_ARMED_KEY]);
  const cfg = data[NOL_CONFIG_KEY] || null;
  nolRec.config = cfg ? { ...cfg, site: "nol" } : null;
}

async function loadSettings() {
  const data = await chrome.storage.local.get([NOL_ARMED_KEY, NOL_CONFIG_KEY]);
  syncFromStorage(data);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes[NOL_ARMED_KEY] && !changes[NOL_CONFIG_KEY]) return;

  if (changes[NOL_ARMED_KEY]) {
    nolRec.armed = Boolean(changes[NOL_ARMED_KEY].newValue);
  }
  if (changes[NOL_CONFIG_KEY]) {
    const cfg = changes[NOL_CONFIG_KEY].newValue || null;
    nolRec.config = cfg ? { ...cfg, site: "nol" } : null;
  }

  if (nolRec.armed) {
    stopNolWatch();
    startNolWatch({ resetRunning: true });
  } else {
    stopNolWatch();
    nolRec.running = false;
    progressLog("[NOL] Rec OFF", "info");
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "NOL_REC_RESTART" || message?.type === "AUTO_REC_RESTART") {
    void loadSettings().then(() => {
      if (nolRec.armed) startNolWatch();
      else stopNolWatch();
      sendResponse({ ok: true, nolArmed: nolRec.armed });
    });
    return true;
  }
  return false;
});

progressLog("NOL 페이지와 연결되었습니다");
loadSettings().then(() => {
  if (nolRec.armed) startNolWatch();
});
