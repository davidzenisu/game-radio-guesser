"use client"
import React from 'react'
import { useState, useRef, useEffect } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Spinner } from '../components/Spinner'

const TARGET_DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]
// Map each decade to a distinct Tailwind color set. We apply these classes
// to the decade Buttons so each decade is visually distinct.
const DECADE_COLORS = {
  1950: 'bg-red-400 text-white hover:bg-red-600',
  1960: 'bg-orange-400 text-white hover:bg-orange-600',
  1970: 'bg-amber-400 text-white hover:bg-amber-600',
  1980: 'bg-lime-400 text-white hover:bg-lime-600',
  1990: 'bg-emerald-400 text-white hover:bg-emerald-600',
  2000: 'bg-sky-400 text-white hover:bg-sky-600',
  2010: 'bg-indigo-400 text-white hover:bg-indigo-600',
  2020: 'bg-violet-400 text-white hover:bg-violet-600',
}
const MAX_ROUNDS = 10

// Small animated playing indicator (three bars). Kept local and lightweight using
// styled-jsx so we don't have to touch global CSS.
function PlayingIndicator({ label = 'Playing' }) {
  // Use an inline SVG to avoid CSS specificity issues and ensure the
  // indicator is visible regardless of surrounding styles. The SVG
  // includes three rects animated via CSS transform.
  return (
    <span className="playing" role="img" aria-label={label} title={label}>
      <svg width="28" height="18" viewBox="0 0 28 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect className="bar" x="2" y="2" width="6" height="14" rx="1" />
        <rect className="bar" x="11" y="2" width="6" height="14" rx="1" />
        <rect className="bar" x="20" y="2" width="6" height="14" rx="1" />
      </svg>
      <style jsx>{`
        .playing{ display:inline-flex; align-items:center; margin-left:8px }
        .playing svg { display:block }
        .playing .bar { transform-origin: center bottom; fill: #10b981; transform: scaleY(0.35); animation: eq 900ms infinite ease-in-out }
        .playing .bar:nth-child(1){ animation-delay: 0ms }
        .playing .bar:nth-child(2){ animation-delay: 150ms }
        .playing .bar:nth-child(3){ animation-delay: 300ms }
        @keyframes eq { 0% { transform: scaleY(0.25) } 50% { transform: scaleY(1) } 100% { transform: scaleY(0.25) } }
      `}</style>
    </span>
  )
}

// Small animated badge for showing whether the last guess was correct
function ResultBadge({ correct }) {
  return (
    <span className={`result-badge ${correct ? 'ok' : 'bad'}`} aria-hidden>
      {correct ? '✅' : '❌'}
      <style jsx>{`
        .result-badge{ display:inline-flex; align-items:center; justify-content:center; width:48px; height:48px; border-radius:9999px; font-size:20px }
        .result-badge.ok{ background: rgba(16,185,129,0.12); color:#059669; animation: pop 600ms ease }
        .result-badge.bad{ background: rgba(239,68,68,0.08); color:#dc2626; animation: shake 700ms ease }
        @keyframes pop { 0%{ transform: scale(0.4); opacity:0 } 60%{ transform: scale(1.08); opacity:1 } 100%{ transform: scale(1) } }
        @keyframes shake { 0%{ transform: translateX(0) } 25%{ transform: translateX(-6px) } 50%{ transform: translateX(6px) } 75%{ transform: translateX(-4px) } 100%{ transform: translateX(0) } }
      `}</style>
    </span>
  )
}

function splitSongTitle(fullTitle) {
  const parts = fullTitle.split(' - ')
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
  return { artist: null, title: null }
}

function getIcecastMetadataUrl(stationUrl) {
  try {
    const u = new URL(stationUrl)
    u.pathname = '/status-json.xsl'
    return u.toString()
  } catch (_) { return null }
}

