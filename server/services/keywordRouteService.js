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
            is_active: true
        };
        
        await db('keyword_routes').insert(route);
        return route;
    }

    // Get all routes for a feed
    async getRoutesForFeed(feedId) {
        return await db('keyword_routes')
            .where({ feed_id: feedId, is_active: true })
            .select('*');
    }

    // Update a keyword route
    async updateRoute(routeId, updates) {
        await db('keyword_routes')
            .where({ id: routeId })
            .update({
                ...updates,
                updated_at: db.fn.now()
            });
        return await db('keyword_routes').where({ id: routeId }).first();
    }

    // Delete a keyword route
    async deleteRoute(routeId) {
        return await db('keyword_routes').where({ id: routeId }).del();
    }

    // Match content against keywords
    matchKeywords(content, routes) {
        const matches = new Set();
        
        for (const route of routes) {
            if (!route.is_active) continue;
            
            try {
                if (route.is_regex) {
                    const regex = new RegExp(route.keyword, route.case_sensitive ? '' : 'i');
                    if (regex.test(content)) {
                        matches.add(route.integration_id);
                    }
                } else {
                    const searchContent = route.case_sensitive ? content : content.toLowerCase();
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