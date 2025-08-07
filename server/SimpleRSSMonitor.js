const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Import routes
const mainRoutes = require('./routes/index');
const feedApiRoutes = require('./routes/feeds'); // Renamed for clarity if used as API
const integrationApiRoutes = require('./routes/integrations'); // Renamed for clarity
const keywordRouteApiRoutes = require('./routes/keywordRoutes'); // Add this line
const statsRoutes = require('./routes/statsRoutes');

// Import services
const { initializeSocketEvents } = require('./services/socketService');
const { startRssScheduler } = require('./services/rssService'); // Correctly import
const { initializeDatabase, db, parseJsonFields } = require('./services/databaseService'); // Import DB service
const statsService = require('./services/statsService');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Setup routes
app.use('/', mainRoutes); // Handles serving HTML pages
app.use('/api/feeds', feedApiRoutes); // API endpoint for feeds
app.use('/api/integrations', integrationApiRoutes); // API endpoint for integrations
app.use('/api/keyword-routes', keywordRouteApiRoutes); // Add this line
app.use('/api/stats', statsRoutes);

// Initialize in-memory stores (will be populated from DB)
global.feeds = []; 
global.integrations = [];

// API Routes
app.get('/api/feeds', async (req, res) => {
    try {
        const feeds = await db('feeds').select('*');
        res.json(feeds.map(feed => parseJsonFields(feed, ['history', 'selectedFields', 'availableFields', 'sampleItems', 'associatedIntegrations'])));
    } catch (error) {
        console.error('Error fetching feeds:', error);
        res.status(500).json({ error: 'Failed to fetch feeds' });
    }
});

async function startServer() {
    // Initialize Database first
    await initializeDatabase();
    await statsService.initializeStatsTable();

    // Load initial data from database into global arrays
    try {
        const rawFeeds = await db('feeds').select('*');
        global.feeds = rawFeeds.map(feed => parseJsonFields(feed, ['history', 'selectedFields', 'availableFields', 'sampleItems', 'associatedIntegrations']));
        console.log(`Loaded ${global.feeds.length} feeds from database.`);

        const rawIntegrations = await db('integrations').select('*');
        global.integrations = rawIntegrations; // Integrations don't have JSON fields in this schema
        console.log(`Loaded ${global.integrations.length} integrations from database.`);
    } catch (error) {
        console.error('Error loading data from database:', error);
        // Decide if you want to exit or continue with empty data
    }

    // Now initialize socket events, as they might rely on global.feeds/integrations
    initializeSocketEvents(io); 

    // Start server
    server.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
        // Initialize the RSS scheduler after the server starts
        startRssScheduler(io);
    });
}

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

// Make io available to other modules AFTER server setup
module.exports.io = io;

module.exports = { app, server, io }; 