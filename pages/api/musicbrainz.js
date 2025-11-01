// Small server-side proxy for MusicBrainz queries to avoid CORS and to
// centralize the User-Agent header and optional caching.
// Usage: GET /api/musicbrainz?artist=...&track=...
// Or: GET /api/musicbrainz?q=<raw-query>

const cache = new Map()
const TTL = 30 * 1000

function buildQuery(params){
  if(params.q) return String(params.q)
  const artist = params.artist || ''
  const track = params.track || ''
  return `recording:${track} AND artist:${artist} AND status:official AND primarytype:album`
}

export default async function handler(req, res){
  const q = buildQuery(req.query)
  if(!q) return res.status(400).json({ error: 'missing query' })

  const limit = req.query.limit || 100
  const offset = req.query.offset || 0
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&inc=releases&limit=${limit}&offset=${offset}`

  const now = Date.now()
  const cacheKey = `${url}`
  const cached = cache.get(cacheKey)
  if(cached && now - cached.ts < TTL){ res.setHeader('x-cache','HIT'); return res.status(200).json(cached.data) }

  try{
    const r = await fetch(url, { headers: { 'User-Agent': 'RadioYearScanner/1.0 (example@example.com)' } })
    if(!r.ok) return res.status(r.status).send(await r.text())
    const data = await r.json()
    cache.set(cacheKey, { ts: now, data })
    res.setHeader('x-cache','MISS')
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=10')
    return res.status(200).json(data)
  }catch(err){
    return res.status(502).json({ error: String(err?.message||err) })
  }
}
