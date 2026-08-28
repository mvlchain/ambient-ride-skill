#!/usr/bin/env node

// src/scripts/ride-relay.ts
import path8 from "path";
import fs7 from "fs";

// src/lib/core/state-paths.ts
import os from "os";
import path from "path";
function resolveDir(raw) {
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}
function stateRoot() {
  return resolveDir(process.env["AMB_RIDE_STATE_DIR"] ?? path.join(os.homedir(), ".amb"));
}

// src/lib/core/runtime-env.ts
var SCALAR_KEYS = {
  AMB_RIDE_STATE_DIR: "stateDir",
  AMB_RIDE_PASSPHRASE: "passphrase",
  AMB_RIDE_LOG_LEVEL: "logLevel",
  AMB_RIDE_OPENCLAW_CLI: "openclawCli",
  AMB_RIDE_NOTIFY_WEBHOOK_URL: "notifyWebhookUrl",
  AMB_RIDE_NOTIFY_WEBHOOK_SECRET: "notifyWebhookSecret",
  AMB_RIDE_NOTIFY_TELEGRAM_BOT_TOKEN: "notifyTelegramBotToken",
  AMB_RIDE_NOTIFY_TELEGRAM_CHAT_ID: "notifyTelegramChatId"
};
var RPC_KEY = /^AMB_RIDE_RPC_URL_([A-Z0-9_]+)$/;
var NETWORK_NAME = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;
function readRuntimeEnv(env = process.env) {
  const result = { rpcUrls: {} };
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("AMB_RIDE_")) continue;
    const scalar = SCALAR_KEYS[key];
    if (scalar !== void 0) {
      if (value !== void 0) result[scalar] = value;
      continue;
    }
    const rpc = RPC_KEY.exec(key);
    if (rpc && NETWORK_NAME.test(rpc[1])) {
      if (value !== void 0) result.rpcUrls[rpc[1]] = value;
      continue;
    }
    throw new Error(`Unknown Ambient Ride runtime environment variable: ${key}`);
  }
  return result;
}

