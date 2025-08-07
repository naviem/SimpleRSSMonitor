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
    if (newObj.hasOwnProperty('paused')) {
        newObj.paused = !!newObj.paused; // Ensure it's a boolean (0/1 from DB becomes false/true)
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
            console.log('Existing database detected. Running migrations to ensure schema is up to date...');
            // Run migrations for existing databases to add any missing columns
            await db.migrate.latest();
            console.log('Database migrations completed.');
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
        table.boolean('paused').defaultTo(false);
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
        table.string('id').primary();
        table.string('feed_id').notNullable();
        table.string('keyword').notNullable();
        table.string('integration_id').notNullable();
        table.boolean('is_regex').defaultTo(false);
        table.boolean('case_sensitive').defaultTo(false);
        table.boolean('is_active').defaultTo(true);
        table.text('fields').defaultTo('[]');
        table.timestamps(true, true);
        
        // Foreign key constraints
        table.foreign('feed_id').references('id').inTable('feeds').onDelete('CASCADE');
        table.foreign('integration_id').references('id').inTable('integrations').onDelete('CASCADE');
        
        // Index for faster keyword searches
        table.index(['feed_id', 'keyword']);
    });

    // Create feed_stats table
    await db.schema.createTable('feed_stats', (table) => {
        table.increments('id').primary();
        table.string('feed_id').references('id').inTable('feeds');
        table.timestamp('timestamp').defaultTo(db.fn.now());
        table.integer('items_processed').defaultTo(0);
        table.integer('bytes_transferred').defaultTo(0);
        table.integer('processing_time_ms').defaultTo(0);
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