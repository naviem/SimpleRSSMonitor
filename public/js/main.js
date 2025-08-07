// This file will contain client-side JavaScript for interacting with the backend,
// managing the UI, and handling Socket.IO events.

// Global Caches - defined at the top level to be accessible by all functions
let globalFeedsCache = [];
let globalIntegrationsCache = [];
let currentKeywordRoutes = [];
let keywordRouteToDelete = null;

// Move renderFeedsTable here so it's globally available
function renderFeedsTable(feeds) {
    globalFeedsCache = feeds; // Update cache
    const feedsTableBody = document.getElementById('feedsTableBody');
    const feedCount = document.getElementById('feedCount');
    feedsTableBody.innerHTML = ''; // Clear existing rows
    feedCount.textContent = feeds.length;
    if (feeds.length === 0) {
        feedsTableBody.innerHTML = '<tr><td colspan="6">No feeds added yet.</td></tr>';
        return;
    }
    feeds.forEach(feed => {
        const row = feedsTableBody.insertRow();
        const statusClass = feed.status === 'ok' ? 'status-ok' : (feed.status === 'error' ? 'status-error' : 'status-pending');
        row.innerHTML = `
            <td><span class="status-icon ${statusClass}" title="${feed.statusDetails || feed.status || 'N/A'}"></span> ${feed.status || 'Pending'}</td>
            <td>${feed.title}</td>
            <td><a href="${feed.url}" target="_blank">${feed.url.length > 50 ? feed.url.substring(0, 50) + '...' : feed.url}</a></td>
            <td>${feed.interval}</td>
            <td>${feed.lastChecked ? new Date(feed.lastChecked).toLocaleString() : 'Never'}</td>
            <td class="actions-cell">
                <button class="btn btn-secondary btn-sm action-btn scan-feed-btn" data-id="${feed.id}" title="Scan Now">
                    <i class="fas fa-sync-alt"></i>
                </button>
                <button class="btn btn-secondary btn-sm action-btn edit-feed-btn" data-id="${feed.id}">Edit</button>
                <button class="btn btn-danger btn-sm action-btn delete-feed-btn" data-id="${feed.id}">Delete</button>
            </td>
        `;
    });

    // Add event listeners for new edit/delete buttons
    document.querySelectorAll('.edit-feed-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            try {
                // Fetch full feed details from the server
                const response = await fetch(`/api/feeds/${id}/details`);
                if (!response.ok) {
                    throw new Error('Failed to fetch feed details.');
                }
                const feedToEdit = await response.json();
                
                if (feedToEdit) {
                    openEditFeedModal(feedToEdit);
                } else {
                    console.error("Feed to edit not found on server with ID:", id);
                    alert("Could not find feed data. It might have been deleted.");
                }
            } catch (error) {
                console.error("Error fetching feed details:", error);
                alert("An error occurred while fetching feed data. Please try again.");
            }
        });
    });

    document.querySelectorAll('.delete-feed-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            if (confirm('Are you sure you want to delete this feed?')) {
                socket.emit('delete_feed', { id: e.target.dataset.id });
            }
        });
    });

    document.querySelectorAll('.scan-feed-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const buttonEl = e.currentTarget;
            const icon = buttonEl.querySelector('i');
            const feedId = buttonEl.dataset.id;

            // Prevent multiple clicks
            if (buttonEl.disabled) return;

            // Visual feedback
            buttonEl.disabled = true;
            icon.classList.add('fa-spin');

            try {
                const response = await fetch(`/api/feeds/${feedId}/scan`, { method: 'POST' });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to start scan.');
                }
                // The backend will emit socket events to update the status, so no need to do much here.
                // We can optionally show a success message if desired.
                console.log(`Scan command sent for feed ${feedId}`);
            } catch (error) {
                console.error('Error triggering scan:', error);
                alert(`Could not trigger scan: ${error.message}`);
            } finally {
                // Remove visual feedback after a short delay to feel more responsive
                setTimeout(() => {
                    buttonEl.disabled = false;
                    icon.classList.remove('fa-spin');
                }, 500);
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Determine current page
    const isFeedsPage = !!document.getElementById('feedsTable');
    const isIntegrationsPage = !!document.getElementById('integrationsTable');

    // --- Socket.IO Event Handlers (Common to both pages) --- //
    socket.on('connect', () => {
        console.log('Connected to server via Socket.IO');
    });

    socket.on('init_data', (data) => {
        console.log('Received initial data:', data);
        if (data.feeds) {
            globalFeedsCache = data.feeds;
            if (isFeedsPage) {
                renderFeedsTable(data.feeds);
            }
        }
        if (data.integrations) {
            globalIntegrationsCache = data.integrations;
            if (isIntegrationsPage) {
                renderIntegrationsTable(data.integrations);
            }
        }
    });

    socket.on('update_feeds', (feeds) => {
        globalFeedsCache = feeds;
        if (isFeedsPage) renderFeedsTable(feeds);
    });

    socket.on('update_integrations', (integrations) => {
        globalIntegrationsCache = integrations;
        if (isIntegrationsPage) renderIntegrationsTable(integrations);
    });

    socket.on('new_feed_item', (notification) => {
        if (isFeedsPage) {
            console.log('New feed item notification:', notification);
        }
    });

    // --- Feeds Page Specific Logic --- //
    if (isFeedsPage) {
        console.log('Setting up Feeds page specific logic.');

        // Modal setup
        setupModal('addFeedModal', 'addFeedBtn', '#closeAddFeedModal');
        setupModal('editFeedModal', null, '#closeEditFeedModal'); // For Edit modal, open is manual
        
        // Other setups
        setupKeywordRouteModals();
        setupFeedPageForms(socket);
        setupFeedPageEventListeners(socket);
        setupCollapsibles();

        socket.on('feed_fields_detected', ({ feedUrl, fields, sampleItem, error }) => {
            handleFeedFieldsDetected(feedUrl, fields, sampleItem, error);
        });
    }

    // --- Integrations Page Specific Logic --- //
    if (isIntegrationsPage) {
        console.log('Setting up Integrations page specific logic.');
        setupModal('integrationModal', 'addIntegrationBtn', '#closeIntegrationModal');
        setupIntegrationsPageForms(socket);
    }
});

