#!/usr/bin/env python3
"""Local speaker diarization for the X broadcast import (scripts/calls/x-import.mjs, `diarize` step).

Reads a 16 kHz mono WAV, runs pyannote.audio's speaker-diarization pipeline on the best local device
(Apple GPU "mps", else CPU) and writes an RTTM file: who spoke when, no text.

The Hugging Face token (the model's terms must be accepted on that account) is read from the HF_TOKEN
environment variable. It is never taken from an argument, a file in the repo or stdout.

Run with the project venv, isolated:  <workdir>/.venv/bin/python -I diarize.py --wav in.wav --out out.rttm
"""
import argparse
import os
import sys
import wave

PIPELINE = "pyannote/speaker-diarization-3.1"


def load_wav(path, torch):
    """Decode the 16-bit PCM WAV here, so pyannote does not need torchcodec's matching FFmpeg libraries."""
    with wave.open(path, "rb") as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() != 1:
            raise ValueError("expected a 16-bit mono WAV")
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())
    samples = torch.frombuffer(bytearray(frames), dtype=torch.int16).float() / 32768.0
    return {"waveform": samples.unsqueeze(0), "sample_rate": rate}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--wav", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--num-speakers", type=int)
    ap.add_argument("--min-speakers", type=int)
    ap.add_argument("--max-speakers", type=int)
    ap.add_argument("--pipeline", default=PIPELINE)
    args = ap.parse_args()

    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        print("HF_TOKEN is not set (see docs/x-call-import.md)", file=sys.stderr)
        return 2
    if not os.path.isfile(args.wav):
        print("input wav not found", file=sys.stderr)
        return 2

    import torch
    from pyannote.audio import Pipeline

    try:
        pipeline = Pipeline.from_pretrained(args.pipeline, token=token)
    except TypeError:  # older pyannote.audio releases call the argument use_auth_token
        pipeline = Pipeline.from_pretrained(args.pipeline, use_auth_token=token)
    if pipeline is None:
        print("could not load the pipeline: accept the model terms on the Hugging Face account of HF_TOKEN", file=sys.stderr)
        return 3

    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")
    pipeline.to(device)

    options = {}
    if args.num_speakers:
        options["num_speakers"] = args.num_speakers
    if args.min_speakers:
        options["min_speakers"] = args.min_speakers
    if args.max_speakers:
        options["max_speakers"] = args.max_speakers

    result = pipeline(load_wav(args.wav, torch), **options)
    # pyannote.audio 4 wraps the annotation; 3.x returns it directly.
    annotation = getattr(result, "speaker_diarization", result)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        annotation.write_rttm(fh)
    os.replace(tmp, args.out)
    speakers = len(annotation.labels())
    print(f"diarized: {speakers} speaker(s) on {device.type}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
