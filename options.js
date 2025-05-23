// New Default Settings Structure
const DEFAULT_SETTINGS = {
    apiProviders: [],
    activeProviderId: null,
    promptProfiles: [],
    activePromptId: null,
    // systemPrompt: 'You are a helpful translation assistant. Translate the following text into {{TARGET_LANGUAGE}}.', // Deprecated
    targetLanguage: 'English',
    temperature: 0.7,
    maxTokens: 2000
};

// DOM Elements - Global Settings
// const systemPromptInput = document.getElementById('systemPrompt'); // Deprecated
const targetLanguageSelect = document.getElementById('targetLanguage');
const temperatureInput = document.getElementById('temperature');
const temperatureValueSpan = document.getElementById('temperatureValue');
const maxTokensInput = document.getElementById('maxTokens');
const saveGlobalSettingsBtn = document.getElementById('saveGlobalSettingsBtn');
const resetButton = document.getElementById('reset');

// DOM Elements - API Provider Management
const apiProvidersListSelect = document.getElementById('apiProvidersList');
const addProviderBtn = document.getElementById('addProviderBtn'); // Renaming for clarity if needed, but it's distinct from profile buttons
const editProviderBtn = document.getElementById('editProviderBtn'); // Ditto
const deleteProviderBtn = document.getElementById('deleteProviderBtn'); // Ditto
const setActiveProviderBtn = document.getElementById('setActiveProviderBtn'); // Ditto
const activeProviderDisplay = document.getElementById('activeProviderDisplay'); // For API Provider

// DOM Elements - Provider Form
const providerFormContainer = document.getElementById('providerFormContainer');
const providerFormTitle = document.getElementById('providerFormTitle');
const editingProviderIdInput = document.getElementById('editingProviderIdInput'); // For API Provider being edited
const providerNameInput = document.getElementById('providerNameInput');
const providerEndpointInput = document.getElementById('providerEndpointInput');
const providerApiKeyInput = document.getElementById('providerApiKeyInput');
const providerModelInput = document.getElementById('providerModelInput');
const providerStreamSupportCheckbox = document.getElementById('providerStreamSupportCheckbox');
const saveProviderBtn = document.getElementById('saveProviderBtn'); // For API Provider form
const cancelProviderBtn = document.getElementById('cancelProviderBtn'); // For API Provider form

// DOM Elements - System Prompt Profile Management
const promptProfilesListSelect = document.getElementById('promptProfilesList');
const addProfileBtn = document.getElementById('addProfileBtn'); // This ID was used in HTML for prompt profiles
const editProfileBtn_prompt = document.getElementById('editProfileBtn'); // This ID was used in HTML for prompt profiles - needs to be distinct
const deleteProfileBtn_prompt = document.getElementById('deleteProfileBtn'); // This ID was used in HTML for prompt profiles - needs to be distinct
const setActiveProfileBtn_prompt = document.getElementById('setActiveProfileBtn'); // This ID was used in HTML for prompt profiles - needs to be distinct
const activeProfileDisplay_prompt = document.getElementById('activeProfileDisplay'); // This ID was used in HTML for prompt profiles

// DOM Elements - Prompt Profile Form
const profileFormContainer = document.getElementById('profileFormContainer');
const profileFormTitle = document.getElementById('profileFormTitle');
const editingProfileIdInput = document.getElementById('editingProfileIdInput'); // For Prompt Profile being edited - this is an ID conflict
const profileNameInput = document.getElementById('profileNameInput');
const profilePromptInput = document.getElementById('profilePromptInput');
const saveProfileBtn = document.getElementById('saveProfileBtn'); // This ID was used in HTML for prompt profiles
const cancelProfileBtn = document.getElementById('cancelProfileBtn'); // This ID was used in HTML for prompt profiles


let currentSettings = {}; // To hold all loaded settings, including providers and profiles

// Resolve ID conflicts by re-getting elements with more specific IDs assumed from HTML structure
// For API Providers (these are fine as they were first)
// const addProviderBtn = document.getElementById('addProviderBtn');
// const editProviderBtn = document.getElementById('editProviderBtn');
// const deleteProviderBtn = document.getElementById('deleteProviderBtn');
// const setActiveProviderBtn = document.getElementById('setActiveProviderBtn');
// const activeProviderDisplay = document.getElementById('activeProviderDisplay');
// const editingProviderIdInput = document.getElementById('editingProviderIdInput'); // For API provider
// const saveProviderBtn = document.getElementById('saveProviderBtn');
// const cancelProviderBtn = document.getElementById('cancelProviderBtn');


