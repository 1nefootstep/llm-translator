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

// Function to estimate the number of tokens in a text
function countTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

// Function to split text into chunks based on token limits

/**
 * Recursively breaks down a text segment if it exceeds maxTokensPerChunk.
 * Prioritizes splitting by single newlines, then sentences, then words.
 * This function is a helper for `splitText` and processes segments that are
 * already considered smaller than full paragraphs or do not contain double newlines.
 * Token limits are respected at each stage of the breakdown.
 *
 * @param {string} segment - The text segment to break down.
 * @param {number} maxTokensPerChunk - The maximum token limit for a chunk.
 * @param {function} countTokensFunc - The function to count tokens in a text.
 * @returns {string[]} An array of sub-chunks, each respecting the token limit (unless a single word is too large).
 */
function breakdownSegment(segment, maxTokensPerChunk, countTokensFunc) {
    // Trim upfront to handle leading/trailing whitespace on segments received from splitting.
    segment = segment.trim(); 
    if (!segment) {
        return []; // Return empty array if segment is empty after trimming.
    }

    // Base case: If the segment already fits, return it as a single chunk.
    if (countTokensFunc(segment) <= maxTokensPerChunk) {
        return [segment];
    }

    let subChunks = []; // Array to hold the chunks generated from this segment.

    // 1. Try splitting by single newlines ('\n').
    //    This is the first strategy because single newlines often represent deliberate formatting.
    const newlineParts = segment.split('\n');
    if (newlineParts.length > 1) {
        // Check if splitting by newline actually makes parts smaller, to avoid infinite recursion on e.g. " \n "
        let canBeSplitByNewline = false;
        for (const part of newlineParts) {
            // Ensure that at least one part is smaller than the original segment after trimming.
            if (countTokensFunc(part.trim()) < countTokensFunc(segment)) { 
                canBeSplitByNewline = true;
                break;
            }
        }
        if (canBeSplitByNewline) {
            // Recursively call breakdownSegment for each part.
            // The results (arrays of chunks) are concatenated.
            newlineParts.forEach(part => {
                subChunks = subChunks.concat(breakdownSegment(part, maxTokensPerChunk, countTokensFunc));
            });
            return subChunks; // Return the concatenated results from newline splitting.
        }
    }

    // 2. If not effectively split by newlines, try splitting by sentences.
    //    Regex attempts to identify sentences ending with ., ?, ! or followed by a newline.
    const sentences = segment.match(/[^.!?\n]+[.!?\n]?/g) || [segment]; // Fallback to the segment itself if no match.
    if (sentences.length > 1) {
         let canBeSplitBySentence = false;
         for (const sentence of sentences) {
             // Ensure that at least one sentence part is smaller than the original segment after trimming.
             if (countTokensFunc(sentence.trim()) < countTokensFunc(segment)) {
                 canBeSplitBySentence = true;
                 break;
             }
         }
         if (canBeSplitBySentence) {
            // Recursively call breakdownSegment for each sentence.
            sentences.forEach(sentence => {
                subChunks = subChunks.concat(breakdownSegment(sentence.trim(), maxTokensPerChunk, countTokensFunc));
            });
            return subChunks; // Return the concatenated results from sentence splitting.
        }
    }

    // 3. Fallback: Split by words if other strategies fail or are not applicable.
    //    This is the most granular splitting. Token limits are strictly applied.
    //    Splits by spaces, keeping the spaces in the array to maintain original spacing if possible.
    const wordsAndSpaces = segment.split(/(\s+)/);
    let currentWordChunk = ""; // Accumulates words and spaces to form a chunk.
    wordsAndSpaces.forEach(wordOrSpace => {
        if (!wordOrSpace) return; // Skip empty strings that might result from split (e.g. multiple spaces).

        const testChunk = currentWordChunk + wordOrSpace;
        // Check if the current word/space can be added to currentWordChunk without exceeding the limit.
        if (countTokensFunc(testChunk) <= maxTokensPerChunk) {
            currentWordChunk = testChunk;
        } else {
            // If currentWordChunk is not empty, it means it has accumulated words up to the limit. Push it.
            if (currentWordChunk) {
                subChunks.push(currentWordChunk);
            }
            // Start a new currentWordChunk with the current wordOrSpace.
            currentWordChunk = wordOrSpace;
            // If the current wordOrSpace itself is too large, it becomes its own chunk.
            // This handles extremely long words or very small token limits.
            if (countTokensFunc(currentWordChunk) > maxTokensPerChunk) {
                subChunks.push(currentWordChunk);
                currentWordChunk = ""; // Reset for the next word.
            }
        }
    });
    // Add any remaining part in currentWordChunk to subChunks.
    if (currentWordChunk) {
        subChunks.push(currentWordChunk);
    }
    
    // Filter out any empty strings that might have been inadvertently added.
    return subChunks.filter(c => c.length > 0);
}

