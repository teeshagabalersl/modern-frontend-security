# Modern Front-End Security – User Security Dashboard

## Overview

This project is a User Security Dashboard created for the Modern Front-End Security Concepts
training assignment. It started as a deliberately vulnerable application and was refined using
secure development practices on the branch `feature/frontend-security-hardening`.

The Git history shows the progression: the first commit is the original vulnerable starter,
followed by one commit for each security fix.

## Technologies

- HTML
- CSS
- Vanilla JavaScript
- Node.js
- Express

## Setup

Install dependencies:

```bash
npm install
```

Start the application:

```bash
npm start
```

Open http://localhost:3000

## Vulnerabilities Identified

| # | Vulnerability | Location | Untrusted source / security boundary |
|---|---------------|----------|--------------------------------------|
| 1 | DOM-Based XSS | `client/app.js`, `server/server.js` (`/account`) | `?name=` query parameter (URL to DOM) |
| 2 | Prototype Pollution | `client/app.js` (`prepareSettings`), `server/server.js` (`POST /api/settings`) | JSON request body (client to server) |
| 3 | SSR Token Leakage | `server/server.js` (`/`, `/api/profile`) | Server to browser |
| 4 | Missing Content Security Policy | `server/server.js` (all responses) | Any injected inline script or foreign origin |
| 5 | Clickjacking | `server/server.js` (`/account`) | Attacker page framing the app |

---

## 1. DOM-Based XSS

### Vulnerable implementation
`client/app.js`:
```js
const username = params.get("name") || window.initialUser?.name || "Guest";

app.innerHTML = `
    <section class="profile-card">
        <h2>Welcome, ${username}</h2>
        ...
`;
```
`server/server.js` (`/account`): `${user.name}`, `${user.email}` and `${user.role}` were inserted
into the HTML without encoding.

### Why it is insecure
The `name` query parameter is controlled by whoever creates the link. It was inserted into an
HTML string and parsed with `innerHTML`, so a value such as `<img src=x onerror=alert(1)>` created
a real element and ran JavaScript in the application's origin. An attacker can send a victim a
crafted link and run scripts that read page data, call APIs as the user, or redirect them.

- **Source of untrusted data:** `window.location.search` (`?name=`)
- **Sink:** `innerHTML`
- **Security boundary:** URL (attacker-controlled) to the DOM (trusted application)

### Security fix
- Replaced `innerHTML` with DOM APIs (`createElement`) and `textContent`, so the value is always
  treated as text, never as markup.
- Validated the input: it must be a string, is trimmed, and is limited to 50 characters.
- Added an `escapeHtml()` helper in `server/server.js` and applied it to all user fields rendered on `/account`.

### Testing and verification
| Scenario | Before | After |
|----------|--------|-------|
| `/?name=<img src=x onerror=alert(1)>` (negative) | Alert box appears | No alert, payload displayed as plain text |
| `/?name=Alice` (positive) | Welcome, Alice | Welcome, Alice |
| `/` with no parameter (positive) | Welcome, John Doe | Welcome, John Doe |

---

## 2. Prototype Pollution

### Vulnerable implementation
`client/app.js` and `server/server.js`:
```js
const settings = {};

for (const key in incomingSettings) {
    settings[key] = incomingSettings[key];
}
```

### Why it is insecure
`JSON.parse('{"__proto__":{"isAdmin":true}}')` creates an own property named `__proto__`. The
`for...in` loop visits it, and the assignment `settings["__proto__"] = ...` replaces the prototype of
`settings` with attacker-controlled data. Any later property check (for example `settings.isAdmin`)
then returns attacker-chosen values. With a recursive merge, the same pattern reaches
`Object.prototype` and affects the whole application. The endpoint also accepted and returned
arbitrary keys (for example `role: "root"`), which is mass assignment.

- **Source of untrusted data:** JSON body of `POST /api/settings`
- **Security boundary:** client to server

### Security fix
- Added an allowlist (`ALLOWED_SETTINGS`) and `validateSettings()` on the server. Only `theme`,
  `language` and `fontSize` with their allowed values are accepted. `__proto__`, `constructor`, unknown
  keys, invalid values, arrays and non-objects return HTTP 400.
- Keys are read with `Object.keys()` (own keys only) and checked with `Object.hasOwn()`.
- The response is built from trusted `defaultSettings` plus the validated values.
- Malformed JSON returns a clean 400 response.
- The client `prepareSettings()` copies only the three known keys by fixed name.
- Defense in depth: `npm start` runs Node with `--disable-proto=delete`, which removes the `__proto__` accessor.

### Testing and verification
| Scenario | Before | After |
|----------|--------|-------|
| `curl -X POST localhost:3000/api/settings -H 'content-type: application/json' -d '{"__proto__":{"isAdmin":true}}'` (negative) | 200, prototype replaced | 400 `Unknown setting: __proto__` |
| `-d '{"role":"root"}'` (negative) | Accepted and echoed | 400 `Unknown setting: role` |
| `-d '{"theme":"neon"}'` (negative) | Accepted | 400 `Invalid value for setting: theme` |
| `-d '{oops'` (negative) | Error | 400 `Invalid JSON body.` |
| `-d '{"theme":"dark","language":"fr","fontSize":"large"}'` (positive) | 200 | 200 Settings saved successfully |
| Save Settings button in the UI (positive) | Works | Works |

