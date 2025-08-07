const rssParser = require('rss-parser');
const parser = new rssParser();
const crypto = require('crypto');
const { manageFeedScheduling } = require('./rssService');
const { db, parseJsonFields } = require('./databaseService'); // Import db and parser

// These would ideally be in a database or a more robust in-memory store
// For now, using the globals defined in app.js, accessed via 'global'
// let feeds = global.feeds; 
// let integrations = global.integrations;


// Helper to broadcast updates
function broadcastFeeds(io) {
    // Ensure fields that are stored as JSON are parsed before sending to client
    const feedsForClient = global.feeds.map(feed => 
        parseJsonFields(feed, ['history', 'selectedFields', 'availableFields', 'sampleItems'])
    );
    io.emit('update_feeds', feedsForClient);
}

function broadcastIntegrations(io) {
    io.emit('update_integrations', global.integrations);
}

// Helper to find common fields from a sample of RSS items
async function getCommonFieldsFromFeed(feedUrl) {
    try {
        const feed = await parser.parseURL(feedUrl);
        if (!feed.items || feed.items.length === 0) {
            return ['title', 'link', 'pubDate', 'contentSnippet'];
        }
        const sampleItem = feed.items[0];
        const allKeys = new Set(Object.keys(sampleItem));
        const defaultFields = ['title', 'link', 'pubDate', 'content', 'contentSnippet', 'isoDate', 'guid', 'creator', 'author'];
        defaultFields.forEach(df => allKeys.add(df));
        return Array.from(allKeys).filter(key => {
            const value = sampleItem[key];
            return typeof value !== 'object' && !key.includes(':') && !key.startsWith('media:') && key !== '$';
        });
    } catch (error) {
        console.error(`Error parsing feed for field detection ${feedUrl}:`, error.message);
        return ['title', 'link', 'pubDate', 'contentSnippet'];
    }
}


