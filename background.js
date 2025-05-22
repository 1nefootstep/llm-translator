// Default settings - used if something is not found in storage
const DEFAULT_SETTINGS = {
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    modelName: 'gpt-3.5-turbo',
    systemPrompt: 'You are a helpful translation assistant. Translate the following text into {{TARGET_LANGUAGE}}.',
    targetLanguage: 'English',
    temperature: 0.7,
    maxTokens: 2000
};

// Function to get settings from chrome.storage.sync
async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
            resolve(items);
        });
    });
}

// Main function to call the LLM API for translation
async function translateText(textToTranslate, targetLanguageOverride) {
    const settings = await getSettings();

    if (!settings.apiEndpoint) {
        return { error: "API Endpoint URL is not configured." };
    }
    if (!settings.apiKey && settings.apiEndpoint.includes('api.openai.com')) { // Only strictly require for OpenAI official, others might be keyless
        // A more robust check could be to see if the endpoint *requires* a key
        // For now, we'll assume endpoints not on openai.com might be local/custom and keyless.
        // However, the PRD implies API key is standard.
        // Let's adjust to: if an API key is expected by the configured endpoint, it must be present.
        // This is hard to determine without trying, so we'll rely on user config.
        // If API key field is empty in settings, it's an issue.
         return { error: "API Key is not configured." };
    }


    const finalSystemPrompt = settings.systemPrompt.replace('{{TARGET_LANGUAGE}}', targetLanguageOverride || settings.targetLanguage);

    const requestBody = {
        model: settings.modelName,
        messages: [
            { role: "system", content: finalSystemPrompt },
            { role: "user", content: textToTranslate }
        ],
        temperature: settings.temperature,
        max_tokens: settings.maxTokens
    };

    try {
        const response = await fetch(settings.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null); // Try to parse error response
            let errorMessage = `API Error: ${response.status} ${response.statusText}`;
            if (errorData && errorData.error && errorData.error.message) {
                errorMessage = `API Error: ${errorData.error.message}`;
            } else if (typeof errorData === 'string') {
                errorMessage = `API Error: ${errorData}`;
            }
            console.error('LLM API Error:', response);
            return { error: errorMessage };
        }

        const data = await response.json();

        if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
            return { translatedText: data.choices[0].message.content.trim() };
        } else {
            console.error('Invalid LLM response structure:', data);
            return { error: "Translation failed: Unexpected response format from LLM." };
        }

    } catch (error) {
        console.error('Network or other error during LLM call:', error);
        return { error: `Translation failed: ${error.message}` };
    }
}

// Listener for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") {
        // This is for general translation requests, perhaps from popup for full page
        translateText(request.text, request.targetLanguage)
            .then(result => {
                sendResponse(result);
            })
            .catch(error => {
                sendResponse({ error: error.message });
            });
        return true; // Indicates that the response is sent asynchronously
    }
    // Add more message handlers if needed, e.g., for getting settings in the popup
    if (request.action === "getSettings") {
        getSettings().then(sendResponse);
        return true;
    }
});

// Create context menu item when the extension is installed
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed, creating context menu.");
  chrome.contextMenus.create({
    id: "translateSelectedText",
    title: "Translate Selected Text",
    contexts: ["selection"]
  });
});

// Listener for context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "translateSelectedText" && info.selectionText && tab && tab.id) {
    const selectedText = info.selectionText;
    console.log(`Context menu clicked. Selected text: "${selectedText}"`);

    // Show a simple "Translating..." notification (optional, but good UX)
    // chrome.notifications.create({
    //   type: 'basic',
    //   iconUrl: 'icon.png',
    //   title: 'Translation',
    //   message: 'Translating selected text...'
    // });

    const settings = await getSettings(); // Get current target language from settings
    const result = await translateText(selectedText, settings.targetLanguage); // Pass the specific target language

    console.log("Translation result from background:", result);

    if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
            action: "replaceSelectedText",
            originalText: selectedText,
            translatedText: result.translatedText, // Will be undefined if error
            error: result.error // Will be undefined if success
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Error sending message to content script:", chrome.runtime.lastError.message);
                // Optionally, notify the user if the content script isn't ready, though this is often a transient issue
                // or indicates the content script failed to load on that page.
            } else {
                console.log("Message sent to content script, response:", response);
            }
        });
    } else {
        console.error("No tab ID found to send message to content script.");
    }
  }
});

console.log("Background script loaded and context menu logic updated.");