// For Prompt Profiles (re-declaring with _prompt suffix for JS clarity, assuming HTML uses these exact IDs)
const addProfileBtn_prompt_specific = document.getElementById('addProfileBtn'); // HTML uses 'addProfileBtn'
const editProfileBtn_prompt_specific = document.getElementById('editProfileBtn'); // HTML uses 'editProfileBtn'
const deleteProfileBtn_prompt_specific = document.getElementById('deleteProfileBtn'); // HTML uses 'deleteProfileBtn'
const setActiveProfileBtn_prompt_specific = document.getElementById('setActiveProfileBtn'); // HTML uses 'setActiveProfileBtn'
const activeSystemProfileDisplay = document.getElementById('activeProfileDisplay'); // HTML uses 'activeProfileDisplay' for prompts
const profileFormContainer_specific = document.getElementById('profileFormContainer');
const profileFormTitle_specific = document.getElementById('profileFormTitle');
const editingProfileIdInput_prompt = document.getElementById('editingProfileIdInput'); // HTML uses 'editingProfileIdInput'
const profileNameInput_specific = document.getElementById('profileNameInput');
const profilePromptInput_specific = document.getElementById('profilePromptInput');
const saveProfileBtn_prompt_specific = document.getElementById('saveProfileBtn'); // HTML uses 'saveProfileBtn'
const cancelProfileBtn_prompt_specific = document.getElementById('cancelProfileBtn'); // HTML uses 'cancelProfileBtn'


// Update temperature display value
temperatureInput.addEventListener('input', () => {
    temperatureValueSpan.textContent = temperatureInput.value;
});

// --- Settings Loading, Saving, Resetting ---

async function loadSettings() {
    let result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    currentSettings = result; // Store all settings globally in this script

    let settingsUpdated = false;

    // Migration for API Providers (from previous step, ensure it runs before prompt migration)
    if (result.apiEndpoint && (!result.apiProviders || result.apiProviders.length === 0)) {
        const migratedProvider = {
            id: `migrated-provider-${Date.now()}`,
            name: 'Default Migrated Provider',
            endpoint: result.apiEndpoint,
            apiKey: result.apiKey || '',
            model: result.modelName || 'gpt-3.5-turbo',
            streamSupport: false
        };
        currentSettings.apiProviders = [migratedProvider];
        currentSettings.activeProviderId = migratedProvider.id;
        settingsUpdated = true;
        console.log('Settings migrated to new provider structure.');
    }
    
    if (!currentSettings.apiProviders || currentSettings.apiProviders.length === 0) {
        const defaultOpenAIProvider = {
            id: `default-openai-${Date.now()}`,
            name: 'OpenAI (Default Provider)',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            apiKey: '',
            model: 'gpt-3.5-turbo',
            streamSupport: true
        };
        currentSettings.apiProviders = [defaultOpenAIProvider];
        if (!currentSettings.activeProviderId) {
            currentSettings.activeProviderId = defaultOpenAIProvider.id;
        }
        settingsUpdated = true;
        console.log('Added default OpenAI provider.');
    }

    // Migration for System Prompts
    if (result.systemPrompt && typeof result.systemPrompt === 'string' && (!result.promptProfiles || result.promptProfiles.length === 0)) {
        const migratedPromptProfile = {
            id: `migrated-prompt-${Date.now()}`,
            name: 'Default Migrated Prompt',
            prompt: result.systemPrompt
        };
        currentSettings.promptProfiles = [migratedPromptProfile];
        currentSettings.activePromptId = migratedPromptProfile.id;
        settingsUpdated = true;
        console.log('System prompt migrated to new profile structure.');
    }

    if (!currentSettings.promptProfiles || currentSettings.promptProfiles.length === 0) {
        const defaultPromptProfile = {
            id: `default-prompt-${Date.now()}`,
            name: 'General Translator',
            prompt: 'You are a helpful translation assistant. Translate the following text into {{TARGET_LANGUAGE}}.'
        };
        currentSettings.promptProfiles = [defaultPromptProfile];
        if (!currentSettings.activePromptId) {
            currentSettings.activePromptId = defaultPromptProfile.id;
        }
        settingsUpdated = true;
        console.log('Added default system prompt profile.');
    }

    if (settingsUpdated) {
        let keysToSave = {
            apiProviders: currentSettings.apiProviders,
            activeProviderId: currentSettings.activeProviderId,
            promptProfiles: currentSettings.promptProfiles,
            activePromptId: currentSettings.activePromptId
        };
        await chrome.storage.sync.set(keysToSave);
        // Remove old keys after successful migration and saving of new ones
        let keysToRemove = [];
        if (result.apiEndpoint) keysToRemove.push('apiEndpoint', 'apiKey', 'modelName');
        if (result.systemPrompt && typeof result.systemPrompt === 'string') keysToRemove.push('systemPrompt');
        if (keysToRemove.length > 0) await chrome.storage.sync.remove(keysToRemove);
        
        // Re-fetch after updates to ensure currentSettings is clean
        currentSettings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    }

    // Load global settings (which do not include systemPrompt anymore)
    targetLanguageSelect.value = currentSettings.targetLanguage;
    temperatureInput.value = currentSettings.temperature;
    temperatureValueSpan.textContent = currentSettings.temperature;
    maxTokensInput.value = currentSettings.maxTokens;

    displayProviders();
    displayPromptProfiles();
}