// src/lib/core/run-lock.ts
import fs from "fs";
import path2 from "path";
function pidFile(root, name) {
  return path2.join(root, "run", `${name}.pid`);
}
function readPid(p) {
  try {
    const n = parseInt(fs.readFileSync(p, "utf8").trim(), 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function isHeldAlive(root, name) {
  const pid = readPid(pidFile(root, name));
  return pid !== null && alive(pid);
}
function acquire(root, name) {
  if (fs.existsSync(`${root}.amb-migration-quiesced`)) return false;
  const p = pidFile(root, name);
  fs.mkdirSync(path2.dirname(p), { recursive: true });
  try {
    const fd = fs.openSync(p, "wx");
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    const pid = readPid(p);
    if (pid === process.pid) return false;
    if (pid !== null && alive(pid)) return false;
    try {
      fs.unlinkSync(p);
    } catch {
    }
    try {
      const fd = fs.openSync(p, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch {
      return false;
    }
  }
}
function release(root, name) {
  try {
    if (readPid(pidFile(root, name)) === process.pid) fs.unlinkSync(pidFile(root, name));
  } catch {
  }
}

// src/scripts/_internal/select-deliver.ts
function selectDeliver(env = process.env) {
  const override = (env["TADA_DELIVER"] ?? "").trim();
  if (override === "openclaw" || override === "stdout") return override;
  if ((env["OPENCLAW_SERVICE_MARKER"] ?? "").trim().length > 0) return "openclaw";
  return "stdout";
}

// src/lib/events/event-phrase.ts
var STATUS_PHRASE = {
  WAITPAY: "waiting for payment",
  PAYCONFIRMED: "payment confirmed, matching a driver",
  PENDING: "searching for a driver",
  MATCHED: "a driver candidate was found",
  CONFIRMED: "the match was confirmed",
  ASSIGNED: "a driver is assigned and on the way",
  PICKUP: "the driver is on the way to the pickup point",
  PICKUP_ARRIVED: "the driver has arrived at the pickup point",
  INUSE: "the ride is in progress",
  FINISHED: "the ride completed successfully",
  NOT_MATCHED: "no driver was found",
  CANCELED: "the ride was cancelled",
  ACCIDENT_CANCELED: "the ride was cancelled due to an accident",
  USER_CANCELED: "cancelled by the rider",
  USER_CANCELED_BEFORE_CALL: "cancelled by the rider before matching",
  USER_CANCELED_NO_FREE: "cancelled by the rider (cancellation fee charged)",
  DRIVER_CANCELED: "cancelled by the driver",
  DRIVER_CANCELED_RECALLABLE: "cancelled by the driver (can re-request)",
  COMPANY_CANCELED: "cancelled by the operator",
  COMPANY_CANCELED_RECALLABLE: "cancelled by the operator (can re-request)",
  EXPIRED: "the request expired (no driver found)",
  EXPIRED_RECALLABLE: "the request expired (can re-request)",
  EXPIRED_BEFORE_PAY: "the payment window expired",
  ERROR_PAYMENT: "a payment error occurred",
  ERROR: "an unexpected error occurred"
};
function phraseFor(status, statusMessage) {
  const msg = statusMessage?.trim();
  if (msg && msg.length > 0) return msg;
  return STATUS_PHRASE[status] ?? status;
}
var CURRENCY_SYMBOL = {
  KRW: "\u20A9",
  USD: "$",
  SGD: "S$",
  VND: "\u20AB"
};
function formatTipAmount(amount, currency) {
  const n = amount.toLocaleString("en-US");
  const sym = CURRENCY_SYMBOL[currency];
  return sym ? `${sym}${n}` : `${n} ${currency}`;
}

// src/scripts/_internal/render-notification.ts
var RETRYABLE = /* @__PURE__ */ new Set([
  "EXPIRED",
  "EXPIRED_RECALLABLE",
  "NOT_MATCHED",
  "DRIVER_CANCELED_RECALLABLE",
  "COMPANY_CANCELED_RECALLABLE"
]);
var ASSIGNMENT_STATUSES = /* @__PURE__ */ new Set(["MATCHED", "CONFIRMED", "ASSIGNED", "PICKUP"]);
function sentenceCase(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
function ensurePeriod(s) {
  return /[.!?…"'」]$/.test(s) ? s : `${s}.`;
}
function driverLine(d) {
  const colorModel = [d.carColor, d.carModel].filter(Boolean).join(" ").trim();
  const parts = [];
  if (colorModel) parts.push(colorModel);
  if (d.carPlate) parts.push(`plate ${d.carPlate}`);
  const vehicle = parts.join(", ");
  return `\u{1F697} Driver assigned: ${d.name || "your driver"}${vehicle ? ` \u2014 ${vehicle}` : ""}.`;
}
function renderNotification(ev) {
  if (ev.kind === "driver_chat") {
    const c = ev.payload["content"] ?? "";
    return `\u{1F4AC} Driver: "${c}"`;
  }
  const status = String(ev.payload["status"] ?? "");
  const statusMessage = ev.payload["statusMessage"]?.trim();
  const shareUrl = ev.payload["rideShareUrl"];
  const withShare = (line) => shareUrl ? `${line}
Track live: ${shareUrl}` : line;
  const driver = ev.payload["driver"];
  if (!ev.terminal && ASSIGNMENT_STATUSES.has(status) && driver && (driver.name || driver.carPlate)) {
    return withShare(driverLine(driver));
  }
  if (ev.terminal) {
    if (status === "FINISHED") {
      const completion = statusMessage ? ensurePeriod(sentenceCase(statusMessage)) : "Ride completed.";
      const tip = ev.payload["tip"];
      const tipInvitation = tip ? ` Tips from ${formatTipAmount(tip.minAmount, tip.currency)} are welcome \u2014 just tell me if you'd like to add one.` : "";
      return `\u2705 ${completion}${tipInvitation} If you'd like your receipt, just ask.`;
    }
    const phrase2 = ensurePeriod(sentenceCase(phraseFor(status, statusMessage)));
    return RETRYABLE.has(status) ? `\u26A0\uFE0F ${phrase2} Say "call again" to retry.` : `\u26A0\uFE0F ${phrase2}`;
  }
  if (!statusMessage) {
    switch (status) {
      case "PICKUP":
        return withShare("\u{1F697} Your driver is on the way to the pickup point.");
      case "PICKUP_ARRIVED":
        return withShare("\u{1F4CD} Your driver has arrived at the pickup point.");
      case "INUSE":
        return withShare("\u{1F6E3}\uFE0F Ride started \u2014 heading to your destination.");
    }
  }
  const phrase = phraseFor(status, statusMessage);
  if (!phrase) return ev.prompt || "Ride update.";
  return withShare(ensurePeriod(sentenceCase(phrase)));
}

// src/scripts/_internal/deliver-stdout.ts
var deliverStdout = async (ev) => {
  await new Promise((resolve, reject) => {
    process.stdout.write(ev.prompt + "\n", (err) => err ? reject(err) : resolve());
  });
};
function contextOnlyFraming(ev) {
  return `[relay] Ride status already sent to the user directly (seq ${ev.seq}). Context only \u2014 do NOT send any message. ${ev.prompt}`;
}
var writeLine = (line) => new Promise((resolve, reject) => {
  process.stdout.write(line, (err) => err ? reject(err) : resolve());
});
function makeSinkThenStdoutDeliver(sink, write = writeLine) {
  const pushedSeqs = /* @__PURE__ */ new Set();
  return async (ev) => {
    let sinkOk = pushedSeqs.has(ev.seq);
    if (!sinkOk) {
      try {
        sinkOk = await sink.push(renderNotification(ev), ev);
      } catch {
        sinkOk = false;
      }
      if (sinkOk) pushedSeqs.add(ev.seq);
    }
    await write(sinkOk ? contextOnlyFraming(ev) + "\n" : ev.prompt + "\n");
  };
}

// src/scripts/_internal/deliver-sink.ts
import { createHmac } from "crypto";
var DEFAULT_SINK_TIMEOUT_MS = 5e3;
function makeWebhookSink(o) {
  const doFetch = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? DEFAULT_SINK_TIMEOUT_MS;
  return {
    async push(rendered, ev) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const body = JSON.stringify({
          rideId: ev.rideId,
          seq: ev.seq,
          kind: ev.kind,
          status: ev.payload?.["status"] ?? null,
          terminal: ev.terminal,
          ts: ev.ts,
          text: rendered
        });
        const headers = { "Content-Type": "application/json" };
        if (o.secret) {
          headers["X-Amb-Ride-Signature"] = "sha256=" + createHmac("sha256", o.secret).update(body).digest("hex");
        }
        const res = await doFetch(o.url, { method: "POST", headers, body, signal: ctrl.signal });
        return res.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
function makeTelegramSink(o) {
  const doFetch = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? DEFAULT_SINK_TIMEOUT_MS;
  const url = `https://api.telegram.org/bot${o.botToken}/sendMessage`;
  return {
    async push(rendered) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: o.chatId, text: rendered }),
          signal: ctrl.signal
        });
        if (!res.ok) return false;
        const json = await res.json();
        return json.ok === true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
var CONSECUTIVE_FAILURE_LATCH = 3;
function withLatch(inner, threshold = CONSECUTIVE_FAILURE_LATCH) {
  let consecutiveFailures = 0;
  let latched = false;
  return {
    async push(rendered, ev) {
      if (latched) return false;
      const ok = await inner.push(rendered, ev);
      if (ok) {
        consecutiveFailures = 0;
      } else if (++consecutiveFailures >= threshold) {
        latched = true;
      }
      return ok;
    }
  };
}
function makeCompositeSink(sinks) {
  return {
    async push(rendered, ev) {
      const results = await Promise.all(sinks.map((s) => s.push(rendered, ev)));
      return results.some(Boolean);
    }
  };
}
function buildSinksFromEnv(env, deps = {}) {
  const sinks = [];
  if (env.notifyWebhookUrl) {
    sinks.push(withLatch(makeWebhookSink({
      url: env.notifyWebhookUrl,
      secret: env.notifyWebhookSecret,
      fetchImpl: deps.fetchImpl
    })));
  }
  if (env.notifyTelegramBotToken && env.notifyTelegramChatId) {
    sinks.push(withLatch(makeTelegramSink({
      botToken: env.notifyTelegramBotToken,
      chatId: env.notifyTelegramChatId,
      fetchImpl: deps.fetchImpl
    })));
  }
  return sinks;
}

// src/scripts/_internal/deliver-openclaw.ts
import { closeSync, existsSync, fstatSync, openSync, readSync, realpathSync } from "fs";
import path3 from "path";
import { execFile, execFileSync } from "child_process";
var DELIVER_AGENT_TIMEOUT_SECONDS = 180;
function buildRelayArgs(input) {
  const base = [
    "agent",
    "--agent",
    input.agentId,
    "--session-id",
    input.sessionId,
    "--thinking",
    "off",
    "--timeout",
    String(DELIVER_AGENT_TIMEOUT_SECONDS),
    "--message",
    input.prompt
  ];
  if (input.hasChannel) base.push("--channel", "last", "--deliver");
  return base;
}
var COMMON_CLI_PATHS = [
  "/opt/homebrew/bin/openclaw",
  "/usr/local/bin/openclaw"
];
function defaultWhich() {
  try {
    const out = execFileSync("command", ["-v", "openclaw"], {
      shell: "/bin/sh",
      encoding: "utf-8"
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
function resolveOpenclawCli(passed, opts = {}) {
  const exists = opts.exists ?? existsSync;
  const which = opts.which ?? defaultWhich;
  if (passed && exists(passed)) return passed;
  const found = which();
  if (found) return found;
  for (const p of COMMON_CLI_PATHS) {
    if (exists(p)) return p;
  }
  throw new Error("openclaw CLI not found (passed/which/common paths all failed)");
}
function defaultRunForString(cli) {
  try {
    return execFileSync(cli, ["channels", "list"], {
      encoding: "utf-8",
      timeout: 1e4
    });
  } catch (e) {
    return `channels list failed: ${e.message}`;
  }
}
function detectChannelEnabled(cli, opts = {}) {
  const run = opts.run ?? defaultRunForString;
  const out = run(cli);
  return !/no configured chat channels/i.test(out);
}
var CHANNEL_UNDELIVERABLE = [
  /unknown channel/i,
  // `--channel last` with no channel history to resolve
  /requires target/i,
  // channel resolved, but no chatId for this session
  /channel is required/i
  // --deliver with no channel at all
];
function isChannelUndeliverable(message) {
  return CHANNEL_UNDELIVERABLE.some((re) => re.test(message));
}
function defaultOnDegrade(reason) {
  process.stderr.write(JSON.stringify({
    note: "RELAY_CHANNEL_DEGRADED",
    message: "channel push is undeliverable for this session \u2014 falling back to session-only inject for the rest of the ride (the rider still sees every event).",
    reason: reason.slice(0, 300)
  }) + "\n");
}
function defaultRun(timeoutMs) {
  return (cli, args) => new Promise((resolve, reject) => {
    execFile(cli, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const so = (stdout ?? "").toString().slice(0, 2e3);
        const se = (stderr ?? "").toString().slice(0, 2e3);
        const detail = [
          err.message,
          so ? `--stdout--
${so}` : "",
          se ? `--stderr--
${se}` : ""
        ].filter(Boolean).join("\n");
        reject(new Error(`deliver failed: ${detail}`));
      } else {
        resolve();
      }
    });
  });
}
function makeOpenclawDeliver(input) {
  const run = input.run ?? defaultRun(input.timeoutMs ?? (DELIVER_AGENT_TIMEOUT_SECONDS + 20) * 1e3);
  const onDegrade = input.onDegrade ?? defaultOnDegrade;
  let hasChannel = input.hasChannel;
  const send = (prompt, channel) => run(input.cli, buildRelayArgs({
    agentId: input.agentId,
    sessionId: input.sessionId,
    hasChannel: channel,
    prompt
  }));
  return async (ev) => {
    const { prompt } = ev;
    try {
      await send(prompt, hasChannel);
    } catch (e) {
      const message = e.message;
      if (!hasChannel || !isChannelUndeliverable(message)) throw e;
      hasChannel = false;
      onDegrade(message);
      await send(prompt, false);
    }
  };
}
var DEFAULT_ACTIVE_MINUTES = 180;
function chooseOpenclawAgent(input) {
  const agents = input.agents.filter((a) => typeof a.id === "string" && a.id.length > 0);
  if (agents.length === 0) {
    throw new Error("OPENCLAW_RELAY_AGENT_UNRESOLVED: `openclaw agents list --json` returned no agents");
  }
  const passed = input.passedAgentId?.trim() || void 0;
  const explicit = passed ? agents.find((a) => a.id === passed) : void 0;
  if (agents.length === 1) {
    const only = agents[0];
    return {
      agentId: only.id,
      source: "only-agent",
      ...passed && passed !== only.id ? { correctedFrom: passed } : {}
    };
  }
  const realpath = input.realpath ?? realpathSync;
  let cwd;
  try {
    cwd = realpath(input.cwd);
  } catch (e) {
    throw new Error(`OPENCLAW_RELAY_AGENT_UNRESOLVED: cannot resolve current workspace ${input.cwd}: ${e.message}`);
  }
  const workspaceMatches = agents.filter((a) => {
    if (!a.workspace) return false;
    try {
      return realpath(a.workspace) === cwd;
    } catch {
      return false;
    }
  });
  if (workspaceMatches.length === 1) {
    const matched = workspaceMatches[0];
    if (explicit && explicit.id !== matched.id) {
      throw new Error(
        `OPENCLAW_RELAY_AGENT_MISMATCH: --agent ${explicit.id} conflicts with workspace agent ${matched.id}`
      );
    }
    return {
      agentId: matched.id,
      source: "workspace",
      ...passed && passed !== matched.id ? { correctedFrom: passed } : {}
    };
  }
  if (workspaceMatches.length > 1) {
    throw new Error(
      `OPENCLAW_RELAY_AGENT_AMBIGUOUS: ${workspaceMatches.length} agents share workspace ${cwd}`
    );
  }
  if (explicit) return { agentId: explicit.id, source: "explicit" };
  throw new Error(
    `OPENCLAW_RELAY_AGENT_UNRESOLVED: no agent workspace matches ${cwd}${passed ? ` and --agent ${passed} is not configured` : ""}`
  );
}
function resolveOpenclawAgent(input) {
  const run = input.run ?? defaultRunForSessions;
  let parsed;
  try {
    parsed = JSON.parse(run(input.cli, ["agents", "list", "--json"]));
  } catch (e) {
    throw new Error(`OPENCLAW_RELAY_AGENT_UNRESOLVED: could not run/parse \`openclaw agents list --json\`: ${e.message}`);
  }
  const raw = Array.isArray(parsed) ? parsed : parsed?.agents;
  const agents = (Array.isArray(raw) ? raw : []).filter(
    (a) => !!a && typeof a === "object" && typeof a.id === "string"
  );
  return chooseOpenclawAgent({
    agents,
    cwd: input.cwd ?? process.cwd(),
    passedAgentId: input.passedAgentId,
    realpath: input.realpath
  });
}
function defaultRunForSessions(cli, args) {
  return execFileSync(cli, args, { encoding: "utf-8", timeout: 1e4 });
}
var TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
var TRANSCRIPT_FLUSH_WAIT_MS = 5e3;
var SESSION_LIST_POLL_MS = 250;
var transcriptWaitBuffer = new Int32Array(new SharedArrayBuffer(4));
var defaultSessionResolveRetry = {
  now: Date.now,
  wait: (ms) => {
    Atomics.wait(transcriptWaitBuffer, 0, 0, ms);
  },
  timeoutMs: TRANSCRIPT_FLUSH_WAIT_MS,
  pollMs: SESSION_LIST_POLL_MS
};
var SINGLE_SHOT_SESSION_RETRY = {
  now: Date.now,
  wait: () => {
  },
  timeoutMs: 0,
  pollMs: 0
};
function listOpenclawSessions(cli, agentId, activeMinutes, run) {
  const base = ["--json", "--agent", agentId, "--active", String(activeMinutes)];
  const argForms = [["sessions", ...base], ["sessions", "list", ...base]];
  let parsed;
  let lastErr;
  for (const args of argForms) {
    try {
      parsed = JSON.parse(run(cli, args));
      lastErr = void 0;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    throw new Error(
      `could not run/parse \`openclaw sessions [list] --json --agent ${agentId}\`: ${lastErr.message}`
    );
  }
  return parsed;
}
function formatSessionResolveDiagnostics(diagnostics) {
  const { attempts, elapsedMs, latestSessionCount, observedSessionIds, storePathObserved } = diagnostics;
  return ` [attempts=${attempts} elapsedMs=${elapsedMs} latestSessionCount=${latestSessionCount} observedSessionIds=${observedSessionIds} storePathObserved=${storePathObserved}]`;
}
function defaultTranscriptHasRideId(storePath, sessionId, rideId) {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return false;
  const transcript = path3.join(path3.dirname(storePath), `${sessionId}.jsonl`);
  let fd;
  try {
    fd = openSync(transcript, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.includes(rideId);
  } catch {
    return false;
  } finally {
    if (fd !== void 0) try {
      closeSync(fd);
    } catch {
    }
  }
}
function readChannelContextTarget(env) {
  const raw = env?.["OPENCLAW_CHANNEL_CONTEXT"];
  if (!raw) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void 0;
  }
  const pick = (v) => {
    if (typeof v === "string") {
      const t = v.trim();
      return t.length ? t : void 0;
    }
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return void 0;
  };
  const obj = parsed && typeof parsed === "object" ? parsed : void 0;
  return pick(obj?.["chat"]?.["id"]);
}
var TARGET_CHANNELS = /* @__PURE__ */ new Set(["telegram"]);
function parseSessionChannelTarget(key) {
  if (!key) return null;
  const seg = key.split(":");
  if (seg.length !== 5 || seg[0] !== "agent") return null;
  const [, , channel, , target] = seg;
  if (!TARGET_CHANNELS.has(channel) || target.length === 0) return null;
  return { channel, target };
}
function resolveOpenclawSession(input) {
  const passed = input.passedSessionId;
  if (passed && !passed.startsWith("agent:")) {
    return { sessionId: passed, key: void 0, source: "explicit-session-id" };
  }
  {
    const listRun = input.run ?? defaultRunForSessions;
    const listActiveMinutes = input.activeMinutes ?? DEFAULT_ACTIVE_MINUTES;
    const envTarget = readChannelContextTarget(input.env);
    if (envTarget) {
      let listed;
      try {
        listed = listOpenclawSessions(input.cli, input.agentId, listActiveMinutes, listRun);
      } catch {
        listed = void 0;
      }
      if (listed) {
        const listedWithId = (Array.isArray(listed.sessions) ? listed.sessions : []).filter(
          (s) => typeof s?.sessionId === "string" && s.sessionId.length > 0
        );
        const matches = listedWithId.filter((s) => {
          const parsed = parseSessionChannelTarget(s.key);
          return parsed !== null && parsed.target === envTarget;
        });
        if (matches.length > 1) {
          throw new Error(
            `OPENCLAW_RELAY_SESSION_AMBIGUOUS: channel target matched ${matches.length} active sessions for agent ${input.agentId}`
          );
        }
        if (matches.length === 1) {
          return { sessionId: matches[0].sessionId, key: matches[0].key, source: "channel-env" };
        }
      }
    }
  }
  const sessionKey = input.sessionKey ?? (passed?.startsWith("agent:") ? passed : void 0);
  const run = input.run ?? defaultRunForSessions;
  const activeMinutes = input.activeMinutes ?? DEFAULT_ACTIVE_MINUTES;
  const retry = input.retry ?? defaultSessionResolveRetry;
  const transcriptHasRideId = input.transcriptHasRideId ?? defaultTranscriptHasRideId;
  const startedAt = retry.now();
  const deadline = startedAt + retry.timeoutMs;
  let result = {};
  let withId = [];
  let transcriptMatches = [];
  let attempts = 0;
  let latestSessionCount = 0;
  let storePathObserved = false;
  let hasValidSnapshot = false;
  let lastListError;
  const observedSessionIds = /* @__PURE__ */ new Set();
  do {
    attempts += 1;
    try {
      result = listOpenclawSessions(input.cli, input.agentId, activeMinutes, run);
      hasValidSnapshot = true;
      lastListError = void 0;
    } catch (e) {
      lastListError = e;
      const now2 = retry.now();
      if (now2 >= deadline) break;
      retry.wait(Math.min(retry.pollMs, deadline - now2));
      continue;
    }
    const sessions = result.sessions;
    withId = (Array.isArray(sessions) ? sessions : []).filter(
      (s) => typeof s?.sessionId === "string" && s.sessionId.length > 0
    );
    latestSessionCount = withId.length;
    storePathObserved ||= typeof result.path === "string";
    for (const session of withId) observedSessionIds.add(session.sessionId);
    if (input.rideId && typeof result.path === "string") {
      transcriptMatches = withId.filter((s) => transcriptHasRideId(result.path, s.sessionId, input.rideId));
      if (transcriptMatches.length > 1) {
        throw new Error(
          `OPENCLAW_RELAY_SESSION_AMBIGUOUS: ride ${input.rideId} appears in ${transcriptMatches.length} active sessions for agent ${input.agentId}`
        );
      }
      if (transcriptMatches.length === 1) break;
    } else {
      break;
    }
    const now = retry.now();
    if (now >= deadline) break;
    retry.wait(Math.min(retry.pollMs, deadline - now));
  } while (true);
  const diagnostics = formatSessionResolveDiagnostics({
    attempts,
    elapsedMs: Math.max(0, retry.now() - startedAt),
    latestSessionCount,
    observedSessionIds: observedSessionIds.size,
    storePathObserved
  });
  if (!hasValidSnapshot) {
    throw new Error(
      `OPENCLAW_RELAY_SESSION_UNRESOLVED: ${lastListError?.message ?? "no valid session-list snapshot"}${diagnostics}`
    );
  }
  const keyMatches = sessionKey ? withId.filter((s) => {
    if (typeof s.key !== "string") return false;
    return sessionKey.startsWith("agent:") ? s.key === sessionKey : s.key.endsWith(":" + sessionKey);
  }) : [];
  if (transcriptMatches.length === 1) {
    const matched = transcriptMatches[0];
    if (keyMatches.length === 1 && keyMatches[0].sessionId !== matched.sessionId) {
      throw new Error(
        `OPENCLAW_RELAY_SESSION_MISMATCH: --session-key resolves to ${keyMatches[0].sessionId}, ride ${input.rideId} resolves to ${matched.sessionId}`
      );
    }
    return {
      sessionId: matched.sessionId,
      key: matched.key,
      source: "transcript",
      ...attempts > 1 ? {
        diagnostics: {
          attempts,
          elapsedMs: Math.max(0, retry.now() - startedAt),
          latestSessionCount,
          observedSessionIds: observedSessionIds.size,
          storePathObserved
        }
      } : {},
      ...sessionKey && (keyMatches.length !== 1 || keyMatches[0].sessionId !== matched.sessionId) ? { correctedSessionKeyFrom: sessionKey } : {}
    };
  }
  if (withId.length === 0) {
    throw new Error(
      `OPENCLAW_RELAY_SESSION_UNRESOLVED: no active session with a sessionId for agent ${input.agentId} (looked back ${activeMinutes}m). Is the agent's chat session live?${diagnostics}`
    );
  }
  if (!sessionKey) {
    throw new Error(
      `OPENCLAW_RELAY_SESSION_UNRESOLVED: ride ${input.rideId ?? "(missing)"} was not found in any active session transcript and no --session-key hint was provided${diagnostics}`
    );
  }
  if (keyMatches.length === 0) {
    throw new Error(
      `OPENCLAW_RELAY_SESSION_UNRESOLVED: the provided session-key hint was not found for agent ${input.agentId}${diagnostics}`
    );
  }
  if (keyMatches.length > 1) {
    throw new Error(
      `OPENCLAW_RELAY_SESSION_AMBIGUOUS: the provided session-key hint matched ${keyMatches.length} active sessions for agent ${input.agentId}`
    );
  }
  return { sessionId: keyMatches[0].sessionId, key: keyMatches[0].key, source: "session-key" };
}

// src/scripts/_internal/resolve-fail-log.ts
import fs2 from "fs";
function makeResolveFailLogger(errorLogPath, opts) {
  const throttleMs = opts?.throttleMs ?? 3e4;
  const now = opts?.now ?? Date.now;
  let count = 0;
  let lastStderrAt = 0;
  return (e) => {
    count += 1;
    const t = now();
    if (count === 1 || t - lastStderrAt >= throttleMs) {
      lastStderrAt = t;
      process.stderr.write(JSON.stringify({
        error: "OPENCLAW_RELAY_SESSION_UNRESOLVED",
        message: e.message,
        attempts: count
      }) + "\n");
    }
    try {
      fs2.appendFileSync(errorLogPath, `[${(/* @__PURE__ */ new Date()).toISOString()}] resolve: ${e.message}
`);
    } catch {
    }
  };
}

// src/scripts/_internal/relay-trace.ts
import fs3 from "fs";
import path4 from "path";
function relayTracePath(root, rideId) {
  return path4.join(root, "run", `relay-trace-${rideId}.jsonl`);
}
function makeRelayTrace(root, rideId) {
  const file = relayTracePath(root, rideId);
  return (rec) => {
    try {
      fs3.mkdirSync(path4.dirname(file), { recursive: true });
      fs3.appendFileSync(file, JSON.stringify(rec) + "\n");
    } catch {
    }
  };
}

// src/scripts/_internal/inject-queue.ts
function makeInjectQueue(o) {
  const now = o.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const pending = /* @__PURE__ */ new Set();
  let chain = Promise.resolve();
  let abandoned = false;
  const attemptAll = async (seq, text) => {
    const startTs = now();
    let lastError = "";
    for (let attempt = 1; attempt <= o.backoffsMs.length + 1; attempt++) {
      if (abandoned) return;
      try {
        await o.run(text);
        if (abandoned) return;
        pending.delete(seq);
        o.onRecord({ seq, status: "ok", attempts: attempt, injectStartTs: startTs, injectOkTs: now() });
        return;
      } catch (e) {
        lastError = e.message.slice(0, 500);
        const backoff = o.backoffsMs[attempt - 1];
        if (backoff !== void 0) await new Promise((r) => setTimeout(r, backoff));
      }
    }
    if (abandoned) return;
    pending.delete(seq);
    o.onRecord({ seq, status: "failed", attempts: o.backoffsMs.length + 1, injectStartTs: startTs, lastError });
  };
  return {
    push(seq, text) {
      pending.add(seq);
      chain = chain.then(() => attemptAll(seq, text));
    },
    async drain(capMs) {
      const done = chain.then(() => true);
      const capped = new Promise((r) => setTimeout(() => r(false), capMs));
      const ok = await Promise.race([done, capped]);
      if (!ok) {
        abandoned = true;
        for (const seq of pending) o.onRecord({ seq, status: "abandoned", attempts: 0 });
        pending.clear();
      }
      return ok;
    }
  };
}

// src/scripts/_internal/deliver-fastpath.ts
import { execFile as execFile2 } from "child_process";

// src/lib/events/event-prompt.ts
function renderDriver(d) {
  if (!d) return "";
  const parts = [];
  if (d.carPlate) parts.push(`plate ${d.carPlate}`);
  const colorModel = [d.carColor, d.carModel].filter(Boolean).join(" ").trim();
  if (colorModel) parts.push(colorModel);
  if (d.name) parts.push(`driver ${d.name}`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}
function brandForRegion(region) {
  const r = typeof region === "string" ? region.toUpperCase() : "";
  if (r === "NY") return "Throo";
  if (r === "") return "TADA/Throo";
  return "TADA";
}
function renderPrompt(ev) {
  const brand = brandForRegion(ev.payload["region"]);
  if (ev.kind === "driver_chat") {
    const c = ev.payload["content"] ?? "";
    return `${brand} ride: driver sent "${c}". Tell the user briefly; their next short reply may be for the driver. No unrelated questions.`;
  }
  const statusMessage = ev.payload["statusMessage"];
  const status = String(ev.payload["status"] ?? "");
  const phrase = phraseFor(status, statusMessage);
  if (ev.terminal) {
    const tip = ev.payload["tip"];
    let line = `${brand} ride ${ev.rideId} ${phrase}. Tell the user the final outcome briefly.`;
    if (status === "FINISHED") {
      line += " Ask whether they would like to see their receipt. Fetch it only if they explicitly ask.";
    }
    if (tip) {
      const range = tip.maxAmount ? `from ${formatTipAmount(tip.minAmount, tip.currency)} up to ${formatTipAmount(tip.maxAmount, tip.currency)}` : `from ${formatTipAmount(tip.minAmount, tip.currency)}`;
      line += ` Tips ${range} are welcome. You may offer the tip together with that receipt question.`;
    }
    return line;
  }
  const eta = ev.payload["etaMin"];
  const driverPart = renderDriver(ev.payload["driver"]);
  const share = ev.payload["rideShareUrl"];
  const sharePart = share ? ` Live tracking: ${share} \u2014 include it as a markdown link.` : "";
  return `${brand} ride ${ev.rideId} is ${phrase}${driverPart}${eta ? `, pickup ~${eta}min` : ""}. Tell the user briefly.${sharePart} No unrelated questions.`;
}

// src/scripts/_internal/deliver-fastpath.ts
var CONSECUTIVE_FAILURE_LATCH2 = 3;
var SEND_TIMEOUT_MS = 3e4;
function buildMessageSendArgs(o) {
  return ["message", "send", "--channel", o.channel, "--target", o.target, "-m", o.text, "--json"];
}
function buildInjectText(ev) {
  return `[relay] Ride status already notified to the user directly (seq ${ev.seq}). Context only \u2014 do NOT send any message. ${ev.prompt || renderPrompt(ev)}`;
}
function defaultRunSend(cli) {
  return (args) => new Promise((resolve, reject) => {
    execFile2(cli, args, { timeout: SEND_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`message send failed: ${err.message}
${String(stderr).slice(0, 500)}`));
        return;
      }
      try {
        const out = JSON.parse(String(stdout));
        resolve({ messageId: out.payload?.messageId ?? out.messageId });
      } catch {
        resolve({});
      }
    });
  });
}
function makeOpenclawSink(o) {
  return {
    async push(rendered) {
      try {
        await o.runSend(buildMessageSendArgs({ channel: o.channel, target: o.target, text: rendered }));
        return true;
      } catch {
        return false;
      }
    }
  };
}
function makeFastpathDeliver(o) {
  const now = o.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  let latched = false;
  let consecutiveFailures = 0;
  return async (ev) => {
    const readTs = now();
    if (!latched) {
      const sendStartTs = now();
      let delivered = false;
      try {
        delivered = await o.sink.push(renderNotification(ev), ev);
      } catch {
        delivered = false;
      }
      if (delivered) {
        consecutiveFailures = 0;
        o.trace({
          seq: ev.seq,
          phase: "notified",
          kind: ev.kind,
          status: ev.payload?.["status"],
          eventTs: ev.ts,
          readTs,
          path: "fast",
          sendStartTs,
          sendOkTs: now()
        });
        o.enqueueInject(ev.seq, buildInjectText(ev));
        return;
      }
      if (++consecutiveFailures >= CONSECUTIVE_FAILURE_LATCH2) latched = true;
    }
    const fbStartTs = now();
    await o.legacyDeliver(ev);
    o.trace({
      seq: ev.seq,
      phase: "notified",
      kind: ev.kind,
      status: ev.payload?.["status"],
      eventTs: ev.ts,
      readTs,
      path: "fallback",
      sendStartTs: fbStartTs,
      sendOkTs: now()
    });
  };
}
function makeTracedLegacyDeliver(legacy, trace, now) {
  const clock = now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  return async (ev) => {
    const readTs = clock();
    const sendStartTs = clock();
    await legacy(ev);
    trace({
      seq: ev.seq,
      phase: "notified",
      kind: ev.kind,
      status: ev.payload?.["status"],
      eventTs: ev.ts,
      readTs,
      path: "fallback",
      sendStartTs,
      sendOkTs: clock()
    });
  };
}

// src/scripts/_internal/relay-loop.ts
import { spawn as nodeSpawn } from "child_process";
import path5 from "path";
import fs4 from "fs";
var RelaySpawnError = class extends Error {
  code = "RELAY_CLI_SPAWN_FAILED";
  ambCmd;
  spawnCode;
  constructor(ambCmd, cause) {
    super(`failed to spawn '${ambCmd}': ${cause.code ?? cause.message}`, { cause });
    this.name = "RelaySpawnError";
    this.ambCmd = ambCmd;
    this.spawnCode = cause.code;
  }
};
function isRelaySpawnError(e) {
  return e instanceof RelaySpawnError;
}
var PERMANENT_SPAWN_CODES = /* @__PURE__ */ new Set(["ENOENT", "EACCES", "EPERM", "ENOTDIR"]);
function isPermanentSpawnFailure(e) {
  return e.spawnCode !== void 0 && PERMANENT_SPAWN_CODES.has(e.spawnCode);
}
function writeCursorAtomic(file, seq) {
  fs4.mkdirSync(path5.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs4.writeFileSync(tmp, String(seq));
  fs4.renameSync(tmp, file);
}
function runRelayLoop(o) {
  const spawn = o.spawn ?? nodeSpawn;
  const ambCmd = o.ambCmd ?? "amb";
  let child;
  try {
    child = spawn(ambCmd, [
      "events",
      "--ride",
      o.rideId,
      "--cursor-file",
      o.cursorFile,
      "--follow",
      "--prompt"
    ], { stdio: ["ignore", "pipe", "inherit"] });
  } catch (err) {
    return Promise.reject(new RelaySpawnError(ambCmd, err));
  }
  let sawTerminal = false;
  const oneShot = o.oneShot ?? false;
  let firstDelivered = false;
  let buf = "";
  let chain = Promise.resolve();
  const inFlightOrDone = /* @__PURE__ */ new Set();
  const processLine = (line) => {
    if (!line.trim()) return Promise.resolve();
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return Promise.resolve();
    }
    if (typeof ev.prompt !== "string" || typeof ev.seq !== "number") return Promise.resolve();
    const evSeq = ev.seq;
    if (inFlightOrDone.has(evSeq)) return Promise.resolve();
    inFlightOrDone.add(evSeq);
    const evTerminal = ev.terminal;
    return (async () => {
      try {
        await o.deliver(ev);
      } catch {
        inFlightOrDone.delete(evSeq);
        return;
      }
      writeCursorAtomic(o.cursorFile, evSeq);
      if (evTerminal === true) sawTerminal = true;
      if (oneShot && !firstDelivered) {
        firstDelivered = true;
        try {
          child.kill("SIGTERM");
        } catch {
        }
      }
    })();
  };
  child.stdout.on("data", (chunk) => {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const captured = line;
      chain = chain.then(() => processLine(captured));
    }
  });
  const killChild = () => {
    try {
      child.kill("SIGTERM");
    } catch {
    }
  };
  if (o.signal) {
    if (o.signal.aborted) killChild();
    else o.signal.addEventListener("abort", killChild, { once: true });
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      o.signal?.removeEventListener("abort", killChild);
      reject(new RelaySpawnError(ambCmd, err));
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      o.signal?.removeEventListener("abort", killChild);
      const tail = buf;
      buf = "";
      chain = chain.then(() => tail.trim() ? processLine(tail) : Promise.resolve());
      chain.then(() => resolve({ exitCode: code ?? 0, sawTerminal }));
    });
  });
}

// src/scripts/_internal/relay-guards.ts
import fs5 from "fs";

// src/lib/events/event-paths.ts
import path6 from "path";
function logPath(root, rideId) {
  return path6.join(root, "events", `${rideId}.jsonl`);
}

// src/scripts/_internal/relay-guards.ts
var DEFAULT_MAX_LIFETIME_MS = 4 * 60 * 60 * 1e3;
var DEFAULT_ORPHAN_IDLE_MS = 15 * 60 * 1e3;
var DEFAULT_CHECK_INTERVAL_MS = 60 * 1e3;
function defaultMonitorAlive(root, rideId) {
  return isHeldAlive(root, `sup-${rideId}`);
}
function defaultLastEventAt(root, rideId) {
  try {
    return fs5.statSync(logPath(root, rideId)).mtimeMs;
  } catch {
    return null;
  }
}
function startRelayGuards(o) {
  const now = o.now ?? Date.now;
  const monitorAlive = o.monitorAlive ?? defaultMonitorAlive;
  const lastEventAt = o.lastEventAt ?? defaultLastEventAt;
  const maxLifetimeMs = o.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS;
  const orphanIdleMs = o.orphanIdleMs ?? DEFAULT_ORPHAN_IDLE_MS;
  const intervalMs = o.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const startedAt = now();
  let done = false;
  let timer = null;
  const stop = () => {
    done = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const trip = (reason) => {
    const cb = o.onTrip;
    stop();
    cb(reason);
  };
  const check = () => {
    if (done) return;
    const t = now();
    if (t - startedAt >= maxLifetimeMs) {
      trip("RELAY_MAX_LIFETIME");
      return;
    }
    if (monitorAlive(o.root, o.rideId)) return;
    const last = lastEventAt(o.root, o.rideId);
    const lastActivity = Math.max(startedAt, last ?? 0);
    if (t - lastActivity >= orphanIdleMs) trip("RELAY_ORPHANED");
  };
  if (intervalMs > 0) {
    timer = setInterval(check, intervalMs);
    timer.unref?.();
  }
  return { check, stop };
}

// src/scripts/_internal/self-detach.ts
import { spawn as nodeSpawn2 } from "child_process";
import fs6 from "fs";
import path7 from "path";
var DETACH_MARKER = "TADA_RELAY_DETACHED";
var NO_DETACH_ENV = "TADA_RELAY_NO_DETACH";
function shouldSelfDetach(env = process.env) {
  if (selectDeliver(env) !== "openclaw") return false;
  if ((env[DETACH_MARKER] ?? "").trim() === "1") return false;
  if ((env[NO_DETACH_ENV] ?? "").trim() === "1") return false;
  return true;
}
function detachSelf(rideId, deps = {}) {
  const spawn = deps.spawn ?? nodeSpawn2;
  const env = deps.env ?? process.env;
  const execPath = deps.execPath ?? process.execPath;
  const argv = deps.argv ?? process.argv.slice(1);
  const root = deps.root ?? stateRoot();
  const warn = deps.stderr ?? ((s) => process.stderr.write(s));
  const logPath2 = path7.join(root, "run", `relay-${rideId}.log`);
  try {
    fs6.mkdirSync(path7.dirname(logPath2), { recursive: true });
    const fd = fs6.openSync(logPath2, "a");
    try {
      const child = spawn(execPath, argv, {
        detached: true,
        stdio: ["ignore", fd, fd],
        env: { ...env, [DETACH_MARKER]: "1" }
      });
      child.unref();
      const pid = child.pid ?? null;
      warn(JSON.stringify({
        note: "RELAY_DETACHED",
        message: "ride-relay re-execed itself in its own session; it survives this tool call.",
        pid,
        log: logPath2
      }) + "\n");
      return pid;
    } finally {
      fs6.closeSync(fd);
    }
  } catch (e) {
    warn(JSON.stringify({
      note: "RELAY_DETACH_FAILED",
      message: `could not detach (${e.message}); running the relay inline instead.`
    }) + "\n");
    return null;
  }
}

// src/lib/core/main-module.ts
import { realpathSync as realpathSync2 } from "fs";
import { pathToFileURL } from "url";
function isMainModule(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return importMetaUrl === pathToFileURL(realpathSync2(entry)).href;
  } catch {
    return false;
  }
}

// src/scripts/ride-relay.ts
var DEFAULT_BACKOFF_MS = 500;
var DRAIN_CAP_MS = 6e5;
function spawnFailureMessage(e) {
  const prefix = `could not run '${e.ambCmd}' (${e.spawnCode ?? "spawn failed"})`;
  if (e.spawnCode === "ENOENT") {
    return `${prefix} \u2014 the Ambient CLI is not on this process's PATH. Install it with \`node scripts/install.js\`, or make sure \`${e.ambCmd}\` resolves for the process that starts the relay.`;
  }
  if (e.spawnCode === "EACCES" || e.spawnCode === "EPERM") {
    return `${prefix} \u2014 the Ambient CLI was found but this process has no permission to execute it. Check the file permissions on \`${e.ambCmd}\`.`;
  }
  if (e.spawnCode === "ENOTDIR") {
    return `${prefix} \u2014 a PATH entry is a file rather than a directory, so \`${e.ambCmd}\` could never be looked up. Check PATH for a malformed entry.`;
  }
  return `${prefix} \u2014 the CLI could not be started. This is usually temporary resource exhaustion on the host.`;
}
function reportSpawnFailure(e) {
  process.stderr.write(JSON.stringify({
    error: e.code,
    message: spawnFailureMessage(e)
  }) + "\n");
  return 1;
}
function noteTransientSpawnFailure(e) {
  process.stderr.write(JSON.stringify({
    note: "RELAY_CLI_SPAWN_RETRY",
    message: `${spawnFailureMessage(e)} Retrying.`
  }) + "\n");
}
async function runRideRelay(rideId, deps) {
  const kind = selectDeliver();
  if (kind === "stdout") {
    const cursorFile2 = path8.join(stateRoot(), "cursors", `stdout-${rideId}`);
    fs7.mkdirSync(path8.dirname(cursorFile2), { recursive: true });
    try {
      const sinks = buildSinksFromEnv(readRuntimeEnv());
      const deliver2 = sinks.length === 0 ? deliverStdout : makeSinkThenStdoutDeliver(makeCompositeSink(sinks));
      const r = await deps.runRelayLoop({ rideId, cursorFile: cursorFile2, deliver: deliver2, oneShot: deps.oneShot });
      return r.exitCode;
    } catch (e) {
      if (isRelaySpawnError(e)) return reportSpawnFailure(e);
      throw e;
    }
  }
  if (deps.oneShot) {
    process.stderr.write(JSON.stringify({
      note: "OPENCLAW_RELAY_ONCE_IGNORED",
      message: "--once ignored under OpenClaw; running the long-running relay instead."
    }) + "\n");
  }
  if (!deps.acquireLock || !deps.resolveOpenclawCli || !deps.makeOpenclawDeliver) {
    process.stderr.write(JSON.stringify({
      error: "INTERNAL",
      message: "openclaw deps missing (acquireLock, resolveOpenclawCli, makeOpenclawDeliver are all required for Flavor B)"
    }) + "\n");
    return 1;
  }
  const cli = deps.resolveOpenclawCli(readRuntimeEnv().openclawCli);
  const makeOpenclawDeliver2 = deps.makeOpenclawDeliver;
  const resolveAgent = deps.resolveOpenclawAgent ?? resolveOpenclawAgent;
  let agentId;
  try {
    const resolved = resolveAgent({ cli, passedAgentId: deps.agentId });
    agentId = resolved.agentId;
    if (resolved.correctedFrom) {
      process.stderr.write(JSON.stringify({
        note: "OPENCLAW_RELAY_AGENT_CORRECTED",
        passed_agent_id: resolved.correctedFrom,
        resolved_agent_id: agentId,
        source: resolved.source
      }) + "\n");
    }
  } catch (e) {
    process.stderr.write(JSON.stringify({
      error: "OPENCLAW_RELAY_AGENT_UNRESOLVED",
      message: e.message
    }) + "\n");
    return 1;
  }
  const resolveSession = deps.resolveOpenclawSession ?? resolveOpenclawSession;
  const errorLogPath = path8.join(stateRoot(), "run", `relay-error-${rideId}.log`);
  fs7.mkdirSync(path8.dirname(errorLogPath), { recursive: true });
  const resolveFailLog = makeResolveFailLogger(errorLogPath);
  let pipeline;
  function buildPipeline(resolved) {
    const channelTarget = parseSessionChannelTarget(resolved.key);
    const trace = makeRelayTrace(stateRoot(), rideId);
    const detectChannel = deps.detectChannelEnabled ?? detectChannelEnabled;
    const hasChannel = detectChannel(cli);
    const baseDeliver = makeOpenclawDeliver2({
      cli,
      agentId,
      sessionId: resolved.sessionId,
      hasChannel
    });
    const withErrorLog = (inner) => async (ev) => {
      try {
        await inner(ev);
      } catch (e) {
        try {
          fs7.appendFileSync(
            errorLogPath,
            `[${(/* @__PURE__ */ new Date()).toISOString()}] ${e.message}

`
          );
        } catch {
        }
        throw e;
      }
    };
    let injectQueue;
    let deliver2;
    if (channelTarget === null) {
      deliver2 = withErrorLog(makeTracedLegacyDeliver(baseDeliver, trace));
    } else {
      const injectRun = deps.injectRun ?? ((text) => defaultRun((DELIVER_AGENT_TIMEOUT_SECONDS + 20) * 1e3)(cli, buildRelayArgs({
        agentId,
        sessionId: resolved.sessionId,
        hasChannel: false,
        prompt: text
      })));
      const q = makeInjectQueue({
        run: injectRun,
        backoffsMs: [5e3, 15e3],
        onRecord: (rec) => trace({ phase: "context", ...rec })
      });
      injectQueue = q;
      const openclawSink = makeOpenclawSink({
        runSend: deps.runSend ?? defaultRunSend(cli),
        channel: channelTarget.channel,
        target: channelTarget.target
      });
      const externalSinks = buildSinksFromEnv(readRuntimeEnv());
      const sink = makeCompositeSink([withLatch(openclawSink), ...externalSinks]);
      deliver2 = withErrorLog(makeFastpathDeliver({
        sink,
        legacyDeliver: baseDeliver,
        enqueueInject: (seq, text) => q.push(seq, text),
        trace
      }));
    }
    return { deliver: deliver2, injectQueue };
  }
  const deliver = async (ev) => {
    if (!pipeline) {
      try {
        const resolved = resolveSession({
          cli,
          agentId,
          rideId,
          env: process.env,
          passedSessionId: deps.sessionId,
          sessionKey: deps.sessionKey,
          retry: SINGLE_SHOT_SESSION_RETRY
        });
        pipeline = buildPipeline(resolved);
      } catch (e) {
        resolveFailLog(e);
        throw e;
      }
    }
    return pipeline.deliver(ev);
  };
  const lockFile = path8.join(stateRoot(), "run", `relay-${rideId}.pid`);
  const unlock = await deps.acquireLock(lockFile);
  if (!unlock) return 0;
  const cursorFile = path8.join(stateRoot(), "cursors", `openclaw-${rideId}`);
  fs7.mkdirSync(path8.dirname(cursorFile), { recursive: true });
  const backoff = deps.backoffMs ?? DEFAULT_BACKOFF_MS;
  const controller = new AbortController();
  const startGuards = deps.startGuards ?? startRelayGuards;
  const guards = startGuards({
    rideId,
    root: stateRoot(),
    onTrip: (reason) => {
      process.stderr.write(JSON.stringify({
        note: reason,
        message: `ride-relay for ${rideId} is shutting down: ${reason === "RELAY_MAX_LIFETIME" ? "exceeded the maximum relay lifetime" : "the ride monitor is gone and no events have arrived"}.`
      }) + "\n");
      controller.abort();
    }
  });
  try {
    for (; ; ) {
      let r;
      try {
        r = await deps.runRelayLoop({ rideId, cursorFile, deliver, signal: controller.signal });
      } catch (e) {
        if (isRelaySpawnError(e)) {
          if (isPermanentSpawnFailure(e)) return reportSpawnFailure(e);
          if (controller.signal.aborted) return 0;
          noteTransientSpawnFailure(e);
          if (backoff > 0) await new Promise((res) => setTimeout(res, backoff));
          if (controller.signal.aborted) return 0;
          continue;
        }
        throw e;
      }
      if (r.sawTerminal) {
        if (pipeline?.injectQueue) await pipeline.injectQueue.drain(DRAIN_CAP_MS);
        return 0;
      }
      if (controller.signal.aborted) return 0;
      if (backoff > 0) await new Promise((res) => setTimeout(res, backoff));
    }
  } finally {
    guards.stop();
    unlock();
  }
}
function makeAcquireLockAdapter(acquireFn = acquire, releaseFn = release) {
  return async (lockFile) => {
    if (path8.basename(path8.dirname(lockFile)) !== "run") {
      throw new Error(
        `ride-relay adapter: lockFile must live under <root>/run/, got: ${lockFile}`
      );
    }
    const root = path8.dirname(path8.dirname(lockFile));
    const name = path8.basename(lockFile, ".pid");
    const ok = acquireFn(root, name);
    if (!ok) return null;
    return () => releaseFn(root, name);
  };
}
var defaultAcquireLockAdapter = makeAcquireLockAdapter();
function parseFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return void 0;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : void 0;
}
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const rideId = argv[0];
  if (!rideId || rideId.startsWith("--")) {
    process.stderr.write("error: Usage: ride-relay.js <request_id> [--agent <agent-id>] [--session-key <key>] [--session-id <sid>] [--once]\n");
    process.exit(1);
  }
  const agentId = parseFlag(argv, "--agent");
  const sessionKey = parseFlag(argv, "--session-key");
  const sessionId = parseFlag(argv, "--session-id");
  const oneShot = argv.includes("--once");
  if (shouldSelfDetach(process.env)) {
    const pid = detachSelf(rideId);
    if (pid !== null) process.exit(0);
  }
  const code = await runRideRelay(rideId, {
    agentId,
    sessionKey,
    sessionId,
    oneShot,
    acquireLock: defaultAcquireLockAdapter,
    runRelayLoop,
    resolveOpenclawCli,
    resolveOpenclawAgent,
    detectChannelEnabled,
    makeOpenclawDeliver
  });
  await new Promise((resolve) => {
    process.stdout.write("", () => resolve());
  });
  process.exit(code);
}
export {
  makeAcquireLockAdapter,
  runRideRelay
};
