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
    const channelTrend = buildChannelTrend_(channelHistory);
    const channelSummary = channel ? Object.assign({}, channel, {
      subscriberGrowth: previousChannel ? channel.subscribers - previousChannel.subscribers : 0,
      channelViewGrowth: previousChannel ? channel.totalViews - previousChannel.totalViews : 0,
      snapshotCount: channelHistory.length
    }) : null;
    const lastCapturedAt = videos.reduce(function (latest, video) {
      return !latest || new Date(video.capturedAt) > new Date(latest) ? video.capturedAt : latest;
    }, channel && channel.capturedAt || "");
    return {
      totals: totals, videoCount: videos.length, videos: videos,
      topVideo: videos[0] || null,
      channelTrend: channelTrend,
      channel: channelSummary,
      channelHealth: buildChannelHealth_(channelSummary, videos, lastCapturedAt),
      periodReports: buildPeriodReports_(channelHistory),
      lastCapturedAt: lastCapturedAt
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

  function buildChannelTrend_(history) {
    return (history || []).slice().sort(function (a, b) {
      return new Date(a.capturedAt) - new Date(b.capturedAt);
    }).slice(-30).map(function (snapshot) {
      return {
        capturedAt: new Date(snapshot.capturedAt).toISOString(),
        subscribers: Math.max(0, Number(snapshot.subscribers || 0)),
        totalViews: Math.max(0, Number(snapshot.totalViews || 0)),
        videoCount: Math.max(0, Number(snapshot.videoCount || 0))
      };
    });
  }

  function buildChannelHealth_(channel, videos, lastCapturedAt, nowValue) {
    if (!channel || !lastCapturedAt) return {
      available: false, score: 0, status: "Awaiting baseline", confidence: "low",
      signals: [], actions: ["Capture YouTube metrics to create the first channel baseline."]
    };
    const now = nowValue ? new Date(nowValue).getTime() : Date.now();
    const capturedAgeHours = Math.max(0, (now - new Date(lastCapturedAt).getTime()) / 3600000);
    const latestPublishedAt = (videos || []).map(function (video) { return video.publishedAt; })
      .filter(Boolean).sort(function (a, b) { return new Date(b) - new Date(a); })[0] || "";
    const uploadAgeDays = latestPublishedAt ? Math.max(0, (now - new Date(latestPublishedAt).getTime()) / 86400000) : null;
    const signals = [], actions = [];
    let score = capturedAgeHours <= 25 ? 30 : capturedAgeHours <= 72 ? 15 : 0;
    signals.push({ label: "Metric freshness", state: capturedAgeHours <= 25 ? "good" : "warning",
      detail: capturedAgeHours <= 25 ? "Snapshot is current." : "Latest snapshot is " + Math.floor(capturedAgeHours) + " hours old." });
    if (capturedAgeHours > 25) actions.push("Refresh YouTube metrics to restore a current baseline.");

    if (uploadAgeDays === null) {
      score += 5; signals.push({ label: "Upload cadence", state: "warning", detail: "No published Short is tracked yet." });
      actions.push("Publish and track the first verified Short.");
    } else if (uploadAgeDays <= 14) {
      score += 25; signals.push({ label: "Upload cadence", state: "good", detail: "A tracked Short was published recently." });
    } else if (uploadAgeDays <= 30) {
      score += 15; signals.push({ label: "Upload cadence", state: "warning", detail: "Latest tracked upload is over two weeks old." });
      actions.push("Schedule the next approved Short.");
    } else {
      score += 5; signals.push({ label: "Upload cadence", state: "warning", detail: "Latest tracked upload is over 30 days old." });
      actions.push("Restart a consistent Shorts publishing cadence.");
    }

    score += channel.channelViewGrowth > 0 ? 20 : 10;
    signals.push({ label: "View momentum", state: channel.channelViewGrowth > 0 ? "good" : "neutral",
      detail: channel.channelViewGrowth > 0 ? "+" + channel.channelViewGrowth + " channel views since the previous snapshot." : "No new channel views since the previous snapshot." });
    score += channel.subscriberGrowth > 0 ? 15 : 8;
    signals.push({ label: "Subscriber momentum", state: channel.subscriberGrowth > 0 ? "good" : "neutral",
      detail: channel.subscriberGrowth > 0 ? "+" + channel.subscriberGrowth + " subscribers since the previous snapshot." : "Subscriber count is unchanged." });
    score += channel.snapshotCount >= 7 ? 10 : channel.snapshotCount >= 2 ? 5 : 0;
    if (channel.snapshotCount < 7) actions.push("Build at least seven snapshots for a more reliable trend.");
    score = Math.max(0, Math.min(100, score));
    return {
      available: true, score: score,
      status: score >= 75 ? "Healthy" : score >= 50 ? "Watch" : "Needs attention",
      confidence: channel.snapshotCount >= 7 ? "high" : channel.snapshotCount >= 2 ? "medium" : "low",
      signals: signals, actions: actions
    };
  }

  function buildPeriodReports_(history) {
    const ordered = (history || []).slice().sort(function (a, b) {
      return new Date(a.capturedAt) - new Date(b.capturedAt);
    });
    if (!ordered.length) return [];
    const latest = ordered[ordered.length - 1];
    return [
      { key: "daily", label: "Daily", days: 1 },
      { key: "weekly", label: "Weekly", days: 7 },
      { key: "monthly", label: "Monthly", days: 30 }
    ].map(function (period) {
      const cutoff = new Date(latest.capturedAt).getTime() - period.days * 86400000;
      const eligible = ordered.filter(function (snapshot) { return new Date(snapshot.capturedAt).getTime() <= cutoff; });
      const baseline = eligible[eligible.length - 1] || ordered[0];
      const elapsedDays = Math.max(0, (new Date(latest.capturedAt) - new Date(baseline.capturedAt)) / 86400000);
      return {
        key: period.key, label: period.label, days: period.days,
        complete: elapsedDays >= period.days * 0.95,
        elapsedDays: Math.round(elapsedDays * 10) / 10,
        from: baseline.capturedAt, to: latest.capturedAt,
        subscriberGrowth: Number(latest.subscribers || 0) - Number(baseline.subscribers || 0),
        viewGrowth: Number(latest.totalViews || 0) - Number(baseline.totalViews || 0),
        videoGrowth: Number(latest.videoCount || 0) - Number(baseline.videoCount || 0)
      };
    });
  }
  return { capture: capture, summary: summary, parseDuration: parseDuration_,
    buildChannelTrend: buildChannelTrend_, buildChannelHealth: buildChannelHealth_,
    buildPeriodReports: buildPeriodReports_ };
})();

