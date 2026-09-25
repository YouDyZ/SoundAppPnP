# PnP Soundboard

Ein browserbasiertes Soundboard, um für Pen&Paper-Runden mehrere YouTube- bzw.
YouTube-Music-Links als unabhängige Audio-Ebenen (Ambience, Musik, Soundeffekte, …)
gleichzeitig abzuspielen und live zu mischen.

Rein statisch: nur HTML/CSS/JS, Speicherung ausschließlich über `localStorage` im
Browser. Kein Build-Schritt, kein Backend — nur ein simpler statischer
Webserver (siehe „Lokal ausführen“).

## Lokal ausführen

Die App braucht einen HTTP-Server — ein Doppelklick auf `index.html` (`file://`)
reicht **nicht**, weil YouTube eingebettete Videos nur abspielt, wenn die Seite
einen HTTP-Referer senden kann (siehe [Fehler 153](#fehler-153-fehler-bei-der-konfiguration-des-videoplayers)).
Ein Einzeiler genügt:

```bash
cd SoundApp
python3 -m http.server 8000
```

Danach im Browser `http://localhost:8000` öffnen. Wird die Seite doch über
`file://` geöffnet, zeigt die App oben einen Hinweis mit genau diesem Befehl an,
statt nur kaputte Player zu zeigen.

## Deploy auf GitHub Pages

1. Repo auf GitHub anlegen und diesen Ordner committen/pushen.
2. In den Repo-Einstellungen unter **Pages** als Quelle den Branch (z. B. `main`)
   und das Root-Verzeichnis auswählen.
3. Fertig — die Seite ist rein statisch, es ist kein Build-Schritt nötig.

## YouTube-Login / Premium

Es gibt bewusst keinen eigenen Login-Flow (kein OAuth, kein Google Sign-In).
YouTube-Embeds laden im Browser die reguläre `youtube.com`-Session mit —
wer in diesem Browser bereits bei YouTube (Premium) angemeldet ist, bekommt
automatisch werbefreie Wiedergabe etc., ohne dass die App selbst etwas tun
müsste oder könnte. Der "Bei YouTube anmelden"-Button in der Seitenleiste
öffnet dafür lediglich youtube.com in einem neuen Tab.

## Bedienung

- **Ebene hinzufügen**: YouTube- oder YouTube-Music-Link in das Eingabefeld
  einfügen — wird automatisch als neue Ebene übernommen (kein Klick auf „+“
  nötig), alternativ „+“ klicken. Unterstützt `watch?v=`, `youtu.be/`,
  `music.youtube.com`, `/shorts/`, `/embed/`, `/live/` sowie reine Video-IDs.
- **Lautstärke**: Regler pro Ebene.
- **Start/Stop**: pro Ebene individuell, oder „Alle abspielen“ / „Alle stoppen“
  oben für alle Ebenen gleichzeitig.
- **Aufklappen**: zeigt den echten YouTube-Player mit normalem Scrubber, um im
  Video zu navigieren. „Startpunkt hier setzen“ merkt sich die aktuelle
  Position als neuen Startpunkt der Ebene.
- **Sammlungen** (linke Seitenleiste): aktuelle Ebenen unter einem Namen
  speichern, laden, umbenennen, löschen. Bei ungespeicherten Änderungen wird
  vor dem Wechseln nachgefragt.
- **Link teilen**: erzeugt einen Link mit allen aktuellen Ebenen (Name, Video,
  Lautstärke, Startpunkt, Typ) zum Weitergeben. Beim Öffnen eines solchen Links
  fragt die App nach, ob als neue Sammlung gespeichert oder in die aktuelle
  Arbeitsfläche geladen werden soll — nichts wird automatisch überschrieben.

## Fehlerbehebung

### Fehler 153: „Fehler bei der Konfiguration des Videoplayers“

YouTube verlangt von einbettenden Seiten einen HTTP-Referer
([Doku](https://support.google.com/youtube/answer/171780)). Fehlt er, erscheint
im Player „Fehler bei der Konfiguration des Videoplayers (Fehler 153)“ statt des
Videos. Typische Ursachen:

- **Die Seite läuft über `file://`.** Dann wird gar kein Referer gesendet und
  `window.location.origin` ist der String `"null"`. Lösung: lokalen Server oder
  GitHub Pages benutzen (siehe oben). Die App weist im Banner darauf hin und
  schickt in diesem Fall bewusst kein `origin`/`widget_referrer` mehr an den
  Player.
- **Der Referer wird unterdrückt** — z. B. durch eine
  `Referrer-Policy: no-referrer` des Hosters, ein `<meta name="referrer">` mit
  `no-referrer` oder eine Privacy-Erweiterung. Die App setzt dafür selbst
  `<meta name="referrer" content="strict-origin-when-cross-origin">`; ein
  Blocker im Browser kann das aber weiterhin überstimmen.

Meldet sich ein Player acht Sekunden lang gar nicht, zeigt die betroffene Ebene
denselben Hinweis an — YouTube malt Fehler 153 nämlich nur in den iframe und
meldet ihn nicht über die JS-API.

### Weitere Player-Fehler

Jede Ebene zeigt den konkreten Grund statt einer Sammelmeldung an: ungültige
Video-ID (2), HTML5-Problem (5), Video gelöscht/privat (100) sowie vom
Rechteinhaber deaktivierte Einbettung (101/150). Dazu gibt es jeweils einen
Link, um das Video direkt auf YouTube zu öffnen.

## Grenzen

- Playlists (`/playlist?list=`) werden nicht unterstützt, nur einzelne Videos.
- Manche Videos deaktivieren die Einbettung von Seiten Dritter — die App zeigt
  das dann pro Ebene an, statt stillschweigend nichts abzuspielen.
- Ohne HTTP-Server (also über `file://`) ist keine Wiedergabe möglich, siehe
  Fehlerbehebung.
- Loop-Bereiche und mehrere Cue-Punkte pro Ebene sind vorbereitet, aber noch
  nicht umgesetzt (nur ein einzelner Startpunkt pro Ebene in dieser Version).
