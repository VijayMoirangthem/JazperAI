"""
Voice Profile Service — Option D (Phases Advanced).

Analyzes a user's voice recording to determine:
  - Pitch range (Hz)     → estimated gender
  - Mean F0              → age range estimate
  - Speech rate          → energy/tempo

Maps the analysis to Edge-TTS voice assignments per personality and
generates age/gender variants using SSML <prosody> tags.

If librosa is not installed, falls back to manual profile mode where the
user self-selects gender + age range and the mapping is still applied.
"""

import structlog

log = structlog.get_logger()

# ── Voice assignments ──────────────────────────────────────────────────────────

# Best-fit Edge-TTS voices per personality, indexed by detected gender.
# Voices chosen for character fit, not just gender match.
PERSONALITY_VOICES: dict[str, dict[str, str]] = {
    "male": {
        "past-self":      "en-US-GuyNeural",          # youthful male
        "current-self":   "en-US-DavisNeural",        # expressive, versatile
        "future-self":    "en-US-TonyNeural",         # confident, authoritative
        "logical-self":   "en-US-ChristopherNeural",  # clear, measured
        "emotional-self": "en-US-JasonNeural",        # warm, casual
    },
    "female": {
        "past-self":      "en-US-JaneNeural",         # bright, younger female
        "current-self":   "en-US-AriaNeural",         # expressive, warm
        "future-self":    "en-US-ElizabethNeural",    # poised, confident
        "logical-self":   "en-US-CoraNeural",         # neutral, precise
        "emotional-self": "en-US-JennyNeural",        # warm, approachable
    },
}

# Age/era variants — prosody tags applied on top of the base voice.
# 'voice_override' replaces the base voice entirely (for child).
AGE_VARIANTS: dict[str, dict] = {
    "child": {
        "label":          "Child (~10 yr)",
        "emoji":          "👦",
        "voice_override": "en-US-AnaNeural",   # Edge-TTS's dedicated child voice
        "prosody":        "pitch='+25%' rate='+8%'",
    },
    "teen": {
        "label":   "Teen (~16 yr)",
        "emoji":   "🧑",
        "prosody": "pitch='+12%' rate='+5%'",
    },
    "current": {
        "label":   "Current (you)",
        "emoji":   "🎯",
        "prosody": "",    # no modification — use base voice as-is
    },
    "mature": {
        "label":   "Mature (~45 yr)",
        "emoji":   "🧔",
        "prosody": "pitch='-10%' rate='-3%'",
    },
    "elder": {
        "label":   "Elder (~65 yr)",
        "emoji":   "🧓",
        "prosody": "pitch='-22%' rate='-10%'",
    },
    "alt_gender_m": {
        "label":          "Male alternative",
        "emoji":          "👨",
        "voice_override": "en-US-DavisNeural",
        "prosody":        "",
    },
    "alt_gender_f": {
        "label":          "Female alternative",
        "emoji":          "👩",
        "voice_override": "en-US-AriaNeural",
        "prosody":        "",
    },
}


# ── Pitch-based classification ─────────────────────────────────────────────────

def classify_voice(mean_f0_hz: float) -> dict:
    """
    Classify a speaker from their mean fundamental frequency.
    Returns: {gender, age_range, confidence}
    """
    if mean_f0_hz <= 0:
        return {"gender": "unknown", "age_range": "adult", "confidence": 0.0}

    if mean_f0_hz > 250:
        gender, age_range = "female", "child-young adult"
    elif mean_f0_hz > 195:
        gender, age_range = "female", "adult"
    elif mean_f0_hz > 165:
        gender, age_range = "female", "mature adult"
    elif mean_f0_hz > 145:
        gender, age_range = "male", "young adult (teen-20s)"
    elif mean_f0_hz > 120:
        gender, age_range = "male", "adult (25-45)"
    elif mean_f0_hz > 95:
        gender, age_range = "male", "mature adult (45-60)"
    else:
        gender, age_range = "male", "older adult (60+)"

    confidence = min(0.95, 0.5 + abs(mean_f0_hz - 160) / 200)
    return {"gender": gender, "age_range": age_range, "confidence": round(confidence, 2)}


# ── Audio analysis ─────────────────────────────────────────────────────────────

