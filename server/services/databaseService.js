const knex = require('knex');
const path = require('path');

const db = knex({
    client: 'sqlite3',
    connection: {
        filename: path.join(__dirname, '..', 'database.sqlite')
    },
    useNullAsDefault: true
});

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
        // Feeds Table: Check existence and create/alter as needed
        const hasFeedsTable = await db.schema.hasTable('feeds');
        if (!hasFeedsTable) {
            await db.schema.createTable('feeds', (table) => {
                table.string('id').primary();
                table.string('title').notNullable();
                table.string('url').notNullable();
                table.integer('interval').defaultTo(60);
                table.text('selectedFields').defaultTo('[]');
                table.text('associatedIntegrations').defaultTo('[]');
                table.text('history').defaultTo('[]');
                table.string('status').defaultTo('pending');
                table.text('statusDetails').defaultTo('');
                table.timestamp('lastChecked');
                table.text('availableFields').defaultTo('[]');
                table.text('sampleItems').defaultTo('[]');
                table.boolean('showAllPrefixes').defaultTo(false);
                table.timestamps(true, true); // Adds created_at and updated_at
            });
            console.log('Created feeds table with ALL columns.');
        } else {
            // If table exists, check for ALL specific columns and add if missing
            const feedsSchemaColumns = [
                // id is handled separately to ensure it's primary
                { name: 'title', type: 'string', notNullable: true, defaultVal: '' },
                { name: 'url', type: 'string', notNullable: true, defaultVal: '' },
                { name: 'interval', type: 'integer', defaultVal: 60 },
                { name: 'selectedFields', type: 'text', defaultVal: '[]' },
                { name: 'associatedIntegrations', type: 'text', defaultVal: '[]' },
                { name: 'history', type: 'text', defaultVal: '[]' },
                { name: 'status', type: 'string', defaultVal: 'pending' },
                { name: 'statusDetails', type: 'text', defaultVal: '' },
                { name: 'lastChecked', type: 'timestamp', nullable: true }, // No defaultVal needed if nullable
                { name: 'availableFields', type: 'text', defaultVal: '[]' },
                { name: 'sampleItems', type: 'text', defaultVal: '[]' },
                { name: 'showAllPrefixes', type: 'boolean', defaultVal: false },
            ];

            for (const col of feedsSchemaColumns) {
                const hasColumn = await db.schema.hasColumn('feeds', col.name);
                if (!hasColumn) {
                    await db.schema.alterTable('feeds', (table) => {
                        let columnBuilder;
                        if (col.type === 'string') columnBuilder = table.string(col.name);
                        else if (col.type === 'integer') columnBuilder = table.integer(col.name);
                        else if (col.type === 'text') columnBuilder = table.text(col.name);
                        else if (col.type === 'boolean') columnBuilder = table.boolean(col.name);
                        else if (col.type === 'timestamp') columnBuilder = table.timestamp(col.name);

                        if (col.hasOwnProperty('defaultVal')) {
                            columnBuilder.defaultTo(col.defaultVal);
                        } else if (col.notNullable) {
                            // Fallback default for NOT NULL columns if defaultVal wasn't specified (though it should be)
                            console.warn(`Adding NOT NULL column ${col.name} without explicit defaultVal in schema for alter operation. Using generic default.`);
                            if (col.type === 'string' || col.type === 'text') columnBuilder.defaultTo('');
                            else if (col.type === 'integer') columnBuilder.defaultTo(0);
                            else if (col.type === 'boolean') columnBuilder.defaultTo(false);
                        }

                        if (col.nullable) {
                            columnBuilder.nullable();
                        }
                        // .notNullable() is generally not added during an alter command in a way that's portable
                        // or safe without default values, which are handled by defaultTo().
                    });
                    console.log(`Altered feeds table to add missing column: ${col.name}.`);
                }
            }

            // Ensure 'id' column exists and is primary
            if (!(await db.schema.hasColumn('feeds', 'id'))) {
                 await db.schema.alterTable('feeds', (table) => { table.string('id').primary(); });
                 console.log('Altered feeds table to add missing primary key column: id.');
            }
            // Ensure created_at and updated_at exist (added by table.timestamps)
            if (!(await db.schema.hasColumn('feeds', 'created_at'))) {
                 await db.schema.alterTable('feeds', (table) => { table.timestamp('created_at').defaultTo(db.fn.now()); });
                 console.log('Altered feeds table to add missing column: created_at.');
            }
            if (!(await db.schema.hasColumn('feeds', 'updated_at'))) {
                 await db.schema.alterTable('feeds', (table) => { table.timestamp('updated_at').defaultTo(db.fn.now()); });
                 console.log('Altered feeds table to add missing column: updated_at.');
            }
        }

        // Integrations Table: Check existence and create if needed
        const hasIntegrationsTable = await db.schema.hasTable('integrations');
        if (!hasIntegrationsTable) {
            await db.schema.createTable('integrations', (table) => {
                table.string('id').primary();
                table.string('name').notNullable();
                table.string('type').notNullable(); 
                table.string('webhookUrl'); 
                table.string('token');      
                table.string('chatId');     
                table.timestamps(true, true);
            });
            console.log('Created integrations table.');
        }

    } catch (error) {
        console.error('Error initializing database:', error);
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