async function getSongYear(artist, track, logFn) {
  // Use stricter MusicBrainz query filters (status:official, primarytype:album)
  const query = `recording:${track} AND artist:${artist}  AND status:official`
  const limit = 100
  let offset = 0
  let allRecordings = []
  try {
    while (true) {
      // Use our server-side proxy to avoid CORS and centralize UA/caching
      const proxyUrl = `/api/musicbrainz?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`
      if (logFn) logFn(` Fetching MusicBrainz via proxy: ${proxyUrl}`)
      const res = await fetch(proxyUrl)
      if (!res.ok) break
      const data = await res.json()
      const recs = data.recordings || []
      allRecordings = allRecordings.concat(recs)

      // Determine if we should fetch the next page: only if there are more
      // results (data.count) and the lowest score in this page is >=75.
      const count = typeof data.count === 'number' ? data.count : allRecordings.length
      const scores = recs.map(r => typeof r.score === 'number' ? r.score : 0)
      const minScore = scores.length ? Math.min(...scores) : 0
      if (logFn) logFn(`  MusicBrainz page offset=${offset} returned ${recs.length} recordings (min score: ${minScore}) count=${count}`)

      // If there are more total results beyond this page and the lowest score
      // on this page is >=75, fetch the next page and continue; otherwise stop.
      if (count > offset + limit && minScore >= 75) {
        offset += limit
        // loop to fetch next page
        continue
      }
      break
    }

    // prefer recordings with decent score and gather releases
    const filteredRecordings = allRecordings.filter(r => (typeof r.score === 'number' ? r.score : 0) >= 75)
    if (logFn) logFn(`  MusicBrainz total filtered recordings: ${filteredRecordings.length}`)
    const flat = filteredRecordings.flatMap(r => r.releases || [])
    const officialReleases = flat.filter(r => r.status === 'Official')
    const withDate = officialReleases.filter(r => r.date)
    withDate.sort((a, b) => a.date.localeCompare(b.date))
    const d = withDate[0]?.date
    return d ? d.substring(0, 4) : null
  } catch (e) {
    console.warn('musicbrainz', e?.message || e)
    return null
  }
}

