// Live Auto-Sync via Supabase Realtime: any entry/defect change refreshes the
// open view instantly (no 60s polling wait).
(function () {
  var channel = null;
  function init() {
    if (!window.sb || channel) return;
    channel = window.sb.channel('live-entries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_entries' }, function () {
        if (window.rawDashboardData && window.fetchDashboardData) window.fetchDashboardData('sync');
        if (window.activeDashTab === 'quality' && window.renderQualityDashboard) window.renderQualityDashboard();
        if (window.activeDashTab === 'section' && window.renderDashboard) window.renderDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'defects' }, function () {
        if (window.fetchDefects) window.fetchDefects();
        if (window.activeDashTab === 'quality' && window.renderQualityDashboard) window.renderQualityDashboard();
      })
      .subscribe(function (status) { console.log('realtime:', status); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 3000); });
  else setTimeout(init, 3000);
})();