// Refactored setup functions to organize code
function setupModal(modalId, openBtnId, closeBtnSelector) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // The open button is optional
    if (openBtnId) {
        const openBtn = document.getElementById(openBtnId);
        if (openBtn) {
            openBtn.onclick = () => {
                if (modalId === 'addFeedModal') {
                    // Logic to reset form can go here
                    const form = document.getElementById('addFeedForm');
                    if (form) form.reset();
                    const preview = document.getElementById('addFeedPreviewSection');
                    if (preview) preview.style.display = 'none';
                    if (typeof populateAddFeedIntegrationsCheckboxes === 'function') {
                        populateAddFeedIntegrationsCheckboxes();
                    }
                }
                modal.style.display = 'block';
            };
        }
    }

    const closeBtn = modal.querySelector(closeBtnSelector);
    if (closeBtn) {
        closeBtn.onclick = () => modal.style.display = 'none';
    }

    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
}

function setupKeywordRouteModals() {
    const keywordRouteModal = document.getElementById('keywordRouteModal');
    if (keywordRouteModal) {
        keywordRouteModal.querySelector('.close-button').addEventListener('click', hideKeywordRouteModal);
        document.getElementById('keywordRouteForm').addEventListener('submit', saveKeywordRoute);
        document.getElementById('addKeywordRouteBtn').addEventListener('click', () => showKeywordRouteModal());
        document.getElementById('testKeywordBtn').addEventListener('click', testKeywordRule);
    }

    const deleteModal = document.getElementById('keywordRouteDeleteModal');
    if (deleteModal) {
        deleteModal.querySelector('.close-button').onclick = hideKeywordRouteDeleteModal;
        document.getElementById('cancelKeywordRouteDeleteBtn').onclick = hideKeywordRouteDeleteModal;
        document.getElementById('confirmKeywordRouteDeleteBtn').onclick = confirmKeywordRouteDelete;
    }
}

function setupFeedPageForms(socket) {
    // Add Feed Form
    const addFeedForm = document.getElementById('addFeedForm');
    if (addFeedForm) {
        addFeedForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const feedData = {
                id: document.getElementById('addFeedId').value || null,
                title: document.getElementById('addFeedTitleInput').value,
                url: document.getElementById('addFeedUrlInput').value,
                interval: parseInt(document.getElementById('addFeedIntervalInput').value, 10),
                showAllPrefixes: document.getElementById('addFeedShowAllPrefixesInput').checked,
                selectedFields: Array.from(document.querySelectorAll('#addFeedFieldsCheckboxes input:checked')).map(cb => cb.value),
                associatedIntegrations: Array.from(document.querySelectorAll('#addFeedIntegrationsCheckboxes input:checked')).map(cb => cb.value)
            };
            socket.emit('add_feed', feedData);
            document.getElementById('addFeedModal').style.display = 'none';
        });
    }

    // Edit Feed Form
    const editFeedForm = document.getElementById('editFeedForm');
    if (editFeedForm) {
        editFeedForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const feedData = {
                id: document.getElementById('editFeedId').value,
                title: document.getElementById('editFeedTitleInput').value,
                url: document.getElementById('editFeedUrlInput').value,
                interval: parseInt(document.getElementById('editFeedIntervalInput').value, 10),
                showAllPrefixes: document.getElementById('editFeedShowAllPrefixesInput').checked,
                selectedFields: Array.from(document.querySelectorAll('#editFeedFieldsCheckboxes input:checked')).map(cb => cb.value),
                associatedIntegrations: Array.from(document.querySelectorAll('#editFeedIntegrationsCheckboxes input:checked')).map(cb => cb.value)
            };
            socket.emit('update_feed', feedData);
            document.getElementById('editFeedModal').style.display = 'none';
        });
    }
}

