const express = require('express');
const router = express.Router();
const keywordRouteService = require('../services/keywordRouteService');

// Create a new keyword route
router.post('/', async (req, res) => {
    try {
        const { feedId, keyword, integrationId, isRegex, caseSensitive } = req.body;
        
        // Validate regex if needed
        if (isRegex && !keywordRouteService.validateRegex(keyword)) {
            return res.status(400).json({ error: 'Invalid regular expression pattern' });
        }

        const route = await keywordRouteService.createRoute(feedId, keyword, integrationId, {
            isRegex,
            caseSensitive
        });
        res.json(route);
    } catch (error) {
        console.error('Error creating keyword route:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all routes for a feed
router.get('/feed/:feedId', async (req, res) => {
    try {
        const routes = await keywordRouteService.getRoutesForFeed(req.params.feedId);
        res.json(routes);
    } catch (error) {
        console.error('Error getting keyword routes:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update a keyword route
router.put('/:routeId', async (req, res) => {
    try {
        const { keyword, integrationId, isRegex, caseSensitive, isActive } = req.body;
        
        // Validate regex if needed
        if (isRegex && !keywordRouteService.validateRegex(keyword)) {
            return res.status(400).json({ error: 'Invalid regular expression pattern' });
        }

        const route = await keywordRouteService.updateRoute(req.params.routeId, {
            keyword,
            integration_id: integrationId,
            is_regex: isRegex,
            case_sensitive: caseSensitive,
            is_active: isActive
        });
        res.json(route);
    } catch (error) {
        console.error('Error updating keyword route:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete a keyword route
router.delete('/:routeId', async (req, res) => {
    try {
        await keywordRouteService.deleteRoute(req.params.routeId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting keyword route:', error);
        res.status(500).json({ error: error.message });
    }
});

// Test a keyword pattern against sample content
router.post('/test', async (req, res) => {
    try {
        const { keyword, content, isRegex, caseSensitive } = req.body;
        console.log('[DEBUG] /api/keyword-routes/test received:', { keyword, content, isRegex, caseSensitive });
        
        if (isRegex && !keywordRouteService.validateRegex(keyword)) {
            return res.status(400).json({ error: 'Invalid regular expression pattern' });
        }

        const matches = keywordRouteService.matchKeywords(content, [{
            keyword,
            is_regex: isRegex,
            case_sensitive: caseSensitive,
            is_active: true
        }]);

        res.json({ matches: matches.length > 0 });
    } catch (error) {
        console.error('Error testing keyword pattern:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 