function saveGlobalSettings() {
    const settingsToSave = {
        // systemPrompt: systemPromptInput.value.trim(), // No longer saved here
        targetLanguage: targetLanguageSelect.value,
        temperature: parseFloat(temperatureInput.value),
        maxTokens: parseInt(maxTokensInput.value, 10)
    };

    if (settingsToSave.maxTokens < 50) {
        alert('Max Tokens should be at least 50.');
        return;
    }

    currentSettings = { ...currentSettings, ...settingsToSave }; // Update local cache
    chrome.storage.sync.set(settingsToSave, () => {
        alert('Global settings saved!');
    });
}

async function resetSettings() {
    if (confirm('Are you sure you want to reset ALL settings to their defaults? This will remove all configured API providers and System Prompt Profiles.')) {
        const defaultProvider = {
            id: `default-openai-reset-${Date.now()}`,
            name: 'OpenAI (Default Provider)',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            apiKey: '', model: 'gpt-3.5-turbo', streamSupport: true
        };
        const defaultProfile = {
            id: `default-prompt-reset-${Date.now()}`,
            name: 'General Translator',
            prompt: 'You are a helpful translation assistant. Translate the following text into {{TARGET_LANGUAGE}}.'
        };
        const freshDefaults = {
            ...DEFAULT_SETTINGS, // spread to get structure and other global defaults like temp, lang
            apiProviders: [defaultProvider],
            activeProviderId: defaultProvider.id,
            promptProfiles: [defaultProfile],
            activePromptId: defaultProfile.id,
            // Explicitly set other global defaults from the original DEFAULT_SETTINGS
            targetLanguage: DEFAULT_SETTINGS.targetLanguage,
            temperature: DEFAULT_SETTINGS.temperature,
            maxTokens: DEFAULT_SETTINGS.maxTokens
        };

        await chrome.storage.sync.set(freshDefaults);
        await loadSettings(); // Reload to show defaults in form
        alert('All settings reset to defaults!');
    }
}

// --- Provider Management UI ---
// (Provider functions from previous step - displayProviders, openProviderForm, etc. - are here)
// ... Assume they are correctly implemented and coexist ...