function setupFeedPageEventListeners(socket) {
    const addFeedBtn = document.getElementById('addFeedBtn');
    if (addFeedBtn) {
        addFeedBtn.onclick = openAddFeedModal;
    }
    
    // Refresh button for add feed preview
    const refreshAddFeedPreviewBtn = document.getElementById('refreshAddFeedPreviewBtn');
    if(refreshAddFeedPreviewBtn) {
        // This button's logic would need to be defined, likely similar to edit feed's preview
    }

    // Event listeners for edit feed preview
    const editFeedShowAllPrefixesInput = document.getElementById('editFeedShowAllPrefixesInput');
    if(editFeedShowAllPrefixesInput) {
        editFeedShowAllPrefixesInput.addEventListener('change', () => renderEditFeedPreview());
    }

    const editFeedFieldsCheckboxes = document.getElementById('editFeedFieldsCheckboxes');
    if(editFeedFieldsCheckboxes) {
        editFeedFieldsCheckboxes.addEventListener('change', (e) => {
            if(e.target.matches('input[type="checkbox"]')) {
                renderEditFeedPreview();
            }
        });
    }
}

function setupCollapsibles() {
    document.querySelectorAll('.collapsible-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            header.classList.toggle('active');
            content.style.display = content.style.display === 'block' ? 'none' : 'block';
        });
    });
}

function setupIntegrationsPageForms(socket) {
    const integrationForm = document.getElementById('integrationForm');
    if (!integrationForm) return;

    const integrationTypeInput = document.getElementById('integrationTypeInput');
    const discordWebhookUrlGroup = document.getElementById('discordWebhookUrlGroup');
    const telegramBotTokenGroup = document.getElementById('telegramBotTokenGroup');
    const telegramChatIdGroup = document.getElementById('telegramChatIdGroup');

    integrationTypeInput.addEventListener('change', (e) => {
        const type = e.target.value;
        discordWebhookUrlGroup.style.display = (type === 'discord') ? 'block' : 'none';
        telegramBotTokenGroup.style.display = (type === 'telegram') ? 'block' : 'none';
        telegramChatIdGroup.style.display = (type === 'telegram') ? 'block' : 'none';
    });

    integrationForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const integrationData = {
            id: document.getElementById('integrationId').value || null,
            name: document.getElementById('integrationNameInput').value,
            type: integrationTypeInput.value,
            webhookUrl: integrationTypeInput.value === 'discord' ? document.getElementById('discordWebhookUrlInput').value : null,
            token: integrationTypeInput.value === 'telegram' ? document.getElementById('telegramBotTokenInput').value : null,
            chatId: integrationTypeInput.value === 'telegram' ? document.getElementById('telegramChatIdInput').value : null,
        };
        socket.emit(integrationData.id ? 'update_integration' : 'add_integration', integrationData);
        document.getElementById('integrationModal').style.display = 'none';
    });

    document.getElementById('addIntegrationBtn').addEventListener('click', () => {
        document.getElementById('integrationModalTitle').textContent = 'Add New Integration';
        integrationForm.reset();
        document.getElementById('integrationId').value = '';
        integrationTypeInput.value = 'discord';
        integrationTypeInput.dispatchEvent(new Event('change'));
    });
}

function handleFeedFieldsDetected(feedUrl, fields, sampleItem, error) {
    const editFeedModal = document.getElementById('editFeedModal');
    if (!editFeedModal || editFeedModal.style.display !== 'block') return;

    const urlInput = document.getElementById('editFeedUrlInput');
    if (urlInput.value !== feedUrl) return;

    if (error) {
        alert(`Error detecting fields: ${error}`);
        populateEditFeedFieldsCheckboxes([], [], null);
        return;
    }

    const feedId = document.getElementById('editFeedId').value;
    const feed = globalFeedsCache.find(f => f.id === feedId);
    
    let selectedFieldsToUse = [];
    if (feed) {
        feed.availableFields = fields;
        feed.sampleItems = [sampleItem];
        selectedFieldsToUse = (feed.selectedFields && feed.selectedFields.length > 0) ? feed.selectedFields : [...fields];
        feed.selectedFields = selectedFieldsToUse;
    } else {
        selectedFieldsToUse = [...fields];
    }

    populateEditFeedFieldsCheckboxes(fields, selectedFieldsToUse, sampleItem);
    
    const fieldsCollapsibleContent = document.querySelector('#editFeedFieldsCheckboxes').closest('.collapsible-content');
    if (fieldsCollapsibleContent) {
        fieldsCollapsibleContent.style.display = 'block';
        fieldsCollapsibleContent.previousElementSibling.classList.add('active');
    }
    
    document.getElementById('editFeedPreviewSection').style.display = 'block';
    renderEditFeedPreview();
}

