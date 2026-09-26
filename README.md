# PnP Soundboard

Ein browserbasiertes Soundboard, um für Pen&Paper-Runden mehrere YouTube-,
YouTube-Music- und SoundCloud-Links als unabhängige Audio-Ebenen (Ambience,
Musik, Soundeffekte, …) gleichzeitig abzuspielen und live zu mischen — dazu
Action-Buttons für Sounds, die auf Knopfdruck genau einmal laufen.

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

1. In den Repo-Einstellungen unter **Pages** als Quelle *Deploy from a branch*,
   Branch `main` und das Root-Verzeichnis `/` auswählen.
2. Fertig — die Seite ist rein statisch, es ist kein Build-Schritt nötig. Die
   leere Datei `.nojekyll` sorgt dafür, dass GitHub die Dateien unverändert
   ausliefert, statt sie durch Jekyll zu schicken.

Über Pages läuft die App unter `https://<user>.github.io/<repo>/` — damit ist die
Referer-Voraussetzung von YouTube erfüllt und die Player funktionieren (siehe
Fehlerbehebung).

**Bei einem privaten Repo** ist Pages nicht in jedem Plan enthalten (mit einem
kostenlosen Account nur für öffentliche Repos), und selbst wenn der Plan es
erlaubt, ist die veröffentlichte Seite öffentlich erreichbar — privat abgesicherte
Pages-Seiten gibt es nur mit GitHub Enterprise Cloud. Ob es geht, zeigt die
Pages-Einstellungsseite des Repos direkt an.

## YouTube-Login / Premium

Es gibt bewusst keinen eigenen Login-Flow (kein OAuth, kein Google Sign-In).
YouTube-Embeds laden im Browser die reguläre `youtube.com`-Session mit —
wer in diesem Browser bereits bei YouTube (Premium) angemeldet ist, bekommt
automatisch werbefreie Wiedergabe etc., ohne dass die App selbst etwas tun
müsste oder könnte. Der "Bei YouTube anmelden"-Button in der Seitenleiste
öffnet dafür lediglich youtube.com in einem neuen Tab.

## Bedienung

- **Ebene hinzufügen**: Link in das Eingabefeld einfügen — wird automatisch als
  neue Ebene übernommen (kein Klick auf „+“ nötig), alternativ „+“ klicken.
  - *YouTube*: `watch?v=`, `youtu.be/`, `music.youtube.com`, `/shorts/`,
    `/embed/`, `/live/` sowie reine Video-IDs.
  - *SoundCloud*: Track-Links (`soundcloud.com/künstler/track`), Sets
    (`/sets/…`) und Kurzlinks (`on.soundcloud.com/…`). Läuft über das
    SoundCloud-Widget, also ohne API-Schlüssel und ohne Login.
- **Action-Buttons** (Block über der Ebenenliste): Sounds, die auf Knopfdruck
  **genau einmal** abgespielt werden — Türknarren, Schwerthieb, Donner. Link
  einfügen, Button drücken, fertig. Über ✎ lassen sich Beschriftung,
  Lautstärke und ein Ausschnitt (von/bis) einstellen; „Start ⟵ jetzt“ und
  „Ende ⟵ jetzt“ übernehmen die Position aus dem Vorschau-Player, sodass sich
  ein Effekt nach Gehör aus einem längeren Video schneiden lässt. Ohne
  Endpunkt läuft der Sound bis zum Ende des Videos.
- **Playlists / Queue**: eine Ebene kann mehrere Videos nacheinander abspielen.
  Der Inhalt landet immer in der **Queue der Ebene** — also einer Liste, die
  sich sortieren (▲▼), kürzen (✕) und erweitern lässt:
  1. *YouTube-Playlist einfügen* — `playlist?list=…` oder ein
     `watch?v=…&list=…`-Link. Die App lädt die Playlist kurz, liest ihre Videos
     aus und übernimmt sie als Queue („☰ Playlist wird übernommen…“ →
     „☰ Playlist (n)“). Danach hängt nichts mehr an YouTubes Reihenfolge; der
     Name der Playlist bleibt als Ebenenname erhalten.
  2. *Selbst zusammenstellen* — Ebene aufklappen und unter „Weiteres Video an
     diese Ebene anhängen…“ beliebig viele Videos hinzufügen. Ab zwei Videos
     ist die Ebene eine Playlist.

  Pro Ebene gibt es ⏮/⏭ zum Springen sowie die Schalter 🔁 **Endlos** und
  🔀 **Zufall**. Beides wird mitgespeichert und mitgeteilt.

  Bei **SoundCloud** bleibt ein Set beim Widget: ⏮/⏭ funktionieren, die
  Reihenfolge lässt sich aber nicht hier bearbeiten, weil das Widget keine
  selbst zusammengestellten Warteschlangen kennt. Zufall bietet nur YouTube
  an — deshalb ist der Schalter bei SoundCloud ausgeblendet statt
  wirkungslos sichtbar.

