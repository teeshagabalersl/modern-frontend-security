const express = require("express");
const path = require("path");
const crypto = require("crypto");

const { user, defaultSettings } = require("./data");

const app = express();
const PORT = 3000;

app.disable("x-powered-by");

/* ======================================================================
 * SECURITY HELPERS
 * ==================================================================== */

/*
 * FIX 1 (DOM XSS): encode untrusted text before putting it in HTML.
 */
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/*
 * FIX 2 (Prototype pollution): only these settings, with only these
 * values, are accepted. "__proto__", "constructor" and every other
 * unknown key are rejected.
 */
const ALLOWED_SETTINGS = Object.freeze({
    theme: ["light", "dark"],
    language: ["en", "fr"],
    fontSize: ["small", "medium", "large"]
});

function validateSettings(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return { ok: false, error: "Settings must be a JSON object." };
    }

    const clean = {};

    // Object.keys() returns own, enumerable keys only
    for (const key of Object.keys(input)) {
        if (!Object.hasOwn(ALLOWED_SETTINGS, key)) {
            return { ok: false, error: `Unknown setting: ${key}` };
        }

        const value = input[key];

        if (
            typeof value !== "string" ||
            !ALLOWED_SETTINGS[key].includes(value)
        ) {
            return { ok: false, error: `Invalid value for setting: ${key}` };
        }

        clean[key] = value;
    }

    return { ok: true, settings: clean };
}

/*
 * FIX 3 (SSR token leakage): only public fields may leave the server.
 * sessionToken and refreshToken are never sent to the browser.
 */
const PUBLIC_USER_FIELDS = ["id", "name", "email", "role"];

function toPublicUser(source) {
    const publicUser = {};

    for (const field of PUBLIC_USER_FIELDS) {
        publicUser[field] = source[field];
    }

    return publicUser;
}

/*
 * FIX 3: safely embed JSON inside an HTML <script> element so data
 * can never close the tag or start HTML parsing.
 */
function serializeForHtml(value) {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

/*
 * FIX 4 (CSP) + FIX 5 (Clickjacking): security headers on every response.
 *
 * - A fresh random nonce is created per request. Only inline <script> /
 *   <style> tags carrying that nonce may run, so injected inline code is
 *   blocked ('unsafe-inline' is NOT used).
 * - frame-ancestors 'none' and X-Frame-Options: DENY stop any site
 *   (including the iframe test page) from embedding the app.
 */
app.use((req, res, next) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    res.locals.nonce = nonce;

    res.set({
        "Content-Security-Policy": [
            "default-src 'self'",
            `script-src 'self' 'nonce-${nonce}'`,
            `style-src 'self' 'nonce-${nonce}'`,
            "img-src 'self' data:",
            "font-src 'self'",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'self'",
            "frame-ancestors 'none'"
        ].join("; "),
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer"
    });

    next();
});

app.use(express.json());

/*
 * Home page
 */
app.get("/", (req, res) => {
    // FIX 3: public fields only, safely serialised
    const initialUserData = serializeForHtml(toPublicUser(user));

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
            >
            <title>User Security Dashboard</title>
            <link rel="stylesheet" href="/styles.css">
        </head>

        <body>
            <header class="header">
                <h1>User Security Dashboard</h1>
                <nav>
                    <a href="/">Dashboard</a>
                    <a href="/account">Account Settings</a>
                </nav>
            </header>

            <main class="container">
                <div id="app"></div>

                <section class="settings">
                    <h2>User Settings</h2>

                    <label>
                        Theme:
                        <select id="theme">
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                        </select>
                    </label>

                    <label>
                        Language:
                        <select id="language">
                            <option value="en">English</option>
                            <option value="fr">French</option>
                        </select>
                    </label>

                    <label>
                        Font Size:
                        <select id="fontSize">
                            <option value="small">Small</option>
                            <option value="medium">Medium</option>
                            <option value="large">Large</option>
                        </select>
                    </label>

                    <button id="save-settings">
                        Save Settings
                    </button>

                    <p id="settings-status"></p>
                </section>
            </main>

            <script id="initial-user" type="application/json">${initialUserData}</script>

            <script src="/app.js"></script>
        </body>
        </html>
    `);
});

/*
 * Profile API
 */
app.get("/api/profile", (req, res) => {
    // FIX 3: no tokens in the API response
    res.set("Cache-Control", "no-store");
    res.json(toPublicUser(user));
});

/*
 * Settings API
 */
app.get("/api/settings", (req, res) => {
    res.json(defaultSettings);
});

app.post("/api/settings", (req, res) => {
    // FIX 2: validate against the allowlist before using any input
    const result = validateSettings(req.body);

    if (!result.ok) {
        return res.status(400).json({
            message: result.error
        });
    }

    const settings = { ...defaultSettings, ...result.settings };

    res.json({
        message: "Settings saved successfully.",
        settings
    });
});

/*
 * Malformed JSON bodies return a clean 400 instead of a stack trace
 */
app.use((err, req, res, next) => {
    if (err && err.type === "entity.parse.failed") {
        return res.status(400).json({ message: "Invalid JSON body." });
    }

    next(err);
});

/*
 * Account page
 */
app.get("/account", (req, res) => {
    const nonce = res.locals.nonce;

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
            >
            <title>Account Settings</title>

            <style nonce="${nonce}">
                body {
                    font-family: Arial, sans-serif;
                    background: #f4f4f4;
                    margin: 0;
                    padding: 40px;
                }

                .account-card {
                    max-width: 600px;
                    margin: auto;
                    background: white;
                    padding: 30px;
                    border-radius: 8px;
                }

                .danger {
                    background: #c62828;
                    color: white;
                    border: none;
                    padding: 12px 20px;
                    cursor: pointer;
                    border-radius: 4px;
                }
            </style>
        </head>

        <body>
            <div class="account-card">
                <h1>Account Settings</h1>

                <p>
                    <strong>Name:</strong>
                    ${escapeHtml(user.name)}
                </p>

                <p>
                    <strong>Email:</strong>
                    ${escapeHtml(user.email)}
                </p>

                <p>
                    <strong>Role:</strong>
                    ${escapeHtml(user.role)}
                </p>

                <button
                    id="delete-account"
                    class="danger"
                >
                    Delete Account
                </button>

                <p id="status"></p>
            </div>

            <script nonce="${nonce}">
                document
                    .getElementById("delete-account")
                    .addEventListener("click", () => {
                        document.getElementById("status").textContent =
                            "Account deletion action triggered.";
                    });
            </script>
        </body>
        </html>
    `);
});

app.use(express.static(path.join(__dirname, "..", "client")));

app.listen(PORT, () => {
    console.log(`Application running at http://localhost:${PORT}`);
});