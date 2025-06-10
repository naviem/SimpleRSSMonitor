const { db } = require('./databaseService');
const { v4: uuidv4 } = require('uuid');

class KeywordRouteService {
    // Create a new keyword route
    async createRoute(feedId, keyword, integrationId, options = {}) {
        const route = {
            id: uuidv4(),
            feed_id: feedId,
            keyword,
            integration_id: integrationId,
            is_regex: options.isRegex || false,
            case_sensitive: options.caseSensitive || false,
            is_active: true,
            fields: options.fields ? JSON.stringify(options.fields) : '[]'
        };
        
        try {
            await db('keyword_routes').insert(route);
            return route;
        } catch (error) {
            console.error('Error creating keyword route:', error);
            throw error;
        }
    }

    // Get all routes for a feed
    async getRoutesForFeed(feedId) {
        const routes = await db('keyword_routes')
            .where({ feed_id: feedId, is_active: true })
            .select('*');
        
        // Parse fields for each route
        return routes.map(route => ({
            ...route,
            fields: route.fields ? JSON.parse(route.fields) : []
        }));
    }

    // Update a keyword route
    async updateRoute(routeId, updates) {
        const updateData = { ...updates };
        if (updateData.fields) {
            updateData.fields = JSON.stringify(updateData.fields);
        }
        
        try {
            await db('keyword_routes')
                .where({ id: routeId })
                .update({
                    ...updateData,
                    updated_at: db.fn.now()
                });
            
            const route = await db('keyword_routes').where({ id: routeId }).first();
            if (route && route.fields) {
                route.fields = JSON.parse(route.fields);
            }
            return route;
        } catch (error) {
            console.error('Error updating keyword route:', error);
            throw error;
        }
    }

    // Delete a keyword route
    async deleteRoute(routeId) {
        return await db('keyword_routes').where({ id: routeId }).del();
    }

    // Match content against keywords
    matchKeywords(item, routes) {
        const matches = new Set();
        for (const route of routes) {
            if (!route.is_active) continue;
            
            let fields = [];
            try {
                // Safely parse fields: only if route.fields is a non-empty string
                fields = (route.fields && typeof route.fields === 'string') ? JSON.parse(route.fields) : [];
            } catch (e) {
                console.error('Error parsing fields for route:', route.id, e);
                fields = [];
            }
            
            // If no fields specified, or 'all' is selected, match against all fields
            let contentToSearch = '';
            if (!fields || fields.length === 0 || fields.includes('all')) {
                contentToSearch = [item.title, item.summary, item.content, item.description, item.contentSnippet]
                    .filter(Boolean).join(' \n ');
            } else {
                contentToSearch = fields.map(f => getFieldValue(item, f)).filter(Boolean).join(' \n ');
            }
            
            try {
                if (route.is_regex) {
                    const regex = new RegExp(route.keyword, route.case_sensitive ? '' : 'i');
                    if (regex.test(contentToSearch)) {
                        matches.add(route.integration_id);
                    }
                } else {
                    const searchContent = route.case_sensitive ? contentToSearch : contentToSearch.toLowerCase();
                    const searchKeyword = route.case_sensitive ? route.keyword : route.keyword.toLowerCase();
                    if (searchContent.includes(searchKeyword)) {
                        matches.add(route.integration_id);
                    }
                }
            } catch (error) {
                console.error(`Error matching keyword route ${route.id}:`, error);
            }
        }
        return Array.from(matches);
    }

    // Validate regex pattern
    validateRegex(pattern) {
        try {
            new RegExp(pattern);
            return true;
        } catch (error) {
            return false;
        }
    }
}

module.exports = new KeywordRouteService(); 