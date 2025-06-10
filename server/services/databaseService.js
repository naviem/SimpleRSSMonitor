const knex = require('knex');
const path = require('path');
const knexConfig = require(path.join(__dirname, '..', '..', 'knexfile.js'));

const db = knex(knexConfig.development);

// Fields that are stored as JSON strings in the database
const feedJsonFields = ['selectedFields', 'associatedIntegrations', 'history', 'availableFields', 'sampleItems'];
const integrationJsonFields = []; // None for now, but good to have for consistency

// Helper to parse JSON fields after fetching from DB, or prepare for client
function parseJsonFields(obj, fieldsToParse, forClient = false) {
    if (!obj) return null;
    const newObj = { ...obj };
    for (const field of fieldsToParse) {
        if (newObj[field] && typeof newObj[field] === 'string') {
            try {
                newObj[field] = JSON.parse(newObj[field]);
            } catch (e) {
                console.error(`Error parsing JSON for field ${field}:`, e);
                newObj[field] = (field === 'history' || field === 'selectedFields' || field === 'availableFields' || field === 'associatedIntegrations' || field === 'sampleItems') ? [] : {}; // Default based on expected type
            }
        }
    }
    // For client, we might want to simplify or remove certain large fields if not needed
    if (forClient) {
        // Example: if (newObj.history) delete newObj.history; // if history is too large for client
    }
    // Booleans like showAllPrefixes should be handled directly, not as JSON strings
    if (newObj.hasOwnProperty('showAllPrefixes')) {
        newObj.showAllPrefixes = !!newObj.showAllPrefixes; // Ensure it's a boolean (0/1 from DB becomes false/true)
    }
    return newObj;
}

async function initializeDatabase() {
    try {
        console.log('Running database migrations...');
        await db.migrate.latest();
        console.log('Database migrations are up to date.');
    } catch (error) {
        console.error('Error running database migrations:', error);
        process.exit(1); 
    }
}

async function loadFeeds() {
    const rawFeeds = await db('feeds').select('*');
    const feeds = rawFeeds.map(feed => parseJsonFields(feed, feedJsonFields));
    console.log(`Loaded ${feeds.length} feeds from database.`);
    // For debugging, log the first feed if it exists
    // if (feeds.length > 0) {
    //     console.log("First loaded feed structure:", JSON.stringify(feeds[0], null, 2));
    // }
    return feeds;
}

module.exports = { db, initializeDatabase, loadFeeds, parseJsonFields, feedJsonFields, integrationJsonFields }; 