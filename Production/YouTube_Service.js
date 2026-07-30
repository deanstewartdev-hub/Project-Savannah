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
    const privacyStatus = normalisePrivacy_(source.privacyStatus);
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
    const video = YouTube.Videos.insert(resource, "snippet,status", videoBlob);
    if (!video || !video.id) throw error_("YouTube did not return a video ID.");
    return {
      videoId: video.id,
      videoUrl: "https://youtu.be/" + video.id,
      title: title,
      description: description,
      tags: tags,
      privacyStatus: privacyStatus,
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
  function fileName_(title) {
    return String(title || "project-savannah-short").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").slice(0, 80);
  }
  function sanitise_(video) {
    return { id: video.id, kind: video.kind || "", status: video.status || {}, snippet: {
      title: video.snippet && video.snippet.title || ""
    } };
  }
  function error_(message) { const error = new Error(message); error.name = "YouTubeServiceError"; return error; }

  return { requireAuthorization: requireAuthorization, getChannel: getChannel, upload: upload };
})();

function authorizeYouTubePublishing() {
  return YouTubeService.requireAuthorization();
}
