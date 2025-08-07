const { db } = require('./databaseService');

// Create stats table if it doesn't exist
async function initializeStatsTable() {
    try {
        const exists = await db.schema.hasTable('feed_stats');
        console.log('Checking if feed_stats table exists:', exists);
        
        if (!exists) {
            console.log('Creating feed_stats table...');
            await db.schema.createTable('feed_stats', (table) => {
                table.increments('id').primary();
                table.string('feed_id').references('id').inTable('feeds');
                table.timestamp('timestamp').defaultTo(db.fn.now());
                table.integer('items_processed').defaultTo(0);
                table.integer('bytes_transferred').defaultTo(0);
                table.integer('processing_time_ms').defaultTo(0);
                table.timestamps(true, true);
            });
            console.log('feed_stats table created successfully');
        }
    } catch (error) {
        console.error('Error initializing stats table:', error);
    }
}

// Record feed processing stats
async function recordFeedStats(feedId, stats) {
    try {
        console.log('Recording stats for feed:', feedId, stats);
        const insertData = {
            feed_id: feedId,
            items_processed: stats.itemsProcessed || 0,
            bytes_transferred: stats.bytesTransferred || 0,
            processing_time_ms: stats.processingTimeMs || 0
        };
        console.log('Inserting data:', insertData);
        
        await db('feed_stats').insert(insertData);
        console.log('Stats recorded successfully');
        
        // Verify the data was inserted
        const inserted = await db('feed_stats').where({ feed_id: feedId }).orderBy('timestamp', 'desc').first();
        console.log('Verification - inserted record:', inserted);
    } catch (error) {
        console.error('Error recording feed stats:', error);
    }
}

// Get stats for a specific time range
async function getStats(timeRange, feedId = null) {
    try {
        console.log('Getting stats for timeRange:', timeRange, 'feedId:', feedId);
        let query = db('feed_stats')
            .select(
                db.raw('DATE(timestamp) as date'),
                db.raw('SUM(items_processed) as total_items'),
                db.raw('SUM(bytes_transferred) as total_bytes'),
                db.raw('AVG(processing_time_ms) as avg_processing_time')
            );

        if (feedId) {
            query = query.where('feed_id', feedId);
        }

        // Apply time range filter
        const now = new Date();
        switch (timeRange) {
            case 'daily':
                query = query.where('timestamp', '>=', now.setDate(now.getDate() - 1));
                break;
            case 'weekly':
                query = query.where('timestamp', '>=', now.setDate(now.getDate() - 7));
                break;
            case 'monthly':
                query = query.where('timestamp', '>=', now.setMonth(now.getMonth() - 1));
                break;
            // 'all-time' doesn't need a time filter
        }

        const stats = await query
            .groupBy('date')
            .orderBy('date');

        console.log('Raw stats from database:', stats);
        return stats;
    } catch (error) {
        console.error('Error getting stats:', error);
        return [];
    }
}

// Export stats to CSV
async function exportToCSV(timeRange, feedId = null) {
    try {
        const stats = await getStats(timeRange, feedId);
        const headers = ['Date', 'Items Processed', 'Bytes Transferred', 'Average Processing Time (ms)'];
        const rows = stats.map(stat => [
            stat.date,
            stat.total_items,
            stat.total_bytes,
            stat.avg_processing_time.toFixed(2)
        ]);

        return [headers, ...rows].map(row => row.join(',')).join('\n');
    } catch (error) {
        console.error('Error exporting stats to CSV:', error);
        return '';
    }
}

// Export stats to PDF
async function exportToPDF(timeRange, feedId = null) {
    // This would require a PDF generation library
    // For now, we'll just return a placeholder
    return 'PDF export not implemented yet';
}

// Clear all stats
async function clearStats() {
    try {
        console.log('Clearing all stats...');
        await db('feed_stats').truncate();
        console.log('Stats cleared successfully');
    } catch (error) {
        console.error('Error clearing stats:', error);
        throw error;
    }
}

// Summary stats for all feeds for a given range
async function getFeedSummary(range) {
    console.log('getFeedSummary called with range:', range);
    
    // Get all feeds (for title)
    const feeds = await db('feeds').select('id', 'title', 'url');
    console.log('Found feeds:', feeds);
    
    // Build time filter
    const now = new Date();
    let since;
    if (range === 'daily') {
        // Start of today in local time
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === 'weekly') {
        // 7 days ago in local time
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    } else if (range === 'monthly') {
        // Start of this month in local time
        since = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
        since = null;
    }
    
    console.log('Time filter - since:', since ? since.toISOString() : 'null');
    
    // Query stats
    let statsQuery = db('feed_stats')
        .select('feed_id')
        .sum({ total_bytes: 'bytes_transferred' })
        .count({ scan_count: 'id' })
        .groupBy('feed_id');
    
    if (since) {
        // Use a more reliable date comparison for SQLite
        const dateString = since.toISOString().split('T')[0]; // YYYY-MM-DD format
        console.log('Using date filter:', dateString);
        statsQuery = statsQuery.whereRaw('DATE(timestamp) >= ?', [dateString]);
    }
    
    const stats = await statsQuery;
    console.log('Raw stats from database:', stats);
    
    // Merge with feeds
    const result = feeds.map(feed => {
        const stat = stats.find(s => s.feed_id === feed.id) || {};
        return {
            id: feed.id,
            title: feed.title || feed.url || feed.id,
            total_bytes: Number(stat.total_bytes) || 0,
            scan_count: Number(stat.scan_count) || 0
        };
    });
    
    console.log('Final result:', result);
    return result;
}

module.exports = {
    initializeStatsTable,
    recordFeedStats,
    getStats,
    exportToCSV,
    exportToPDF,
    clearStats,
    getFeedSummary
}; 