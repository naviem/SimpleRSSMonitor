const path = require('path');

module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: path.resolve(__dirname, './rss_monitor_dev.sqlite3')
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve(__dirname, './server/database/migrations')
    },
    seeds: {
      directory: path.resolve(__dirname, './server/database/seeds')
    }
  },
  // You can add configurations for other environments like production here
  production: {
    client: 'sqlite3',
    connection: {
      filename: path.resolve(__dirname, './rss_monitor.sqlite3') // Or a path outside the project dir
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve(__dirname, './server/database/migrations')
    }
    // Seeds are typically not run in production directly via knex CLI
  }
}; 