def analyze_audio(audio_bytes: bytes, sample_rate: int = 22050) -> dict:
    """
    Analyze voice recording bytes.
    Returns pitch stats + classification.
    Falls back to {analyzed: False} if librosa is unavailable.
    """
    try:
        import io
        import numpy as np

        try:
            import librosa
        except ImportError:
            log.info("voice_profile: librosa not installed — manual mode")
            return {"analyzed": False, "reason": "librosa_not_installed"}

        import soundfile as sf

        # Decode audio
        try:
            y, sr = sf.read(io.BytesIO(audio_bytes))
            if y.ndim > 1:
                y = y.mean(axis=1)   # stereo → mono
            if sr != sample_rate:
                y = librosa.resample(y, orig_sr=sr, target_sr=sample_rate)
        except Exception:
            # Try librosa's native loader as fallback
            y, _ = librosa.load(io.BytesIO(audio_bytes), sr=sample_rate, mono=True)

        # Pitch via pyin (more robust than yin for speech)
        f0, voiced_flag, _ = librosa.pyin(
            y,
            fmin=librosa.note_to_hz("C2"),   # ~65 Hz
            fmax=librosa.note_to_hz("C6"),   # ~1047 Hz
            sr=sample_rate,
        )

        voiced_f0 = f0[voiced_flag & ~np.isnan(f0)]
        if len(voiced_f0) < 10:
            return {"analyzed": False, "reason": "insufficient_voiced_frames"}

        mean_f0  = float(np.mean(voiced_f0))
        std_f0   = float(np.std(voiced_f0))
        min_f0   = float(np.min(voiced_f0))
        max_f0   = float(np.max(voiced_f0))

        # Speech rate: onset strength → proxy for syllable rate
        onset_env   = librosa.onset.onset_strength(y=y, sr=sample_rate)
        onsets      = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sample_rate)
        duration_s  = len(y) / sample_rate
        speech_rate = len(onsets) / duration_s if duration_s > 0 else 0

        classification = classify_voice(mean_f0)

        return {
            "analyzed":     True,
            "mean_f0_hz":   round(mean_f0, 1),
            "std_f0_hz":    round(std_f0, 1),
            "min_f0_hz":    round(min_f0, 1),
            "max_f0_hz":    round(max_f0, 1),
            "speech_rate":  round(speech_rate, 2),  # onsets/sec
            "duration_s":   round(duration_s, 1),
            **classification,
        }

    except Exception as e:
        log.warning("voice_profile: analysis failed", error=str(e))
        return {"analyzed": False, "reason": str(e)}


# ── Voice assignment ───────────────────────────────────────────────────────────

def build_voice_assignment(gender: str) -> dict[str, str]:
    """
    Return the recommended Edge-TTS voice per personality for the given gender.
    Falls back to 'male' set if gender is unknown.
    """
    key = "female" if gender == "female" else "male"
    return dict(PERSONALITY_VOICES[key])


def build_age_variants(base_voice: str, gender: str) -> list[dict]:
    """
    Build the list of age/gender variant configs for the UI preview buttons.
    base_voice: the user's detected current voice (e.g. 'en-US-DavisNeural')
    """
    variants = []
    for key, cfg in AGE_VARIANTS.items():
        # Skip opposite-gender alt that matches the user's detected gender
        if key == "alt_gender_m" and gender == "male":
            continue
        if key == "alt_gender_f" and gender == "female":
            continue

        voice = cfg.get("voice_override") or base_voice
        variants.append({
            "id":      key,
            "label":   cfg["label"],
            "emoji":   cfg["emoji"],
            "voice":   voice,
            "prosody": cfg.get("prosody", ""),
        })
    return variants


def apply_prosody(text: str, prosody_str: str) -> str:
    """
    Wrap text in SSML <prosody> tag if a prosody string is provided.
    Edge-TTS accepts SSML when text starts with <speak>.
    """
    if not prosody_str:
        return text
    return f"<speak><prosody {prosody_str}>{text}</prosody></speak>"


# ── Big Five → personality trait mapping ──────────────────────────────────────

def big_five_to_traits(big_five: dict) -> dict[str, dict[str, float]]:
    """
    Map Big Five scores (0-100 each) to personality trait overrides.
    Returns per-personality overrides: {personality_id: {riskTolerance, logicLevel, emotionLevel, optimism}}
    """
    o = big_five.get("openness",          50) / 100
    c = big_five.get("conscientiousness", 50) / 100
    e = big_five.get("extraversion",      50) / 100
    a = big_five.get("agreeableness",     50) / 100
    n = big_five.get("neuroticism",       50) / 100

    def clamp(v: float) -> float:
        return round(max(0.05, min(0.99, v)), 2)

    return {
        "past-self": {
            "riskTolerance": clamp(0.25 - n * 0.15 + o * 0.10),
            "logicLevel":    clamp(0.50 + c * 0.15),
            "emotionLevel":  clamp(0.75 + n * 0.15 - c * 0.10),
            "optimism":      clamp(0.45 + e * 0.10 - n * 0.15),
        },
        "current-self": {
            "riskTolerance": clamp(0.55 + o * 0.15 - n * 0.10),
            "logicLevel":    clamp(0.70 + c * 0.10),
            "emotionLevel":  clamp(0.55 - c * 0.10 + a * 0.10),
            "optimism":      clamp(0.65 + e * 0.10 - n * 0.10),
        },
        "future-self": {
            "riskTolerance": clamp(0.80 + o * 0.10),
            "logicLevel":    clamp(0.80 + c * 0.05),
            "emotionLevel":  clamp(0.40 + a * 0.10),
            "optimism":      clamp(0.85 - n * 0.05),
        },
        "logical-self": {
            "riskTolerance": clamp(0.50),
            "logicLevel":    clamp(0.95),
            "emotionLevel":  clamp(0.10 + a * 0.05),
            "optimism":      clamp(0.50),
        },
        "emotional-self": {
            "riskTolerance": clamp(0.40 - n * 0.10 + e * 0.10),
            "logicLevel":    clamp(0.20 + c * 0.10),
            "emotionLevel":  clamp(0.95),
            "optimism":      clamp(0.60 + e * 0.10 - n * 0.10),
        },
    }
