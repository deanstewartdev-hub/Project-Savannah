/****************************************************
 * Project Savannah v1.3 - deterministic render plan.
 ****************************************************/
const ScenePlanService = (() => {
  const SLOT_COUNT = 4;
  const WORDS_PER_SECOND = 2.0;

  function create(script) {
    if (!script || !script.id) throw error_("A valid script is required.");
    const voiceover = String(script.voiceoverScript || "").trim();
    if (!voiceover) throw error_("The script has no complete voiceover.");
    const originalScenes = Array.isArray(script.scenes) ? script.scenes : [];
    if (!originalScenes.length) throw error_("The script has no scenes.");

    const sceneGroups = groupScenes_(originalScenes, SLOT_COUNT);
    const narrationParts = narrationForGroups_(sceneGroups, voiceover);
    const slots = narrationParts.map(function (narration, index) {
      const group = sceneGroups[index] || [];
      const expectedDurationSeconds = round_(Math.max(
        3,
        countWords_(narration) / WORDS_PER_SECOND
      ), 2);
      return {
        slotNumber: index + 1,
        sourceSceneNumbers: group.map(function (scene, sceneIndex) {
          return Number(scene.sceneNumber) || sceneIndex + 1;
        }),
        narration: narration,
        onScreenText: onScreenText_(group, narration),
        visualDirection: group.map(function (scene) {
          return String(scene && scene.visualDirection || "").trim();
        }).filter(Boolean).join(" Then "),
        expectedDurationSeconds: expectedDurationSeconds
      };
    });

    const expectedDurationSeconds = round_(slots.reduce(function (total, slot) {
      return total + slot.expectedDurationSeconds;
    }, 0), 2);

    if (expectedDurationSeconds < 30 || expectedDurationSeconds > 60) {
      throw error_(
        "Planned narration duration is " + expectedDurationSeconds +
        " seconds; it must be between 30 and 60 seconds."
      );
    }

    return {
      scriptId: script.id,
      sourceSceneCount: originalScenes.length,
      slotCount: slots.length,
      expectedDurationSeconds: expectedDurationSeconds,
      voiceoverWordCount: countWords_(voiceover),
      slots: slots,
      modelVersion: "scene-plan-v1.2-continuous"
    };
  }

  function narrationForGroups_(sceneGroups, voiceover) {
    const grouped = sceneGroups.map(function (group) {
      return group.map(function (scene) {
        return String(scene && scene.narration || "").trim();
      }).filter(Boolean).join(" ");
    });
    const rebuilt = grouped.join(" ").replace(/\s+/g, " ").trim();
    const complete = String(voiceover || "").replace(/\s+/g, " ").trim();
    return rebuilt === complete && grouped.every(Boolean)
      ? grouped
      : splitVoiceover_(voiceover, SLOT_COUNT);
  }

  function splitVoiceover_(voiceover, slotCount) {
    const sentences = String(voiceover).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [voiceover];
    const clean = sentences.map(function (sentence) {
      return String(sentence).replace(/\s+/g, " ").trim();
    }).filter(Boolean);
    const groups = Array.from({ length: slotCount }, function () { return []; });
    const totalWords = countWords_(voiceover);
    const targetWords = totalWords / slotCount;
    let slot = 0;
    let slotWords = 0;

    clean.forEach(function (sentence, index) {
      const remainingSentences = clean.length - index;
      const remainingSlots = slotCount - slot;
      if (
        slot < slotCount - 1 &&
        slotWords > 0 &&
        slotWords + countWords_(sentence) > targetWords &&
        remainingSentences >= remainingSlots
      ) {
        slot += 1;
        slotWords = 0;
      }
      groups[slot].push(sentence);
      slotWords += countWords_(sentence);
    });

    for (let index = 0; index < groups.length; index++) {
      if (!groups[index].length) {
        const donor = groups.findIndex(function (group) { return group.length > 1; });
        if (donor === -1) throw error_("The voiceover cannot be divided into four render slots.");
        groups[index].push(groups[donor].pop());
      }
    }

    return groups.map(function (group) { return group.join(" "); });
  }

  function groupScenes_(scenes, slotCount) {
    const groups = Array.from({ length: slotCount }, function () { return []; });
    scenes.forEach(function (scene, index) {
      const target = Math.min(slotCount - 1, Math.floor(index * slotCount / scenes.length));
      groups[target].push(scene);
    });
    return groups;
  }

  function onScreenText_(scenes, narration) {
    const supplied = scenes.map(function (scene) {
      return String(scene && scene.onScreenText || "").trim();
    }).filter(Boolean);
    if (supplied.length) return supplied.join(" • ").slice(0, 80);
    return narration.split(/\s+/).slice(0, 7).join(" ");
  }

  function countWords_(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
  }
  function round_(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }
  function error_(message) {
    const error = new Error(message);
    error.name = "ScenePlanServiceError";
    return error;
  }

  return { create: create };
})();

function testScenePlanPreservesCompleteVoiceover() {
  const voiceover = [
    "A harmless travel habit could get you fined abroad.",
    "Japan has rules that surprise even experienced visitors.",
    "Some escalators expect you to stand on a particular side.",
    "Quiet trains make loud phone calls feel especially disruptive.",
    "Shoes must come off in places tourists do not always expect.",
    "Even rubbish disposal follows local routines worth learning.",
    "The real secret is observing locals before acting.",
    "That simple pause prevents awkward mistakes and shows respect.",
    "It also makes every conversation feel calmer and more confident.",
    "You notice details that rushed visitors walk straight past.",
    "Follow Savannah Atlas for smarter cultural shortcuts."
  ].join(" ");
  const plan = ScenePlanService.create({
    id: "SCR-TEST",
    voiceoverScript: voiceover,
    scenes: Array.from({ length: 7 }, function (_, index) {
      return {
        sceneNumber: index + 1,
        onScreenText: "Japan fact " + (index + 1),
        visualDirection: "Show Japanese culture scene " + (index + 1)
      };
    })
  });
  const rebuilt = plan.slots.map(function (slot) { return slot.narration; }).join(" ");
  if (rebuilt !== voiceover || plan.slotCount !== 4 || plan.sourceSceneCount !== 7) {
    throw new Error("Scene plan did not preserve the complete voiceover.");
  }
  return { passed: true, expectedDurationSeconds: plan.expectedDurationSeconds };
}
