const app = document.getElementById("app");

const params = new URLSearchParams(window.location.search);

const username =
    params.get("name") ||
    window.initialUser?.name ||
    "Guest";

app.innerHTML = `
    <section class="profile-card">
        <h2>Welcome, ${username}</h2>

        <p>
            Email:
            ${window.initialUser?.email || "Unknown"}
        </p>

        <p>
            Role:
            ${window.initialUser?.role || "User"}
        </p>
    </section>
`;

function prepareSettings(userSettings) {
    const settings = {};

    for (const key in userSettings) {
        settings[key] = userSettings[key];
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
            result.message;
    } catch (error) {
        document.getElementById("settings-status").textContent =
            "Unable to save settings.";
    }
});