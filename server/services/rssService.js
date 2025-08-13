const Parser = require('rss-parser');
const parser = new Parser();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getFieldValue, notifyIntegrationsForFeed } = require('./notificationService');
const { db } = require('./databaseService');
const { convert } = require('html-to-text');
const keywordRouteService = require('./keywordRouteService');
const statsService = require('./statsService');

// Store for setTimeout IDs, so we can clear them if a feed is updated or deleted
const feedTimers = {}; 

// --- Identifier normalization helpers ---
function decodeHtmlEntities(text) {
	if (!text || typeof text !== 'string') return text;
	return text
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

function normalizeUrl(urlString) {
	try {
		const decoded = decodeHtmlEntities(urlString).trim();
		const u = new URL(decoded);
		u.host = u.host.toLowerCase();
		// Remove common tracking params and sort remaining for stability
		const params = new URLSearchParams(u.search);
		const tracking = new Set(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','mc_cid','mc_eid','ref']);
		for (const key of Array.from(params.keys())) {
			if (tracking.has(key)) params.delete(key);
		}
		// Sort params
		const entries = Array.from(params.entries()).sort(([a],[b]) => a.localeCompare(b));
		const sorted = new URLSearchParams(entries);
		u.search = sorted.toString() ? `?${sorted.toString()}` : '';
		// Normalize trailing slash (keep only if path is just '/')
		if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
			u.pathname = u.pathname.replace(/\/+$/, '');
		}
		return u.toString();
	} catch (e) {
		return urlString;
	}
}

function getStableItemIdentifier(item) {
	// Prefer Atom/RSS id, else normalized link, else hash of title+date
	if (item && typeof item.id === 'string' && item.id.trim()) {
		return normalizeUrl(item.id);
	}
	if (item && typeof item.link === 'string' && item.link.trim()) {
		return normalizeUrl(item.link);
	}
	const basis = `${item && item.title ? String(item.title) : ''}|${item && (item.isoDate || item.pubDate) ? String(item.isoDate || item.pubDate) : ''}`;
	return crypto.createHash('sha1').update(basis).digest('hex');
}

async function fetchAndProcessFeed(feed, io, isInitialFetch = false) {
    const startTime = Date.now();
    let feedObject;
    let dbUpdateData = {};

    try {
        // Respect paused state
        if (feed.paused) {
            const scanTime = new Date().toLocaleTimeString();
            console.log(`[${scanTime}] ${feed.title} is paused. Skipping fetch.`);
            return;
        }
        // Get the feed content and calculate bytes
        const response = await fetch(feed.url);
        const feedContent = await response.text();
        const bytesTransferred = new TextEncoder().encode(feedContent).length;
        
        feedObject = await parser.parseString(feedContent);

        // Process ALL items first using the processFeedItem function
        const processedItems = feedObject.items.map(item => processFeedItem(item, feed.id));
        const sampleProcessedItems = processedItems.slice(0, 5);

        feed.status = 'ok';
        feed.statusDetails = `Successfully fetched ${processedItems.length} items.`;
        feed.lastChecked = new Date().toISOString();

        dbUpdateData = {
            status: feed.status,
            statusDetails: feed.statusDetails,
            lastChecked: feed.lastChecked,
            sampleItems: JSON.stringify(sampleProcessedItems)
        };

        // Update availableFields based on processed items if not already populated or if forced
        // For simplicity, let's always try to update/derive from the latest processed sample
        if (sampleProcessedItems.length > 0) {
            const firstProcessedSample = sampleProcessedItems[0];
            const currentAvailableFields = Object.keys(firstProcessedSample);
            
            // Merge with existing to ensure no fields are lost, and new ones are added
            const updatedAvailableFields = [...new Set([...(feed.availableFields || []), ...currentAvailableFields])];
            
            if (JSON.stringify(feed.availableFields) !== JSON.stringify(updatedAvailableFields)) {
                feed.availableFields = updatedAvailableFields;
                dbUpdateData.availableFields = JSON.stringify(feed.availableFields);
            }

            // If selectedFields are empty or not set, default them based on new availableFields
            if (!feed.selectedFields || feed.selectedFields.length === 0) {
                feed.selectedFields = [...feed.availableFields]; 
                dbUpdateData.selectedFields = JSON.stringify(feed.selectedFields);
            }
        }

        let newItemsFound = 0;
        // Sort processed items newest first for consistent history and initial fetch logic
        const itemsToProcessForHistory = processedItems.sort((a, b) => 
            new Date(b.isoDate || b.pubDate || 0) - new Date(a.isoDate || a.pubDate || 0)
        ); // Sort newest first

        const originalHistoryLength = feed.history.length;

        // Get keyword routes for this feed
        const keywordRoutes = await keywordRouteService.getRoutesForFeed(feed.id);

        if (isInitialFetch) {
            console.log(`Initial fetch for ${feed.title}. Processing up to 2 newest items for notification.`);

            const existingIds = new Set(feed.history || []);

            // Notify up to 2 newest items that are not already in history
            const newestTwoItems = itemsToProcessForHistory.slice(0, 2);
            let notificationsSent = 0;
            for (const item of newestTwoItems) {
                if (notificationsSent >= 2) break;
                const stableId = getStableItemIdentifier(item);
                if (!existingIds.has(stableId)) {
                    // Create content string for keyword matching
                    const content = [
                        item.title,
                        item.content,
                        item.description,
                        item.summary
                    ].filter(Boolean).join(' ');

                    const matchingIntegrationIds = keywordRouteService.matchKeywords(content, keywordRoutes);
                    const targetIntegrationIds = matchingIntegrationIds.length > 0 
                        ? matchingIntegrationIds 
                        : feed.associatedIntegrations;

                    const originalIntegrations = feed.associatedIntegrations;
                    feed.associatedIntegrations = targetIntegrationIds;
                    notifyIntegrationsForFeed(feed, item);
                    feed.associatedIntegrations = originalIntegrations;

                    feed.history.push(stableId);
                    existingIds.add(stableId);
                    newItemsFound++;
                    notificationsSent++;

                    if (io && io.emit) {
                        io.emit('new_feed_item', { 
                            feedId: feed.id,
                            feedTitle: feed.title,
                            item: { title: item.title, link: item.link, guid: item.guid }
                        });
                    }
                }
            }

            // Add the rest silently to history to prevent future notifications
            for (const item of itemsToProcessForHistory) {
                const stableId = getStableItemIdentifier(item);
                if (!existingIds.has(stableId)) {
                    feed.history.push(stableId);
                    existingIds.add(stableId);
                }
            }

            if (feed.history.length > 200) { // Cap history
                feed.history.splice(0, feed.history.length - 200);
            }
        } else {
            // Regular check: process items oldest first from the original processedItems array for sequential notification
            // itemsToProcess (original order, but processed) for notifying oldest first
            const itemsInOriginalOrderButProcessed = feedObject.items.map(item => processFeedItem(item, feed.id));
            for (const item of itemsInOriginalOrderButProcessed.reverse()) { // item here is already processed
                const itemIdentifier = getStableItemIdentifier(item);
                if (!itemIdentifier) {
                    console.warn(`Item in feed ${feed.title} lacks guid, link, or title. Skipping.`);
                    continue;
                }

                if (!feed.history.includes(itemIdentifier)) {
                    console.log(`New item found in ${feed.title}: ${item.title}`);
                    newItemsFound++;
                    feed.history.push(itemIdentifier);
                    if (feed.history.length > 200) {
                        feed.history.shift(); 
                    }

                    // Create content string for keyword matching
                    const content = [
                        item.title,
                        item.content,
                        item.description,
                        item.summary
                    ].filter(Boolean).join(' ');

                    // Get matching integration IDs
                    const matchingIntegrationIds = keywordRouteService.matchKeywords(content, keywordRoutes);
                    
                    // Use matching integrations or fall back to default
                    const targetIntegrationIds = matchingIntegrationIds.length > 0 
                        ? matchingIntegrationIds 
                        : feed.associatedIntegrations;

                    // Update feed's associated integrations temporarily for this notification
                    const originalIntegrations = feed.associatedIntegrations;
                    feed.associatedIntegrations = targetIntegrationIds;

                    notifyIntegrationsForFeed(feed, item);
                    
                    // Restore original integrations
                    feed.associatedIntegrations = originalIntegrations;

                    if (io && io.emit) {
                        io.emit('new_feed_item', { 
                            feedId: feed.id,
                            feedTitle: feed.title,
                            item: { title: item.title, link: item.link, guid: item.guid }
                        });
                    }
                }
            }
        }

        if (feed.history.length !== originalHistoryLength) {
            dbUpdateData.history = JSON.stringify(feed.history);
        }

        // Record statistics - now tracking feed scans instead of items
        const endTime = Date.now();
        const scanTime = new Date().toLocaleTimeString();
        
        // Log scan results in a clean format
        if (newItemsFound > 0) {
            console.log(`[${scanTime}] ${feed.title}: ${newItemsFound} new item(s) found and sent to integrations`);
        } else {
            console.log(`[${scanTime}] ${feed.title}: No new items found`);
        }
        
        await statsService.recordFeedStats(feed.id, {
            itemsProcessed: 1, // Changed from processedItems.length to 1 to count scans
            bytesTransferred: bytesTransferred,
            processingTimeMs: endTime - startTime
        });

    } catch (error) {
        console.error(`Error fetching or processing feed ${feed.url}:`, error.message);
        feed.status = 'error';
        feed.statusDetails = `Error: ${error.message.substring(0, 100)}`;
        feed.lastChecked = new Date().toISOString();
        dbUpdateData = {
            status: feed.status,
            statusDetails: feed.statusDetails,
            lastChecked: feed.lastChecked,
        };
    }

    // Update feed status for all clients
    const feedIndex = global.feeds.findIndex(f => f.id === feed.id);
    if (feedIndex !== -1) {
        global.feeds[feedIndex] = { ...global.feeds[feedIndex], ...feed, ...dbUpdateData };
        if (dbUpdateData.history) global.feeds[feedIndex].history = JSON.parse(dbUpdateData.history);
        if (dbUpdateData.selectedFields) global.feeds[feedIndex].selectedFields = JSON.parse(dbUpdateData.selectedFields);
        if (dbUpdateData.availableFields) global.feeds[feedIndex].availableFields = JSON.parse(dbUpdateData.availableFields);
        if (dbUpdateData.sampleItems) global.feeds[feedIndex].sampleItems = JSON.parse(dbUpdateData.sampleItems);
    } else {
        console.warn(`Feed ${feed.id} not found in global.feeds during fetchAndProcessFeed update.`);
        stopFeedCheck(feed.id);
        return;
    }

    // Persist changes to DB
    if (Object.keys(dbUpdateData).length > 0) {
        try {
            await db('feeds').where({ id: feed.id }).update({...dbUpdateData, updated_at: db.fn.now()});
            console.log(`Updated feed ${feed.title} in DB.`);
        } catch (dbError) {
            console.error(`Error updating feed ${feed.id} in database:`, dbError);
        }
    }

    // Broadcast feed updates to clients
    if (io) {
        const { parseJsonFields: parseForClient } = require('./databaseService');
        const feedsForClient = global.feeds.map(f => parseForClient(f, ['history', 'selectedFields', 'availableFields', 'sampleItems']));
        io.emit('update_feeds', feedsForClient);
    }

    // Reschedule next check only if the feed still exists (hasn't been deleted)
    if (global.feeds.find(f => f.id === feed.id)) {
        // Pass false for isInitialFetch for subsequent scheduled checks
        scheduleFeedCheck(feed, io, false); 
    } else {
        console.log(`Feed ${feed.title} (${feed.id}) no longer exists. Not rescheduling.`);
        stopFeedCheck(feed.id); // Ensure timer is cleared if somehow active
    }
}

function scheduleFeedCheck(feed, io, isInitialFetch = false) {
    // Clear any existing timer for this feed to prevent duplicates if interval is updated
    if (feedTimers[feed.id]) {
        clearTimeout(feedTimers[feed.id]);
    }

    // Don't schedule if feed is paused
    if (feed.paused) {
        console.log(`Feed ${feed.title} is paused. Not scheduling next check.`);
        return;
    }

    const intervalMilliseconds = (feed.interval || 60) * 60 * 1000;
    console.log(`Scheduling next check for ${feed.title} in ${feed.interval} minutes.`);
    
    feedTimers[feed.id] = setTimeout(() => {
        // Ensure feed still exists in global array before fetching
        const currentFeed = global.feeds.find(f => f.id === feed.id);
        if (currentFeed) {
            if (currentFeed.paused) {
                const scanTime = new Date().toLocaleTimeString();
                console.log(`[${scanTime}] ${currentFeed.title} is paused. Skipping scheduled fetch.`);
                return;
            }
            // Pass false for isInitialFetch for subsequent scheduled checks
            fetchAndProcessFeed(currentFeed, io, false);
        }
    }, intervalMilliseconds);
}

function stopFeedCheck(feedId) {
    if (feedTimers[feedId]) {
        clearTimeout(feedTimers[feedId]);
        delete feedTimers[feedId];
        console.log(`Stopped scheduled checks for feed ID: ${feedId}`);
    }
}

// Initialize scheduler for existing feeds that might be loaded from persistence (not applicable here yet)
function startRssScheduler(io) {
    if (global.feeds && global.feeds.length > 0) {
        global.feeds.forEach(feed => {
            if (feed.paused) {
                const scanTime = new Date().toLocaleTimeString();
                console.log(`[${scanTime}] ${feed.title} is paused. Not starting initial fetch.`);
                return;
            }
            const initialDelay = Math.random() * 5000 + 2000; // 2-7 seconds delay
            const treatAsInitial = !feed.history || feed.history.length === 0;
            setTimeout(() => fetchAndProcessFeed(feed, io, treatAsInitial), initialDelay);
        });
    }
}

// Functions to be called by socketService or other parts of the app
function manageFeedScheduling(feed, io, action = 'schedule') {
    if (action === 'schedule') {
        scheduleFeedCheck(feed, io, false); // Subsequent checks are not initial
    } else if (action === 'unschedule') {
        stopFeedCheck(feed.id);
    } else if (action === 'initial_fetch') {
        if (feed.paused) {
            const scanTime = new Date().toLocaleTimeString();
            console.log(`[${scanTime}] ${feed.title} is paused. Skipping initial fetch.`);
            return;
        }
        setTimeout(() => fetchAndProcessFeed(feed, io, true), 1000); // Pass true for isInitialFetch
    }
}

// Enhanced processFeedItem to include HTML to text conversion
function processFeedItem(item, feedId) {
    const processedItem = {
        id: getFieldValue(item, 'guid') || getFieldValue(item, 'id') || uuidv4(),
        feedId: feedId,
        ...item // Spread the original item fields
    };

    // List of fields that might contain HTML and should be converted
    const potentialHtmlFields = ['summary', 'content', 'content:encoded', 'description'];

    for (const fieldName of potentialHtmlFields) {
        const htmlContent = getFieldValue(item, fieldName);
        if (htmlContent && typeof htmlContent === 'string' && htmlContent.includes('<') && htmlContent.includes('>')) {
            try {
                const textContent = convert(htmlContent, {
                    wordwrap: false, // Disable wordwrap for more predictable output in notifications
                    selectors: [
                        { selector: 'img', format: 'skip' }, // Skip images
                        { selector: 'a', options: { ignoreHref: true } } // Skip links, keep text
                    ]
                });
                processedItem[`${fieldName}_text`] = textContent.trim();
            } catch (err) {
                console.error(`Error converting HTML to text for field ${fieldName} in feed ${feedId}:`, err);
                processedItem[`${fieldName}_text`] = '[Error converting HTML to text]';
            }
        }
    }
    return processedItem;
}

async function getFeedDetails(feedId) {
    const { parseJsonFields, feedJsonFields } = require('./databaseService');
    const feed = await db('feeds').where({ id: feedId }).first();
    if (!feed) {
        return null;
    }
    // The 'parseJsonFields' function needs the object and the list of fields to parse.
    return parseJsonFields(feed, feedJsonFields);
}

async function updateFeedPauseState(feedId, paused) {
    try {
        // Update in database
        await db('feeds').where({ id: feedId }).update({
            paused: paused,
            updated_at: db.fn.now()
        });

        // Update in memory
        const feedIndex = global.feeds.findIndex(f => f.id === feedId);
        if (feedIndex === -1) {
            return false;
        }

        global.feeds[feedIndex].paused = paused;

        // If pausing, clear the timer
        if (paused && feedTimers[feedId]) {
            clearTimeout(feedTimers[feedId]);
            delete feedTimers[feedId];
        }
        // If unpausing, reschedule the feed
        else if (!paused && !feedTimers[feedId]) {
            scheduleFeedCheck(global.feeds[feedIndex], global.io, false);
        }

        return true;
    } catch (error) {
        console.error(`Error updating feed pause state for ${feedId}:`, error);
        throw error;
    }
}

module.exports = {
    fetchAndProcessFeed,
    scheduleFeedCheck,
    stopFeedCheck,
    startRssScheduler,
    manageFeedScheduling,
    processFeedItem,
    getFeedDetails,
    updateFeedPauseState
}; 