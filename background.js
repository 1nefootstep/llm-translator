// Default settings aligned with new structure (including prompt profiles and glossary)
const DEFAULT_SETTINGS = {
    apiProviders: [],
    activeProviderId: null,
    promptProfiles: [],
    activePromptId: null,
    glossaryTerms: [], // Added for Glossary
    targetLanguage: 'English',
    temperature: 0.7,
    maxTokens: 2000
};

// Function to get settings from chrome.storage.sync
async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (storedSettings) => {
            let currentProvider = null;
            let currentSystemPromptText = null;
            let error = storedSettings.error || null; 

            // Resolve API Provider
            if (!error) { 
                if (storedSettings.apiProviders && storedSettings.apiProviders.length > 0) {
                    if (storedSettings.activeProviderId) {
                        currentProvider = storedSettings.apiProviders.find(p => p.id === storedSettings.activeProviderId);
                    }
                    if (!currentProvider) { 
                        currentProvider = storedSettings.apiProviders[0];
                        console.warn("Active provider not found or not set, falling back to the first available provider.");
                    }
                } else {
                    error = "No API providers configured. Please configure one in the extension options.";
                }
                if (currentProvider && !currentProvider.endpoint) {
                    error = `Selected API provider "${currentProvider.name}" is missing API Endpoint URL.`;
                    currentProvider = null; 
                }
            }

            // Resolve System Prompt Profile
            if (!error) { 
                if (storedSettings.promptProfiles && storedSettings.promptProfiles.length > 0) {
                    let activeProfile = null;
                    if (storedSettings.activePromptId) {
                        activeProfile = storedSettings.promptProfiles.find(p => p.id === storedSettings.activePromptId);
                    }
                    if (!activeProfile) { 
                        activeProfile = storedSettings.promptProfiles[0];
                        console.warn("Active prompt profile not found or not set, falling back to the first available profile.");
                    }
                    if (activeProfile) {
                        currentSystemPromptText = activeProfile.prompt;
                    } else {
                         error = "Selected prompt profile is invalid or no profiles exist.";
                    }
                } else {
                    error = "No System Prompt Profiles configured. Please configure one in the extension options.";
                }
            }
            
            // Glossary terms are directly available under storedSettings.glossaryTerms
            // No specific resolution needed here other than ensuring it's part of the returned object.

            if (error) console.error("Error in getSettings:", error);

            resolve({
                ...storedSettings, // Includes apiProviders, activeProviderId, promptProfiles, activePromptId, glossaryTerms, etc.
                currentProvider: currentProvider, 
                currentSystemPromptText: currentSystemPromptText,
                error: error 
            });
        });
    });
}