/**
 * Splits a given text into chunks, each not exceeding a specified token limit.
 * The overall strategy is:
 * 1. Initial Handling: Checks for empty text or text that already meets the token limit.
 * 2. Paragraph Splitting: The text is first split by double newlines ('\n\n') to respect paragraph structure.
 *    This is the highest-level structural division.
 * 3. Segment Breakdown: Each paragraph (or segment resulting from the initial split) is then processed by `breakdownSegment`.
 *    `breakdownSegment` recursively tries to split the segment further by:
 *      a. Single newlines ('\n')
 *      b. Sentences
 *      c. Words (as a final fallback for any oversized part)
 *    This ensures that oversized segments are broken down hierarchically, respecting token limits at each stage.
 * 4. Preliminary Chunks Collection: The results from `breakdownSegment` for each paragraph, along with special "\n\n" markers
 *    (if the original text had multiple paragraphs), are collected into a `preliminaryChunks` list.
 *    These markers are crucial for the subsequent merging pass to reconstruct paragraph separation.
 * 5. Merging Pass: This pass iterates through `preliminaryChunks` to intelligently combine adjacent pieces.
 *    - It attempts to merge text pieces, re-introducing separators (like "\n\n" or a space for word/sentence joins),
 *      as long as the combined chunk doesn't exceed `maxTokensPerChunk`.
 *    - The "\n\n" markers from `preliminaryChunks` guide the merging to preserve paragraph breaks.
 *    - Other joins (e.g., between sentence parts or word-split parts from the same original segment) typically use a space.
 * 6. Final Verification: A final loop ensures all generated chunks are within the token limit, re-breaking any merged chunk
 *    that might have (exceptionally) become too large. This is a safeguard for strict compliance.
 *
 * @param {string} text - The input text to split.
 * @param {number} maxTokensPerChunk - The maximum number of tokens allowed per chunk.
 * @param {function} countTokensFunc - A function that takes a string and returns its token count.
 * @returns {string[]} An array of text chunks, each respecting the token limit (unless a single word is too large).
 */
