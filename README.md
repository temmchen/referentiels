# Référentiels Mobil

Verschlüsselte iPhone/iPad-Fassung der Référentiels (Dashboard Pro, Kachel „Référentiels“) auf GitHub Pages:
https://temmchen.github.io/referentiels/ – Schuljahr → Klasse → Modul, Kurzfassung (Kompetenzen mit Gewichtung
und Punkten, Lernsituationen, Lerneinheiten) und die PDFs (Betrachter in der Seite, Teilen, offline).

Dieses Repo ist öffentlich und enthält **nur Programmcode und AES-256-GCM-Chiffrat** (`docs/vaults`). Passwörter
und Tresorschlüssel liegen außerhalb (`_Portal-Setup/geheim/Referentiels-…`, per Verknüpfung `zugangsdaten.json`,
`.build-state.json`, `.letzter-stand.json` – gitignored). Quelle der Inhalte: `KI/Referentiels` (OneDrive).

- `build.py` – Tresor bauen (PBKDF2-SHA256 600 000 → AES-256-GCM, Schema wie Dashboard Mobil)
- `veroeffentlichen.py` – holen, prüfen, bauen, Klartext-Prüfung, committen, pushen; `--pruefen` für den Portal-Wächter
- `verwaltung.py` – Zugänge, Passwort, Passwort-Übersicht nach `KI/Passwoerter`
- `docs/` – Oberfläche (index.html, sw.js, manifest, Icons, pdf.js) und `vaults/` (erzeugt)
