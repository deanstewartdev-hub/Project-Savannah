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
    // A staging project is authorised as the owner, so YouTube here is the REAL channel.
    assertNotStaging_("YouTube upload");
    const source = options || {};
    const title = String(source.title || seoPack.titleOptions && seoPack.titleOptions[0] || "").trim().slice(0, 100);
    if (!title) throw error_("A YouTube title is required.");
    const description = buildDescription_(source.description || seoPack.description, seoPack.hashtags);
    const tags = normaliseTags_(seoPack.tags);
    if (source.publishingJobId) {
      const uploadTag = uploadTag_(source.publishingJobId);
      // YouTube counts commas and quotes around tags containing spaces toward 500 characters.
      while (tags.length && tagLength_(tags.concat([uploadTag])) > 500) tags.pop();
      tags.push(uploadTag);
    }
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
    let video;
    try {
      video = YouTube.Videos.insert(resource, "snippet,status", videoBlob);
      if (!video || !video.id) throw error_("YouTube did not return a video ID.");
    } catch (caught) {
      const uncertain = error_("YouTube upload completion is unknown. Check YouTube Studio or reconcile the upload before retrying.");
      uncertain.uploadUncertain = true;
      throw uncertain;
    }
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

  function findUpload(job) {
    const tag = uploadTag_(job.id);
    const channels = YouTube.Channels.list("id,contentDetails", { mine: true });
    const channel = channels && channels.items && channels.items[0];
    const playlist = channel && channel.contentDetails && channel.contentDetails.relatedPlaylists &&
      channel.contentDetails.relatedPlaylists.uploads;
    if (!playlist) throw error_("The authorized YouTube channel uploads playlist was not found.");
    const matches = [];
    let pageToken = "";
    // Bound quota and execution time. Absence is never permission to re-upload.
    for (let page = 0; page < 5; page++) {
      const options = { playlistId: playlist, maxResults: 50 };
      if (pageToken) options.pageToken = pageToken;
      const response = YouTube.PlaylistItems.list("contentDetails", options);
      const ids = (response.items || []).map(function (item) {
        return item.contentDetails && item.contentDetails.videoId;
      }).filter(Boolean);
      if (ids.length) {
        const videos = YouTube.Videos.list("id,snippet,status,processingDetails", { id: ids.join(",") });
        (videos.items || []).forEach(function (video) {
          if (video.snippet && video.snippet.channelId === channel.id &&
              (video.snippet.tags || []).indexOf(tag) !== -1 &&
              !matches.some(function (match) { return match.id === video.id; })) matches.push(video);
        });
      }
      pageToken = response.nextPageToken || "";
      if (!pageToken) break;
    }
    if (matches.length > 1) throw error_("Multiple matching YouTube uploads exist. Check YouTube Studio before continuing.");
    if (!matches.length) return null;
    const video = matches[0];
    if (!video.status || ["failed", "rejected", "deleted"].indexOf(video.status.uploadStatus) !== -1) {
      throw error_("The matching YouTube upload needs review. Check YouTube Studio before continuing.");
    }
    return {
      videoId: video.id, videoUrl: "https://youtu.be/" + video.id,
      privacyStatus: video.status.privacyStatus,
      publishAt: video.status.publishAt || "",
      uploadStatus: video.status.uploadStatus || "",
      processingStatus: video.processingDetails && video.processingDetails.processingStatus || "",
      response: sanitise_(video)
    };
  }

  function uploadTag_(id) {
    const value = String(id || "").trim();
    if (!/^PUB-[A-Za-z0-9-]+$/.test(value)) throw error_("A valid publishing job ID is required.");
    return "savannah-upload-" + value;
  }

  function tagLength_(tags) {
    return tags.reduce(function (length, tag) {
      return length + tag.length + (/\s/.test(tag) ? 2 : 0);
    }, Math.max(0, tags.length - 1));
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
    const disclosure = "Narration in this video was generated using an AI voice.";
    const hashLine = (Array.isArray(hashtags) ? hashtags : []).map(function (tag) {
      const value = String(tag || "").trim();
      return value ? (value.charAt(0) === "#" ? value : "#" + value.replace(/\s+/g, "")) : "";
    }).filter(Boolean).join(" ");
    return (body + "\n\n" + disclosure + (hashLine ? "\n\n" + hashLine : "")).slice(0, 5000);
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

  return { requireAuthorization: requireAuthorization, getChannel: getChannel, upload: upload, getVideo: getVideo,
    findUpload: findUpload };
})();

function authorizeYouTubePublishing() {
  return YouTubeService.requireAuthorization();
}
