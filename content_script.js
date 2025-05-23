console.log("LLM Translator content script loaded and ready for streaming.");

let currentTranslationElement = null;
let originalSelectedTextContent = ''; // To store the text content of the selection
let isFirstChunk = true; // To identify the first text chunk

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // The old "replaceSelectedText" action for selected text is superseded by the streaming messages
    // when translation is initiated from the context menu.
    // If "replaceSelectedText" is used by other features (e.g. popup translating a specific input field),
    // that logic would need to be preserved or adapted. For now, we focus on context menu streaming.

    if (request.action === "translateStreamStart") {
        console.log("Content script received translateStreamStart request:", request);
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            
            // Verify that the current selection matches the original text from context menu.
            // This is a safeguard. If it doesn't match, we might not want to proceed,
            // or we could try to find `request.originalText` in the page.
            // For simplicity, we'll be strict for now.
            if (range.toString().trim() !== request.originalText.trim()) {
                console.warn("LLM Translator: Selected text changed since context menu click. Original:", request.originalText, "Current:", range.toString());
                // Optionally, alert the user or try a more sophisticated find-and-replace.
                // For now, we will not proceed if the selection has changed significantly.
                // However, minor whitespace changes might be okay.
                // A more robust solution would be to highlight or mark the text to be replaced
                // as soon as the context menu is clicked, but that's more complex.
                sendResponse({ status: "error", message: "Selected text changed or lost." });
                return true;
            }

            originalSelectedTextContent = range.toString(); // Save original text

            const newSpan = document.createElement('span');
            newSpan.className = 'llm-translator-streaming-text';
            newSpan.textContent = '⏳'; // Initial placeholder, will be replaced by first chunk

            range.deleteContents();
            range.insertNode(newSpan);
            currentTranslationElement = newSpan;
            isFirstChunk = true; // Reset for the new stream
            selection.removeAllRanges(); // Deselect text after replacement

            console.log("Placeholder inserted, ready for stream.");
            sendResponse({ status: "ready_for_chunks" });
        } else {
            console.warn("LLM Translator: Received stream start but no text selected or selection lost.");
            sendResponse({ status: "error", message: "No active selection for streaming." });
        }
        return true;

    } else if (request.action === "translateStreamChunk") {
        if (!currentTranslationElement) {
            console.error("LLM Translator: Received chunk but no translation element active.");
            // This might happen if translateStreamStart failed or was missed.
            sendResponse({ status: "error", message: "No active translation element for chunk."});
            return true;
        }
        
        if (isFirstChunk) {
            currentTranslationElement.textContent = request.text; // Replace placeholder with first actual text
            isFirstChunk = false;
        } else {
            currentTranslationElement.textContent += request.text; // Append subsequent chunks
        }
        // console.log("Chunk received:", request.text); // Can be noisy
        sendResponse({ status: "chunk_received" });
        return true;

    } else if (request.action === "translateStreamEnd") {
        if (currentTranslationElement) {
            console.log("LLM Translator: Stream ended. Full text:", currentTranslationElement.textContent);
            currentTranslationElement.classList.remove('llm-translator-streaming-text');
            currentTranslationElement.classList.add('llm-translator-translation-complete');
            // Optionally, unwrap the span if it's no longer needed for styling,
            // though keeping it might be useful for other interactions.
        } else {
            // This could happen if [DONE] is received but no chunks ever came through, or after an error that already cleared the element.
            console.log("LLM Translator: Stream ended, but no current translation element was active.");
        }
        // Reset state for the next translation operation
        currentTranslationElement = null;
        originalSelectedTextContent = '';
        isFirstChunk = true; 
        sendResponse({ status: "stream_ended" });
        return true;

    } else if (request.action === "translateStreamError") {
        console.error("LLM Translator: Stream error reported:", request.error, "Original text was:", request.originalText);
        if (currentTranslationElement) {
            // Attempt to revert to original text
            // This is a best-effort. If the DOM structure around currentTranslationElement changed,
            // simply setting textContent might not perfectly restore the original state,
            // but it's better than leaving a partial or error message in place.
            // A more robust revert would involve replacing the currentTranslationElement with a text node of originalSelectedTextContent.
            
            const parent = currentTranslationElement.parentNode;
            if (parent) {
                const originalTextNode = document.createTextNode(originalSelectedTextContent);
                try {
                    parent.replaceChild(originalTextNode, currentTranslationElement);
                } catch (e) {
                    console.error("Error reverting text:", e);
                    // Fallback if replaceChild fails (e.g. element was removed)
                    currentTranslationElement.textContent = originalSelectedTextContent; 
                    currentTranslationElement.classList.add('llm-translator-error-state');
                }
            } else {
                 currentTranslationElement.textContent = originalSelectedTextContent; // Fallback
                 currentTranslationElement.classList.add('llm-translator-error-state');
            }
        }
        alert(`Translation Error: ${request.error}`); // Simple error display for the user

        // Reset state
        currentTranslationElement = null;
        originalSelectedTextContent = '';
        isFirstChunk = true;
        sendResponse({ status: "error_handled", message: request.error });
        return true;
    }
    // Listener for "translateEntirePage"
    else if (request.action === "translateEntirePage") {
        console.log("Content script received translateEntirePage request:", request);
        const targetLanguage = request.targetLanguage;
        if (!targetLanguage) {
            alert("Target language not provided for page translation.");
            sendResponse({ status: "error", message: "Target language missing" });
            return true;
        }

        // Show a simple loading indicator
        let indicator = document.createElement('div');
        indicator.textContent = 'Translating page...';
        indicator.style.position = 'fixed';
        indicator.style.top = '10px';
        indicator.style.right = '10px';
        indicator.style.backgroundColor = 'yellow';
        indicator.style.padding = '10px';
        indicator.style.zIndex = '9999';
        indicator.style.fontFamily = 'sans-serif';
        indicator.style.fontSize = '14px';
        document.body.appendChild(indicator);

        const textNodes = [];
        const treeWalker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    if (
                        node.parentElement.tagName.toLowerCase() === 'script' ||
                        node.parentElement.tagName.toLowerCase() === 'style' ||
                        node.parentElement.tagName.toLowerCase() === 'noscript' ||
                        node.parentElement.closest('.llm-translator-streaming-text') || // Don't translate our own elements
                        node.parentElement.closest('.llm-translator-translation-complete') ||
                        node.parentElement.isContentEditable ||
                        node.parentElement.tagName.toLowerCase() === 'textarea' ||
                        node.parentElement.tagName.toLowerCase() === 'input' ||
                        !node.nodeValue.trim()
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            },
            false
        );

        while (node = treeWalker.nextNode()) {
            textNodes.push(node);
        }

        if (textNodes.length === 0) {
            indicator.textContent = 'No text found to translate.';
            setTimeout(() => indicator.remove(), 3000);
            sendResponse({ status: "success", message: "No text found" });
            return true;
        }

        const originalTexts = textNodes.map(tn => tn.nodeValue);
        const combinedText = originalTexts.join("\n\n---\n\n");

        console.log(`Sending ${textNodes.length} text segments combined for translation for full page.`);

        chrome.runtime.sendMessage(
            {
                action: "translate", // This should ideally use streaming if background supports it for this action
                text: combinedText,
                targetLanguage: targetLanguage
                // Not sending tabId from here, background.js's onMessage handler for "translate"
                // will try to get sender.tab.id if this feature is to be converted to streaming.
            },
            (response) => {
                // This response handling is for non-streaming full page translation.
                // If "translate" action in background.js is converted to stream to tabs,
                // this callback would just get an ack like {streamingStarted: true}
                // and actual content would arrive via translateStreamChunk etc.
                // For now, assuming it's still non-streaming for page translation.
                if (chrome.runtime.lastError || !response) {
                    indicator.textContent = 'Error: Could not connect to background script.';
                    indicator.style.backgroundColor = 'red';
                    console.error("Error sending combined text for page translation or no response:", chrome.runtime.lastError?.message);
                    sendResponse({ status: "error", message: chrome.runtime.lastError?.message || "No response from background." });
                    setTimeout(() => indicator.remove(), 3000);
                    return;
                }

                if (response.error) {
                    indicator.textContent = `Translation Error: ${response.error}`;
                    indicator.style.backgroundColor = 'red';
                    console.error("Page translation error from background:", response.error);
                    sendResponse({ status: "error", message: response.error });
                    setTimeout(() => indicator.remove(), 3000);
                    return;
                }

                if (response.translatedText) { // This implies non-streaming path was hit
                    const translatedTexts = response.translatedText.split("\n\n---\n\n");

                    if (translatedTexts.length !== textNodes.length) {
                        indicator.textContent = 'Error: Translation count mismatch. Page might be partially translated.';
                        indicator.style.backgroundColor = 'red';
                        console.error("Mismatch for page translation segments.");
                        sendResponse({ status: "error", message: "Translation count mismatch for page" });
                        setTimeout(() => indicator.remove(), 5000);
                        return;
                    }

                    let index = 0;
                    function replaceBatch() {
                        const batchSize = 10;
                        let count = 0;
                        while(index < textNodes.length && count < batchSize) {
                            if (textNodes[index] && translatedTexts[index] !== undefined) {
                                if (document.body.contains(textNodes[index])) {
                                   textNodes[index].nodeValue = translatedTexts[index];
                                } else {
                                    console.warn("Text node for page translation no longer in document, skipping:", textNodes[index]);
                                }
                            }
                            index++;
                            count++;
                        }
                        if (index < textNodes.length) {
                            indicator.textContent = `Translating page... (${Math.round((index/textNodes.length)*100)}%)`;
                            setTimeout(replaceBatch, 50);
                        } else {
                            indicator.textContent = 'Page translated successfully!';
                            indicator.style.backgroundColor = 'lightgreen';
                            console.log("Page translation complete (non-streaming).");
                            sendResponse({ status: "success", message: "Page translated (non-streaming)" });
                            setTimeout(() => indicator.remove(), 3000);
                        }
                    }
                    replaceBatch();
                } else if (response.streamingStarted) {
                    // This block would be hit if the "translate" action in background.js
                    // was modified to start streaming to the tab for page translations.
                    // The actual content would then come via "translateStreamChunk" etc.
                    // The current indicator would need to be updated by those handlers.
                    indicator.textContent = 'Page translation streaming started...';
                    console.log("Page translation: Streaming initiated.");
                    // sendResponse is already handled by background.js for this message type.
                    // The content script just needs to be ready for chunks.
                    // We might need a different state for page-level streaming vs selection streaming.
                    sendResponse({ status: "success", message: "Page translation streaming initiated." });
                } else {
                    indicator.textContent = 'Error: No translated text or streaming signal received for page.';
                    indicator.style.backgroundColor = 'red';
                    sendResponse({ status: "error", message: "No translated text/stream signal for page" });
                    setTimeout(() => indicator.remove(), 3000);
                }
            }
        );
        return true; // Crucial for async sendResponse
    }
    // Default response for unhandled actions
    // sendResponse({ status: "unhandled_action", requestAction: request.action });
    return true; // Keep true generally for async handling, or if some paths don't call sendResponse.
});