function renderIntegrationsTable(integrations) {
    const integrationsTableBody = document.getElementById('integrationsTableBody');
    const integrationCount = document.getElementById('integrationCount');
    if (!integrationsTableBody || !integrationCount) return;

    integrationsTableBody.innerHTML = '';
    integrationCount.textContent = integrations.length;
    if (integrations.length === 0) {
        integrationsTableBody.innerHTML = '<tr><td colspan="4">No integrations added yet.</td></tr>';
        return;
    }
    integrations.forEach(integ => {
        const row = integrationsTableBody.insertRow();
        let details = '';
        if (integ.type === 'discord') {
            details = `Webhook: ${integ.webhookUrl.substring(0,30)}...`;
        } else if (integ.type === 'telegram') {
            details = `Token: ${integ.token ? integ.token.substring(0,15) : ''}... / Chat ID: ${integ.chatId}`;
        }

        row.innerHTML = `
            <td>${integ.name}</td>
            <td>${integ.type.charAt(0).toUpperCase() + integ.type.slice(1)}</td>
            <td>${details}</td>
            <td>
                <button class="btn btn-secondary btn-sm action-btn edit-integration-btn" data-id="${integ.id}">Edit</button>
                <button class="btn btn-danger btn-sm action-btn delete-integration-btn" data-id="${integ.id}">Delete</button>
            </td>
        `;
    });

    document.querySelectorAll('.edit-integration-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            const integToEdit = globalIntegrationsCache.find(i => i.id === id);
            if (integToEdit) {
                document.getElementById('integrationModalTitle').textContent = 'Edit Integration';
                document.getElementById('integrationId').value = integToEdit.id;
                document.getElementById('integrationNameInput').value = integToEdit.name;
                const typeInput = document.getElementById('integrationTypeInput');
                typeInput.value = integToEdit.type;
                typeInput.dispatchEvent(new Event('change')); 
                if (integToEdit.type === 'discord') {
                    document.getElementById('discordWebhookUrlInput').value = integToEdit.webhookUrl;
                } else if (integToEdit.type === 'telegram') {
                    document.getElementById('telegramBotTokenInput').value = integToEdit.token;
                    document.getElementById('telegramChatIdInput').value = integToEdit.chatId;
                }
                document.getElementById('integrationModal').style.display = 'block';
            }
        });
    });

    document.querySelectorAll('.delete-integration-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            if (confirm('Are you sure you want to delete this integration?')) {
                const socket = io(); // This is not ideal, should be passed in
                socket.emit('delete_integration', { id: e.target.dataset.id });
            }
        });
    });
}

function showKeywordRoutesSection() {
    const section = document.getElementById('feedKeywordRoutesSection');
    section.style.display = 'block';
}

function hideKeywordRoutesSection() {
    const section = document.getElementById('feedKeywordRoutesSection');
    section.style.display = 'none';
}

async function loadKeywordRoutes(feedId) {
    console.log(`Loading keyword routes for feed ID: ${feedId}`);
    try {
        const response = await fetch(`/api/keyword-routes/feed/${feedId}`);
        if (!response.ok) {
            // Log the error response text for better debugging
            const errorText = await response.text();
            console.error('Error loading keyword routes:', response.status, errorText);
            currentKeywordRoutes = []; // Ensure it's an array on error
        } else {
            currentKeywordRoutes = await response.json();
        }
        renderKeywordRoutes();
    } catch (error) {
        console.error('Error loading keyword routes:', error);
        currentKeywordRoutes = []; // Ensure it's an array on fetch error
        renderKeywordRoutes();
    }
}

function renderKeywordRoutes() {
    const container = document.getElementById('keywordRoutesList');
    container.innerHTML = '';

    currentKeywordRoutes.forEach(route => {
        const routeElement = document.createElement('div');
        routeElement.className = 'keyword-route-item';
        const integration = globalIntegrationsCache.find(i => i.id === route.integration_id);
        const integrationName = integration ? integration.name : 'Unknown';

        let optionsHtml = '';
        if (route.is_regex) {
            optionsHtml += `<span class="badge badge-info">Regex</span>`;
        }
        if (route.case_sensitive) {
            optionsHtml += `<span class="badge badge-warning">Case Sensitive</span>`;
        }

        let fieldsHtml = '<span class="fields-label">Fields:</span>';
        if (route.fields && route.fields.length > 0 && !(route.fields.length === 1 && route.fields[0] === 'all')) {
            fieldsHtml += route.fields.map(f => `<span class="badge badge-secondary">${f}</span>`).join(' ');
        } else {
            fieldsHtml += `<span class="badge badge-secondary">All</span>`;
        }

        routeElement.innerHTML = `
            <div class="route-info-wrapper">
                <div class="route-summary">
                    <span class="route-keyword">"${route.keyword}"</span> &rarr; <span class="route-integration">${integrationName}</span>
                </div>
                <div class="route-details">
                    <div class="route-fields">${fieldsHtml}</div>
                    <div class="route-options">${optionsHtml}</div>
                </div>
            </div>
            <div class="route-actions">
                <button type="button" id="edit-kw-route-${route.id}" class="btn btn-secondary btn-sm">Edit</button>
                <button type="button" id="delete-kw-route-${route.id}" class="btn btn-danger btn-sm">Delete</button>
            </div>
        `;
        container.appendChild(routeElement);
    });

    // Add event listeners for edit and delete buttons on each route
    currentKeywordRoutes.forEach(route => {
        const editBtn = document.getElementById(`edit-kw-route-${route.id}`);
        const deleteBtn = document.getElementById(`delete-kw-route-${route.id}`);
        if (editBtn) {
            editBtn.addEventListener('click', () => editKeywordRoute(route.id));
        }
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => showKeywordRouteDeleteModal(route.id));
        }
    });
}

