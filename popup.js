document.addEventListener('DOMContentLoaded', () => {
    const translatePageButton = document.getElementById('translatePageButton');
    const currentTargetLanguageDisplay = document.getElementById('currentTargetLanguage');
    const statusMessageDisplay = document.getElementById('statusMessage');

    // Function to display status messages in the popup
    function showStatus(message, isError = false) {
        statusMessageDisplay.textContent = message;
        statusMessageDisplay.style.color = isError ? 'red' : '#555';
    }

    // Load current target language and display it
    // Using chrome.runtime.sendMessage to ask background.js for settings
    // to keep storage access centralized if desired, or could use chrome.storage.sync.get directly.
    chrome.runtime.sendMessage({ action: "getSettings" }, (settings) => {
        if (chrome.runtime.lastError) {
            console.error("Error getting settings for popup:", chrome.runtime.lastError.message);
            currentTargetLanguageDisplay.textContent = 'Error';
            showStatus("Could not load settings.", true);
            return;
        }
        if (settings && settings.targetLanguage) {
            currentTargetLanguageDisplay.textContent = settings.targetLanguage;
        } else {
            currentTargetLanguageDisplay.textContent = 'Not set';
            showStatus("Settings not fully configured.", true);
        }
    });

    translatePageButton.addEventListener('click', () => {
        showStatus("Initiating translation...");
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                showStatus("No active tab found.", true);
                return;
            }
            const activeTab = tabs[0];
            if (!activeTab.id) {
                 showStatus("Active tab has no ID.", true);
                 return;
            }

            // Get target language again in case it changed since popup opened,
            // or rely on the one fetched initially. For simplicity, fetch again.
            chrome.runtime.sendMessage({ action: "getSettings" }, (settings) => {
                if (chrome.runtime.lastError || !settings || !settings.targetLanguage) {
                    showStatus("Error: Target language not set in options.", true);
                    return;
                }

                chrome.tabs.sendMessage(
                    activeTab.id,
                    {
                        action: "translateEntirePage",
                        targetLanguage: settings.targetLanguage // Send target language to content script
                    },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            console.error("Error sending translateEntirePage message:", chrome.runtime.lastError.message);
                            showStatus(`Error: ${chrome.runtime.lastError.message}`, true);
                        } else if (response && response.status === "error") {
                            console.error("Page translation error:", response.message);
                            showStatus(`Error: ${response.message}`, true);
                        } else if (response && response.status === "success") {
                            showStatus("Page translation started.");
                            // Optionally close popup: window.close();
                        } else {
                            // Handle cases where content script might not be responding
                            // This can happen on special pages like chrome:// URLs
                            showStatus("No response from page. Is it a valid web page?", true);
                        }
                    }
                );
            });
        });
    });
});