function splitText(text, maxTokensPerChunk, countTokensFunc) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    // Initial trim for the whole input text.
    text = text.trim(); 
    if (!text) {
        return [];
    }

    // If the entire text already fits, return it as a single chunk.
    if (countTokensFunc(text) <= maxTokensPerChunk) {
        return [text];
    }

    // This list will hold text pieces from breakdownSegment and special "\n\n" markers.
    // These markers help in reconstructing paragraph structure during the merging pass.
    let preliminaryChunks = [];
    // 1. Split by double newlines (paragraphs) first. This is the highest-level structural split.
    const paragraphs = text.split('\n\n');

    for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i].trim(); // Trim individual paragraphs before breakdown.
        if (!paragraph) continue; // Skip empty paragraphs that might result from multiple \n\n.

        // 2. Break down each paragraph using the recursive helper.
        //    Each part returned by breakdownSegment is guaranteed to be within maxTokensPerChunk (unless a single word is too large).
        const brokenDownParagraph = breakdownSegment(paragraph, maxTokensPerChunk, countTokensFunc);
        preliminaryChunks = preliminaryChunks.concat(brokenDownParagraph);
        
        // 3. Add a special "\n\n" marker between processed paragraphs for the merging pass.
        // This helps preserve original paragraph separations if they caused chunks to be distinct.
        if (i < paragraphs.length - 1) {
            preliminaryChunks.push("\n\n"); 
        }
    }

    // 4. Merging Pass: Combine preliminary chunks intelligently to form larger, compliant chunks.
    //    The goal is to join smaller pieces together without exceeding maxTokensPerChunk,
    //    while respecting the structural separators like "\n\n".
    const mergedChunks = [];
    let currentChunk = ""; // Accumulates pieces to form a chunk.

    for (let i = 0; i < preliminaryChunks.length; i++) {
        const nextPiece = preliminaryChunks[i];

        // Handle the special "\n\n" separator from preliminaryChunks.
        if (nextPiece === "\n\n") {
            if (currentChunk) { // Only add "\n\n" if there's preceding text in currentChunk.
                // Try to append "\n\n" to currentChunk if it fits token-wise.
                if (countTokensFunc(currentChunk + "\n\n") <= maxTokensPerChunk) {
                    currentChunk += "\n\n";
                } else {
                    // If adding "\n\n" makes currentChunk too large, push currentChunk as is.
                    // The "\n\n" then effectively acts as a hard break, and the next text piece will start a new currentChunk.
                    mergedChunks.push(currentChunk);
                    currentChunk = ""; 
                }
            }
            // Skip to the next piece after processing the separator.
            continue; 
        }
        
        // Logic for merging actual text pieces.
        // Determine the separator to use when trying to merge 'nextPiece' with 'currentChunk'.
        let separator = ""; // Default to no separator if currentChunk is empty.
        if (currentChunk) {
            if (currentChunk.endsWith("\n\n")) {
                // If currentChunk already ends with a double newline, no additional separator is needed.
                separator = ""; 
            } else if (currentChunk.endsWith("\n")) {
                // If currentChunk ends with a single newline (rare, as breakdownSegment trims, but possible if a chunk *is* just "\n"),
                // this implies 'nextPiece' might be a continuation. Defaulting to space.
                // A more advanced version could try to preserve the single newline if it was the intended structure.
                separator = " "; 
            } else {
                // Default to a space for joining pieces that don't have specific newline endings (e.g., word/sentence parts).
                separator = " "; 
            }
        }

        // Use effectiveSeparator to handle the case where currentChunk is empty (no separator needed).
        const effectiveSeparator = currentChunk ? separator : "";
        
        const testChunk = currentChunk + effectiveSeparator + nextPiece;

        if (countTokensFunc(testChunk) <= maxTokensPerChunk) {
            // If the combined chunk fits, update currentChunk.
            currentChunk = testChunk;
        } else {
            // If combined chunk is too large, push the existing currentChunk.
            if (currentChunk) {
                mergedChunks.push(currentChunk);
            }
            // 'nextPiece' starts the new currentChunk.
            // breakdownSegment should ensure 'nextPiece' itself is within limits (unless it's a single oversized word).
            currentChunk = nextPiece; 
            // Safeguard: if 'nextPiece' itself is too large (e.g. single very long word), push it immediately.
            // This check is important if breakdownSegment might return oversized single words.
            if (countTokensFunc(currentChunk) > maxTokensPerChunk) {
                 mergedChunks.push(currentChunk);
                 currentChunk = ""; // Reset currentChunk.
            }
        }
    }

    // Add the last accumulated currentChunk if it's not empty.
    if (currentChunk) {
        mergedChunks.push(currentChunk);
    }
    
    // 5. Final Verification and Filtering:
    //    - Filter out any empty strings from the merged list.
    //    - Re-check token limits for all merged chunks. If any chunk is (exceptionally) too large,
    //      re-run breakdownSegment on it. This is a safeguard for complex merges or oversized single words.
    const finalVerifiedChunks = [];
    mergedChunks.filter(c => c.length > 0).forEach(chunk => {
        if (countTokensFunc(chunk) > maxTokensPerChunk) {
            // This situation should be rare if merging logic and breakdownSegment are correct.
            const reBroken = breakdownSegment(chunk, maxTokensPerChunk, countTokensFunc);
            finalVerifiedChunks.push(...reBroken);
        } else {
            finalVerifiedChunks.push(chunk);
        }
    });

    // Ensure no empty strings are in the final output.
    return finalVerifiedChunks.filter(c => c.length > 0); 
}

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

