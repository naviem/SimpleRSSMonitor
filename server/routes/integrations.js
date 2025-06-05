const express = require('express');
const router = express.Router();

// Placeholder for potential future HTTP routes related to integrations.
// For now, most integration management is handled via WebSockets.

// Example: Get all integrations
router.get('/', (req, res) => {
    // Access integrations from global scope, or preferably from a service
    res.json(global.integrations || []);
});

module.exports = router; 