// Main function to call the LLM API for translation
// Accepts an optional tabId for sending stream messages
async function translateText(textToTranslate, targetLanguageOverride, tabId = null) {
    const settings = await getSettings();

    if (settings.error || !settings.currentProvider || settings.currentSystemPromptText === null) {
        const errorMessage = settings.error || "No active API provider or system prompt configured.";
        if (tabId) {
            chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: errorMessage, originalText: textToTranslate });
        }
        return { error: errorMessage };
    }

    const activeProvider = settings.currentProvider;

    if (activeProvider.endpoint.includes('api.openai.com') && !activeProvider.apiKey) {
        const keyError = `API Key is not configured for the active provider "${activeProvider.name}" which appears to be an OpenAI endpoint.`;
        if (tabId) {
            chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: keyError, originalText: textToTranslate });
        }
        return { error: keyError };
    }

    let systemPromptWithGlossary = settings.currentSystemPromptText;
    if (settings.glossaryTerms && settings.glossaryTerms.length > 0) {
        const glossaryString = settings.glossaryTerms
            .map(item => `${item.term} -> ${item.translation}`)
            .join('; ');
        // Append the glossary to the system prompt.
        // Adding newlines for better separation and clarity in the prompt.
        systemPromptWithGlossary += `\n\nImportant: Use the following translations for specific terms (Glossary): ${glossaryString}.`;
    }

    const finalSystemPrompt = systemPromptWithGlossary.replace('{{TARGET_LANGUAGE}}', targetLanguageOverride || settings.targetLanguage);

    const requestBody = {
        model: activeProvider.model,
        messages: [
            { role: "system", content: finalSystemPrompt },
            { role: "user", content: textToTranslate }
        ],
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        // Conditionally enable streaming based on provider setting
        stream: typeof activeProvider.streamSupport === 'boolean' ? activeProvider.streamSupport : false
    };
    
    // If not streaming, remove the stream parameter if the API doesn't like it when false
    if (!requestBody.stream) {
        delete requestBody.stream; 
    }

    try {
        const response = await fetch(activeProvider.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${activeProvider.apiKey}` // Assuming Bearer token
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            let errorMessage = `API Error: ${response.status} ${response.statusText}`;
            if (errorData && errorData.error && errorData.error.message) {
                errorMessage = `API Error: ${errorData.error.message}`;
            } else if (typeof errorData === 'string') {
                errorMessage = `API Error: ${errorData}`;
            }
            console.error('LLM API Error:', response.status, errorMessage, "Provider:", activeProvider.name);
            if (tabId) {
                chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: errorMessage, originalText: textToTranslate });
            }
            return { error: errorMessage };
        }

        // Handle streaming response if stream was requested and tabId is present
        if (requestBody.stream && tabId && response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedData = '';
            let fullTranslatedText = ''; 

            chrome.tabs.sendMessage(tabId, { action: "translateStreamStart", originalText: textToTranslate });

            async function processStream({ done, value }) {
                if (done) {
                    console.log("Stream finished. Full translated text:", fullTranslatedText);
                    chrome.tabs.sendMessage(tabId, { action: "translateStreamEnd", fullText: fullTranslatedText, originalText: textToTranslate });
                    return;
                }

                accumulatedData += decoder.decode(value, { stream: true });
                let newlineIndex;
                while ((newlineIndex = accumulatedData.indexOf('\n')) >= 0) {
                    const line = accumulatedData.substring(0, newlineIndex).trim();
                    accumulatedData = accumulatedData.substring(newlineIndex + 1);

                    if (line.startsWith('data: ')) {
                        const jsonStr = line.substring(5);
                        if (jsonStr === '[DONE]') {
                            console.log("Stream signaled [DONE]. Full translated text:", fullTranslatedText);
                            chrome.tabs.sendMessage(tabId, { action: "translateStreamEnd", fullText: fullTranslatedText, originalText: textToTranslate });
                            reader.cancel().catch(e => console.warn("Error cancelling reader:", e));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(jsonStr);
                            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                                const textChunk = parsed.choices[0].delta.content;
                                if (textChunk) {
                                    fullTranslatedText += textChunk;
                                    chrome.tabs.sendMessage(tabId, { action: "translateStreamChunk", text: textChunk, originalText: textToTranslate });
                                }
                                if (parsed.choices[0].finish_reason) {
                                    console.log("Stream finished with reason:", parsed.choices[0].finish_reason, "Full text:", fullTranslatedText);
                                    chrome.tabs.sendMessage(tabId, { action: "translateStreamEnd", fullText: fullTranslatedText, originalText: textToTranslate, finishReason: parsed.choices[0].finish_reason });
                                    reader.cancel().catch(e => console.warn("Error cancelling reader:", e));
                                    return;
                                }
                            }
                        } catch (e) {
                            console.error('Error parsing stream JSON:', e, jsonStr);
                            chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: "Error parsing stream data", details: jsonStr, originalText: textToTranslate });
                            reader.cancel().catch(cancelError => console.warn("Error cancelling reader on parse error:", cancelError));
                            return;
                        }
                    }
                }
                reader.read().then(processStream).catch(streamError => {
                    console.error('Stream reading error:', streamError);
                    chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: streamError.message, originalText: textToTranslate });
                });
            }

            reader.read().then(processStream).catch(streamError => {
                console.error('Initial stream read error:', streamError);
                chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: streamError.message, originalText: textToTranslate });
            });
            return { streamingStarted: true };

        } else if (requestBody.stream && !tabId && response.body) {
            // Stream was requested, but no tabId to send chunks to.
            // This situation should be avoided by design if streaming is only for context menu.
            // For now, attempt to consume the stream and return full text (if API sends it that way for non-event-stream streams)
            // or just read the first chunk if it's an event-stream (which is more likely).
            // This path is problematic for SSE.
            console.warn("Streaming response received but no tabId. Attempting to read as non-event-stream or will fail for SSE.");
            try {
                const fullResponseData = await response.json(); // This will likely fail if it's an SSE stream
                if (fullResponseData.choices && fullResponseData.choices.length > 0 && fullResponseData.choices[0].message && fullResponseData.choices[0].message.content) {
                    return { translatedText: fullResponseData.choices[0].message.content.trim() };
                } else {
                     console.error('Invalid LLM response structure (streaming fallback):', fullResponseData);
                    return { error: "Translation failed: Unexpected response format from LLM (streaming fallback)." };
                }
            } catch (e) {
                 console.error('Error reading streaming response without tabId as JSON:', e);
                return { error: "Failed to process streaming response without a tab." };
            }
        }
         else { // Non-streaming response (stream:false or API doesn't support/return stream for the request)
            const data = await response.json(); // Standard JSON response
            if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
                return { translatedText: data.choices[0].message.content.trim() };
            } else {
                console.error('Invalid LLM response structure (non-streaming):', data);
                return { error: "Translation failed: Unexpected response format from LLM (non-streaming)." };
            }
        }

    } catch (error) {
        console.error('Network or other error during LLM call:', error, "Provider:", activeProvider.name);
        const netError = `Translation failed: ${error.message}`;
        if (tabId) {
            chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: netError, originalText: textToTranslate });
        }
        return { error: netError };
    }
}

// Listener for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") {
        // translateText will determine if streaming should occur based on provider settings and tabId.
        translateText(request.text, request.targetLanguage, sender.tab ? sender.tab.id : null)
            .then(result => {
                // If streamingStarted, translateText has already handled comms with the tab.
                // If not, send the result (translatedText or error) back.
                if (!result.streamingStarted) {
                    sendResponse(result);
                } else {
                    // Acknowledge that streaming has begun or will begin.
                    // The actual content/end/error messages are sent by translateText.
                    sendResponse({ status: "streaming_initiated" }); 
                }
            })
            .catch(error => {
                // Catch errors from translateText itself (e.g., config errors before fetch)
                sendResponse({ error: error.message });
            });
        return true; // Indicates that the response is sent asynchronously
    }
    if (request.action === "getSettings") {
        // The options page now handles its own settings directly.
        // This "getSettings" message might be from other parts of the extension (e.g. popup)
        // that need to know the *resolved* active provider settings.
        getSettings().then(resolvedSettings => {
            // We send the resolved settings, which include currentProvider details
            sendResponse(resolvedSettings);
        });
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
    const tabId = tab.id;
    console.log(`Context menu clicked. Selected text: "${selectedText}" in tab ${tabId}`);

    // Get settings to determine target language for this specific call (if needed for system prompt)
    // translateText will internally call getSettings again to get the full provider config.
    // This initial call is lightweight if only targetLanguage is needed here.
    const settings = await getSettings(); 
    if (settings.error || !settings.currentProvider) {
        // If settings are invalid, notify the user via the content script if possible
        const errorMsg = settings.error || "Translation provider not configured.";
        console.error("Context menu translation aborted:", errorMsg);
        chrome.tabs.sendMessage(tabId, {
            action: "translateStreamError", // Use existing error message type
            error: errorMsg,
            originalText: selectedText
        });
        return;
    }
    
    // Call translateText for streaming. 
    // It will handle all messaging to the content script.
    // settings.targetLanguage will be used as targetLanguageOverride if needed by system prompt
    translateText(selectedText, settings.targetLanguage, tabId); 
  }
});

console.log("Background script loaded and refactored for provider-based settings.");