function displayProviders() {
    apiProvidersListSelect.innerHTML = ''; 
    if (!currentSettings.apiProviders || currentSettings.apiProviders.length === 0) {
        activeProviderDisplay.textContent = 'None - Please add a provider.';
        editProviderBtn.disabled = true;
        deleteProviderBtn.disabled = true;
        setActiveProviderBtn.disabled = true;
        return;
    }

    currentSettings.apiProviders.forEach(provider => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name + (provider.id === currentSettings.activeProviderId ? ' (Active API Provider)' : '');
        if (provider.id === currentSettings.activeProviderId) {
            option.selected = true;
            activeProviderDisplay.textContent = provider.name;
        }
        apiProvidersListSelect.appendChild(option);
    });

    if (!currentSettings.activeProviderId && currentSettings.apiProviders.length > 0) {
        activeProviderDisplay.textContent = 'None - Please set an active provider.';
    }
    
    const selectedProviderNotNull = apiProvidersListSelect.value !== null && apiProvidersListSelect.value !== '';
    editProviderBtn.disabled = !selectedProviderNotNull;
    deleteProviderBtn.disabled = !selectedProviderNotNull;
    setActiveProviderBtn.disabled = !selectedProviderNotNull;
}

function openProviderForm(providerId = null) {
    // This is the existing function for API Providers
    const hiddenIdField = document.getElementById('editingProviderIdInput'); // ensure correct ID
    hiddenIdField.value = providerId || '';

    if (providerId) {
        const provider = currentSettings.apiProviders.find(p => p.id === providerId);
        if (provider) {
            providerFormTitle.textContent = 'Edit API Provider';
            providerNameInput.value = provider.name;
            providerEndpointInput.value = provider.endpoint;
            providerApiKeyInput.value = ''; 
            providerApiKeyInput.placeholder = provider.apiKey ? 'API Key is set. Enter new key to change.' : 'Enter API Key';
            providerModelInput.value = provider.model;
            providerStreamSupportCheckbox.checked = provider.streamSupport || false;
        } else {
            alert('Error: Provider not found for editing.');
            return;
        }
    } else {
        providerFormTitle.textContent = 'Add New API Provider';
        providerNameInput.value = '';
        providerEndpointInput.value = '';
        providerApiKeyInput.value = '';
        providerApiKeyInput.placeholder = 'Enter API Key';
        providerModelInput.value = '';
        providerStreamSupportCheckbox.checked = false;
    }
    providerFormContainer.style.display = 'block';
}

function closeProviderForm() {
    // This is the existing function for API Providers
    providerFormContainer.style.display = 'none';
    const hiddenIdField = document.getElementById('editingProviderIdInput');
    hiddenIdField.value = '';
    providerNameInput.value = '';
    providerEndpointInput.value = '';
    providerApiKeyInput.value = '';
    providerModelInput.value = '';
    providerStreamSupportCheckbox.checked = false;
}

async function handleSaveProvider() {
    // This is the existing function for API Providers
    const hiddenIdField = document.getElementById('editingProviderIdInput');
    const providerId = hiddenIdField.value;
    const name = providerNameInput.value.trim();
    const endpoint = providerEndpointInput.value.trim();
    const apiKey = providerApiKeyInput.value; 
    const model = providerModelInput.value.trim();
    const streamSupport = providerStreamSupportCheckbox.checked;

    if (!name || !endpoint || !model) {
        alert('Provider Name, API Endpoint, and Model Name are required for API Provider.');
        return;
    }
    try { new URL(endpoint); } catch (e) { alert('Invalid API Endpoint URL for API Provider.'); return; }

    let providers = [...(currentSettings.apiProviders || [])];
    if (providerId) { 
        const providerIndex = providers.findIndex(p => p.id === providerId);
        if (providerIndex > -1) {
            const existingProvider = providers[providerIndex];
            providers[providerIndex] = { ...existingProvider, name, endpoint, apiKey: apiKey ? apiKey : existingProvider.apiKey, model, streamSupport };
        }
    } else { 
        providers.push({ id: `provider-${Date.now()}`, name, endpoint, apiKey, model, streamSupport });
    }
    
    currentSettings.apiProviders = providers;
    await chrome.storage.sync.set({ apiProviders: providers });
    displayProviders();
    closeProviderForm();
    alert(`API Provider ${providerId ? 'updated' : 'saved'} successfully!`);
}

