"""Transcrit tous les .ogg d'un dossier avec faster-whisper sur le GPU.

Usage : py transcrire.py <dossier> [modele]
Sortie : un .txt par vocal + un recap transcriptions.md trie par heure.
"""
import sys
import pathlib
import datetime
from faster_whisper import WhisperModel

dossier = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
modele = sys.argv[2] if len(sys.argv) > 2 else "large-v3"

fichiers = sorted(dossier.glob("*.ogg"))
if not fichiers:
    print("aucun .ogg dans", dossier)
    sys.exit(1)

print(f"{len(fichiers)} vocal(s), modele {modele} sur GPU")
model = WhisperModel(modele, device="cuda", compute_type="float16")

lignes = []
for f in fichiers:
    segments, info = model.transcribe(str(f), language="fr", vad_filter=True, beam_size=5)
    texte = " ".join(s.text.strip() for s in segments).strip()
    (f.with_suffix(".txt")).write_text(texte, encoding="utf-8")
    heure = f.stem.split(" at ")[-1] if " at " in f.stem else ""
    lignes.append((heure, f.name, round(info.duration), texte))
    print(f"  {f.name} ({round(info.duration)} s) -> {len(texte)} caracteres")

recap = dossier / "transcriptions.md"
with recap.open("w", encoding="utf-8") as fh:
    fh.write(f"# Transcriptions des vocaux WhatsApp\n\n")
    fh.write(f"Genere le {datetime.date.today().strftime('%d/%m/%Y')} depuis {dossier.name}\n\n")
    for heure, nom, duree, texte in lignes:
        fh.write(f"## {heure} ({duree} s)\n\n{texte or '(vide)'}\n\n")
print("recap ->", recap)
