// This file can be used for general non-API routes or to combine other routers.
const express = require('express');
const router = express.Router();
const path = require('path');

// Serve index.html for the root path
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
});

// Serve integrations.html for the /integrations path
router.get('/integrations', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'integrations.html'));
});

module.exports = router; 