// server/config/index.js

// This file can be used to manage application configuration.
// For example, you might load environment variables here or define default settings.

const config = {
    port: process.env.PORT || 3000,
    // Example: Default feed check interval if not specified by user
    defaultFeedIntervalMinutes: 60,

    // Example: Database configuration (if you add persistence)
    // database: {
    //     client: 'sqlite3',
    //     connection: {
    //         filename: './dev.sqlite3'
    //     },
    //     useNullAsDefault: true
    // },

    // Add other configuration settings as needed
};

module.exports = config; 