function initializeSocketEvents(io) {
    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id}`);
        // Send initial data (already parsed from app.js loading)
        socket.emit('init_data', { feeds: global.feeds, integrations: global.integrations });

        // --- Feed Handlers ---
        socket.on('add_feed', async (feedData) => {
            console.log('add_feed received:', feedData);
            let detectedFields = [];
            try {
                detectedFields = await getCommonFieldsFromFeed(feedData.url);
            } catch (e) {
                console.error("Error detecting fields for new feed:", e);
            }

            const newFeed = {
                id: crypto.randomBytes(8).toString('hex'),
                title: feedData.title,
                url: feedData.url,
                interval: parseInt(feedData.interval, 10) || 60,
                selectedFields: feedData.selectedFields && feedData.selectedFields.length > 0 
                                ? feedData.selectedFields 
                                : (detectedFields.length > 0 ? detectedFields : ['title', 'link']),
                status: 'pending',
                statusDetails: 'Scheduled for first check',
                lastChecked: null,
                history: [], 
                availableFields: detectedFields,
                associatedIntegrations: feedData.associatedIntegrations || [],
                // createdAt and updatedAt will be handled by DB
            };

            try {
                await db('feeds').insert({
                    ...newFeed,
                    history: JSON.stringify(newFeed.history),
                    selectedFields: JSON.stringify(newFeed.selectedFields),
                    availableFields: JSON.stringify(newFeed.availableFields),
                    associatedIntegrations: JSON.stringify(newFeed.associatedIntegrations),
                });
                global.feeds.push(newFeed); // Add to global array after successful insert
                broadcastFeeds(io);
                manageFeedScheduling(newFeed, io, 'initial_fetch');
            } catch (error) {
                console.error('Error adding feed to database:', error);
                socket.emit('operation_error', { message: 'Failed to add feed. URL might already exist or DB error.' });
            }
        });

        socket.on('update_feed', async (feedData) => {
            // console.log('update_feed received:', feedData);
            console.log('Received update_feed event.');
            console.log('feedData received:', JSON.stringify(feedData, null, 2));
            console.log('feedData.showAllPrefixes before any processing:', feedData.showAllPrefixes, 'Type:', typeof feedData.showAllPrefixes);

            const feedId = feedData.id;
            const currentFeedIndex = global.feeds.findIndex(f => f.id === feedId);
            if (currentFeedIndex === -1) {
                console.error('Feed to update not found in global list:', feedId);
                socket.emit('operation_error', { message: 'Failed to update feed: Not found.' });
                return;
            }
            const oldFeed = global.feeds[currentFeedIndex];

            let newAvailableFields = oldFeed.availableFields;
            let newSelectedFields = feedData.selectedFields;

            if (feedData.url !== oldFeed.url) {
                try {
                    newAvailableFields = await getCommonFieldsFromFeed(feedData.url);
                    if (!feedData.selectedFields || feedData.selectedFields.length === 0) {
                        newSelectedFields = [...newAvailableFields];
                    }
                } catch(e) {
                    console.error("Error re-detecting fields for updated feed:", e);
                    newAvailableFields = oldFeed.availableFields || ['title', 'link', 'pubDate', 'contentSnippet'];
                    if (!feedData.selectedFields || feedData.selectedFields.length === 0){
                         newSelectedFields = newAvailableFields;
                    }
                }
            }
            
            const updatedFeedData = {
                title: feedData.title,
                url: feedData.url,
                interval: parseInt(feedData.interval, 10) || oldFeed.interval,
                selectedFields: JSON.stringify(newSelectedFields),
                availableFields: JSON.stringify(newAvailableFields),
                associatedIntegrations: JSON.stringify(feedData.associatedIntegrations || []),
                showAllPrefixes: !!feedData.showAllPrefixes, // Ensure boolean for DB
                // status and statusDetails are typically updated by rssService, not directly by user
                updated_at: db.fn.now() // Knex function for current timestamp
            };
            const loggableUpdatedFeedData = { ...updatedFeedData };
            if (loggableUpdatedFeedData.updated_at && typeof loggableUpdatedFeedData.updated_at === 'object') {
                loggableUpdatedFeedData.updated_at = '[Knex db.fn.now()]'; // Placeholder for logging
            }
            console.log('updatedFeedData for DB:', JSON.stringify(loggableUpdatedFeedData, null, 2));
            console.log('updatedFeedData.showAllPrefixes for DB:', updatedFeedData.showAllPrefixes, 'Type:', typeof updatedFeedData.showAllPrefixes);

            try {
                await db('feeds').where({ id: feedId }).update(updatedFeedData);
                console.log('DB update successful for feed:', feedId);
                console.log('Value of showAllPrefixes written to DB was:', updatedFeedData.showAllPrefixes);

                // Fetch the updated record from DB to confirm
                const updatedFeedFromDb = await db('feeds').where({ id: feedId }).first();
                if (updatedFeedFromDb) {
                    // The value from DB will be 0 or 1 for boolean, need to parse
                    const showAllPrefixesFromDb = updatedFeedFromDb.showAllPrefixes === 1 || updatedFeedFromDb.showAllPrefixes === true;
                    console.log('Fetched record from DB. Raw showAllPrefixes from DB:', updatedFeedFromDb.showAllPrefixes, 'Type:', typeof updatedFeedFromDb.showAllPrefixes);
                    console.log('Parsed showAllPrefixes from DB:', showAllPrefixesFromDb, 'Type:', typeof showAllPrefixesFromDb);
                } else {
                    console.log('Could not fetch updated record from DB to confirm.');
                }

                // Update global array
                const updatedInMemoryFeed = {
                    ...oldFeed, // Preserve history, lastChecked, status, statusDetails
                    title: feedData.title,
                    url: feedData.url,
                    interval: parseInt(feedData.interval, 10) || oldFeed.interval,
                    selectedFields: newSelectedFields, // Use parsed version
                    availableFields: newAvailableFields, // Use parsed version
                    associatedIntegrations: feedData.associatedIntegrations || [],
                    showAllPrefixes: !!feedData.showAllPrefixes, // Ensure boolean for in-memory
                    updated_at: new Date().toISOString() // Reflect update time
                };
                global.feeds[currentFeedIndex] = updatedInMemoryFeed;
                console.log('In-memory feed updated. global.feeds[currentFeedIndex].showAllPrefixes:', global.feeds[currentFeedIndex].showAllPrefixes, 'Type:', typeof global.feeds[currentFeedIndex].showAllPrefixes);
                
                // Prepare data for client (parseJsonFields should handle boolean conversion if needed)
                const feedsForClient = global.feeds.map(feed => 
                    parseJsonFields(feed, ['history', 'selectedFields', 'availableFields', 'sampleItems', 'showAllPrefixes'])
                );
                const updatedFeedForClient = feedsForClient.find(f => f.id === feedId);
                 if (updatedFeedForClient) {
                    console.log('Parsed feed for client. updatedFeedForClient.showAllPrefixes:', updatedFeedForClient.showAllPrefixes, 'Type:', typeof updatedFeedForClient.showAllPrefixes);
                }

                // broadcastFeeds(io); // This calls parseJsonFields internally
                 io.emit('update_feeds', feedsForClient); // Emit the already parsed feeds

                if (feedData.interval !== oldFeed.interval) {
                    manageFeedScheduling(global.feeds[currentFeedIndex], io, 'schedule');
                }
            } catch (error) {
                console.error('Error updating feed in database:', error);
                socket.emit('operation_error', { message: 'Failed to update feed in database.' });
            }
        });

        socket.on('delete_feed', async ({ id }) => {
            console.log('delete_feed received:', id);
            try {
                const feedToDelete = global.feeds.find(f => f.id === id);
                if (feedToDelete) {
                    manageFeedScheduling(feedToDelete, io, 'unschedule');
                }
                await db('feeds').where({ id }).del();
                global.feeds = global.feeds.filter(f => f.id !== id);
                broadcastFeeds(io);
            } catch (error) {
                console.error('Error deleting feed from database:', error);
                socket.emit('operation_error', { message: 'Failed to delete feed from database.' });
            }
        });

        socket.on('update_feed_pause_state', async ({ id, paused }) => {
            console.log('update_feed_pause_state received:', { id, paused });
            try {
                const { updateFeedPauseState } = require('./rssService');
                const success = await updateFeedPauseState(id, paused);
                if (success) {
                    // Broadcast the updated feeds to all clients
                    broadcastFeeds(io);
                } else {
                    socket.emit('operation_error', { message: 'Failed to update feed pause state: Feed not found.' });
                }
            } catch (error) {
                console.error('Error updating feed pause state:', error);
                socket.emit('operation_error', { message: 'Failed to update feed pause state.' });
            }
        });

        socket.on('detect_feed_fields', async ({ feedUrl }) => {
            console.log('detect_feed_fields received for:', feedUrl);
            try {
                const { processFeedItem } = require('./rssService'); // Import processor
                const feed = await parser.parseURL(feedUrl);
                if (!feed.items || feed.items.length === 0) {
                    throw new Error('No items found in feed.');
                }
                
                // Process the first item to get all fields, including generated ones
                const processedSampleItem = processFeedItem(feed.items[0], null); // feedId is not needed for detection
                const fields = Object.keys(processedSampleItem);

                socket.emit('feed_fields_detected', { feedUrl, fields, sampleItem: processedSampleItem });
            } catch (error) {
                console.error('Error in detect_feed_fields event handler:', error);
                socket.emit('feed_fields_detected', { feedUrl, fields: [], error: 'Failed to detect fields.' });
            }
        });

        // --- Integration Handlers ---
        socket.on('add_integration', async (integrationData) => {
            console.log('add_integration received:', integrationData);
            const newIntegration = {
                id: crypto.randomBytes(8).toString('hex'),
                name: integrationData.name,
                type: integrationData.type,
                webhookUrl: integrationData.webhookUrl || null,
                token: integrationData.token || null,
                chatId: integrationData.chatId || null,
            };
            try {
                await db('integrations').insert(newIntegration);
                global.integrations.push(newIntegration);
                broadcastIntegrations(io);
            } catch (error) {
                console.error('Error adding integration to database:', error);
                socket.emit('operation_error', { message: 'Failed to add integration.' });
            }
        });

        socket.on('update_integration', async (integrationData) => {
            console.log('update_integration received:', integrationData);
            const integrationId = integrationData.id;
             const updatedData = {
                name: integrationData.name,
                type: integrationData.type,
                webhookUrl: integrationData.webhookUrl || null,
                token: integrationData.token || null,
                chatId: integrationData.chatId || null,
                updated_at: db.fn.now()
            };
            try {
                await db('integrations').where({ id: integrationId }).update(updatedData);
                const index = global.integrations.findIndex(i => i.id === integrationId);
                if (index !== -1) {
                    const updatedInMemory = { ...global.integrations[index], ...updatedData }; 
                    delete updatedInMemory.updated_at;
                    updatedInMemory.updatedAt = new Date().toISOString();
                    global.integrations[index] = updatedInMemory;
                }
                broadcastIntegrations(io);
            } catch (error) {
                console.error('Error updating integration in database:', error);
                socket.emit('operation_error', { message: 'Failed to update integration.' });
            }
        });

        socket.on('delete_integration', async ({ id }) => {
            console.log('delete_integration received:', id);
            try {
                await db('integrations').where({ id }).del();
                global.integrations = global.integrations.filter(i => i.id !== id);
                broadcastIntegrations(io);
            } catch (error) {
                console.error('Error deleting integration from database:', error);
                socket.emit('operation_error', { message: 'Failed to delete integration.' });
            }
        });

        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id}`);
        });
    });
}

module.exports = { initializeSocketEvents, broadcastFeeds, broadcastIntegrations }; 