// Simple server-side proxy for Icecast status JSON to avoid browser CORS issues.
// Usage: GET /api/icecast?url=<station-url>
// It rewrites the path to /status-json.xsl and returns the JSON response.
// NOTE: This is a small convenience proxy — in production you should
// validate/whitelist hosts or add rate-limiting to avoid abuse.

const cache = new Map() // url -> { ts, data }
const TTL = 60 * 1000 // 60s

export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'missing url query param' })

  let statusUrl
  try {
    const u = new URL(String(url))
    u.pathname = '/status-json.xsl'
    statusUrl = u.toString()
  } catch (e) {
    return res.status(400).json({ error: 'invalid url' })
  }

  const now = Date.now()
  const cached = cache.get(statusUrl)
  if (cached && now - cached.ts < TTL) {
    res.setHeader('x-cache', 'HIT')
    return res.status(200).json(cached.data)
  }

  try {
    const r = await fetch(statusUrl, { cache: 'no-store' })
    const text = await r.text()
    // Try to parse JSON; many Icecast servers return valid JSON here
    let data
    try { data = JSON.parse(text) } catch (_) { return res.status(502).send(text) }

    cache.set(statusUrl, { ts: now, data })
    res.setHeader('x-cache', 'MISS')
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(502).json({ error: String(err?.message || err) })
  }
}
