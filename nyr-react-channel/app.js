(function () {
  "use strict";

  const API_URL = "/api/react";
  const MAX_TOTAL = 500;
  const MAX_EMOJIS = 10;
  const MAX_DELAY = 10000;
  const MAX_LOG_ITEMS = 80;
  const MAX_ERRORS_IN_ROW = 3;
  const CHANNEL_POST_PATTERN =
    /^https:\/\/(www\.)?whatsapp\.com\/channel\/[A-Za-z0-9_-]+\/\d+\/?(\?.*)?$/i;

  const $ = (id) => document.getElementById(id);

  const els = {
    link: $("link"),
    emoji: $("emoji"),
    total: $("total"),
    delay: $("delay"),
    server: $("server"),
    presets: $("presets"),
    btnStart: $("btn-start"),
    btnStop: $("btn-stop"),
    btnClear: $("btn-clear"),
    formError: $("form-error"),
    statusText: $("status-text"),
    progress: $("progress"),
    progressBar: $("progress-bar"),
    progressLabel: $("progress-label"),
    statTotal: $("stat-total"),
    statDone: $("stat-done"),
    statOk: $("stat-ok"),
    statBad: $("stat-bad"),
    log: $("log")
  };

  const formControls = [els.link, els.emoji, els.total, els.delay, els.server];

  const state = { running: false, stopRequested: false };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function parseEmojis(raw) {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  // Ukuran kelompok disesuaikan dengan jeda supaya satu request
  // tidak melewati batas waktu fungsi di Vercel.
  function getBatchSize(delay) {
    return Math.max(1, Math.min(5, Math.floor(40000 / (delay + 1500))));
  }

  function showError(message) {
    els.formError.textContent = message;
    els.formError.hidden = false;
  }

  function clearError() {
    els.formError.textContent = "";
    els.formError.hidden = true;
  }

  function validateForm() {
    const url = els.link.value.trim();
    if (!CHANNEL_POST_PATTERN.test(url)) {
      return { error: "Link harus link postingan channel, contoh: https://whatsapp.com/channel/xxxx/123" };
    }

    const emojis = parseEmojis(els.emoji.value);
    if (emojis.length < 1) {
      return { error: "Isi minimal 1 emoji." };
    }
    if (emojis.length > MAX_EMOJIS) {
      return { error: "Maksimal " + MAX_EMOJIS + " emoji." };
    }
    if (emojis.some((item) => item.length > 12)) {
      return { error: "Ada emoji yang terlalu panjang." };
    }

    const total = Number.parseInt(els.total.value, 10);
    if (!Number.isInteger(total) || total < 1 || total > MAX_TOTAL) {
      return { error: "Jumlah react harus 1 sampai " + MAX_TOTAL + "." };
    }

    const delay = Number.parseInt(els.delay.value, 10);
    if (!Number.isInteger(delay) || delay < 0 || delay > MAX_DELAY) {
      return { error: "Jeda harus 0 sampai " + MAX_DELAY + " ms." };
    }

    const server = Number.parseInt(els.server.value, 10);
    if (![1, 2, 3].includes(server)) {
      return { error: "Pilih server 1, 2, atau 3." };
    }

    return { value: { url, emojis, total, delay, server } };
  }

  function addLog(type, message) {
    const empty = els.log.querySelector(".log-empty");
    if (empty) empty.remove();

    const item = document.createElement("li");
    item.className = "log-item log-" + type;
    const time = new Date().toLocaleTimeString("id-ID", { hour12: false });
    item.textContent = "[" + time + "] " + message;
    els.log.prepend(item);

    while (els.log.children.length > MAX_LOG_ITEMS) {
      els.log.lastElementChild.remove();
    }
  }

  function clearLog() {
    els.log.innerHTML = "";
    const item = document.createElement("li");
    item.className = "log-item log-empty";
    item.textContent = "Log akan muncul di sini.";
    els.log.appendChild(item);
  }

  function renderStats(stats) {
    const percent = stats.total > 0 ? Math.min(100, Math.round((stats.done / stats.total) * 100)) : 0;
    els.statTotal.textContent = String(stats.total);
    els.statDone.textContent = String(stats.done);
    els.statOk.textContent = String(stats.ok);
    els.statBad.textContent = String(stats.bad);
    els.progressBar.style.width = percent + "%";
    els.progressBar.dataset.empty = percent === 0 ? "true" : "false";
    els.progressLabel.textContent = percent + "%";
    els.progress.setAttribute("aria-valuenow", String(percent));
  }

  function setRunning(running) {
    state.running = running;
    formControls.forEach((control) => { control.disabled = running; });
    els.presets.querySelectorAll("button").forEach((button) => { button.disabled = running; });
    els.btnStart.disabled = running;
    els.btnStop.disabled = !running;
  }

  async function sendBatch(config, count) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: config.url,
        emojis: config.emojis,
        count: count,
        delay: config.delay,
        server: config.server
      })
    });

    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    if (!response.ok || !json || !json.status) {
      const error = new Error((json && (json.message || json.error)) || "Server membalas " + response.status);
      error.fatal = response.status === 400 || response.status === 403;
      throw error;
    }

    return json.data;
  }

  async function startRun() {
    if (state.running) return;

    const checked = validateForm();
    if (checked.error) {
      showError(checked.error);
      return;
    }
    clearError();

    const config = checked.value;
    const batchSize = getBatchSize(config.delay);
    const stats = { total: config.total, done: 0, ok: 0, bad: 0 };
    let errorsInRow = 0;
    let finishedReason = "Selesai.";

    state.stopRequested = false;
    setRunning(true);
    renderStats(stats);
    els.statusText.textContent = "Sedang mengirim react...";
    addLog("info", "Mulai: " + config.total + " react, " + batchSize + " per kelompok, server " + config.server + ".");

    while (stats.done < stats.total && !state.stopRequested) {
      const count = Math.min(batchSize, stats.total - stats.done);

      try {
        const data = await sendBatch(config, count);
        if (!data || data.attempted < 1) {
          throw new Error("Server tidak sempat memproses react (waktu habis).");
        }
        stats.ok += data.success;
        stats.bad += data.failed;
        stats.done += data.attempted;
        errorsInRow = 0;
        addLog(
          data.failed > 0 ? "error" : "ok",
          "Kelompok selesai: " + data.success + " sukses, " + data.failed + " gagal."
        );
      } catch (error) {
        errorsInRow += 1;
        stats.bad += count;
        stats.done += count;
        addLog("error", "Gagal: " + (error.message || "kesalahan tidak diketahui"));

        if (error.fatal) {
          finishedReason = "Dihentikan karena permintaan ditolak.";
          renderStats(stats);
          break;
        }
        if (errorsInRow >= MAX_ERRORS_IN_ROW) {
          finishedReason = "Dihentikan: " + MAX_ERRORS_IN_ROW + " kelompok gagal berturut-turut.";
          renderStats(stats);
          break;
        }
      }

      renderStats(stats);
      els.statusText.textContent = "Sedang mengirim react... (" + stats.done + "/" + stats.total + ")";

      if (stats.done < stats.total && !state.stopRequested && config.delay > 0) {
        await sleep(config.delay);
      }
    }

    if (state.stopRequested) {
      finishedReason = "Dihentikan oleh kamu.";
    }

    els.statusText.textContent = finishedReason + " Sukses " + stats.ok + ", gagal " + stats.bad + ".";
    addLog("info", finishedReason + " Sukses " + stats.ok + ", gagal " + stats.bad + ".");
    setRunning(false);
  }

  function stopRun() {
    if (!state.running) return;
    state.stopRequested = true;
    els.btnStop.disabled = true;
    els.statusText.textContent = "Menghentikan setelah kelompok ini selesai...";
  }

  function addPresetEmoji(value) {
    const current = parseEmojis(els.emoji.value);
    if (!current.includes(value)) current.push(value);
    els.emoji.value = current.join(",");
  }

  els.btnStart.addEventListener("click", startRun);
  els.btnStop.addEventListener("click", stopRun);
  els.btnClear.addEventListener("click", clearLog);

  els.presets.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-emoji]");
    if (!button || state.running) return;
    addPresetEmoji(button.dataset.emoji);
  });

  [els.link, els.emoji, els.total, els.delay].forEach((input) => {
    input.addEventListener("input", clearError);
  });

  renderStats({ total: 0, done: 0, ok: 0, bad: 0 });
})();
