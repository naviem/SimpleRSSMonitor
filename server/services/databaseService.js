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
        // Check if database file exists and has tables
        const hasTable = await db.schema.hasTable('feeds');
        
        if (!hasTable) {
            console.log('Fresh installation detected. Creating database schema...');
            // For fresh install, create tables directly without migrations
            await createTables();
            console.log('Database schema created successfully.');
        } else {
            console.log('Existing database detected. Schema is already up to date.');
        }
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1); 
    }
}

async function createTables() {
    // Create feeds table
    await db.schema.createTable('feeds', (table) => {
        table.string('id').primary();
        table.string('title').notNullable();
        table.string('url').notNullable().unique();
        table.integer('interval').defaultTo(60);
        table.string('status').defaultTo('pending');
        table.text('statusDetails').defaultTo('');
        table.timestamp('lastChecked');
        table.text('history').defaultTo('[]'); // Store as JSON string
        table.text('selectedFields').defaultTo(JSON.stringify(['title', 'link'])); // Store as JSON string
        table.text('availableFields').defaultTo('[]'); // Store as JSON string
        table.text('sampleItems').defaultTo('[]'); // Store 1-2 sample full items as JSON string
        table.text('associatedIntegrations').defaultTo('[]'); // Store array of associated integration IDs as JSON
        table.boolean('showAllPrefixes').defaultTo(false);
        table.timestamps(true, true);
    });

    // Create integrations table
    await db.schema.createTable('integrations', (table) => {
        table.string('id').primary();
        table.string('name').notNullable();
        table.string('type').notNullable(); // 'discord' or 'telegram'
        table.string('webhookUrl'); // For Discord
        table.string('token');      // For Telegram
        table.string('chatId');     // For Telegram
        table.timestamps(true, true);
    });

    // Create keyword_routes table
    await db.schema.createTable('keyword_routes', (table) => {
        table.increments('id').primary();
        table.string('keyword').notNullable();
        table.integer('feed_id').unsigned().references('id').inTable('feeds').onDelete('CASCADE');
        table.string('integration_name').notNullable();
        table.boolean('enabled').defaultTo(true);
        table.timestamps(true, true);
    });

    // Create stats table
    await db.schema.createTable('stats', (table) => {
        table.increments('id').primary();
        table.integer('feed_id').unsigned().references('id').inTable('feeds').onDelete('CASCADE');
        table.string('feed_name').notNullable();
        table.string('feed_url').notNullable();
        table.integer('data_transferred').defaultTo(0);
        table.integer('scan_count').defaultTo(0);
        table.timestamp('last_scan').nullable();
        table.timestamps(true, true);
    });
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