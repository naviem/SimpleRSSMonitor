const express = require('express');
const router = express.Router();
const keywordRouteService = require('../services/keywordRouteService');

// Create a new keyword route
router.post('/', async (req, res) => {
    try {
        const { feedId, keyword, integrationId, isRegex, caseSensitive, fields } = req.body;
        
        // Validate regex if needed
        if (isRegex && !keywordRouteService.validateRegex(keyword)) {
            return res.status(400).json({ error: 'Invalid regular expression pattern' });
        }

        const route = await keywordRouteService.createRoute(feedId, keyword, integrationId, {
            isRegex,
            caseSensitive,
            fields
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
        const { keyword, integrationId, isRegex, caseSensitive, isActive, fields } = req.body;
        
        // Validate regex if needed
        if (isRegex && !keywordRouteService.validateRegex(keyword)) {
            return res.status(400).json({ error: 'Invalid regular expression pattern' });
        }

        const route = await keywordRouteService.updateRoute(req.params.routeId, {
            keyword,
            integration_id: integrationId,
            is_regex: isRegex,
            case_sensitive: caseSensitive,
            is_active: isActive,
            fields
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
        const { keyword, content, isRegex, caseSensitive, fields } = req.body;
        console.log('[DEBUG] /api/keyword-routes/test received:', { keyword, content, isRegex, caseSensitive, fields });
        
        if (isRegex && !keywordRouteService.validateRegex(keyword)) {
            return res.status(400).json({ error: 'Invalid regular expression pattern' });
        }

        // Simulate a feed item with the test content in all fields
        const testItem = {
            title: content,
            summary: content,
            content: content,
            description: content,
            contentSnippet: content
        };
        const matches = keywordRouteService.matchKeywords(testItem, [{
            keyword,
            is_regex: isRegex,
            case_sensitive: caseSensitive,
            is_active: true,
            fields: fields && fields.length ? JSON.stringify(fields) : null
        }]);

        res.json({ matches: matches.length > 0 });
    } catch (error) {
        console.error('Error testing keyword pattern:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 