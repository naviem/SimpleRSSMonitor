document.addEventListener('DOMContentLoaded', () => {
    let currentRange = 'daily';
    const statsTableBody = document.getElementById('statsTableBody');
    const rangeButtons = document.querySelectorAll('.time-range-btn');

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function renderTable(feeds) {
        if (!feeds.length) {
            statsTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No data for this period.</td></tr>';
            return;
        }
        statsTableBody.innerHTML = feeds.map(feed => `
            <tr>
                <td>${feed.title || feed.name || feed.url || feed.id}</td>
                <td>${formatBytes(feed.total_bytes || 0)}</td>
                <td>${feed.scan_count || 0}</td>
            </tr>
        `).join('');
    }

    async function loadStats(range) {
        statsTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Loading...</td></tr>';
        try {
            const res = await fetch(`/api/stats/summary/${range}`);
            const data = await res.json();
            renderTable(data);
        } catch (e) {
            statsTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:red;">Failed to load stats.</td></tr>';
        }
    }

    rangeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            rangeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRange = btn.dataset.range;
            loadStats(currentRange);
        });
    });

    // Initial load
    loadStats(currentRange);
}); 