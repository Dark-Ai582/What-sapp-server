import fs from "fs";
import chalk from "chalk";
import NodeCache from "node-cache";

import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason
} from "@whiskeysockets/baileys";

import pino from "pino";
import express from "express";

// ================= EXPRESS SERVER =================

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🤖 Bot Running");
});

app.listen(PORT, () => {
  console.log(
    chalk.green("🌐 Server running on port:"),
    PORT
  );
});

// ================= LOG FILTER =================

const originalError = console.error;
const originalLog = console.log;

console.error = (...args) => {

  const msg = args.join(" ");

  if (
    msg.includes("Bad MAC") ||
    msg.includes("Closing stale open session") ||
    msg.includes("Session error") ||
    msg.includes("libsignal") ||
    msg.includes("decrypt")
  ) return;

  originalError(...args);
};

console.log = (...args) => {

  const msg = args.join(" ");

  if (
    msg.includes("chainKey") ||
    msg.includes("ephemeralKeyPair")
  ) return;

  originalLog(...args);
};

// ================= LOAD FILES =================

const phone = fs
  .readFileSync("phone.txt", "utf-8")
  .trim();

const target = fs
  .readFileSync("target.txt", "utf-8")
  .trim();

const messages = fs
  .readFileSync("messages.txt", "utf-8")
  .split("\n")
  .map(v => v.trim())
  .filter(Boolean);

const config = JSON.parse(
  fs.readFileSync("config.json")
);

// ================= GLOBALS =================

let sock = null;

let heartbeat = null;

let reconnecting = false;

let totalMessages = 0;

let index = 0;

let messageLoopRunning = false;

const msgRetryCounterCache =
  new NodeCache({
    stdTTL: 0,
    checkperiod: 0
  });

// ================= HELPERS =================

function getIndianTime() {

  return new Date().toLocaleString(
    "en-IN",
    {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "medium"
    }
  );
}

function formatNumber(num) {

  return num.replace(/[^0-9]/g, "");
}

function random(min, max) {

  return Math.floor(
    Math.random() *
      (max - min + 1)
  ) + min;
}

function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}

// ================= GLOBAL ERROR HANDLER =================

process.on(
  "uncaughtException",
  err => {

    const msg =
      err?.message || "";

    if (
      msg.includes("Bad MAC") ||
      msg.includes("decrypt") ||
      msg.includes("Session error")
    ) return;

    console.log(
      chalk.red(
        "❌ Uncaught Error:"
      ),
      msg
    );
  }
);

process.on(
  "unhandledRejection",
  reason => {

    const msg =
      String(reason);

    if (
      msg.includes("Bad MAC") ||
      msg.includes("decrypt")
    ) return;

    console.log(
      chalk.red(
        "❌ Promise Error:"
      ),
      msg
    );
  }
);

// ================= MESSAGE LOOP =================

async function startMessageLoop() {

  if (messageLoopRunning)
    return;

  messageLoopRunning = true;

  console.log(
    chalk.yellow(
      "⏳ Starting Message Loop..."
    )
  );

  while (true) {

    try {

      if (
        !sock ||
        sock?.ws?.readyState !== 1
      ) {

        await sleep(5000);

        continue;
      }

      const msg =
        `${config.namePrefix} ${messages[index]}`;

      const jid =
        target.includes("@g.us")
          ? target
          : `${target}@s.whatsapp.net`;

      let status =
        "❌ Message Failed";

      try {

        // RANDOM WAIT
        await sleep(
          random(3000, 8000)
        );

        // CHECK SOCKET
        if (
          sock?.ws?.readyState !== 1
        ) {
          continue;
        }

        // TYPING
        await sock.sendPresenceUpdate(
          "composing",
          jid
        );

        // HUMAN TYPING
        const typingTime =
          msg.length *
          random(80, 180);

        await sleep(typingTime);

        // SEND
        await sock.sendMessage(
          jid,
          {
            text: msg
          }
        );

        // STOP TYPING
        await sock.sendPresenceUpdate(
          "paused",
          jid
        );

        status =
          "✅ Message Sent Successfully";

      } catch (err) {

        try {

          await sock.sendPresenceUpdate(
            "paused",
            jid
          );

        } catch {}

        status =
          "❌ Message Failed";
      }

      totalMessages++;

      // LOGS
      console.log(
        chalk.gray(
          "────────────────────────────────────────"
        )
      );

      console.log(
        chalk.yellow("🕒 Time:"),
        getIndianTime()
      );

      console.log(
        chalk.green("📱 Phone:"),
        formatNumber(phone)
      );

      console.log(
        chalk.blue("🎯 Target:"),
        formatNumber(target)
      );

      console.log(
        chalk.cyan("💬 Message:"),
        msg
      );

      console.log(
        chalk.magenta("📊 Total:"),
        totalMessages
      );

      console.log(

        status.includes(
          "Successfully"
        )

          ? chalk.green(
              "🚀 Status: " +
                status
            )

          : chalk.red(
              "⚠️ Status: " +
                status
            )
      );

      console.log(
        chalk.gray(
          "────────────────────────────────────────"
        )
      );

      index =
        (index + 1) %
        messages.length;

      // SAFE DELAY
      await sleep(
        config.delaySeconds *
          1000
      );

    } catch {

      await sleep(5000);
    }
  }
}

