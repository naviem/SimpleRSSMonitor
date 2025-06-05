/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('feeds', (table) => {
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
    table.text('sampleItems').defaultTo('[]'); // ADDED: To store 1-2 sample full items as JSON string
    table.text('associatedIntegrations').defaultTo('[]'); // NEW: Store array of associated integration IDs as JSON
    table.timestamps(true, true); // Adds createdAt and updatedAt columns
  });

  await knex.schema.createTable('integrations', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('type').notNullable(); // 'discord' or 'telegram'
    table.string('webhookUrl'); // For Discord
    table.string('token');      // For Telegram
    table.string('chatId');     // For Telegram
    table.timestamps(true, true); // Adds createdAt and updatedAt columns
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('integrations');
  await knex.schema.dropTableIfExists('feeds');
}; 