- **Lautstärke**: Regler pro Ebene.
- **Start/Stop**: pro Ebene individuell, oder „Alle abspielen“ / „Alle stoppen“
  oben für alle Ebenen gleichzeitig.
- **Aufklappen**: zeigt den echten YouTube-Player mit normalem Scrubber, um im
  Video zu navigieren. „Startpunkt hier setzen“ merkt sich die aktuelle
  Position als neuen Startpunkt der Ebene.
- **Sammlungen** (linke Seitenleiste): „＋ Neue Sammlung“ legt eine leere
  Sammlung unter einem Namen an und räumt die Arbeitsfläche frei;
  „Speichern unter…“ sichert die aktuellen Ebenen als neue Sammlung.
  Sammlungen lassen sich laden, umbenennen und löschen — alles im
  `localStorage` des Browsers. Eine Sammlung enthält immer beides: die Ebenen
  **und** die Action-Buttons. Bei ungespeicherten Änderungen wird vor dem
  Wechseln nachgefragt.
- **Link teilen**: erzeugt einen Link mit allen aktuellen Ebenen und
  Action-Buttons (Name, Quelle, Lautstärke, Start-/Endpunkt, Typ, Endlos/Zufall)
  zum Weitergeben. Beim Öffnen eines solchen Links
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

### SoundCloud

SoundCloud läuft über das offizielle Widget (`w.soundcloud.com/player`), das die
Track-URL serverseitig auflöst — kein API-Schlüssel, kein Login. Was dort nicht
abspielt, ist in aller Regel nicht öffentlich oder vom Rechteinhaber für
externe Einbettung gesperrt; die Ebene zeigt das dann an.

### Weitere Player-Fehler

Jede Ebene zeigt den konkreten Grund statt einer Sammelmeldung an: ungültige
Video-ID (2), HTML5-Problem (5), Video gelöscht/privat (100) sowie vom
Rechteinhaber deaktivierte Einbettung (101/150). Dazu gibt es jeweils einen
Link, um das Video direkt auf YouTube zu öffnen.

## Grenzen

- Private Listen („Später ansehen“, „Gefällt mir“) und automatische
  Mixe/Radios (`list=RD…`) lassen sich nicht einbetten. Enthält ein
  Video-Link zusätzlich so eine Liste, wird nur das Video übernommen.
- Eine Playlist lässt sich nur übernehmen, solange der Player ihre Videos
  nennen kann — bei einer privaten oder leeren Playlist meldet die Ebene das,
  statt still nichts zu tun.
- Manche Videos deaktivieren die Einbettung von Seiten Dritter — die App zeigt
  das dann pro Ebene an, statt stillschweigend nichts abzuspielen.
- Ohne HTTP-Server (also über `file://`) ist keine Wiedergabe möglich, siehe
  Fehlerbehebung.
- Für Action-Buttons gibt es einen Ausschnitt (von/bis), für Ebenen weiterhin
  nur einen Startpunkt.
- Bei SoundCloud stoppt ein Action-Button mit Endpunkt über einen Timer, weil
  das Widget keinen Endpunkt kennt — das ist minimal ungenauer als bei YouTube,
  wo der Player den Endpunkt selbst einhält.
- Loop-Bereiche und mehrere Cue-Punkte pro Ebene sind vorbereitet, aber noch
  nicht umgesetzt (nur ein einzelner Startpunkt pro Ebene in dieser Version).
  Bei Playlist-Ebenen entfällt der Startpunkt ganz, weil er sich immer nur auf
  ein einzelnes Video beziehen könnte.

## Lizenz

[PolyForm Noncommercial License 1.0.0](LICENSE.md) — Nutzung, Änderung und
Weitergabe sind für **nicht-kommerzielle** Zwecke erlaubt (privat, Hobby,
Lehre, gemeinnützige Organisationen). Für kommerzielle Nutzung braucht es eine
gesonderte Erlaubnis des Rechteinhabers.

Hinweis: Das ist bewusst keine OSI-Open-Source-Lizenz — eine Beschränkung auf
nicht-kommerzielle Nutzung schließt das per Definition aus.

Die Lizenz gilt für den Code dieser App. Die über YouTube eingebundenen Inhalte
gehören ihren jeweiligen Rechteinhabern; für deren Nutzung gelten die
YouTube-Nutzungsbedingungen.