// JSDoc comments for translateText were added in the previous step.
// Reviewing them for clarity and completeness based on the subtask requirements:
// - Initial token check and decision to split: Covered.
// - Loop for processing chunks: Covered.
// - Per-chunk error handling: Covered.
// - Streaming management (start, chunk, end): Covered.
// - Non-streaming result combination: Covered.
// The existing JSDoc for translateText is sufficient.
// No changes to JSDoc comments needed for translateText.
// Adding more detailed inline comments as per the subtask.

/**
 * Main function to call the LLM API for translation.
 * Handles settings retrieval, text splitting for large inputs, API call execution,
 * and both streaming and non-streaming responses.
 *
 * @param {string} textToTranslate - The text to be translated.
 * @param {string|null} targetLanguageOverride - Optional target language to override user settings.
 * @param {number|null} tabId - Optional ID of the tab initiating the request, used for streaming responses.
 * @returns {Promise<object>} A promise that resolves to an object containing either `translatedText` (non-streaming)
 *                            `streamingStarted: true` (streaming), or an `error` message.
 */
async function translateText(textToTranslate, targetLanguageOverride, tabId = null) {
    // Retrieve current extension settings (API provider, prompt, etc.)
    const settings = await getSettings();

    // Validate essential settings; return error if misconfigured.
    // This includes checking if an API provider is configured and if a system prompt is available.
    if (settings.error || !settings.currentProvider || settings.currentSystemPromptText === null) {
        const errorMessage = settings.error || "No active API provider or system prompt configured.";
        // If a tabId is provided, attempt to send the error message to the content script.
        if (tabId) {
            chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: errorMessage, originalText: textToTranslate });
        }
        return { error: errorMessage };
    }

    const activeProvider = settings.currentProvider;

    // Specific check for OpenAI compatible providers requiring an API key.
    // Other providers might use different auth methods not explicitly checked here.
    if (activeProvider.endpoint.includes('api.openai.com') && !activeProvider.apiKey) {
        const keyError = `API Key is not configured for the active provider "${activeProvider.name}" which appears to be an OpenAI endpoint.`;
        if (tabId) {
            chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: keyError, originalText: textToTranslate });
        }
        return { error: keyError };
    }

    // Prepare the system prompt, incorporating glossary terms if available.
    // Glossary terms are appended to the system prompt to guide the LLM.
    let systemPromptWithGlossary = settings.currentSystemPromptText;
    if (settings.glossaryTerms && settings.glossaryTerms.length > 0) {
        const glossaryString = settings.glossaryTerms
            .map(item => `${item.term} -> ${item.translation}`)
            .join('; ');
        systemPromptWithGlossary += `\n\nImportant: Use the following translations for specific terms (Glossary): ${glossaryString}.`;
    }
    // Replace placeholder for target language in the system prompt.
    const finalSystemPrompt = systemPromptWithGlossary.replace('{{TARGET_LANGUAGE}}', targetLanguageOverride || settings.targetLanguage);

    // Determine if streaming is enabled for this provider and if a tabId is present for sending stream messages.
    // Streaming is only truly enabled if the provider supports it AND we have a tab to stream to.
    const effectiveStreamSupport = typeof activeProvider.streamSupport === 'boolean' ? activeProvider.streamSupport : false;
    const enableStreaming = effectiveStreamSupport && tabId; 

    // --- Initial token check and decision to split ---
    // Estimate token count of the input text.
    const estimatedTokens = countTokens(textToTranslate);
    let textChunks = [textToTranslate]; // Default to the original text as a single chunk.

    // If estimated tokens exceed configured maxTokens (from settings, meant as input segment limit), split the text.
    // `settings.maxTokens` here refers to the desired max input tokens for a single API call (per chunk).
    // It's also used later as the `max_tokens` parameter for the API's response generation per chunk.
    if (estimatedTokens > settings.maxTokens) {
        console.log(`Text too large (${estimatedTokens} tokens, limit ${settings.maxTokens}), attempting to split.`);
        // `splitText` will try to create chunks that are each within `settings.maxTokens` (token count of the input chunk).
        textChunks = splitText(textToTranslate, settings.maxTokens, countTokens);
        
        // Validate the result of splitting. If splitting fails or results in no usable chunks, return an error.
        if (!textChunks || textChunks.length === 0 || (textChunks.length === 1 && !textChunks[0].trim())) {
            const splitError = "Failed to split large text or text became empty after splitting.";
            console.error(splitError, "Original text (first 100 chars):", textToTranslate.substring(0,100));
            if (tabId) {
                chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: splitError, originalText: textToTranslate });
            }
            return { error: splitError };
        }
        console.log(`Text split into ${textChunks.length} chunks.`);
    }

    let translatedChunks = []; // Array to store results for non-streaming translation.
    let fullTranslatedTextForStreaming = ""; // String to accumulate results for streaming translation.

    // --- Streaming Management: Start ---
    // If streaming is enabled, send a "translateStreamStart" message to the content script.
    // This is done once before processing any chunks, signaling the UI to prepare for incoming text.
    if (enableStreaming) { 
         chrome.tabs.sendMessage(tabId, { action: "translateStreamStart", originalText: textToTranslate });
    }

    // --- Loop for processing chunks ---
    // Loop through each text chunk (could be one if no splitting occurred, or multiple if text was large).
    // Each chunk is processed by making an API call.
    for (let i = 0; i < textChunks.length; i++) {
        const chunk = textChunks[i]; // The current piece of text to translate.
        const isFirstChunk = i === 0; // Flag for the first chunk (currently unused but available for future logic).
        const isLastChunk = i === textChunks.length - 1; // Flag for the last chunk, crucial for stream ending.

        // Prepare the request body for the API call for the current chunk.
        // `settings.maxTokens` (originally from user settings for input text size) is also used here
        // as the `max_tokens` parameter for the API's response generation for this specific chunk.
        // This tells the API the maximum number of tokens it should generate for the translation of *this chunk*.
        const requestBody = {
            model: activeProvider.model,
            messages: [
                { role: "system", content: finalSystemPrompt },
                { role: "user", content: chunk } // Current text chunk for translation.
            ],
            temperature: settings.temperature,
            max_tokens: settings.maxTokens, // Max output tokens for the response to this chunk.
            stream: enableStreaming // Request streaming from API if enabled for this translation.
        };
        
        // If not explicitly requesting a stream, remove the parameter, as some APIs might error if `stream: false` is sent.
        if (!requestBody.stream) {
            delete requestBody.stream;
        }

        try {
            // Perform the API call using fetch.
            const response = await fetch(activeProvider.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${activeProvider.apiKey}` // Assumes Bearer token auth.
                },
                body: JSON.stringify(requestBody)
            });

            // --- Per-chunk error handling ---
            // Handle API errors (non-2xx HTTP status codes).
            if (!response.ok) {
                const errorData = await response.json().catch(() => null); // Try to parse error response body.
                let errorMessage = `API Error: ${response.status} ${response.statusText} on chunk ${i+1}/${textChunks.length}`;
                if (errorData && errorData.error && errorData.error.message) {
                    errorMessage = `API Error on chunk ${i+1}/${textChunks.length}: ${errorData.error.message}`;
                } else if (typeof errorData === 'string') { // Some APIs might return plain text errors.
                    errorMessage = `API Error on chunk ${i+1}/${textChunks.length}: ${errorData}`;
                }
                console.error('LLM API Error:', errorMessage, "Provider:", activeProvider.name, "Chunk (first 50 chars):", chunk.substring(0,50));
                // If an error occurs for any chunk, stop processing and report back.
                // Send error to content script if applicable, allowing UI to update.
                if (tabId) {
                    chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: errorMessage, originalText: textToTranslate });
                }
                return { error: errorMessage }; // Stop further chunk processing.
            }

            // Process the response based on whether streaming is enabled.
            if (requestBody.stream && tabId && response.body) {
                // --- Streaming Management: Chunk & End ---
                // Handle streaming response for the current chunk.
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let accumulatedData = ''; // Buffer for incomplete stream data lines (SSE).
                let currentChunkStreamedText = ''; // Text accumulated from the current chunk's stream.

                // Promisify the stream processing for this chunk. This ensures that one chunk's stream
                // is fully processed before moving to the next chunk's API call, maintaining order.
                await new Promise((resolveStream, rejectStream) => {
                    function processStreamChunk({ done, value }) {
                        if (done) { // Stream for this chunk is finished.
                            console.log(`Stream finished for chunk ${i+1}. Text (last 50):`, currentChunkStreamedText.slice(-50));
                            // Append this chunk's full text to the overall streamed text.
                            // A space is added between aggregated chunk translations to prevent words running together.
                            fullTranslatedTextForStreaming += (fullTranslatedTextForStreaming && currentChunkStreamedText ? " " : "") + currentChunkStreamedText; 
                            if (isLastChunk) {
                                // If this was the last chunk overall, send the final "translateStreamEnd" message to content script.
                                chrome.tabs.sendMessage(tabId, { action: "translateStreamEnd", fullText: fullTranslatedTextForStreaming, originalText: textToTranslate });
                            }
                            resolveStream(); // Resolve the promise, signaling this chunk's stream processing is complete.
                            return;
                        }

                        accumulatedData += decoder.decode(value, { stream: true }); // Decode and append new data.
                        let newlineIndex;
                        // Process line by line if data is newline-separated (standard for Server-Sent Events).
                        while ((newlineIndex = accumulatedData.indexOf('\n')) >= 0) {
                            const line = accumulatedData.substring(0, newlineIndex).trim();
                            accumulatedData = accumulatedData.substring(newlineIndex + 1); // Keep remaining data in buffer.

                            if (line.startsWith('data: ')) {
                                const jsonStr = line.substring(5);
                                if (jsonStr === '[DONE]') { // OpenAI specific stream termination signal.
                                    console.log(`Stream signaled [DONE] for chunk ${i+1}. Text (last 50):`, currentChunkStreamedText.slice(-50));
                                    fullTranslatedTextForStreaming += (fullTranslatedTextForStreaming && currentChunkStreamedText ? " " : "") + currentChunkStreamedText;
                                    if (isLastChunk) {
                                        chrome.tabs.sendMessage(tabId, { action: "translateStreamEnd", fullText: fullTranslatedTextForStreaming, originalText: textToTranslate });
                                    }
                                    reader.cancel().catch(e => console.warn("Error cancelling reader:", e));
                                    resolveStream();
                                    return;
                                }
                                try {
                                    const parsed = JSON.parse(jsonStr); // Parse the JSON data part of the SSE line.
                                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                                        const textPiece = parsed.choices[0].delta.content;
                                        if (textPiece) {
                                            currentChunkStreamedText += textPiece; // Accumulate translated text for this chunk.
                                            // Send individual pieces to content script for progressive display.
                                            // `originalText` (the full, unsplit text) is sent for context in content script.
                                            chrome.tabs.sendMessage(tabId, { action: "translateStreamChunk", text: textPiece, originalText: textToTranslate });
                                        }
                                        // Check for finish reason (another way a stream might end for a choice from an API).
                                        if (parsed.choices[0].finish_reason) {
                                            console.log(`Stream finished for chunk ${i+1} with reason:`, parsed.choices[0].finish_reason, "Text (last 50):", currentChunkStreamedText.slice(-50));
                                            fullTranslatedTextForStreaming += (fullTranslatedTextForStreaming && currentChunkStreamedText ? " " : "") + currentChunkStreamedText;
                                            if (isLastChunk) {
                                                 chrome.tabs.sendMessage(tabId, { action: "translateStreamEnd", fullText: fullTranslatedTextForStreaming, originalText: textToTranslate, finishReason: parsed.choices[0].finish_reason });
                                            }
                                            reader.cancel().catch(e => console.warn("Error cancelling reader:", e));
                                            resolveStream();
                                            return;
                                        }
                                    }
                                } catch (e) {
                                    console.error('Error parsing stream JSON for chunk:', e, jsonStr);
                                    reader.cancel().catch(cancelError => console.warn("Error cancelling reader on parse error:", cancelError));
                                    rejectStream(new Error("Error parsing stream data for chunk")); // Reject promise for this chunk's stream.
                                    return;
                                }
                            }
                        }
                        // Continue reading the stream for this chunk.
                        reader.read().then(processStreamChunk).catch(rejectStream);
                    }
                    // Start processing the stream for this chunk.
                    reader.read().then(processStreamChunk).catch(rejectStream);
                }).catch(streamError => { // Catch errors specific to this chunk's stream processing (e.g., JSON parse error).
                    console.error(`Stream reading error for chunk ${i+1}:`, streamError);
                    // Send error to content script; this will also signal the end of attempts for the user.
                    chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: streamError.message, originalText: textToTranslate });
                    // Critical: re-throw the error to be caught by the outer try-catch.
                    // This ensures that the main loop (`for (let i = 0;...`) is broken and no further chunks are processed.
                    throw streamError; 
                });
                
            } else if (requestBody.stream && !tabId && response.body) { 
                // This case handles scenarios where streaming was requested by the provider config,
                // but no tabId was available (e.g., translation initiated from popup UI directly, not context menu).
                // Attempt to read the whole response as a single JSON. This might fail for true SSE streams.
                console.warn("Streaming response received but no tabId. Attempting to read as non-event-stream. Chunk (first 50):", chunk.substring(0,50));
                 try {
                    const fullResponseData = await response.json(); // Assumes API might send full response if not SSE.
                    if (fullResponseData.choices && fullResponseData.choices.length > 0 && fullResponseData.choices[0].message && fullResponseData.choices[0].message.content) {
                        translatedChunks.push(fullResponseData.choices[0].message.content.trim());
                    } else {
                        const formatError = `Translation failed: Unexpected response format from LLM (streaming fallback, chunk ${i+1}).`;
                        console.error(formatError, fullResponseData);
                        return { error: formatError }; // Stop further processing.
                    }
                } catch (e) {
                    const readError = `Failed to process streaming response without a tab (chunk ${i+1}).`;
                    console.error(readError, e);
                    return { error: readError }; // Stop further processing.
                }

            } else { // Non-streaming response (stream:false or API doesn't support/return stream for this request).
                const data = await response.json(); // Standard JSON response.
                if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
                    // Add translated text of the chunk to the array for later joining.
                    translatedChunks.push(data.choices[0].message.content.trim());
                } else {
                    const formatError = `Translation failed: Unexpected response format from LLM (non-streaming, chunk ${i+1}).`;
                    console.error(formatError, data, "Chunk (first 50 chars):", chunk.substring(0,50));
                    // If tabId exists, inform the user even for a non-streaming error if possible via stream error mechanism.
                    if (tabId) { 
                         chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: formatError, originalText: textToTranslate });
                    }
                    return { error: formatError }; // Stop further processing.
                }
            }

        } catch (error) { // Catch network errors or errors from stream processing's re-throw.
            const netError = `Translation failed for chunk ${i+1}/${textChunks.length}: ${error.message}`;
            console.error('Network or other error during LLM call for chunk:', error, "Provider:", activeProvider.name, "Chunk (first 50 chars):", chunk.substring(0,50));
            // Send error to content script if applicable.
            if (tabId) {
                chrome.tabs.sendMessage(tabId, { action: "translateStreamError", error: netError, originalText: textToTranslate });
            }
            return { error: netError }; // Stop further chunk processing.
        }
    } // End of loop through chunks.

    // --- Combine results (non-streaming) or acknowledge streaming ---
    // After processing all chunks successfully:
    if (enableStreaming) {
        // If streaming was enabled, all communications (start, chunks, end/error) have been handled directly with the tab.
        // The onMessage listener in background.js (which calls this function) expects an acknowledgement that streaming was handled.
        return { streamingStarted: true };
    } else {
        // For non-streaming, combine all translated chunks.
        if (translatedChunks.length === textChunks.length) { // Check if all chunks were successfully translated.
            // Join with double newline, assuming chunks might represent paragraphs or significant segments.
            // This joining strategy works best if `splitText` produces chunks that correspond to these structures.
            return { translatedText: translatedChunks.join("\n\n") }; 
        } else {
            // This state should ideally be unreachable if errors correctly stop processing and return an error object.
            // However, as a fallback, if not all chunks are present (e.g. an error was not returned properly from the loop), return an error.
            return { error: "Failed to translate all text chunks." };
        }
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
