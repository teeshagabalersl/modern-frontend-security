const user = {
    id: 101,
    name: "John Doe",
    email: "john@example.com",
    role: "Administrator",

    sessionToken: "TRAINING-FAKE-ACCESS-TOKEN-12345",
    refreshToken: "TRAINING-FAKE-REFRESH-TOKEN-67890"
};

const defaultSettings = {
    theme: "light",
    language: "en",
    fontSize: "medium"
};

module.exports = {
    user,
    defaultSettings
};