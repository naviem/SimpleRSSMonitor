const express = require('express');
const router = express.Router();
const statsService = require('../services/statsService');

// Clear all stats
router.post('/clear', async (req, res) => {
    try {
        await statsService.clearStats();
        res.json({ success: true, message: 'Stats cleared successfully' });
    } catch (error) {
        console.error('Error clearing stats:', error);
        res.status(500).json({ error: 'Failed to clear stats' });
    }
});

// Export stats to CSV
router.get('/export/csv', async (req, res) => {
    try {
        console.log('CSV export request received for range:', req.query.range, 'feedId:', req.query.feedId);
        const csv = await statsService.exportToCSV(req.query.range, req.query.feedId);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=stats.csv');
        res.send(csv);
    } catch (error) {
        console.error('Error exporting stats to CSV:', error);
        res.status(500).json({ error: 'Failed to export stats to CSV' });
    }
});

// Export stats to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        console.log('PDF export request received for range:', req.query.range, 'feedId:', req.query.feedId);
        const pdf = await statsService.exportToPDF(req.query.range, req.query.feedId);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=stats.pdf');
        res.send(pdf);
    } catch (error) {
        console.error('Error exporting stats to PDF:', error);
        res.status(500).json({ error: 'Failed to export stats to PDF' });
    }
});

// Get stats for a specific feed and time range
router.get('/feeds/:feedId/:timeRange', async (req, res) => {
    try {
        console.log('Feed stats request received for feedId:', req.params.feedId, 'timeRange:', req.params.timeRange);
        const stats = await statsService.getStats(req.params.timeRange, req.params.feedId);
        console.log('Sending feed stats response:', stats);
        res.json(stats);
    } catch (error) {
        console.error('Error getting feed stats:', error);
        res.status(500).json({ error: 'Failed to get feed stats' });
    }
});

// Get stats for a specific time range
router.get('/:timeRange', async (req, res) => {
    try {
        console.log('Stats request received for timeRange:', req.params.timeRange);
        const stats = await statsService.getStats(req.params.timeRange);
        console.log('Sending stats response:', stats);
        res.json(stats);
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Summary stats for all feeds for a given range
router.get('/summary/:range', async (req, res) => {
    try {
        const summary = await statsService.getFeedSummary(req.params.range);
        res.json(summary);
    } catch (error) {
        console.error('Error getting summary stats:', error);
        res.status(500).json({ error: 'Failed to get summary stats' });
    }
});

module.exports = router; 