function showKeywordRouteModal(route = null) {
    const modal = document.getElementById('keywordRouteModal');
    const form = document.getElementById('keywordRouteForm');
    const modalTitle = modal.querySelector('h2');
    const feedIdInput = document.getElementById('feedId');
    const keywordRouteIdInput = document.getElementById('keywordRouteId');
    const keywordInput = document.getElementById('keywordInput');
    const isRegexInput = document.getElementById('isRegexInput');
    const caseSensitiveInput = document.getElementById('caseSensitiveInput');
    const targetIntegrationSelect = document.getElementById('targetIntegrationSelect');
    const fieldSelect = document.getElementById('fieldSelect');

    // Reset form fields
    form.reset();
    keywordRouteIdInput.value = '';
    
    // Reset selections for the multiple-select box
    for (let i = 0; i < fieldSelect.options.length; i++) {
        fieldSelect.options[i].selected = false;
    }
    // Set default for 'All Fields'
    const allFieldsOption = fieldSelect.querySelector('option[value="all"]');
    if (allFieldsOption) allFieldsOption.selected = true;
    
    // Set the hidden feedId input from the currently open feed in the main edit modal
    const currentFeedId = document.getElementById('editFeedId').value;
    feedIdInput.value = currentFeedId;

    // Populate integrations dropdown
    targetIntegrationSelect.innerHTML = ''; // Clear previous options
    globalIntegrationsCache.forEach(integration => {
        const option = document.createElement('option');
        option.value = integration.id;
        option.textContent = integration.name;
        targetIntegrationSelect.appendChild(option);
    });

    if (route) {
        // Editing existing route
        modalTitle.textContent = 'Edit Keyword Rule';
        keywordRouteIdInput.value = route.id;
        keywordInput.value = route.keyword;
        isRegexInput.checked = route.is_regex;
        caseSensitiveInput.checked = route.case_sensitive;
        targetIntegrationSelect.value = route.integration_id;
        
        // Populate selected fields
        if (route.fields && route.fields.length > 0) {
            // Deselect 'All Fields' if specific fields are set
            if (allFieldsOption) allFieldsOption.selected = false;
            
            route.fields.forEach(fieldValue => {
                const option = fieldSelect.querySelector(`option[value="${fieldValue}"]`);
                if (option) {
                    option.selected = true;
                }
            });
        }
    } else {
        // Adding new route
        modalTitle.textContent = 'Add Keyword Rule';
    }

    modal.style.display = 'block';
}

