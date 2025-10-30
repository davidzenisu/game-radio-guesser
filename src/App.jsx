import React, { useState, useEffect, useRef } from "react";

const TARGET_DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
const STATION_LIMIT = 60;

function splitSongTitle(fullTitle) {
  const parts = fullTitle.split(" - ");
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }
  return { artist: null, title: null };
}

function getIcecastMetadataUrl(stationUrl) {
  try {
    const url = new URL(stationUrl);
    url.pathname = "/status-json.xsl";
    return url.toString();
  } catch {
    return null;
  }
}

async function getSongYear(artist, track, logFn) {
  const query = `recording:${track} AND artist:${artist}`;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json`;
  if(logFn) {
    logFn(` Fetching MusicBrainz URL: ${url}`);
  }
  try {
    const res = await fetch(url, { headers: { "User-Agent": "RadioYearScanner/1.0 (example@example.com)" } });
    if (!res.ok) return null;
    const data = await res.json();
    const filteredRecordings = data.recordings?.filter(r => r.title === track) || [];
    const flatReleases = filteredRecordings.flatMap(r => r.releases || []);
    const releasesWithDate = flatReleases?.filter(r => r.date);
    releasesWithDate?.sort((a, b) => a.date.localeCompare(b.date));
    const date = releasesWithDate?.[0]?.date;
    return date ? date.substring(0, 4) : null;
  } catch (err) {
    console.warn("MusicBrainz fetch failed:", err.message);
    return null;
  }
}

export default function App() {
  const IS_PROD = Boolean(import.meta.env && import.meta.env.PROD);
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [match, setMatch] = useState(null); // match object but hide year until guess
  const [collected, setCollected] = useState([]);
  const [stationsTotal, setStationsTotal] = useState(0);
  const [stationsChecked, setStationsChecked] = useState(0);
  const [guess, setGuess] = useState("");
  const [score, setScore] = useState({ points: 0, rounds: 0, correct: 0 });
  const [showAnswer, setShowAnswer] = useState(false);
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [showUnmutePrompt, setShowUnmutePrompt] = useState(false);

  // load persisted score
  useEffect(() => {
    try {
      const saved = localStorage.getItem("grg-score");
      if (saved) setScore(JSON.parse(saved));
    } catch (_) {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("grg-score", JSON.stringify(score)); } catch (_) {}
  }, [score]);

  const log = (text) => setLogs(l => [...l, text]);

  async function runScan() {
    setLogs([]);
    setCollected([]);
    setMatch(null);
    setGuess("");
    setShowAnswer(false);
    setStationsTotal(0);
    setStationsChecked(0);
    setRunning(true);

    const randomDecade = TARGET_DECADES[Math.floor(Math.random() * TARGET_DECADES.length)];
    log(`Searching for songs from ${randomDecade}s...`);

    const host = "https://all.api.radio-browser.info"; // public API host
    const url = `${host}/json/stations/search?order=clickcount&reverse=true&tag=rock&limit=${STATION_LIMIT}&has_extended_info=true`;
    log(`Fetching stations...`);
    let stations = [];
    try {
      const res = await fetch(url);
      stations = await res.json();
      stations = stations.filter(s => s.url && (s.title || s.has_extended_info));
      log(`Loaded ${stations.length} stations.`);
      setStationsTotal(stations.length);
    } catch (err) {
      log(`Failed to load stations: ${err.message}`);
      setRunning(false);
      return;
    }

    const cache = new Map();

    for (const s of stations) {
      if (match) break;
      log(`Checking station: ${s.name}`);
      setStationsChecked(c => c + 1);
      let songTitle = s.title && s.title.includes(" - ") ? s.title : null;
      if (!songTitle) {
        const baseUrl = getIcecastMetadataUrl(s.url);
        if (baseUrl) {
          try {
            const res = await fetch(baseUrl, { cache: "no-store" });
            if (res.ok) {
              const json = await res.json();
              const sources = json.icestats?.source || [];
              const source = sources.find(x => x.server_name === s.name) || sources[0];
              songTitle = source?.title || null;
            }
          } catch (_) {
            log(` Could not fetch station status for ${s.name}`);
          }
        }
      }

      log(` Current song: ${songTitle || "(no song info)"}`);
      if (!songTitle) continue;

      const normalized = songTitle.trim();
      if (cache.has(normalized)) continue;

      const { artist, title } = splitSongTitle(normalized);
      if (!artist || !title) continue;

      log(` Looking up year for: ${artist} - ${title}...`);
      const year = await getSongYear(artist, title, log);
      cache.set(normalized, year);
      log(` Found year: ${year || "unknown"}`);
      if (!year) continue;

      setCollected(prev => [...prev, `${artist} - ${title} (${year})`]);

      const yearInt = parseInt(year);
      const decadeStart = Math.floor(yearInt / 10) * 10;
      if (decadeStart === randomDecade) {
        log(`Match found: ${artist} - ${title} (${year}) at ${s.name}`);
        // store the match but don't reveal the year until user guesses or reveals
        setMatch({ artist, title, year, decadeStart, station: s });
        break;
      }
    }

    log(`Scan complete.`);
    setRunning(false);
    // ensure progress shows 100% at end
    setStationsChecked(stationsTotal);
  }

  function submitGuess(e) {
    e?.preventDefault?.();
    if (!match) return;
    const g = parseInt(guess);
    if (Number.isNaN(g)) return;
    const guessedDecade = Math.floor(g / 10) * 10;
    const correct = guessedDecade === match.decadeStart;
    setScore(s => ({ points: s.points + (correct ? 1 : 0), rounds: s.rounds + 1, correct: s.correct + (correct ? 1 : 0) }));
    setShowAnswer(true);
    log(`Player guessed ${g} → ${guessedDecade}s — ${correct ? 'correct' : 'wrong'}`);
  }

  function revealAnswer() {
    if (!match) return;
    setShowAnswer(true);
    setScore(s => ({ ...s, rounds: s.rounds + 1 }));
    log(`Answer revealed: ${match.year}`);
  }

  function nextRound() {
    try { audioRef.current?.pause(); } catch (_) {}
    setMatch(null);
    setGuess("");
    setShowAnswer(false);
    setIsPlaying(false);
  }

  // when a match appears, try to autoplay the stream muted (browsers often allow muted autoplay)
  useEffect(() => {
    if (!match) return;
    const el = audioRef.current;
    if (!el) return;
    // try muted autoplay first
    try {
      el.muted = true;
      const p = el.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          setIsPlaying(true);
          setAutoplayBlocked(false);
          log('Autoplay started (muted)');
        }).catch(err => {
          setAutoplayBlocked(true);
          setShowUnmutePrompt(true);
          log(`Autoplay blocked: ${err?.message || err}`);
        });
      }
    } catch (err) {
      setAutoplayBlocked(true);
      setShowUnmutePrompt(true);
      log(`Autoplay error: ${err?.message || err}`);
    }
  }, [match]);

  // user gesture to unmute — attach to global click as a fallback to allow one-click unmute
  useEffect(() => {
    function handleUserGesture() {
      const el = audioRef.current;
      if (!el) return;
      if (el.muted) {
        try {
          el.muted = false;
          el.play()?.catch(() => {});
          setIsPlaying(!el.paused);
          setAutoplayBlocked(false);
          setShowUnmutePrompt(false);
          log('Audio unmuted via user gesture');
        } catch (_) {}
      }
      // remove listener after first gesture
      window.removeEventListener('click', handleUserGesture);
    }
    window.addEventListener('click', handleUserGesture);
    return () => window.removeEventListener('click', handleUserGesture);
  }, []);

  function resetScore() {
    setScore({ points: 0, rounds: 0, correct: 0 });
  }

  return (
    <div className="app">
      <header>
        <h1>Game Radio Guesser</h1>
        <p>Scan public radio stations and guess the release decade of a found song.</p>
      </header>

  <main>
        {/* Production spinner: show while scanning in production builds */}
        {IS_PROD && running && (
          <div className="prod-spinner" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true"></div>
            <div className="spinner-text">Searching radio stations...</div>
          </div>
        )}

        {/* Progress meter: show while running */}
        {running && stationsTotal > 0 && (
          <div className="progress" aria-hidden={IS_PROD ? 'true' : 'false'}>
            <div className="progress__label">Searching {stationsChecked}/{stationsTotal}</div>
            <div className="progress__bar">
              <div className="progress__fill" style={{width: `${Math.round((stationsChecked/stationsTotal) * 100)}%`}} />
            </div>
          </div>
        )}
        <div className="controls">
          <button onClick={runScan} disabled={running || !!match}>{running ? "Scanning..." : (match ? "Round in progress" : "Start Round")}</button>
          <div style={{display:'inline-block', marginLeft:12}}>
            <strong>Score:</strong> {score.points} pts · Rounds: {score.rounds} · Correct: {score.correct}
            <button style={{marginLeft:8}} onClick={resetScore}>Reset</button>
          </div>
        </div>

        {match && (
          <section className="result">
            <h2>Round</h2>
            <p><strong>Song:</strong> {match.artist} — {match.title}</p>
            <p><strong>Station:</strong> {match.station.name} · <a href={match.station.url} target="_blank" rel="noreferrer">Open stream</a></p>

            <div className="player" style={{marginTop:8}}>
              <audio
                key={match.station.url}
                ref={audioRef}
                preload="none"
                src={match.station.url}
                crossOrigin="anonymous"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onError={() => log(`Audio playback error for ${match.station.url}`)}
                aria-hidden="true"
              />
              {autoplayBlocked && (
                <div style={{marginTop:6,color:'#b33'}}>
                  Autoplay was blocked by the browser or will start muted. Click anywhere or press Unmute to enable sound.
                </div>
              )}
              <div className="player-buttons" style={{marginTop:6}}>
                <button aria-label="Play" onClick={() => {
                  try {
                    audioRef.current?.play()?.catch?.(e => log(`Playback blocked: ${e.message}`));
                  } catch (e) { log(`Playback error: ${e.message}`); }
                }}>{isPlaying ? 'Playing' : 'Play'}</button>
                <button className="secondary" aria-label="Pause" style={{marginLeft:8}} onClick={() => { try { audioRef.current?.pause(); } catch(_){} }}>Pause</button>
                <button className="secondary" aria-label="Unmute" style={{marginLeft:8}} onClick={() => { try { audioRef.current.muted = false; audioRef.current.play()?.catch(()=>{}); setAutoplayBlocked(false); } catch(_){} }}>Unmute</button>
              </div>
            </div>

            {/* Floating unmute prompt */}
            {autoplayBlocked && showUnmutePrompt && (
              <div className="unmute-prompt" role="dialog" aria-live="polite">
                <div className="unmute-prompt__message">Click to enable sound</div>
                <div className="unmute-prompt__actions">
                  <button className="btn-unmute" onClick={() => {
                    const el = audioRef.current;
                    if (!el) return;
                    try {
                      el.muted = false;
                      el.play()?.then(() => setIsPlaying(true)).catch(()=>{});
                    } catch(_){}
                    setAutoplayBlocked(false);
                    setShowUnmutePrompt(false);
                    log('Unmute prompt clicked');
                  }}>Enable sound</button>
                </div>
              </div>
            )}

            {!showAnswer ? (
              <form onSubmit={submitGuess} style={{marginTop:8}}>
                <label>Guess the release year (e.g. 1975): </label>
                <input value={guess} onChange={e => setGuess(e.target.value)} placeholder="YYYY" style={{marginLeft:8}} />
                <button type="submit" style={{marginLeft:8}}>Submit Guess</button>
                <button type="button" onClick={revealAnswer} style={{marginLeft:8}}>Reveal</button>
              </form>
            ) : (
                <div style={{marginTop:8}}>
                <p>Answer: <strong>{match.year}</strong> ({match.decadeStart}s)</p>
                <button onClick={nextRound}>Next Round</button>
              </div>
            )}
          </section>
        )}

        {/* In production hide debug sections (logs & collected); show them in dev for debugging */}
        {!IS_PROD && (
          <>
            <section className="log">
              <h3>Log</h3>
              <div className="log-window">
                {logs.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </section>

            <section className="collected">
              <h3>Collected songs</h3>
              <ul>
                {collected.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </section>
          </>
        )}
      </main>

      <footer>
        <small>Uses RadioBrowser and MusicBrainz public APIs.</small>
      </footer>
    </div>
  );
}
