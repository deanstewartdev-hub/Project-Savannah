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
    // The publishing record ID is the upload attempt the owner reviewed. Its tracking tag is part of the
    // reviewed tags, so the same ID is used to build the plan (see previewUpload).
    if (!source.publishingJobId) throw error_("An upload needs its publishing record ID.");
    // The same plan the owner reviewed: refused before the MP4 is downloaded when the render has no
    // verified music record, or its required credit is missing.
    const plan = uploadPlan_(renderJob, seoPack, Object.assign({}, source, { uploadAttemptId: source.publishingJobId }));
    const title = plan.title;
    const description = plan.description;
    const tags = plan.tags.slice();
    const publishAt = plan.publishAt;
    const privacyStatus = plan.privacyStatus;
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

  // Everything the owner approves, computed in one place so the review and the upload cannot disagree.
  // Throws when the render cannot be uploaded at all.
  function uploadPlan_(renderJob, seoPack, source) {
    const title = String(source.title || seoPack.titleOptions && seoPack.titleOptions[0] || "").trim().slice(0, 100);
    if (!title) throw error_("A YouTube title is required.");
    const music = musicOf_(renderJob);
    const publishAt = normalisePublishAt_(source.publishAt);
    return {
      renderJobId: String(renderJob.id || ""),
      uploadAttemptId: String(source.uploadAttemptId || ""),
      title: title,
      description: buildDescription_(source.description || seoPack.description, seoPack.hashtags, music.credit),
      tags: finalTags_(seoPack.tags, source.uploadAttemptId),
      privacyStatus: publishAt ? "private" : normalisePrivacy_(source.privacyStatus),
      publishAt: publishAt,
      music: music
    };
  }

  // The tags YouTube receives: the owner's tags followed by the internal tracking tag. Owner tags are
  // dropped from the end until the whole list fits YouTube's 500-character limit, so the tracking tag is
  // always kept. The same function serves the review and the upload, so they cannot differ.
  function finalTags_(ownerTags, uploadAttemptId) {
    const tags = normaliseTags_(ownerTags);
    if (!uploadAttemptId) return tags;
    const internal = uploadTag_(uploadAttemptId);
    // YouTube counts commas and quotes around tags containing spaces toward 500 characters.
    while (tags.length && tagLength_(tags.concat([internal])) > 500) tags.pop();
    return tags.concat([internal]);
  }

  // Read-only. Returns the exact details for owner review, with a digest that the upload must match.
  // If anything the owner sees changes, the digest changes and the upload is refused until re-review.
  function previewUpload(renderJob, seoPack, options) {
    if (!renderJob || renderJob.status !== "SUCCEEDED" || !renderJob.videoUrl) {
      throw error_("Only a completed render can be uploaded.");
    }
    const source = options || {};
    // Read-only: the attempt ID is allocated by the caller and saved only when the upload is approved, so
    // a preview never writes a publishing record.
    if (!source.uploadAttemptId) throw error_("A review needs an upload attempt ID.");
    const plan = uploadPlan_(renderJob, seoPack, source);
    return {
      renderJobId: plan.renderJobId,
      uploadAttemptId: plan.uploadAttemptId,
      title: plan.title,
      description: plan.description,
      tags: plan.tags,
      privacyStatus: plan.privacyStatus,
      publishAt: plan.publishAt,
      music: plan.music,
      metadataHash: metadataHash_(plan)
    };
  }

  // Binds the approval to the render, the upload attempt and every field the upload sends, including
  // the final tags and the tracking tag.
  function metadataHash_(plan) {
    const fields = JSON.stringify([plan.renderJobId, plan.uploadAttemptId, plan.title, plan.description, plan.tags,
      plan.privacyStatus, plan.publishAt, plan.music.id, plan.music.credit]);
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, fields)
      .map(function (byte) { return ("0" + (byte & 255).toString(16)).slice(-2); }).join("");
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

  // The music credit comes from the verified track recorded with the render (see
  // VideoProcessingProvider.submitRender). Legacy renders have no record and cannot be uploaded.
  function musicOf_(renderJob) {
    const music = renderJob && renderJob.requestPayload && renderJob.requestPayload.music;
    if (!music || !music.id) {
      throw error_("This render has no verified music record, so it cannot be uploaded. Render it again with a verified track.");
    }
    let credit = "";
    if (music.attributionRequired === true) {
      credit = String(music.attribution || "").trim();
      if (!credit) throw error_("The music track's required credit text is missing, so the upload is refused.");
    }
    return {
      id: String(music.id),
      title: String(music.title || ""),
      licence: String(music.licence || ""),
      sourceUrl: String(music.sourceUrl || ""),
      credit: credit
    };
  }

  // The disclosure, music credit and hashtags are always kept. Only the owner's description text is
  // shortened to fit YouTube's 5000-character limit, so the required credit can never be cut off.
  function buildDescription_(description, hashtags, musicCredit) {
    const disclosure = "Narration in this video was generated using an AI voice.";
    const hashLine = (Array.isArray(hashtags) ? hashtags : []).map(function (tag) {
      const value = String(tag || "").trim();
      return value ? (value.charAt(0) === "#" ? value : "#" + value.replace(/\s+/g, "")) : "";
    }).filter(Boolean).join(" ");
    const tail = [disclosure]
      .concat(musicCredit ? ["Music: " + musicCredit] : [])
      .concat(hashLine ? [hashLine] : [])
      .join("\n\n");
    const body = String(description || "").trim().slice(0, Math.max(0, 5000 - tail.length - 2));
    return body ? body + "\n\n" + tail : tail;
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

  return { requireAuthorization: requireAuthorization, getChannel: getChannel, upload: upload, previewUpload: previewUpload,
    getVideo: getVideo, findUpload: findUpload };
})();

function authorizeYouTubePublishing() {
  return YouTubeService.requireAuthorization();
}