function hideKeywordRouteModal() {
    const modal = document.getElementById('keywordRouteModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function saveKeywordRoute(event) {
    event.preventDefault();
    
    const form = event.target;
    const routeId = document.getElementById('keywordRouteId')?.value || '';
    const feedId = document.getElementById('feedId')?.value;
    
    if (!feedId) {
        console.error('No feed ID found when saving keyword route');
        alert('Error: No feed ID found. Please try again.');
        return;
    }
    
    // Collect selected fields
    const fieldSelect = document.getElementById('fieldSelect');
    if (!fieldSelect) {
        console.error('Field select element not found');
        return;
    }
    
    let selectedFields = Array.from(fieldSelect.selectedOptions).map(opt => opt.value);
    if (selectedFields.includes('all') || selectedFields.length === 0) selectedFields = [];
    
    const keywordInput = document.getElementById('keywordInput');
    const isRegexInput = document.getElementById('isRegexInput');
    const caseSensitiveInput = document.getElementById('caseSensitiveInput');
    const targetIntegrationSelect = document.getElementById('targetIntegrationSelect');
    
    if (!keywordInput || !isRegexInput || !caseSensitiveInput || !targetIntegrationSelect) {
        console.error('Required form elements missing');
        alert('Error: Some form elements are missing. Please try again.');
        return;
    }
    
    const routeData = {
        keyword: keywordInput.value,
        isRegex: isRegexInput.checked,
        caseSensitive: caseSensitiveInput.checked,
        integrationId: targetIntegrationSelect.value,
        fields: selectedFields
    };
    
    try {
        if (routeId) {
            await fetch(`/api/keyword-routes/${routeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(routeData)
            });
        } else {
            await fetch('/api/keyword-routes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...routeData, feedId })
            });
        }
        
        await loadKeywordRoutes(feedId);
        hideKeywordRouteModal();
    } catch (error) {
        console.error('Error saving keyword route:', error);
        alert('Failed to save keyword route. Please try again.');
    }
}

function showKeywordRouteDeleteModal(routeId) {
    keywordRouteToDelete = routeId;
    document.getElementById('keywordRouteDeleteModal').style.display = 'block';
}

function hideKeywordRouteDeleteModal() {
    keywordRouteToDelete = null;
    document.getElementById('keywordRouteDeleteModal').style.display = 'none';
}

async function confirmKeywordRouteDelete() {
    if (!keywordRouteToDelete) return;
    try {
        await fetch(`/api/keyword-routes/${keywordRouteToDelete}`, { method: 'DELETE' });
        await loadKeywordRoutes(document.getElementById('editFeedId').value);
    } catch (error) {
        console.error('Error deleting keyword route:', error);
        alert('Failed to delete keyword route. Please try again.');
    }
    hideKeywordRouteDeleteModal();
}

async function testKeywordRule() {
    const keyword = document.getElementById('keywordInput').value;
    const content = document.getElementById('testContentInput').value;
    const isRegex = document.getElementById('isRegexInput').checked;
    const caseSensitive = document.getElementById('caseSensitiveInput').checked;
    // Collect selected fields
    const fieldSelect = document.getElementById('fieldSelect');
    let selectedFields = Array.from(fieldSelect.selectedOptions).map(opt => opt.value);
    if (selectedFields.includes('all') || selectedFields.length === 0) selectedFields = [];
    if (!keyword || !content) {
        alert('Please enter both a keyword and test content.');
        return;
    }
    try {
        const response = await fetch('/api/keyword-routes/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword, content, isRegex, caseSensitive, fields: selectedFields })
        });
        
        const result = await response.json();
        const testResult = document.getElementById('testResult');
        
        if (result.error) {
            testResult.className = 'error';
            testResult.textContent = result.error;
        } else {
            testResult.className = result.matches ? 'success' : '';
            testResult.textContent = result.matches 
                ? '✓ Keyword matches the test content!'
                : '✗ No match found in the test content.';
        }
    } catch (error) {
        console.error('Error testing keyword rule:', error);
        alert('Failed to test keyword rule. Please try again.');
    }
}

function editKeywordRoute(routeId) {
    const routeToEdit = currentKeywordRoutes.find(r => r.id === routeId);
    if (routeToEdit) {
        showKeywordRouteModal(routeToEdit);
    }
}

function populateAddFeedIntegrationsCheckboxes() {
    const container = document.getElementById('addFeedIntegrationsCheckboxes');
    if (!container) return;
    container.innerHTML = '';
    if (!globalIntegrationsCache || globalIntegrationsCache.length === 0) {
        container.innerHTML = '<p style="width: 100%; text-align: center; color: #a0aec0; padding: 10px 0;">No integrations configured. <a href="/integrations" style="color: #63b3ed; text-decoration: underline;">Add integrations here.</a></p>';
        return;
    }
    globalIntegrationsCache.forEach(integration => {
        const checkboxDiv = document.createElement('div');
        checkboxDiv.classList.add('checkbox-item');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `add-integration-${integration.id}`;
        checkbox.value = integration.id;
        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.textContent = `${integration.name} (${integration.type})`;
        checkboxDiv.appendChild(checkbox);
        checkboxDiv.appendChild(label);
        container.appendChild(checkboxDiv);
    });
}

// --- Robust openAddFeedModal ---
function openAddFeedModal() {
    const addFeedModal = document.getElementById('addFeedModal');
    const addFeedForm = document.getElementById('addFeedForm');
    const addFeedIdInput = document.getElementById('addFeedId');
    const addFeedTitleInput = document.getElementById('addFeedTitleInput');
    const addFeedUrlInput = document.getElementById('addFeedUrlInput');
    const addFeedIntervalInput = document.getElementById('addFeedIntervalInput');
    const addFeedPreviewSection = document.getElementById('addFeedPreviewSection');
    let missing = [];
    if (!addFeedModal) missing.push('addFeedModal');
    if (!addFeedForm) missing.push('addFeedForm');
    if (!addFeedIdInput) missing.push('addFeedId');
    if (!addFeedTitleInput) missing.push('addFeedTitleInput');
    if (!addFeedUrlInput) missing.push('addFeedUrlInput');
    if (!addFeedIntervalInput) missing.push('addFeedIntervalInput');
    if (!addFeedPreviewSection) missing.push('addFeedPreviewSection');
    if (missing.length > 0) {
        console.error('Missing element(s) in openAddFeedModal:', missing.join(', '));
        return;
    }
    addFeedForm.reset();
    addFeedIdInput.value = '';
    addFeedTitleInput.value = '';
    addFeedUrlInput.value = '';
    addFeedIntervalInput.value = '60';
    addFeedModal.style.display = 'block';
    addFeedPreviewSection.style.display = 'none';
    if (typeof populateAddFeedIntegrationsCheckboxes === 'function') {
        populateAddFeedIntegrationsCheckboxes();
    } else {
        console.error('populateAddFeedIntegrationsCheckboxes function is missing!');
    }
}

// --- Robust openEditFeedModal ---
function openEditFeedModal(feed) {
    const editFeedModal = document.getElementById('editFeedModal');
    const editFeedForm = document.getElementById('editFeedForm');
    const editFeedIdInput = document.getElementById('editFeedId');
    const editFeedTitleInput = document.getElementById('editFeedTitleInput');
    const editFeedUrlInput = document.getElementById('editFeedUrlInput');
    const editFeedIntervalInput = document.getElementById('editFeedIntervalInput');
    const editFeedPreviewSection = document.getElementById('editFeedPreviewSection');
    const feedKeywordRoutesSection = document.getElementById('feedKeywordRoutesSection');
    let missing = [];
    if (!editFeedModal) missing.push('editFeedModal');
    if (!editFeedForm) missing.push('editFeedForm');
    if (!editFeedIdInput) missing.push('editFeedId');
    if (!editFeedTitleInput) missing.push('editFeedTitleInput');
    if (!editFeedUrlInput) missing.push('editFeedUrlInput');
    if (!editFeedIntervalInput) missing.push('editFeedIntervalInput');
    if (!editFeedPreviewSection) missing.push('editFeedPreviewSection');
    if (!feedKeywordRoutesSection) missing.push('feedKeywordRoutesSection');
    if (missing.length > 0) {
        console.error('Missing element(s) in openEditFeedModal:', missing.join(', '));
        return;
    }

    // Populate the modal with existing data first
    editFeedIdInput.value = feed.id || '';
    editFeedTitleInput.value = feed.title || '';
    editFeedUrlInput.value = feed.url || '';
    editFeedIntervalInput.value = feed.interval || '';
    populateEditFeedIntegrationsCheckboxes(feed.associatedIntegrations || []);
    loadKeywordRoutes(feed.id);

    // Populate fields and preview, which will show "no data" states if empty
    populateEditFeedFieldsCheckboxes(feed.availableFields || [], feed.selectedFields || [], (feed.sampleItems && feed.sampleItems.length > 0) ? feed.sampleItems[0] : null);
    renderEditFeedPreview(feed);

    // If we have fields, display the sections. Otherwise, trigger detection.
    const fieldsCollapsibleContent = document.querySelector('#editFeedFieldsCheckboxes').closest('.collapsible-content');
    if (feed.availableFields && feed.availableFields.length > 0) {
        fieldsCollapsibleContent.style.display = 'block';
        fieldsCollapsibleContent.previousElementSibling.classList.add('active');
        document.getElementById('editFeedPreviewSection').style.display = 'block';
    } else {
        socket.emit('detect_feed_fields', { feedUrl: feed.url });
    }
    
    editFeedModal.style.display = 'block';
    feedKeywordRoutesSection.style.display = 'block';
}

function populateEditFeedFieldsCheckboxes(availableFields, selectedFields, sampleItem) {
    const editFeedFieldsCheckboxes = document.getElementById('editFeedFieldsCheckboxes');
    console.log('populateEditFeedFieldsCheckboxes availableFields:', availableFields, 'selectedFields:', selectedFields, 'sampleItem:', sampleItem);
    console.log('editFeedFieldsCheckboxes element:', editFeedFieldsCheckboxes);
    if (!editFeedFieldsCheckboxes) return;
    editFeedFieldsCheckboxes.innerHTML = '';
    if (!availableFields || availableFields.length === 0) {
        editFeedFieldsCheckboxes.innerHTML = '<p style="width: 100%; text-align: center; color: #a0aec0; padding: 10px 0;">No fields detected for this feed.</p>';
        return;
    }
    availableFields.forEach(fieldKey => {
        const checkboxDiv = document.createElement('div');
        checkboxDiv.classList.add('checkbox-item');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `edit-field-${fieldKey.replace(/\s+/g, '-')}`;
        checkbox.value = fieldKey;
        checkbox.checked = selectedFields && selectedFields.includes(fieldKey);
        
        // Add event listener to update preview on change
        checkbox.addEventListener('change', () => renderEditFeedPreview());

        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.textContent = fieldKey;
        checkboxDiv.appendChild(checkbox);
        checkboxDiv.appendChild(label);
        editFeedFieldsCheckboxes.appendChild(checkboxDiv);
    });
}

function populateEditFeedIntegrationsCheckboxes(associatedIntegrations) {
    const editFeedIntegrationsCheckboxes = document.getElementById('editFeedIntegrationsCheckboxes');
    console.log('populateEditFeedIntegrationsCheckboxes associatedIntegrations:', associatedIntegrations);
    console.log('globalIntegrationsCache:', globalIntegrationsCache);
    console.log('editFeedIntegrationsCheckboxes element:', editFeedIntegrationsCheckboxes);
    if (!editFeedIntegrationsCheckboxes) return;
    editFeedIntegrationsCheckboxes.innerHTML = '';
    if (!globalIntegrationsCache || globalIntegrationsCache.length === 0) {
        editFeedIntegrationsCheckboxes.innerHTML = '<p style="width: 100%; text-align: center; color: #a0aec0; padding: 10px 0;">No integrations configured. <a href="/integrations" style="color: #63b3ed; text-decoration: underline;">Add integrations here.</a></p>';
        return;
    }
    globalIntegrationsCache.forEach(integration => {
        const checkboxDiv = document.createElement('div');
        checkboxDiv.classList.add('checkbox-item');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `edit-integration-${integration.id}`;
        checkbox.value = integration.id;
        checkbox.checked = associatedIntegrations && associatedIntegrations.includes(integration.id);
        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.textContent = `${integration.name} (${integration.type})`;
        checkboxDiv.appendChild(checkbox);
        checkboxDiv.appendChild(label);
        editFeedIntegrationsCheckboxes.appendChild(checkboxDiv);
    });
}

function renderEditFeedPreview(feedObject) {
    const editFeedPreviewSection = document.getElementById('editFeedPreviewSection');
    if (!editFeedPreviewSection) return;

    let currentFeed = feedObject;
    if (!currentFeed) {
        const feedId = document.getElementById('editFeedId').value;
        currentFeed = globalFeedsCache.find(f => f.id === feedId);
    }
    
    const sampleItem = currentFeed && currentFeed.sampleItems && currentFeed.sampleItems.length > 0 ? currentFeed.sampleItems[0] : null;
    
    const selectedFields = Array.from(document.querySelectorAll('#editFeedFieldsCheckboxes input:checked')).map(cb => cb.value);
    const showAllPrefixes = document.getElementById('editFeedShowAllPrefixesInput').checked;
    const feedTitle = document.getElementById('editFeedTitleInput').value;

    const discordPreviewAuthor = editFeedPreviewSection.querySelector('.discord-embed-author');
    const discordPreviewTitle = editFeedPreviewSection.querySelector('.discord-embed-title');
    const discordPreviewDescription = editFeedPreviewSection.querySelector('.discord-embed-description');
    const telegramPreviewContent = editFeedPreviewSection.querySelector('.telegram-message-content');

    if (!sampleItem) {
        discordPreviewAuthor.textContent = 'No sample data for preview.';
        discordPreviewTitle.innerHTML = '';
        discordPreviewDescription.innerHTML = '';
        telegramPreviewContent.textContent = 'No sample data for preview.';
        editFeedPreviewSection.style.display = 'block';
        return;
    }

    // Discord Preview
    discordPreviewAuthor.textContent = feedTitle;
    let discordItemTitleText = selectedFields.includes('title') ? (sampleItem.title || 'New RSS Item') : '';
    let discordItemLink = selectedFields.includes('link') ? sampleItem.link : '';

    if (discordItemTitleText && discordItemLink) {
        discordPreviewTitle.innerHTML = `<a href="${discordItemLink}" target="_blank">${discordItemTitleText}</a>`;
    } else {
        discordPreviewTitle.textContent = discordItemTitleText;
    }

    let discordDesc = '';
    selectedFields.forEach(fieldKey => {
        if (fieldKey === 'title' || fieldKey === 'link') return;
        const value = sampleItem[fieldKey] || '';
        if (value) {
            // Use the _text version if it exists and is selected, for a cleaner preview
            const textVersion = sampleItem[`${fieldKey}_text`];
            const displayValue = textVersion || value;

            if (showAllPrefixes) {
                discordDesc += `**${fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1)}:** ${String(displayValue).substring(0, 100)}\n`;
            } else {
                discordDesc += `${String(displayValue).substring(0, 1000)}\n`;
            }
        }
    });
    discordPreviewDescription.innerHTML = discordDesc.trim().replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

    // Telegram Preview
    let telegramMsg = `*${feedTitle}*\n`;
    let telegramItemTitleText = selectedFields.includes('title') ? (sampleItem.title || 'New RSS Item') : '';
    let telegramItemLink = selectedFields.includes('link') ? sampleItem.link : '';

    if (telegramItemTitleText && telegramItemLink) {
        telegramMsg += `[${telegramItemTitleText}](${telegramItemLink})\n\n`;
    } else if (telegramItemTitleText) {
        telegramMsg += `${telegramItemTitleText}\n\n`;
    }

    selectedFields.forEach(fieldKey => {
        if (fieldKey === 'title' || fieldKey === 'link') return;
        const value = sampleItem[fieldKey] || '';
        if (value) {
            const textVersion = sampleItem[`${fieldKey}_text`];
            const displayValue = textVersion || value;
            if (showAllPrefixes) {
                telegramMsg += `*${fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1)}:* ${String(displayValue).substring(0, 100)}\n`;
            } else {
                telegramMsg += `${String(displayValue).substring(0, 1000)}\n`;
            }
        }
    });
    telegramPreviewContent.textContent = telegramMsg.trim();

    editFeedPreviewSection.style.display = 'block';
}

// ... [rest of the file content from the previous turn] ... 