export default function Home() {
  const IS_PROD = process.env.NODE_ENV === 'production'
  const [logs, setLogs] = useState([])
  const [running, setRunning] = useState(false)
  const [match, setMatch] = useState(null)
  const matchRef = useRef(null)
  const [collected, setCollected] = useState([])
  const [stationsTotal, setStationsTotal] = useState(0)
  const [stationsChecked, setStationsChecked] = useState(0)
  const [guess, setGuess] = useState('')
  // Initialize score with a stable default to avoid server/client hydration mismatch.
  const [score, setScore] = useState({ points: 0, rounds: 0, correct: 0 })

  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioMuted, setAudioMuted] = useState(true)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [showUnmutePrompt, setShowUnmutePrompt] = useState(false)
  // In-memory cache of songs we've already picked: key is "Artist - Track"
  // Value: { artist, track, year, decade }
  const songCacheRef = useRef(new Map())
  // Remember only the decade used in the very last round so we avoid
  // picking the same decade twice in a row.
  const lastDecadeRef = useRef(null)

  const log = (t) => setLogs(l => [...l, String(t)])
  // Last guess result shown after revealing an answer.
  // { correct: boolean, guessed: number|null, actual: number }
  const [lastResult, setLastResult] = useState(null)
  // Per-round results for the session, shown on the Results screen.
  // Each entry: { artist, track, year, actual, guessed, correct }
  const [roundResults, setRoundResults] = useState([])

  // When we've reached the max rounds, pause audio and clear any active match
  useEffect(() => {
    if (score.rounds >= MAX_ROUNDS) {
      try { audioRef.current?.pause() } catch (_) { }
      setMatchAndRef(null)
      setRunning(false)
      log(`Reached ${MAX_ROUNDS} rounds — showing results`)
    }
  }, [score.rounds])

  function restartGame() {
    // Reset score, caches, logs and UI state so player can play again
    setScore({ points: 0, rounds: 0, correct: 0 })
    songCacheRef.current.clear()
    lastDecadeRef.current = null
    setLogs([])
    setCollected([])
    setMatchAndRef(null)
    setGuess('')
    setShowAnswer(false)
    setIsPlaying(false)
    setLastResult(null)
  }
  // Results rendering is handled later (after all hooks) to avoid changing
  // the hooks call order between renders.

  // helper to keep a mutable ref in sync with match state so long-running
  // async loops can read the current value without depending on React's
  // asynchronous state updates.
  const setMatchAndRef = (v) => { matchRef.current = v; setMatch(v) }

  async function runScan() {
    setLogs([]); setCollected([]); setMatchAndRef(null); setGuess(''); setRunning(true); setStationsChecked(0); setStationsTotal(0)
    log(`Searching for the first song that returns a release year (excluding previously picked songs/decades)...`)
    const host = 'https://all.api.radio-browser.info'
    const url = `${host}/json/stations/search?order=clickcount&reverse=true&tag=rock&limit=60&has_extended_info=true`
    log(`Fetching stations from: ${url}`)
    let stations = []
    try {
      const r = await fetch(url)
      stations = await r.json()
      // Randomize the station order so we don't always pick the same high-clickcount stations
      function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]] } return arr }
      stations = shuffle(stations)
      setStationsTotal(stations.length)
      log(`Loaded ${stations.length} stations.`)
    } catch (e) { log(`Failed to load stations: ${e?.message || e}`); setRunning(false); return }
    const seenThisScan = new Set()
    for (const s of stations) {
      // read the mutable ref instead of React state to avoid staleness
      if (matchRef.current) break
      setStationsChecked(c => c + 1)
      log(`Checking station: ${s.name || s.title || s.url}`)
      let title = (s.title && s.title.includes(' - ')) ? s.title : null
      // if station record doesn't include a "Artist - Track" title, try Icecast status JSON
      if (!title) {
        const base = getIcecastMetadataUrl(s.url)
        if (base) {
          const proxyUrl = `/api/icecast?url=${encodeURIComponent(s.url)}`
          log(` Fetching Icecast metadata via proxy: ${proxyUrl}`)
          try {
            const res = await fetch(proxyUrl)
            if (res.ok) {
              const json = await res.json()
              const sources = json.icestats?.source || []
              const source = Array.isArray(sources) ? (sources.find(x => x.server_name === s.name) || sources[0]) : sources
              const fetchedTitle = source?.title || null
              if (fetchedTitle) {
                log(`  Icecast provided title: ${fetchedTitle}`)
                if (fetchedTitle.includes(' - ')) title = fetchedTitle
                else log(`  Icecast title not in expected format: ${fetchedTitle}`)
              }
            } else {
              log(`  Icecast metadata proxy fetch failed: ${res.status}`)
            }
          } catch (e) { log(`  Could not fetch station status for ${s.name || s.url}: ${e?.message || e}`) }
        }
      }
      log(` Current song: ${title || '(no song info)'}`)
      if (!title) continue
      const normalized = title.trim()
      if (seenThisScan.has(normalized)) { log(` Already seen "${normalized}" in this scan, skipping`); continue }
      if (songCacheRef.current.has(normalized)) { log(` Song "${normalized}" already picked in a previous round, skipping`); continue }
      const { artist, title: track } = splitSongTitle(title)
      if (!artist || !track) { log(` Could not split title into artist/title: "${title}"`); continue }
      log(` Looking up year for: ${artist} - ${track} ...`)
      const year = await getSongYear(artist, track, log)
      seenThisScan.add(normalized)
      log(` Found year for ${artist} - ${track}: ${year || 'unknown'}`)
      if (!year) continue
      setCollected(c => [...c, `${artist} - ${track} (${year})`])
      const yr = parseInt(year)
      if (Number.isNaN(yr)) continue
      const dec = Math.floor(yr / 10) * 10
      // If the last round used this same decade, skip it so we don't repeat
      if (lastDecadeRef.current === dec) { log(` Decade ${dec}s was the last round's decade; skipping to avoid repeat.`); continue }

      // Store in the in-memory cache and choose this as the match
      const entry = { artist, track, year, decade: dec }
      songCacheRef.current.set(normalized, entry)
      // Remember this decade as the last used decade for the next round
      lastDecadeRef.current = dec
      log(`Match found: ${artist} - ${track} (${year}) at station ${s.name || s.url} — storing in cache and setting last-decade to ${dec}s`)
      setMatchAndRef({ artist, track, year, station: s })
      break
    }
    log('Scan complete.')
    setRunning(false)
  }
  function submitGuess(e) { e?.preventDefault?.(); if (!match) return; const g = parseInt(guess); if (Number.isNaN(g)) return; const dec = Math.floor(g / 10) * 10; const correct = dec === Math.floor(parseInt(match.year) / 10) * 10; setScore(s => ({ points: s.points + (correct ? 1 : 0), rounds: s.rounds + 1, correct: s.correct + (correct ? 1 : 0) })); }

  // add logging for guesses
  function submitGuessWithLog(e) {
    e?.preventDefault?.()
    if (!match) return
    const g = parseInt(guess)
    if (Number.isNaN(g)) return
    const dec = Math.floor(g / 10) * 10
    const correct = dec === Math.floor(parseInt(match.year) / 10) * 10
    setScore(s => ({ points: s.points + (correct ? 1 : 0), rounds: s.rounds + 1, correct: s.correct + (correct ? 1 : 0) }))
    log(`Player guessed ${g} → ${dec}s — ${correct ? 'correct' : 'wrong'}`)
    const entry = { artist: match.artist, track: match.track, year: match.year, actual: Math.floor(parseInt(match.year) / 10) * 10, guessed: dec, correct }
    setLastResult(entry)
    setRoundResults(r => [...r, entry])
    setShowAnswer(true)
  }

  // handle guesses when the user selects a decade button
  function handleDecadeGuess(decade) {
    if (!match) return
    const correct = decade === Math.floor(parseInt(match.year) / 10) * 10
    setScore(s => ({ points: s.points + (correct ? 1 : 0), rounds: s.rounds + 1, correct: s.correct + (correct ? 1 : 0) }))
    log(`Player guessed ${decade}s — ${correct ? 'correct' : 'wrong'}`)
    const entry = { artist: match.artist, track: match.track, year: match.year, actual: Math.floor(parseInt(match.year) / 10) * 10, guessed: decade, correct }
    setLastResult(entry)
    setRoundResults(r => [...r, entry])
    setShowAnswer(true)
  }

  function revealAnswer() {
    if (!match) return
    setShowAnswer(true)
    setScore(s => ({ ...s, rounds: s.rounds + 1 }))
    // mark that no guess was made for this round
    const actualDec = Math.floor(parseInt(match.year) / 10) * 10
    const entry = { artist: match.artist, track: match.track, year: match.year, actual: actualDec, guessed: null, correct: false }
    setLastResult(entry)
    setRoundResults(r => [...r, entry])
    log(`Answer revealed: ${match.artist} - ${match.track} (${match.year})`)
  }

  function nextRound() {
    try { audioRef.current?.pause() } catch (_) { }
    setMatchAndRef(null)
    setGuess('')
    setShowAnswer(false)
    setIsPlaying(false)
    setLastResult(null)
    // now it's safe to start the next scan immediately because matchRef
    // was cleared synchronously above
    try { runScan() } catch (_) { }
  }

  // Skip the current round (e.g. an ad). Do NOT increment rounds.
  function skipRound() {
    try { audioRef.current?.pause() } catch (_) { }
    log('Round skipped by user (Ads :()')
    setMatchAndRef(null)
    setGuess('')
    setShowAnswer(false)
    setIsPlaying(false)
    setLastResult(null)
    try { runScan() } catch (_) { }
  }

  function resetScore() { setScore({ points: 0, rounds: 0, correct: 0 }); }

  // when a match appears, try to autoplay the stream muted (browsers often allow muted autoplay)
  useEffect(() => {
    if (!match) return
    const el = audioRef.current
    if (!el) return
    try {
      el.muted = true
      setAudioMuted(true)
      const p = el.play()
      if (p && typeof p.then === 'function') {
        p.then(() => { setIsPlaying(true); setAutoplayBlocked(false); log('Autoplay started (muted)') }).catch(err => { setAutoplayBlocked(true); setShowUnmutePrompt(true); log(`Autoplay blocked: ${err?.message || err}`) })
      }
    } catch (err) { setAutoplayBlocked(true); setShowUnmutePrompt(true); log(`Autoplay error: ${err?.message || err}`) }
  }, [match])

  // global click gesture to unmute as a fallback
  useEffect(() => {
    function handleUserGesture() {
      const el = audioRef.current
      if (!el) return
      if (el.muted) {
        try { el.muted = false; el.play()?.catch(() => { }); setIsPlaying(!el.paused); setAutoplayBlocked(false); setShowUnmutePrompt(false); log('Audio unmuted via user gesture') } catch (_) { }
      }
      window.removeEventListener('click', handleUserGesture)
    }
    window.addEventListener('click', handleUserGesture)
    return () => window.removeEventListener('click', handleUserGesture)
  }, [])

  // Keep React state in sync with the underlying audio element by
  // listening to its events (play/pause/volumechange). This ensures the
  // UI updates when the user unmutes via the control or other gestures.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    function onPlay() { setIsPlaying(true) }
    function onPause() { setIsPlaying(false) }
    function onVolumeChange() { setAudioMuted(!!el.muted) }
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('volumechange', onVolumeChange)
    // initialize state from element
    setAudioMuted(!!el.muted)
    setIsPlaying(!el.paused)
    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('volumechange', onVolumeChange)
    }
  }, [match])
  const finished = score.rounds >= MAX_ROUNDS
  if (finished) {
    const accuracy = score.rounds ? Math.round((score.correct / score.rounds) * 100) : 0
    const cached = Array.from(songCacheRef.current.values())
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="max-w-4xl mx-auto">
          <Card>
            <h2 className="text-2xl font-semibold">Results</h2>
            <p className="mt-3">Rounds: <strong>{score.rounds}/{MAX_ROUNDS}</strong></p>
            <p className="mt-1">Points: <strong>{score.points}</strong> ({accuracy}%)</p>
            <div className="mt-4">
              <Button onClick={restartGame}>Play Again</Button>
            </div>
          </Card>

          <section className="mt-6">
            <h3 className="text-sm font-medium mb-2">Picked songs (this session)</h3>
            <ul className="list-disc list-inside">
              {cached.map((c, i) => <li key={i}>{c.artist} — {c.track} — {c.year} ({c.decade}s)</li>)}
            </ul>
          </section>
        </div>
      </main>
    )
  }
  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Game Radio Guesser</h1>
          <p className="text-sm text-gray-600">Find a song and guess its release decade.</p>
        </header>

        <div className="flex gap-4 items-center mb-4">
          <Button onClick={runScan} disabled={running || !!match}>{running ? 'Scanning...' : 'Start Round'}</Button>
          <div className="ml-auto text-sm text-gray-700">Score: <strong>{score.points}</strong> · Rounds: {score.rounds}/{MAX_ROUNDS}
          </div>
        </div>

        {running && <Card><div className="flex items-center gap-3"><Spinner /> Searching stations... ({stationsChecked}/{stationsTotal})</div></Card>}

        {match && (
          <div className="flex flex-col gap-6 mt-6">
            <Card>
              <h2 className="text-lg font-medium">Controls</h2>
              <div className="mt-4">
                <audio ref={audioRef} src={match.station?.url} preload="none" controls style={{ display: 'none' }} />
                <div className="flex gap-3 flex-col items-center">
                  {isPlaying && audioMuted &&
                    <Button onClick={() => {
                      try {
                        const el = audioRef.current
                        if (!el) return
                        el.muted = false
                        setAudioMuted(false)
                        const p = el.play()
                        if (p && typeof p.then === 'function') p.then(() => setIsPlaying(true)).catch(() => { })
                        else setIsPlaying(!el.paused)
                        setAutoplayBlocked(false)
                      } catch (_) { }
                    }}>PLAY</Button>
                  }
                  {isPlaying && !audioMuted && <PlayingIndicator />}
                  <Button className="bg-rose-600 text-white hover:bg-rose-700" onClick={skipRound} aria-label="Skip this round">Song's over / Ads :(</Button>
                </div>
              </div>
            </Card>
            <Card>
              <h2 className="text-lg font-medium">Answer</h2>
              <div className="mt-4">
                {!showAnswer ? (
                  <div className="mt-4 flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      {TARGET_DECADES.map((d) => {
                        const colorClass = DECADE_COLORS[d] || 'bg-sky-600 text-white hover:bg-sky-700'
                        const disabledClass = showAnswer ? 'opacity-60 cursor-not-allowed' : ''
                        return (
                          <Button key={d} onClick={() => handleDecadeGuess(d)} className={`${colorClass} ${disabledClass}`} disabled={showAnswer}>{d}s</Button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col items-center gap-3">
                    <div><strong>🎤: {match.artist}</strong></div>
                    <div><strong>🎶: {match.track}</strong></div>
                    <div><strong>📅: {match.year}</strong> ({Math.floor(parseInt(match.year) / 10) * 10}s)</div>
                    {lastResult && (
                      <div className="mt-2">
                        {lastResult.guessed === null ? (
                          <div className="text-yellow-700">No guess was made. Correct decade: <strong>{lastResult.actual}s</strong></div>
                        ) : lastResult.correct ? (
                          <div className="flex flex-col items-center gap-2">
                            <ResultBadge correct={true} />
                            <div className="text-emerald-600"><strong>Correct!</strong></div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-rose-600">
                            <ResultBadge correct={false} />
                            <div><strong>Wrong!</strong></div>
                            <div>Your guess: <strong>{lastResult.guessed}s</strong></div>
                            <div>Correct answer: <strong>{lastResult.actual}s</strong></div>
                          </div>
                        )}
                      </div>
                    )}
                    <Button onClick={nextRound}>Next Round</Button>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {!IS_PROD && (
          <section className="mt-6">
            <h3 className="text-sm font-medium mb-2">Logs</h3>
            <div className="bg-black text-white p-3 rounded h-40 overflow-auto font-mono text-xs">{logs.map((l, i) => <div key={i}>{l}</div>)}</div>
          </section>
        )}

        {!IS_PROD && (
          <section className="mt-6">
            <h3 className="text-sm font-medium mb-2">Collected songs</h3>
            <ul className="list-disc list-inside">
              {collected.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
