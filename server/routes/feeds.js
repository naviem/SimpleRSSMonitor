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
router.get('/:feedId/details', async (req, res) => {
    try {
        const feedDetails = await rssService.getFeedDetails(req.params.feedId);
        if (feedDetails) {
            res.json(feedDetails);
        } else {
            res.status(404).json({ error: 'Feed not found' });
        }
    } catch (error) {
        console.error(`Error getting feed details for ${req.params.feedId}:`, error);
        res.status(500).json({ error: 'Failed to get feed details' });
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

// Manually trigger a feed scan
router.post('/:feedId/scan', async (req, res) => {
    try {
        const feedId = req.params.feedId;
        const result = await rssService.scanFeedNow(feedId);
        if (result.success) {
            res.json({ message: result.message });
        } else {
            res.status(404).json({ error: result.message });
        }
    } catch (error) {
        console.error('Error in scan route:', error);
        res.status(500).json({ error: 'Failed to trigger scan.' });
    }
});

module.exports = router; 