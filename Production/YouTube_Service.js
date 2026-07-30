/****************************************************
 * Project Savannah v1.3 - YouTube Data API boundary.
 ****************************************************/
const YouTubeService = (() => {
  const REQUIRED_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly"
  ];

  function requireAuthorization() {
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, REQUIRED_SCOPES);
    return getChannel();
  }

  function getChannel() {
    const response = YouTube.Channels.list("id,snippet", { mine: true });
    const channel = response && response.items && response.items[0];
    return channel ? {
      id: channel.id,
      title: channel.snippet && channel.snippet.title || ""
    } : null;
  }

  function upload(renderJob, seoPack, options) {
    if (!renderJob || renderJob.status !== "SUCCEEDED" || !renderJob.videoUrl) {
      throw error_("Only a completed render can be uploaded.");
    }
    const source = options || {};
    const title = String(source.title || seoPack.titleOptions && seoPack.titleOptions[0] || "").trim().slice(0, 100);
    if (!title) throw error_("A YouTube title is required.");
    const description = buildDescription_(source.description || seoPack.description, seoPack.hashtags);
    const tags = normaliseTags_(seoPack.tags);
    const publishAt = normalisePublishAt_(source.publishAt);
    const privacyStatus = publishAt ? "private" : normalisePrivacy_(source.privacyStatus);
    const videoBlob = download_(renderJob.videoUrl, title);
    const resource = {
      snippet: {
        title: title,
        description: description,
        tags: tags,
        categoryId: "22"
      },
      status: {
        privacyStatus: privacyStatus,
        selfDeclaredMadeForKids: false
      }
    };
    if (publishAt) resource.status.publishAt = publishAt;
    const video = YouTube.Videos.insert(resource, "snippet,status", videoBlob);
    if (!video || !video.id) throw error_("YouTube did not return a video ID.");
    return {
      videoId: video.id,
      videoUrl: "https://youtu.be/" + video.id,
      title: title,
      description: description,
      tags: tags,
      privacyStatus: privacyStatus,
      publishAt: publishAt,
      response: sanitise_(video)
    };
  }

  function getVideo(videoId) {
    const id = String(videoId || "").trim();
    if (!id) throw error_("A YouTube video ID is required.");
    const response = YouTube.Videos.list("id,status,processingDetails", { id: id });
    const video = response && response.items && response.items[0];
    if (!video) throw error_("The YouTube video was not found.");
    return {
      videoId: video.id,
      privacyStatus: video.status && video.status.privacyStatus || "",
      publishAt: video.status && video.status.publishAt || "",
      uploadStatus: video.status && video.status.uploadStatus || "",
      processingStatus: video.processingDetails && video.processingDetails.processingStatus || "",
      processingProgress: video.processingDetails && video.processingDetails.processingProgress || {},
      response: sanitise_(video)
    };
  }

  function download_(url, title) {
    const response = UrlFetchApp.fetch(String(url), {
      method: "get",
      followRedirects: true,
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) throw error_("The rendered MP4 could not be downloaded (HTTP " + status + ").");
    const blob = response.getBlob();
    if (!blob.getBytes().length) throw error_("The rendered MP4 was empty.");
    return blob.setName(fileName_(title) + ".mp4").setContentType("video/mp4");
  }

  function buildDescription_(description, hashtags) {
    const body = String(description || "").trim();
    const hashLine = (Array.isArray(hashtags) ? hashtags : []).map(function (tag) {
      const value = String(tag || "").trim();
      return value ? (value.charAt(0) === "#" ? value : "#" + value.replace(/\s+/g, "")) : "";
    }).filter(Boolean).join(" ");
    return (body + (hashLine ? "\n\n" + hashLine : "")).slice(0, 5000);
  }
  function normaliseTags_(tags) {
    return (Array.isArray(tags) ? tags : []).map(function (tag) {
      return String(tag || "").trim().replace(/^#/, "");
    }).filter(Boolean).slice(0, 30);
  }
  function normalisePrivacy_(value) {
    const result = String(value || "private").trim().toLowerCase();
    if (["private", "unlisted", "public"].indexOf(result) === -1) throw error_("Invalid YouTube privacy status.");
    return result;
  }
  function normalisePublishAt_(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const date = new Date(text);
    if (isNaN(date.getTime())) throw error_("Scheduled publication time is invalid.");
    if (date.getTime() <= Date.now() + 60000) {
      throw error_("Scheduled publication time must be at least one minute in the future.");
    }
    return date.toISOString();
  }
  function fileName_(title) {
    return String(title || "project-savannah-short").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").slice(0, 80);
  }
  function sanitise_(video) {
    return { id: video.id, kind: video.kind || "", status: video.status || {}, snippet: {
      title: video.snippet && video.snippet.title || ""
    } };
  }
  function error_(message) { const error = new Error(message); error.name = "YouTubeServiceError"; return error; }

  return { requireAuthorization: requireAuthorization, getChannel: getChannel, upload: upload, getVideo: getVideo };
})();

function authorizeYouTubePublishing() {
  return YouTubeService.requireAuthorization();
}