function testYouTubeAnalyticsDurationParsing() {
  if (YouTubeAnalyticsService.parseDuration("PT1M3S") !== 63) throw new Error("YouTube duration parsing failed.");
  return { passed: true };
}

function testYouTubeAnalyticsTrendBuilding() {
  const trend = YouTubeAnalyticsService.buildChannelTrend([
    { capturedAt: "2026-01-02T00:00:00.000Z", subscribers: 12, totalViews: 200, videoCount: 3 },
    { capturedAt: "2026-01-01T00:00:00.000Z", subscribers: 10, totalViews: 100, videoCount: 2 }
  ]);
  if (trend.length !== 2 || trend[0].subscribers !== 10 || trend[1].totalViews !== 200) {
    throw new Error("YouTube channel trend ordering failed.");
  }
  return { passed: true };
}

function testYouTubeAnalyticsChannelHealth() {
  const now = "2026-01-10T12:00:00.000Z";
  const health = YouTubeAnalyticsService.buildChannelHealth({
    capturedAt: "2026-01-10T11:00:00.000Z", subscriberGrowth: 2,
    channelViewGrowth: 120, snapshotCount: 8
  }, [{ publishedAt: "2026-01-05T12:00:00.000Z" }], "2026-01-10T11:00:00.000Z", now);
  if (!health.available || health.score !== 100 || health.status !== "Healthy" || health.confidence !== "high") {
    throw new Error("Healthy YouTube channel scoring failed.");
  }
  const missing = YouTubeAnalyticsService.buildChannelHealth(null, [], "", now);
  if (missing.available || missing.status !== "Awaiting baseline") throw new Error("Missing channel baseline was not handled.");
  return { passed: true };
}

function testYouTubeAnalyticsPeriodReports() {
  const reports = YouTubeAnalyticsService.buildPeriodReports([
    { capturedAt: "2026-01-01T00:00:00.000Z", subscribers: 10, totalViews: 100, videoCount: 2 },
    { capturedAt: "2026-01-08T00:00:00.000Z", subscribers: 14, totalViews: 260, videoCount: 4 }
  ]);
  const weekly = reports.filter(function (report) { return report.key === "weekly"; })[0];
  if (!weekly.complete || weekly.subscriberGrowth !== 4 || weekly.viewGrowth !== 160 || weekly.videoGrowth !== 2) {
    throw new Error("Weekly YouTube channel report failed.");
  }
  const monthly = reports.filter(function (report) { return report.key === "monthly"; })[0];
  if (monthly.complete || monthly.elapsedDays !== 7) throw new Error("Partial reporting period was not identified.");
  return { passed: true };
}
