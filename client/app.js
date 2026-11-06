const app = document.getElementById("app");

const params = new URLSearchParams(window.location.search);

const MAX_NAME_LENGTH = 50;

/*
 * FIX 1 (DOM XSS)
 * The ?name= value is attacker-controlled. It is validated here and is
 * only ever written to the page as text (textContent), never as HTML.
 */
function normaliseName(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim().slice(0, MAX_NAME_LENGTH);
}

function createElement(tag, { className, text } = {}) {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== undefined) {
        element.textContent = text;
    }

    return element;
}

function renderProfile({ name, email, role }) {
    const card = createElement("section", { className: "profile-card" });

    card.append(
        createElement("h2", { text: `Welcome, ${name}` }),
        createElement("p", { text: `Email: ${email}` }),
        createElement("p", { text: `Role: ${role}` })
    );

    app.replaceChildren(card);
}

/*
 * FIX 3 (SSR token leakage)
 * Server-rendered state arrives in an inert JSON block
 * (<script type="application/json">) that the browser never executes.
 * It contains public fields only - no tokens.
 */
function readInitialUser() {
    const node = document.getElementById("initial-user");

    if (!node) {
        return null;
    }

    try {
        return JSON.parse(node.textContent);
    } catch (error) {
        return null;
    }
}

const initialUser = readInitialUser();

const username =
    normaliseName(params.get("name")) ||
    initialUser?.name ||
    "Guest";

renderProfile({
    name: username,
    email: initialUser?.email || "Unknown",
    role: initialUser?.role || "User"
});

/*
 * FIX 2 (Prototype pollution)
 * Copy only known setting keys, using fixed property names, so an
 * attacker-controlled key such as "__proto__" can never be assigned.
 */
const SETTING_KEYS = ["theme", "language", "fontSize"];

function prepareSettings(userSettings) {
    const settings = {};

    for (const key of SETTING_KEYS) {
        if (Object.hasOwn(userSettings, key)) {
            settings[key] = userSettings[key];
        }
    }

    return settings;
}

const saveButton = document.getElementById("save-settings");

saveButton.addEventListener("click", async () => {
    const theme = document.getElementById("theme").value;
    const language = document.getElementById("language").value;
    const fontSize = document.getElementById("fontSize").value;

    const settings = prepareSettings({
        theme,
        language,
        fontSize
    });

    try {
        const response = await fetch("/api/settings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(settings)
        });

        const result = await response.json();

        document.getElementById("settings-status").textContent =
            result.message || "Unable to save settings.";
    } catch (error) {
        document.getElementById("settings-status").textContent =
            "Unable to save settings.";
    }
});