async function deleteSelectedProvider() {
    // This is the existing function for API Providers
    const selectedProviderId = apiProvidersListSelect.value;
    if (!selectedProviderId) { alert('Please select an API Provider to delete.'); return; }
    if (confirm(`Are you sure you want to delete the API Provider: ${apiProvidersListSelect.options[apiProvidersListSelect.selectedIndex].text}?`)) {
        currentSettings.apiProviders = currentSettings.apiProviders.filter(p => p.id !== selectedProviderId);
        let newActiveId = currentSettings.activeProviderId;
        if (currentSettings.activeProviderId === selectedProviderId) {
            newActiveId = (currentSettings.apiProviders.length > 0) ? currentSettings.apiProviders[0].id : null;
            currentSettings.activeProviderId = newActiveId;
            await chrome.storage.sync.set({ activeProviderId: newActiveId });
        }
        await chrome.storage.sync.set({ apiProviders: currentSettings.apiProviders });
        displayProviders();
        alert('API Provider deleted.');
    }
}

async function setActiveProvider() {
    // This is the existing function for API Providers
    const selectedProviderId = apiProvidersListSelect.value;
    if (!selectedProviderId) { alert('Please select an API Provider to set as active.'); return; }
    currentSettings.activeProviderId = selectedProviderId;
    await chrome.storage.sync.set({ activeProviderId: selectedProviderId });
    displayProviders(); 
    alert('API Provider set as active.');
}


// --- System Prompt Profile Management UI ---

function displayPromptProfiles() {
    promptProfilesListSelect.innerHTML = ''; // Clear existing options
    if (!currentSettings.promptProfiles || currentSettings.promptProfiles.length === 0) {
        activeSystemProfileDisplay.textContent = 'None - Please add a profile.';
        editProfileBtn_prompt_specific.disabled = true;
        deleteProfileBtn_prompt_specific.disabled = true;
        setActiveProfileBtn_prompt_specific.disabled = true;
        return;
    }

    currentSettings.promptProfiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name + (profile.id === currentSettings.activePromptId ? ' (Active System Prompt)' : '');
        if (profile.id === currentSettings.activePromptId) {
            option.selected = true;
            activeSystemProfileDisplay.textContent = profile.name;
        }
        promptProfilesListSelect.appendChild(option);
    });
    
    if (!currentSettings.activePromptId && currentSettings.promptProfiles.length > 0) {
        activeSystemProfileDisplay.textContent = 'None - Please set an active profile.';
    }

    const selectedProfileNotNull = promptProfilesListSelect.value !== null && promptProfilesListSelect.value !== '';
    editProfileBtn_prompt_specific.disabled = !selectedProfileNotNull;
    deleteProfileBtn_prompt_specific.disabled = !selectedProfileNotNull;
    setActiveProfileBtn_prompt_specific.disabled = !selectedProfileNotNull;
}

function openPromptProfileForm(profileId = null) {
    const hiddenIdField = editingProfileIdInput_prompt; // Use specific ID for prompt's hidden input
    hiddenIdField.value = profileId || '';

    if (profileId) {
        const profile = currentSettings.promptProfiles.find(p => p.id === profileId);
        if (profile) {
            profileFormTitle_specific.textContent = 'Edit System Prompt Profile';
            profileNameInput_specific.value = profile.name;
            profilePromptInput_specific.value = profile.prompt;
        } else {
            alert('Error: System Prompt Profile not found for editing.');
            return;
        }
    } else {
        profileFormTitle_specific.textContent = 'Add New System Prompt Profile';
        profileNameInput_specific.value = '';
        profilePromptInput_specific.value = '';
    }
    profileFormContainer_specific.style.display = 'block';
}

function closePromptProfileForm() {
    profileFormContainer_specific.style.display = 'none';
    editingProfileIdInput_prompt.value = '';
    profileNameInput_specific.value = '';
    profilePromptInput_specific.value = '';
}

async function handleSavePromptProfile() {
    const profileId = editingProfileIdInput_prompt.value;
    const name = profileNameInput_specific.value.trim();
    const prompt = profilePromptInput_specific.value.trim();

    if (!name || !prompt) {
        alert('Profile Name and System Prompt text are required.');
        return;
    }

    let profiles = [...(currentSettings.promptProfiles || [])];
    if (profileId) { // Editing existing profile
        const profileIndex = profiles.findIndex(p => p.id === profileId);
        if (profileIndex > -1) {
            profiles[profileIndex] = { ...profiles[profileIndex], name, prompt };
        }
    } else { // Adding new profile
        profiles.push({ id: `prompt-${Date.now()}`, name, prompt });
    }
    
    currentSettings.promptProfiles = profiles;
    await chrome.storage.sync.set({ promptProfiles: profiles });
    displayPromptProfiles();
    closePromptProfileForm();
    alert(`System Prompt Profile ${profileId ? 'updated' : 'saved'} successfully!`);
}