---

## 3. SSR Token Leakage

### Vulnerable implementation
`server/server.js`:
```js
const initialUserData = JSON.stringify(user);   // user includes sessionToken and refreshToken
...
<script>window.initialUser = ${initialUserData};</script>
...
app.get("/api/profile", (req, res) => { res.json(user); });
```

### Why it is insecure
The complete `user` object, including `sessionToken` and `refreshToken`, was serialised into the
HTML and returned by the API. Any script running on the page (for example through XSS), a browser
extension, a cache or the "view source" option can read these secrets. Embedding unescaped JSON in
a `<script>` element could also be broken out of with `</script>`.

- **Security boundary:** server to browser. Everything that crosses it must be treated as public.

### Security fix
- Added `toPublicUser()`, an allowlist that returns only `id`, `name`, `email` and `role`.
- Replaced the inline `window.initialUser = ...` script with an inert
  `<script id="initial-user" type="application/json">` data block, which the browser never executes.
  `client/app.js` reads it with `JSON.parse`.
- Added `serializeForHtml()`, which escapes `<`, `>`, `&`, U+2028 and U+2029 so data cannot close the script element.
- `/api/profile` returns the public user only, with `Cache-Control: no-store`.
- Secrets belong in `HttpOnly; Secure; SameSite` cookies, never in markup or JavaScript-readable state.

### Testing and verification
| Scenario | Before | After |
|----------|--------|-------|
| Browser console: `window.initialUser` (negative) | Shows both tokens | `undefined` |
| `curl localhost:3000/api/profile` (negative) | Includes `sessionToken`, `refreshToken` | Only `id`, `name`, `email`, `role` |
| `curl -s localhost:3000/ \| grep -i token` (negative) | Tokens found | No output |
| Dashboard still shows name, email and role (positive) | Works | Works |

---

## 4. Content Security Policy (CSP)

### Vulnerable implementation
The application sent no `Content-Security-Policy` header, so the browser executed any inline script,
inline event handler or script loaded from any origin.

### Why it is insecure
Without a CSP, a single missed injection point turns into full script execution. There is no
second layer to stop an injected payload.

### Security fix
A middleware in `server/server.js` sets these headers on every response (registered before the
routes and the static files):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<random>';
  style-src 'self' 'nonce-<random>'; img-src 'self' data:; font-src 'self'; connect-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

- A new random nonce is generated for every request. The `/account` page's own inline `<style>` and
  `<script>` carry that nonce, so they still work, while any injected inline code does not
  (`unsafe-inline` is not used).
- `object-src 'none'` and `base-uri 'none'` block plugin and `<base>` tag injection.
- `X-Powered-By` is disabled.

### Testing and verification
| Scenario | Before | After |
|----------|--------|-------|
| `curl -I localhost:3000/account` (negative) | No CSP header | CSP, nosniff and Referrer-Policy present |
| Console on `/`: `document.body.insertAdjacentHTML("beforeend",'<img src=x onerror="alert(1)">')` (negative) | Alert runs | Blocked; console shows a CSP violation |
| `/account` page looks the same and Delete Account still works (positive) | Works | Works |

---

## 5. Clickjacking

### Vulnerable implementation
No framing restriction existed. `test/iframe-test.html` embeds `http://localhost:3000/account`,
which contains the Delete Account button.

### Why it is insecure
A malicious page can embed `/account` in a transparent iframe and trick a logged-in user into
clicking the real Delete Account button without realising it.

### Security fix
- Added `frame-ancestors 'none'` to the CSP (modern browsers).
- Added `X-Frame-Options: DENY` (legacy fallback).
- No origin can frame the application.

### Testing and verification
| Scenario | Before | After |
|----------|--------|-------|
| Open `test/iframe-test.html` with the server running (negative) | `/account` and its Delete button appear in the iframe | Iframe stays blank, framing refused |
| `curl -I localhost:3000/account` (negative) | No framing headers | `X-Frame-Options: DENY` and `frame-ancestors 'none'` |
| Open `http://localhost:3000/account` directly (positive) | Works | Works |

---

## Defense-in-Depth Approach

No single control is trusted on its own. Each layer assumes the previous one can fail.

| Layer | Controls |
|-------|----------|
| 1. Avoid dangerous APIs | `textContent` and DOM APIs instead of `innerHTML`; fixed-key copies instead of `for...in` |
| 2. Validate input at the boundary | Normalised `?name=`; strict allowlist of settings keys and values (400 on anything else) |
| 3. Encode output | `escapeHtml()` for server-rendered HTML; `serializeForHtml()` for embedded JSON |
| 4. Minimise data exposure | Public-field DTO; no tokens in HTML or API responses; `no-store` on the profile |
| 5. Browser-enforced policy | Strict nonce-based CSP blocks injected scripts; `frame-ancestors` and `X-Frame-Options` block framing |
| 6. Runtime hardening | `--disable-proto=delete`, `nosniff`, `no-referrer`, no `X-Powered-By` |

Example: if a future XSS bug got past layers 1 to 3, the CSP would still block the payload, and
because no tokens are ever sent to the page there would be nothing sensitive to steal.

## Functionality Check

After all fixes the original features still work: the dashboard shows the user profile,
`?name=` displays the given name safely, Save Settings saves valid settings, and the Account
Settings page renders with a working Delete Account button.