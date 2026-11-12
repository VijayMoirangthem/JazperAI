from api.routes.voice import sniff_audio


def test_sniff_audio_detects_the_real_format():
    assert sniff_audio(b"\x00\x00\x00\x20ftypM4A \x00\x00")[0] == ".m4a"       # what the phone records (no file name is sent)
    assert sniff_audio(b"RIFF\x24\x00\x00\x00WAVE")[0] == ".wav"
    assert sniff_audio(bytes.fromhex("1a45dfa3") + b"\x00" * 8)[0] == ".webm"  # the browser
    assert sniff_audio(b"OggS\x00\x02\x00\x00\x00\x00")[0] == ".ogg"
    assert sniff_audio(b"ID3\x04\x00\x00\x00\x00\x00\x00")[0] == ".mp3"
    assert sniff_audio(b"????????????", "audio/wav")[0] == ".wav"               # unknown bytes: fall back to the declared type
    assert sniff_audio(b"????????????")[0] == ".webm"