// ================= START BOT =================

async function startBot() {

  try {

    const sessionPath =
      `./session-${phone}`;

    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        sessionPath
      );

    const { version } =
      await fetchLatestBaileysVersion();

    // ================= SOCKET =================

    sock = makeWASocket({

      version,

      logger: pino({
        level: "silent"
      }),

      browser:
        Browsers.ubuntu(
          "Chrome"
        ),

      auth: {

        creds: state.creds,

        keys:
          makeCacheableSignalKeyStore(
            state.keys,
            pino({
              level: "silent"
            })
          )
      },

      printQRInTerminal: false,

      markOnlineOnConnect: false,

      keepAliveIntervalMs: 30000,

      retryRequestDelayMs: 5000,

      qrTimeout: 60000,

      generateHighQualityLinkPreview: false,

      msgRetryCounterCache,

      shouldIgnoreJid: jid => {

        return jid.includes(
          "broadcast"
        );
      },

      getMessage: async () => {

        return {
          conversation: "retry"
        };
      }
    });

    // ================= SAVE CREDS =================

    sock.ev.on(
      "creds.update",
      async () => {

        try {
          await saveCreds();
        } catch {}
      }
    );

    // ================= CONNECTION =================

    sock.ev.on(
      "connection.update",

      async update => {

        const {
          connection,
          lastDisconnect
        } = update;

        // ================= CONNECTED =================

        if (
          connection === "open"
        ) {

          console.log(
            chalk.green(
              "✅ WhatsApp Connected"
            )
          );

          reconnecting = false;

          // HEARTBEAT
          if (heartbeat)
            clearInterval(
              heartbeat
            );

          heartbeat =
            setInterval(
              async () => {

                try {

                  if (
                    sock?.ws
                      ?.readyState === 1
                  ) {

                    await sock.sendPresenceUpdate(
                      "available"
                    );

                    console.log(
                      chalk.gray(
                        "💓 Heartbeat Sent"
                      )
                    );
                  }

                } catch {}
              },

              600000
            );

          // START LOOP
          startMessageLoop();
        }

        // ================= CLOSED =================

        if (
          connection === "close"
        ) {

          const statusCode =
            lastDisconnect?.error
              ?.output
              ?.statusCode;

          console.log(
            chalk.red(
              "❌ Connection Closed:"
            ),
            statusCode
          );

          // HEARTBEAT STOP
          if (heartbeat) {

            clearInterval(
              heartbeat
            );

            heartbeat = null;
          }

          // ================= LOGGED OUT =================

          if (
            statusCode === 401 ||
            statusCode ===
              DisconnectReason.loggedOut
          ) {

            console.log(
              chalk.red(
                "❌ Session Logged Out!"
              )
            );

            reconnecting = false;

            return;
          }

          // ================= BAD SESSION =================

          if (
            statusCode ===
            DisconnectReason.badSession
          ) {

            console.log(
              chalk.red(
                "❌ Bad Session!"
              )
            );

            reconnecting = false;

            return;
          }

          // ================= RECONNECT =================

          if (!reconnecting) {

            reconnecting = true;

            console.log(
              chalk.yellow(
                "🔄 Reconnecting in 10s..."
              )
            );

            setTimeout(
              async () => {

                try {

                  reconnecting = false;

                  await startBot();

                } catch {

                  console.log(
                    chalk.red(
                      "❌ Reconnect Failed"
                    )
                  );
                }
              },

              10000
            );
          }
        }
      }
    );

    // ================= PAIRING =================

    if (
      !state.creds.registered
    ) {

      setTimeout(
        async () => {

          try {

            const code =
              await sock.requestPairingCode(
                phone
              );

            console.log(
              chalk.yellow(
                "🔑 Pairing Code:"
              ),

              code
                .match(/.{1,4}/g)
                .join("-")
            );

          } catch (err) {

            console.log(
              chalk.red(
                "❌ Pairing Failed:"
              ),
              err.message
            );
          }
        },

        3000
      );
    }

  } catch (err) {

    console.log(
      chalk.red(
        "❌ Fatal Error:"
      ),
      err.message
    );

    setTimeout(
      () => {

        startBot();

      },

      15000
    );
  }
}

// ================= START =================

startBot();