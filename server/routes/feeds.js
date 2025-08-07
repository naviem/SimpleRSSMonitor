const express = require('express');
const router = express.Router();
const rssService = require('../services/rssService');

// Placeholder for potential future HTTP routes related to feeds.
// For now, most feed management is handled via WebSockets.

// Example: Get all feeds (could be useful for non-WebSocket clients or initial data loading)
router.get('/', (req, res) => {
    // Access feeds from global scope, or preferably from a service
    res.json(global.feeds || []); 
});

// Get full details for a single feed (for editing)
router.get('/:id/details', async (req, res) => {
    try {
        const feed = await rssService.getFeedDetails(req.params.id);
        if (feed) {
            res.json(feed);
        } else {
            res.status(404).json({ error: 'Feed not found' });
        }
    } catch (error) {
        console.error(`Error getting feed details for ${req.params.id}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Update feed pause state
router.post('/:id/pause', async (req, res) => {
    try {
        const { id } = req.params;
        const { paused } = req.body;
        
        if (typeof paused !== 'boolean') {
            return res.status(400).json({ error: 'Paused state must be a boolean' });
        }

        const success = await rssService.updateFeedPauseState(id, paused);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Feed not found' });
        }
    } catch (error) {
        console.error(`Error updating feed pause state for ${req.params.id}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Trigger manual scan for a feed
router.post('/:id/scan', async (req, res) => {
    try {
        const { id } = req.params;
        const feed = await rssService.getFeedDetails(id);
        
        if (!feed) {
            return res.status(404).json({ error: 'Feed not found' });
        }

        // Trigger the scan
        await rssService.fetchAndProcessFeed(feed, req.app.get('io'));
        res.json({ success: true, message: 'Feed scan triggered successfully' });
    } catch (error) {
        console.error(`Error triggering scan for feed ${req.params.id}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Add a new feed
router.post('/', async (req, res) => {
    try {
        // ... existing code ...
    } catch (error) {
        // ... existing code ...
    }
});

module.exports = router; 