async function deleteSelectedPromptProfile() {
    const selectedProfileId = promptProfilesListSelect.value;
    if (!selectedProfileId) {
        alert('Please select a System Prompt Profile to delete.');
        return;
    }
    if (confirm(`Are you sure you want to delete the System Prompt Profile: ${promptProfilesListSelect.options[promptProfilesListSelect.selectedIndex].text}?`)) {
        currentSettings.promptProfiles = currentSettings.promptProfiles.filter(p => p.id !== selectedProfileId);
        
        let newActiveId = currentSettings.activePromptId;
        if (currentSettings.activePromptId === selectedProfileId) {
            newActiveId = (currentSettings.promptProfiles.length > 0) ? currentSettings.promptProfiles[0].id : null;
            currentSettings.activePromptId = newActiveId; // Update local cache
            await chrome.storage.sync.set({ activePromptId: newActiveId });
        }
        
        await chrome.storage.sync.set({ promptProfiles: currentSettings.promptProfiles });
        displayPromptProfiles();
        alert('System Prompt Profile deleted.');
    }
}

async function setActivePromptProfile() {
    const selectedProfileId = promptProfilesListSelect.value;
    if (!selectedProfileId) {
        alert('Please select a System Prompt Profile to set as active.');
        return;
    }
    currentSettings.activePromptId = selectedProfileId; // Update local cache
    await chrome.storage.sync.set({ activePromptId: selectedProfileId });
    displayPromptProfiles(); 
    alert('System Prompt Profile set as active.');
}


// Event Listeners
document.addEventListener('DOMContentLoaded', loadSettings);
saveGlobalSettingsBtn.addEventListener('click', saveGlobalSettings);
resetButton.addEventListener('click', resetSettings);

// API Provider Event Listeners
addProviderBtn.addEventListener('click', () => openProviderForm());
editProviderBtn.addEventListener('click', () => {
    const selectedId = apiProvidersListSelect.value;
    if (selectedId) openProviderForm(selectedId);
    else alert('Please select an API Provider to edit.');
});
deleteProviderBtn.addEventListener('click', deleteSelectedProvider);
setActiveProviderBtn.addEventListener('click', setActiveProvider);
saveProviderBtn.addEventListener('click', handleSaveProvider); // For API Provider form
cancelProviderBtn.addEventListener('click', closeProviderForm); // For API Provider form
apiProvidersListSelect.addEventListener('change', () => {
    const selectedProvider = apiProvidersListSelect.value !== null && apiProvidersListSelect.value !== '';
    editProviderBtn.disabled = !selectedProvider;
    deleteProviderBtn.disabled = !selectedProvider;
    setActiveProviderBtn.disabled = !selectedProvider;
});

// System Prompt Profile Event Listeners
addProfileBtn_prompt_specific.addEventListener('click', () => openPromptProfileForm());
editProfileBtn_prompt_specific.addEventListener('click', () => {
    const selectedId = promptProfilesListSelect.value;
    if (selectedId) openPromptProfileForm(selectedId);
    else alert('Please select a System Prompt Profile to edit.');
});
deleteProfileBtn_prompt_specific.addEventListener('click', deleteSelectedPromptProfile);
setActiveProfileBtn_prompt_specific.addEventListener('click', setActivePromptProfile);
saveProfileBtn_prompt_specific.addEventListener('click', handleSavePromptProfile);
cancelProfileBtn_prompt_specific.addEventListener('click', closePromptProfileForm);
promptProfilesListSelect.addEventListener('change', () => {
    const selectedProfile = promptProfilesListSelect.value !== null && promptProfilesListSelect.value !== '';
    editProfileBtn_prompt_specific.disabled = !selectedProfile;
    deleteProfileBtn_prompt_specific.disabled = !selectedProfile;
    setActiveProfileBtn_prompt_specific.disabled = !selectedProfile;
});
