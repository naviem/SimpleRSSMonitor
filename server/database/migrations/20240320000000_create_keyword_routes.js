/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('keyword_routes', (table) => {
    table.string('id').primary();
    table.string('feed_id').notNullable();
    table.string('keyword').notNullable();
    table.string('integration_id').notNullable();
    table.boolean('is_regex').defaultTo(false);
    table.boolean('case_sensitive').defaultTo(false);
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
    
    // Foreign key constraints
    table.foreign('feed_id').references('id').inTable('feeds').onDelete('CASCADE');
    table.foreign('integration_id').references('id').inTable('integrations').onDelete('CASCADE');
    
    // Index for faster keyword searches
    table.index(['feed_id', 'keyword']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('keyword_routes');
}; 