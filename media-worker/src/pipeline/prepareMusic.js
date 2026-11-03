import { chooseMusicSource, preflightMusic, validateMusicProbe } from "../lib/musicLicence.js";

// Everything that must succeed before the first paid step: the track is chosen from the verified
// manifest, its object exists, the file is downloaded into the job's work directory, and the
// downloaded file is probed for a real audio stream that lasts the whole video. I/O is injected so
// the refusal and download paths are testable without Google Cloud or ffprobe.
export async function prepareMusic({
  musicTrackId,
  legacyPlaceholderMusic,
  manifest,
  defaultPath,
  musicTrack,
  musicTrackPath,
  workDir,
  minSeconds,
  existsFn,
  downloadFn,
  probeFn
}) {
  const music = chooseMusicSource({
    musicTrackId,
    manifest,
    defaultPath,
    musicTrack,
    musicTrackPath,
    legacyPlaceholderMusic
  });
  await preflightMusic({ path: music.path, existsFn });
  const localPath = workDir.path("music.mp3");
  await downloadFn(music.path, localPath);
  const info = validateMusicProbe(await probeFn(localPath), { minSeconds });
  return { localPath, info, track: music.track, placeholder: music.placeholder };
}
