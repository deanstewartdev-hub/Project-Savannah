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
        visualBrief: buildVisualBrief_(script, group, narration, index),
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
      modelVersion: "scene-plan-v1.5-model-ready"
    };
  }

  function buildVisualBrief_(script, group, narration, index) {
    const directions = group.map(function (scene) {
      return String(scene && scene.visualDirection || "").trim();
    }).filter(Boolean);
    const purposes = [
      "instant hook and topic recognition",
      "clear evidence or discovery",
      "escalation through one readable action",
      "payoff reveal with a memorable final detail"
    ];
    const motionProfiles = [
      "immediate subject movement toward or across frame; fast visual recognition",
      "controlled environmental movement with one obvious focal action",
      "single physically plausible action with a clean camera follow",
      "decisive reveal or transformation followed by a stable payoff frame"
    ];
    return {
      scenePurpose: purposes[index] || "support the current narration beat",
      primaryAction: directions.join(" Then ") || String(narration || "").trim(),
      motionProfile: motionProfiles[index] || "one clear, physically plausible action",
      continuityAnchor: String(script.title || "the established subject and location").trim(),
      audioCue: String(narration || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0].slice(0, 180),
      evaluationCriteria: [
        "topic fidelity",
        "physical plausibility",
        "subject and setting continuity",
        "audio beat alignment",
        "caption-safe composition",
        "quality relative to generation cost"
      ],
      fallbackStrategy: "Preserve the same subject and composition as a strong still frame with a subtle push-in."
    };
  }

  function fitToDuration(plan, durationSeconds) {
    const duration = round_(Number(durationSeconds || 0), 2);
    if (!plan || !Array.isArray(plan.slots) || plan.slots.length !== SLOT_COUNT) {
      throw error_("A complete four-slot scene plan is required.");
    }
    if (duration < 30 || duration > 60) {
      throw error_("Measured narration duration is " + duration +
        " seconds; it must be between 30 and 60 seconds.");
    }
    const estimated = Number(plan.expectedDurationSeconds || 0);
    if (!estimated) throw error_("The scene plan has no estimated duration.");
    let allocated = 0;
    const slots = plan.slots.map(function (slot, index) {
      const slotDuration = index === SLOT_COUNT - 1
        ? round_(duration - allocated, 2)
        : round_(Number(slot.expectedDurationSeconds || 0) / estimated * duration, 2);
      allocated += slotDuration;
      return Object.assign({}, slot, { expectedDurationSeconds: slotDuration });
    });
    return Object.assign({}, plan, {
      slots: slots,
      expectedDurationSeconds: duration,
      estimatedDurationSeconds: estimated,
      timingSource: "measured-mp3",
      modelVersion: "scene-plan-v1.3-measured-audio"
    });
  }

  function fitToSlotDurations(plan, durations) {
    if (!plan || !Array.isArray(plan.slots) || plan.slots.length !== SLOT_COUNT) {
      throw error_("A complete four-slot scene plan is required.");
    }
    if (!Array.isArray(durations) || durations.length !== SLOT_COUNT) {
      throw error_("Four measured scene narration durations are required.");
    }
    const measured = durations.map(function (value) { return round_(Number(value || 0), 2); });
    if (measured.some(function (value) { return value <= 0; })) {
      throw error_("Every scene narration must have a measurable duration.");
    }
    const total = round_(measured.reduce(function (sum, value) { return sum + value; }, 0), 2);
    if (total < 30 || total > 60) {
      throw error_("Measured narration duration is " + total +
        " seconds; it must be between 30 and 60 seconds.");
    }
    return Object.assign({}, plan, {
      slots: plan.slots.map(function (slot, index) {
        return Object.assign({}, slot, { expectedDurationSeconds: measured[index] });
      }),
      expectedDurationSeconds: total,
      estimatedDurationSeconds: Number(plan.expectedDurationSeconds || 0),
      timingSource: "measured-scene-mp3s",
      modelVersion: "scene-plan-v1.4-measured-scenes"
    });
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
    const source = supplied.length ? supplied[0] : narration;
    return String(source || "").split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
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

  return { create: create, fitToDuration: fitToDuration, fitToSlotDurations: fitToSlotDurations };
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
