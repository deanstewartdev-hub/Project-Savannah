/****************************************************
 * Project Savannah v1.3 - YouTube analytics foundation.
 ****************************************************/
const YouTubeAnalyticsService = (() => {
  const MINIMUM_CAPTURE_INTERVAL_MS = 60 * 60 * 1000;

  function capture() {
    const channelCapture = captureChannel_();
    const publishingJobs = PublishingJobRepository.getAll().filter(function (job) {
      return job.status === "PUBLISHED" && job.youtubeVideoId;
    });
    if (!publishingJobs.length) return { channel: channelCapture, captured: [], skipped: [], missing: [] };
    const jobsByVideoId = {};
    publishingJobs.forEach(function (job) { jobsByVideoId[job.youtubeVideoId] = job; });
    const response = YouTube.Videos.list("id,snippet,statistics,contentDetails,status", {
      id: Object.keys(jobsByVideoId).slice(0, 50).join(",")
    });
    const videos = response && response.items || [], captured = [], skipped = [];
    videos.forEach(function (video) {
      const previous = AnalyticsSnapshotRepository.getLatestByVideoId(video.id);
      if (previous && Date.now() - new Date(previous.capturedAt).getTime() < MINIMUM_CAPTURE_INTERVAL_MS) {
        skipped.push(previous);
        return;
      }
      const job = jobsByVideoId[video.id], statistics = video.statistics || {}, status = video.status || {};
      captured.push(AnalyticsSnapshotRepository.save({
        youtubeVideoId: video.id, publishingJobId: job.id, scriptId: job.scriptId,
        title: video.snippet && video.snippet.title || job.title,
        publishedAt: video.snippet && video.snippet.publishedAt || status.publishAt || job.createdAt,
        likes: statistics.likeCount, comments: statistics.commentCount,
        durationSeconds: parseDuration_(video.contentDetails && video.contentDetails.duration),
        privacyStatus: status.privacyStatus
      }));
    });
    const returned = videos.map(function (video) { return video.id; });
    return { channel: channelCapture, captured: captured, skipped: skipped, missing: Object.keys(jobsByVideoId).filter(function (id) {
      return returned.indexOf(id) === -1;
    }) };
  }

  function summary() {
    const all = AnalyticsSnapshotRepository.getAll().sort(function (a, b) {
      return new Date(a.capturedAt) - new Date(b.capturedAt);
    });
    const grouped = {};
    all.forEach(function (snapshot) {
      if (!grouped[snapshot.youtubeVideoId]) grouped[snapshot.youtubeVideoId] = [];
      grouped[snapshot.youtubeVideoId].push(snapshot);
    });
    const videos = Object.keys(grouped).map(function (videoId) {
      const history = grouped[videoId], latest = history[history.length - 1], previous = history[history.length - 2];
      return Object.assign({}, latest, {
        viewGrowth: previous ? latest.views - previous.views : 0,
        likeGrowth: previous ? latest.likes - previous.likes : 0,
        snapshotCount: history.length
      });
    }).sort(function (a, b) { return b.views - a.views; });
    const totals = videos.reduce(function (sum, video) {
      sum.views += video.views; sum.likes += video.likes; sum.comments += video.comments;
      sum.viewGrowth += video.viewGrowth; return sum;
    }, { views: 0, likes: 0, comments: 0, viewGrowth: 0 });
    const channelHistory = ChannelAnalyticsRepository.getAll().sort(function (a, b) {
      return new Date(a.capturedAt) - new Date(b.capturedAt);
    });
    const channel = channelHistory[channelHistory.length - 1] || null;
    const previousChannel = channelHistory[channelHistory.length - 2] || null;
    return {
      totals: totals, videoCount: videos.length, videos: videos,
      topVideo: videos[0] || null,
      channel: channel ? Object.assign({}, channel, {
        subscriberGrowth: previousChannel ? channel.subscribers - previousChannel.subscribers : 0,
        channelViewGrowth: previousChannel ? channel.totalViews - previousChannel.totalViews : 0,
        snapshotCount: channelHistory.length
      }) : null,
      lastCapturedAt: videos.reduce(function (latest, video) {
        return !latest || new Date(video.capturedAt) > new Date(latest) ? video.capturedAt : latest;
      }, "")
    };
  }

  function captureChannel_() {
    const previous = ChannelAnalyticsRepository.latest();
    if (previous && Date.now() - new Date(previous.capturedAt).getTime() < MINIMUM_CAPTURE_INTERVAL_MS) {
      return { captured: false, snapshot: previous };
    }
    const response = YouTube.Channels.list("id,snippet,statistics", { mine: true });
    const channel = response && response.items && response.items[0];
    if (!channel) throw new Error("The connected YouTube channel was not found.");
    const statistics = channel.statistics || {};
    return { captured: true, snapshot: ChannelAnalyticsRepository.save({
      channelId: channel.id, channelTitle: channel.snippet && channel.snippet.title || "",
      subscribers: statistics.subscriberCount, totalViews: statistics.viewCount,
      videoCount: statistics.videoCount
    }) };
  }

  function parseDuration_(value) {
    const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
    if (!match) return 0;
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }
  return { capture: capture, summary: summary, parseDuration: parseDuration_ };
})();

function testYouTubeAnalyticsDurationParsing() {
  if (YouTubeAnalyticsService.parseDuration("PT1M3S") !== 63) throw new Error("YouTube duration parsing failed.");
  return { passed: true };
}
