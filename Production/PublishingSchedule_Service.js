/****************************************************
 * Project Savannah v1.3 - YouTube schedule safety.
 ****************************************************/
const PublishingScheduleService = (() => {
  const MINIMUM_GAP_MINUTES = 60;
  const MINIMUM_GAP_MS = MINIMUM_GAP_MINUTES * 60 * 1000;

  function assertAvailable(publishAt, jobs, excludeRenderJobId, options) {
    const requested = normalise_(publishAt);
    if (!requested) return { scheduled: false, publishAt: "", conflicts: [] };
    const config = options || {}, timezoneOffsetMinutes = boundedInteger_(config.timezoneOffsetMinutes, -840, 840, 0);
    const maxPerDay = boundedInteger_(config.maxPerDay, 1, 5, 2), existing = upcoming(jobs);
    const conflicts = existing.filter(function (slot) {
      return slot.renderJobId !== String(excludeRenderJobId || "").trim() &&
        Math.abs(new Date(slot.publishAt).getTime() - new Date(requested).getTime()) < MINIMUM_GAP_MS;
    });
    if (conflicts.length) {
      throw error_(
        "Scheduled publication conflicts with '" + conflicts[0].title + "' at " +
        conflicts[0].publishAt + ". Keep at least " + MINIMUM_GAP_MINUTES + " minutes between Shorts."
      );
    }
    const requestedDate = localDateKey_(new Date(requested).getTime(), timezoneOffsetMinutes);
    const scheduledThatDay = existing.filter(function (slot) {
      return slot.renderJobId !== String(excludeRenderJobId || "").trim() &&
        localDateKey_(new Date(slot.publishAt).getTime(), timezoneOffsetMinutes) === requestedDate;
    });
    if (scheduledThatDay.length >= maxPerDay) {
      throw error_("The daily publishing limit of " + maxPerDay + " Shorts has already been reached for " + requestedDate + ".");
    }
    return { scheduled: true, publishAt: requested, conflicts: [] };
  }

  function upcoming(jobs) {
    const now = Date.now();
    return (Array.isArray(jobs) ? jobs : []).map(function (job) {
      const publishAt = normalise_(job && job.providerResponse && job.providerResponse.publishAt, true);
      return publishAt ? {
        publishingJobId: String(job.id || ""),
        renderJobId: String(job.renderJobId || ""),
        title: String(job.title || "Untitled Short"),
        publishAt: publishAt,
        youtubeUrl: String(job.youtubeUrl || ""),
        privacyStatus: String(job.privacyStatus || "private")
      } : null;
    }).filter(function (slot) {
      return slot && new Date(slot.publishAt).getTime() > now;
    }).sort(function (a, b) {
      return new Date(a.publishAt) - new Date(b.publishAt);
    });
  }

  function suggestSlots(jobs, options) {
    const config = options || {};
    const timezoneOffsetMinutes = boundedInteger_(config.timezoneOffsetMinutes, -840, 840, 0);
    const maxPerDay = boundedInteger_(config.maxPerDay, 1, 5, 2);
    const limit = boundedInteger_(config.limit, 1, 20, 6);
    const daysAhead = boundedInteger_(config.daysAhead, 1, 31, 14);
    const dailyTimes = normaliseTimes_(config.dailyTimes || ["12:00", "18:00"]);
    const now = config.now ? new Date(config.now).getTime() : Date.now();
    if (!isFinite(now)) throw error_("The scheduling reference time is invalid.");
    const scheduled = upcomingAt_(jobs, now), counts = {};
    scheduled.forEach(function (slot) {
      const key = localDateKey_(new Date(slot.publishAt).getTime(), timezoneOffsetMinutes);
      counts[key] = (counts[key] || 0) + 1;
    });
    const localNow = new Date(now - timezoneOffsetMinutes * 60000), suggestions = [];
    for (let day = 0; day < daysAhead && suggestions.length < limit; day++) {
      const localDay = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + day));
      const dateKey = localDay.toISOString().slice(0, 10);
      if ((counts[dateKey] || 0) >= maxPerDay) continue;
      for (let index = 0; index < dailyTimes.length && suggestions.length < limit; index++) {
        if ((counts[dateKey] || 0) >= maxPerDay) break;
        const parts = dailyTimes[index].split(":");
        const utcMs = Date.UTC(localDay.getUTCFullYear(), localDay.getUTCMonth(), localDay.getUTCDate(),
          Number(parts[0]), Number(parts[1])) + timezoneOffsetMinutes * 60000;
        if (utcMs <= now + 60000) continue;
        const conflicts = scheduled.concat(suggestions).some(function (slot) {
          return Math.abs(new Date(slot.publishAt).getTime() - utcMs) < MINIMUM_GAP_MS;
        });
        if (conflicts) continue;
        suggestions.push({ publishAt: new Date(utcMs).toISOString(), localDate: dateKey,
          localTime: dailyTimes[index], timezoneOffsetMinutes: timezoneOffsetMinutes });
        counts[dateKey] = (counts[dateKey] || 0) + 1;
      }
    }
    return { slots: suggestions, dailyTimes: dailyTimes, maxPerDay: maxPerDay,
      timezoneOffsetMinutes: timezoneOffsetMinutes };
  }

  function upcomingAt_(jobs, now) {
    return (Array.isArray(jobs) ? jobs : []).map(function (job) {
      const publishAt = normalise_(job && job.providerResponse && job.providerResponse.publishAt, true);
      return publishAt ? { publishingJobId: String(job.id || ""), renderJobId: String(job.renderJobId || ""),
        title: String(job.title || "Untitled Short"), publishAt: publishAt } : null;
    }).filter(function (slot) { return slot && new Date(slot.publishAt).getTime() > now; });
  }

  function normaliseTimes_(times) {
    const unique = {};
    const result = (Array.isArray(times) ? times : []).map(function (value) {
      const match = String(value || "").trim().match(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
      if (!match) throw error_("Daily publishing times must use 24-hour HH:MM format.");
      return match[0];
    }).filter(function (value) {
      if (unique[value]) return false;
      unique[value] = true; return true;
    }).sort();
    if (!result.length) throw error_("At least one daily publishing time is required.");
    return result;
  }

  function localDateKey_(utcMs, timezoneOffsetMinutes) {
    return new Date(utcMs - timezoneOffsetMinutes * 60000).toISOString().slice(0, 10);
  }

  function boundedInteger_(value, minimum, maximum, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw error_("A scheduling rule contains an invalid number.");
    }
    return number;
  }

  function normalise_(value, allowPast) {
    const text = String(value || "").trim();
    if (!text) return "";
    const date = new Date(text);
    if (isNaN(date.getTime())) throw error_("Scheduled publication time is invalid.");
    if (!allowPast && date.getTime() <= Date.now() + 60000) {
      throw error_("Scheduled publication time must be at least one minute in the future.");
    }
    return date.toISOString();
  }

  function error_(message) {
    const error = new Error(message);
    error.name = "PublishingScheduleError";
    return error;
  }

  return { assertAvailable: assertAvailable, upcoming: upcoming, suggestSlots: suggestSlots };
})();
