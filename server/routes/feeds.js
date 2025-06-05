const express = require('express');
const router = express.Router();

// Placeholder for potential future HTTP routes related to feeds.
// For now, most feed management is handled via WebSockets.

// Example: Get all feeds (could be useful for non-WebSocket clients or initial data loading)
router.get('/', (req, res) => {
    // Access feeds from global scope, or preferably from a service
    res.json(global.feeds || []); 
});

module.exports = router; 