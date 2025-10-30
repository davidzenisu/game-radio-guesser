/**
 * Continuous Radio Year Scanner
 * ------------------------------
 * Scans a list of radio stations for songs from a given release year.
 * Uses:
 *  - RadioBrowser API (to get stations)
 *  - MusicBrainz API (to get release year)
 *
 * No API keys required.
 */

import fetch from "node-fetch";
import dns from "dns";
import util from "util";
import player from "play-sound";
const resolveSrv = util.promisify(dns.resolveSrv);

// target decade
const TARGET_DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
const STATION_LIMIT = 100;          // How many stations to scan
const POLL_INTERVAL = 30000;      // How often to recheck stations (ms)

const CACHE = new Map();           // artist-title → year cache

async function main() {
    console.log("=== Radio Year Scanner ===");

    // Choose a random target year from the decades list
    const randomDecade = TARGET_DECADES[Math.floor(Math.random() * TARGET_DECADES.length)];
    console.log(`🎵 Searching for songs from ${randomDecade}s...`);

    const host = await get_radiobrowser_base_url_random();
    console.log(`Received random RadioBrowser server: ${host}`);

    const stations = await getStations(host, STATION_LIMIT);
    console.log(`Loaded ${stations.length} stations to scan.\n`);

    const stats = {
        totalChecked: 0,
        totalSongFound: 0,
        totalYearFound: 0,
        totalMatches: 0,
        collectedSongs: new Set(),
    }

    const result = {};

    for (const s of stations) {
        try {
            console.log(`Checking station: ${s.name}`);
            const songTitle = await getCurrentSong(s);
            console.log(` Current song: ${songTitle || "(no song info)"}`);
            if (!songTitle) continue;

            stats.totalChecked++;

            console.log(` Processing song title: ${songTitle}...`);

            const normalized = songTitle.trim();
            if (CACHE.has(normalized)) {
                console.log(` Found in cache: ${CACHE.get(normalized) || "unknown"}`);
                if (CACHE.get(normalized) === TARGET_YEAR) {
                    console.log(`✅ ${s.name}: ${songTitle} (${TARGET_YEAR})`);
                }
                continue;
            }

            const { artist, title } = splitSongTitle(normalized);
            if (!artist || !title) continue;

            stats.totalSongFound++;

            console.log(` Looking up year for: ${artist} - ${title}...`);

            const year = await getSongYear(artist, title);
            CACHE.set(normalized, year);

            console.log(` Found year: ${year || "unknown"}`);

            if (!year) continue;

            stats.totalYearFound++;

            stats.collectedSongs.add(`${artist} - ${title} (${year})`);

            // check if year matches target decade
            if (year.length < 4) continue;
            const yearInt = parseInt(year);
            const decadeStart = Math.floor(yearInt / 10) * 10;
            if (decadeStart !== randomDecade) continue;
            console.log(`🎯 Match found! ${s.name}: ${artist} - ${title} (${year})`);
            stats.totalMatches++;

            result.urls = {
                stream: s.url,
                metadata: getIcecastMetadataUrl(s.url),
            };
            result.song = { artist, title, year };

            // stop after first match
            break;
        } catch (err) {
            console.error(`Error checking ${s.name}:`, err.message);
        }
    }
    console.log("\n--- Scan complete ---");
    console.log(` Total songs checked: ${stats.totalChecked}`);
    console.log(` Total songs with title found: ${stats.totalSongFound}`);
    console.log(` Total songs with year found: ${stats.totalYearFound}`);
    console.log(` Total matches for decade ${randomDecade}: ${stats.totalMatches}`);
    console.log(" Collected songs:");
    for (const song of stats.collectedSongs) {
        console.log(`  - ${song}`);
    }

    // finally, start streaming song
    console.log(`Found song: ${JSON.stringify(result, null, 2)}`);
    console.log("\n=== Scanner finished ===");

    // const play = player();
    // play.play(result.stream_url, function (err) {
    //     if (err) console.error("Error playing stream:", err);
    // });
}

/* --- Helpers --- */

/**
 * Get a list of base urls of all available radio-browser servers
 * Returns: array of strings - base urls of radio-browser servers
 */
async function get_radiobrowser_base_urls() {
    const hosts = await resolveSrv("_api._tcp.radio-browser.info");
    hosts.sort();
    return hosts.map(host => "https://" + host.name);
}

/**
 * Get a random available radio-browser server.
 * Returns: string - base url for radio-browser api
 */
async function get_radiobrowser_base_url_random() {
    const hosts = await get_radiobrowser_base_urls();
    var item = hosts[Math.floor(Math.random() * hosts.length)];
    return item;
}

async function getStations(host, limit = 20) {
    const url = `${host}/json/stations/search?order=clickcount&reverse=true&tag=rock&limit=${limit}&has_extended_info=true`;
    const res = await fetch(url);
    const stations = await res.json();
    return stations.filter(s => s.url && (s.title || s.has_extended_info));
}

async function getCurrentSong(station) {
    // Try RadioBrowser metadata first
    if (station.title && station.title.includes(" - ")) {
        return station.title;
    }

    // Try station-specific status JSON (common on Icecast)
    try {
        console.log(` Trying to receive metadata from station ${station.url}...`);
        const baseUrl = getIcecastMetadataUrl(station.url);
        console.log(` Trying to fetch station status from ${baseUrl.toString()}...`);
        const res = await fetch(baseUrl.toString(), { timeout: 4000 });
        if (res.ok) {
            const json = await res.json();
            const sources = json.icestats?.source || [];
            console.log(` Received station status JSON with ${sources.length} sources.`);
            const source = sources.find(s => s.server_name === station.name);
            return source?.title;
        }
    } catch (_) {
        console.log("  Could not fetch station status JSON.");
    }

    return null;
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

function splitSongTitle(fullTitle) {
    const parts = fullTitle.split(" - ");
    console.log(` Split song title into artist: "${parts[0].trim()}", title: "${parts.slice(1).join(" - ").trim()}"`);
    if (parts.length >= 2) {
        return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
    }
    return { artist: null, title: null };
}

async function getSongYear(artist, track) {
    const query = `recording:${track} AND artist:${artist}`;
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json`;

    const res = await fetch(url, {
        headers: { "User-Agent": "RadioYearScanner/1.0 (yourname@example.com)" },
    });

    console.log(` Fetching MusicBrainz URL: ${url}`);

    if (!res.ok) return null;
    const data = await res.json();
    const flatReleases = data.recordings?.flatMap(r => r.releases || []);
    // order releases by date ascending
    const releasesWithDate = flatReleases?.filter(r => r.date);
    releasesWithDate?.sort((a, b) => a.date.localeCompare(b.date));
    const date = releasesWithDate?.[0]?.date;
    console.log(` Checkd MusicBrainz for "${artist} - ${track}", got date: recording: ${data.recordings?.length}, release: ${flatReleases?.length}, date: ${date}`);
    return date ? date.substring(0, 4) : null;
}

/* --- Run it --- */
main().catch(console.error);
