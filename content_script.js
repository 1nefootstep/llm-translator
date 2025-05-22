console.log("Content script loaded.");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "replaceSelectedText") {
        console.log("Content script received replaceSelectedText request:", request);
        if (request.error) {
            alert(`Translation Error: ${request.error}`);
            sendResponse({ status: "error_displayed", message: request.error });
            return;
        }

        if (request.translatedText) {
            const selection = window.getSelection();
            if (!selection.rangeCount || selection.isCollapsed) {
                // This might happen if the selection is lost between the time the context menu
                // was clicked and this message is processed.
                console.warn("No active selection found to replace.");
                // alert("Could not replace text: No active selection.");
                // We should ideally match request.originalText to a part of the page
                // but that's much more complex. For now, we rely on active selection.
                // The PRD implies direct replacement of what was selected.
                sendResponse({ status: "error", message: "No active selection" });
                return;
            }

            const range = selection.getRangeAt(0);
            const originalTextFromSelection = range.toString();

            // Sanity check: Does the current selection text match the original text sent for translation?
            // Due to dynamic page changes or slight variations in how text is copied,
            // this check might be too strict. However, it's a good safeguard.
            // A more fuzzy match might be needed in a production system.
            if (originalTextFromSelection.trim() !== request.originalText.trim()) {
                console.warn("Original selected text mismatch. Current: '", originalTextFromSelection, "' vs Sent: '", request.originalText, "'. Proceeding with replacement, but this could indicate an issue.");
                // For robustness, we might try to find request.originalText near the current selection
                // or skip replacement if it's too different.
                // For now, we'll proceed with what's currently selected if the check is too sensitive.
                // Let's try replacing based on the current range directly.
            }

            try {
                // The most straightforward way to replace selected text while respecting DOM
                // is to delete the contents of the range and insert the new text.
                // This generally handles cases where selection spans multiple elements
                // or is within a single text node.
                range.deleteContents();
                
                // Create a new text node with the translated text.
                // This helps prevent accidental HTML injection if translatedText contains HTML-like strings.
                // If HTML preservation *within* the translated string is desired (e.g. LLM outputs <b>text</b>)
                // then we'd need to parse and insert nodes, but PRD says "replace textContent".
                const textNode = document.createTextNode(request.translatedText);
                range.insertNode(textNode);

                // Clear the selection after replacement
                selection.removeAllRanges();
                // Restore selection to the newly inserted text (optional)
                // const newRange = document.createRange();
                // newRange.selectNodeContents(textNode);
                // selection.addRange(newRange);


                console.log("Text replaced successfully.");
                sendResponse({ status: "success", message: "Text replaced" });
            } catch (e) {
                console.error("Error replacing text in DOM:", e);
                alert("Error replacing text on page: " + e.message);
                sendResponse({ status: "error", message: e.message });
            }
        } else {
            sendResponse({ status: "error", message: "No translated text provided" });
        }
        return true; // Indicate async response if any further async ops were added
    }
    // Listener for "translateEntirePage" will be added later
    else if (request.action === "translateEntirePage") {
        console.log("Content script received translateEntirePage request:", request);
        const targetLanguage = request.targetLanguage;
        if (!targetLanguage) {
            alert("Target language not provided for page translation.");
            sendResponse({ status: "error", message: "Target language missing" });
            return true; // Keep `true` if sendResponse might be async later
        }

        // Show a simple loading indicator (optional, could be improved)
        let indicator = document.createElement('div');
        indicator.textContent = 'Translating page...';
        indicator.style.position = 'fixed';
        indicator.style.top = '10px';
        indicator.style.right = '10px';
        indicator.style.backgroundColor = 'yellow';
        indicator.style.padding = '10px';
        indicator.style.zIndex = '9999';
        document.body.appendChild(indicator);

        // 1. Extract all relevant text nodes
        const textNodes = [];
        const treeWalker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    // Skip text nodes within <script>, <style>, <noscript> tags
                    // Also skip text nodes that are all whitespace or inside editable elements
                    if (
                        node.parentElement.tagName.toLowerCase() === 'script' ||
                        node.parentElement.tagName.toLowerCase() === 'style' ||
                        node.parentElement.tagName.toLowerCase() === 'noscript' ||
                        node.parentElement.isContentEditable ||
                        node.parentElement.tagName.toLowerCase() === 'textarea' ||
                        node.parentElement.tagName.toLowerCase() === 'input' ||
                        !node.nodeValue.trim() // Check if nodeValue is not empty after trimming
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            },
            false
        );

        let node;
        while (node = treeWalker.nextNode()) {
            textNodes.push(node);
        }

        if (textNodes.length === 0) {
            indicator.textContent = 'No text found to translate.';
            setTimeout(() => indicator.remove(), 3000);
            sendResponse({ status: "success", message: "No text found" });
            return true;
        }

        // Combine text content for a single API call (V1 approach, chunking is V2)
        // Store original texts to map back if needed, though direct node replacement is simpler
        const originalTexts = textNodes.map(tn => tn.nodeValue);
        const combinedText = originalTexts.join("\n\n---\n\n"); // Separator that's unlikely in normal text

        console.log(`Sending ${textNodes.length} text segments combined for translation.`);

        // 2. Send to background for translation
        chrome.runtime.sendMessage(
            {
                action: "translate", // General translate action in background.js
                text: combinedText,
                targetLanguage: targetLanguage
            },
            (response) => {
                if (chrome.runtime.lastError || !response) {
                    indicator.textContent = 'Error: Could not connect to background script.';
                    indicator.style.backgroundColor = 'red';
                    console.error("Error sending combined text for translation or no response:", chrome.runtime.lastError?.message);
                    sendResponse({ status: "error", message: chrome.runtime.lastError?.message || "No response from background." });
                    setTimeout(() => indicator.remove(), 3000);
                    return;
                }

                if (response.error) {
                    indicator.textContent = `Translation Error: ${response.error}`;
                    indicator.style.backgroundColor = 'red';
                    console.error("Translation error from background:", response.error);
                    sendResponse({ status: "error", message: response.error });
                    setTimeout(() => indicator.remove(), 3000);
                    return;
                }

                if (response.translatedText) {
                    const translatedTexts = response.translatedText.split("\n\n---\n\n");

                    if (translatedTexts.length !== textNodes.length) {
                        indicator.textContent = 'Error: Translation count mismatch. Page might be partially translated or structure is too complex.';
                        indicator.style.backgroundColor = 'red';
                        console.error("Mismatch between original text node count and translated segments count.");
                        sendResponse({ status: "error", message: "Translation count mismatch" });
                        setTimeout(() => indicator.remove(), 5000);
                        return;
                    }

                    // 3. Replace text on page (batched replacement for performance)
                    let index = 0;
                    function replaceBatch() {
                        const batchSize = 10; // Process N nodes at a time
                        let count = 0;
                        while(index < textNodes.length && count < batchSize) {
                            if (textNodes[index] && translatedTexts[index] !== undefined) {
                                // Check if the node is still part of the document
                                if (document.body.contains(textNodes[index])) {
                                   textNodes[index].nodeValue = translatedTexts[index];
                                } else {
                                    console.warn("Text node no longer in document, skipping replacement:", textNodes[index]);
                                }
                            }
                            index++;
                            count++;
                        }
                        if (index < textNodes.length) {
                            // Update indicator
                            indicator.textContent = `Translating... (${Math.round((index/textNodes.length)*100)}%)`;
                            setTimeout(replaceBatch, 50); // Continue with next batch
                        } else {
                            indicator.textContent = 'Page translated successfully!';
                            indicator.style.backgroundColor = 'lightgreen';
                            console.log("Page translation complete.");
                            sendResponse({ status: "success", message: "Page translated" });
                            setTimeout(() => indicator.remove(), 3000);
                        }
                    }
                    replaceBatch(); // Start the batched replacement
                } else {
                    indicator.textContent = 'Error: No translated text received.';
                    indicator.style.backgroundColor = 'red';
                    sendResponse({ status: "error", message: "No translated text received" });
                    setTimeout(() => indicator.remove(), 3000);
                }
            }
        );
        return true; // Crucial for async sendResponse
    }
});
