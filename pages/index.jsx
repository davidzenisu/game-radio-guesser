"use client"
import React from 'react'
import { useState, useRef, useEffect } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Spinner } from '../components/Spinner'

const TARGET_DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]

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
  const query = `recording:${track} AND artist:${artist} AND status:official AND primarytype:album`
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&inc=releases&limit=100`
  if (logFn) logFn(` Fetching MusicBrainz URL: ${url}`)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'RadioYearScanner/1.0 (example@example.com)' } })
    if (!res.ok) return null
    const data = await res.json()
    // prefer recordings with decent score and gather releases
    const filteredRecordings = data.recordings?.filter(r => r.score >= 75) || []
    if (logFn) logFn(`  MusicBrainz returned ${filteredRecordings.length} matching recordings.`)
    const flat = filteredRecordings.flatMap(r => r.releases || [])
    const withDate = flat.filter(r => r.date)
    withDate.sort((a, b) => a.date.localeCompare(b.date))
    const d = withDate[0]?.date
    return d ? d.substring(0, 4) : null
  } catch (e) {
    console.warn('musicbrainz', e?.message || e)
    return null
  }
}

export default function Home() {
  const IS_PROD = true
  const [logs, setLogs] = useState([])
  const [running, setRunning] = useState(false)
  const [match, setMatch] = useState(null)
  const [collected, setCollected] = useState([])
  const [stationsTotal, setStationsTotal] = useState(0)
  const [stationsChecked, setStationsChecked] = useState(0)
  const [guess, setGuess] = useState('')
  // Initialize score with a stable default to avoid server/client hydration mismatch.
  // Load persisted score from localStorage only on the client after mount.
  const [score, setScore] = useState({ points: 0, rounds: 0, correct: 0 })

  useEffect(() => {
    try {
      const saved = localStorage.getItem('grg-score')
      if (saved) setScore(JSON.parse(saved))
    } catch (_) { }
  }, [])
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [showUnmutePrompt, setShowUnmutePrompt] = useState(false)

  useEffect(() => { try { localStorage.setItem('grg-score', JSON.stringify(score)) } catch (_) { } }, [score])

  const log = (t) => setLogs(l => [...l, String(t)])

  async function runScan() {
    setLogs([]); setCollected([]); setMatch(null); setGuess(''); setRunning(true); setStationsChecked(0); setStationsTotal(0)
    const decade = TARGET_DECADES[Math.floor(Math.random() * TARGET_DECADES.length)]
    log(`Searching for ${decade}s songs...`)
    const host = 'https://all.api.radio-browser.info'
    const url = `${host}/json/stations/search?order=clickcount&reverse=true&tag=rock&limit=60&has_extended_info=true`
    log(`Fetching stations from: ${url}`)
    let stations = []
    try {
      const r = await fetch(url)
      stations = await r.json()
      setStationsTotal(stations.length)
      log(`Loaded ${stations.length} stations.`)
    } catch (e) { log(`Failed to load stations: ${e?.message || e}`); setRunning(false); return }

    const cache = new Map()
    for (const s of stations) {
      if (match) break
      setStationsChecked(c => c + 1)
      log(`Checking station: ${s.name || s.title || s.url}`)
      let title = (s.title && s.title.includes(' - ')) ? s.title : null
      // if station record doesn't include a "Artist - Track" title, try Icecast status JSON
      if (!title) {
        const base = getIcecastMetadataUrl(s.url)
        if (base) {
          log(` Fetching Icecast metadata from: ${base}`)
          try {
            const res = await fetch(base, { cache: 'no-store' })
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
              log(`  Icecast metadata fetch failed: ${res.status}`)
            }
          } catch (e) { log(`  Could not fetch station status for ${s.name || s.url}: ${e?.message || e}`) }
        }
      }
      log(` Current song: ${title || '(no song info)'}`)
      if (!title) continue
      const normalized = title.trim()
      if (cache.has(normalized)) { log(` Already seen "${normalized}", skipping`); continue }
      const { artist, title: track } = splitSongTitle(title)
      if (!artist || !track) { log(` Could not split title into artist/title: "${title}"`); continue }
      log(` Looking up year for: ${artist} - ${track} ...`)
      const year = await getSongYear(artist, track, log)
      cache.set(normalized, year)
      log(` Found year for ${artist} - ${track}: ${year || 'unknown'}`)
      if (!year) continue
      setCollected(c => [...c, `${artist} - ${track} (${year})`])
      const yr = parseInt(year)
      const dec = Math.floor(yr / 10) * 10
      if (dec === decade) {
        log(`Match found: ${artist} - ${track} (${year}) at station ${s.name || s.url}`)
        setMatch({ artist, track, year, station: s });
        break
      }
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
    setShowAnswer(true)
  }

  function revealAnswer() {
    if (!match) return
    setShowAnswer(true)
    setScore(s => ({ ...s, rounds: s.rounds + 1 }))
    log(`Answer revealed: ${match.year}`)
  }

  function nextRound() {
    try { audioRef.current?.pause() } catch (_) { }
    setMatch(null)
    setGuess('')
    setShowAnswer(false)
    setIsPlaying(false)
    runScan()
  }

  function resetScore() { setScore({ points: 0, rounds: 0, correct: 0 }); }

  // when a match appears, try to autoplay the stream muted (browsers often allow muted autoplay)
  useEffect(() => {
    if (!match) return
    const el = audioRef.current
    if (!el) return
    try {
      el.muted = true
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

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Game Radio Guesser</h1>
          <p className="text-sm text-gray-600">Find a song and guess its release decade.</p>
        </header>

        <div className="flex gap-4 items-center mb-4">
          <Button onClick={runScan} disabled={running || !!match}>{running ? 'Scanning...' : 'Start Round'}</Button>
          <div className="ml-auto text-sm text-gray-700">Score: <strong>{score.points}</strong> · Rounds: {score.rounds} · Correct: {score.correct}
            <Button className="ml-3" variant="ghost" onClick={resetScore}>Reset</Button>
          </div>
        </div>

        {running && <Card><div className="flex items-center gap-3"><Spinner /> Searching stations... ({stationsChecked}/{stationsTotal})</div></Card>}

        {match && (
          <Card>
            <h2 className="text-lg font-medium">Round</h2>
            <p className="mt-2"><strong>{match.artist}</strong> — {match.track}</p>
            <div className="mt-4">
              <audio ref={audioRef} src={match.station?.url} preload="none" controls style={{ display: 'none' }} />
              <div className="flex gap-3">
                <Button onClick={() => audioRef.current?.play()?.catch(e => log('play blocked'))}>{isPlaying ? 'Playing' : 'Play'}</Button>
                <Button variant="ghost" onClick={() => { try { audioRef.current?.pause() } catch (_) { } }}>Pause</Button>
                <Button variant="ghost" onClick={() => { try { audioRef.current.muted = false; audioRef.current.play()?.catch(() => { }); setAutoplayBlocked(false) } catch (_) { } }}>Unmute</Button>
              </div>

              {autoplayBlocked && (
                <div style={{ marginTop: 6, color: '#b33' }}>
                  Autoplay was blocked by the browser or will start muted. Click anywhere or press Unmute to enable sound.
                </div>
              )}

              {autoplayBlocked && showUnmutePrompt && (
                <div className="mt-3 p-3 border rounded bg-white shadow">
                  <div className="font-medium">Click to enable sound</div>
                  <div className="mt-2">
                    <Button onClick={() => {
                      const el = audioRef.current
                      if (!el) return
                      try { el.muted = false; el.play()?.then(() => setIsPlaying(true)).catch(() => { }) } catch (_) { }
                      setAutoplayBlocked(false); setShowUnmutePrompt(false); log('Unmute prompt clicked')
                    }}>Enable sound</Button>
                  </div>
                </div>
              )}

              {!showAnswer ? (
                <form onSubmit={submitGuessWithLog} className="mt-4 flex gap-2 items-center">
                  <input className="border px-2 py-1 rounded" placeholder="YYYY" value={guess} onChange={e => setGuess(e.target.value)} />
                  <Button type="submit">Submit Guess</Button>
                  <Button type="button" variant="ghost" onClick={revealAnswer}>Reveal</Button>
                </form>
              ) : (
                <div className="mt-4">
                  <p>Answer: <strong>{match.year}</strong> ({Math.floor(parseInt(match.year) / 10) * 10}s)</p>
                  <Button onClick={nextRound}>Next Round</Button>
                </div>
              )}
            </div>
          </Card>
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
