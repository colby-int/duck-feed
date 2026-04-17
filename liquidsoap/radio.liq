#!/usr/bin/liquidsoap

# Enable telnet server for API control
settings.server.telnet := true
settings.server.telnet.port := 1234
settings.server.telnet.bind_addr := "0.0.0.0"

# Library playlist — randomised, watches for new files
library = playlist(
  id="library",
  mode="randomize",
  reload_mode="watch",
  "/var/lib/duckfeed/library"
)

# Request queue for operator-pushed episodes
queue = request.queue(id="queue")

# Archive chain: queue first, then library. Switches only at track boundaries.
archive = fallback(
  id="archive",
  track_sensitive=true,
  [queue, library]
)

# Live relay — pulls an external stream URL set via telnet. The URL is
# controlled by the Node backend based on the schedule; live.enabled gates
# whether we actually take over from the archive.
live_enabled = interactive.bool("live.enabled", false)
live_url     = interactive.string("live.url", "")

live = input.http(id="live", live_url)

# Top-level switch: live takes priority when enabled AND ready (URL is
# reachable). Cuts are not track-sensitive so window boundaries can flip
# sources immediately. If live drops or the URL is empty, we fall through
# to archive rotation automatically.
main = switch(
  id="main",
  track_sensitive=false,
  [
    ({live_enabled() and source.is_ready(live)}, live),
    ({true}, archive)
  ]
)

# Crossfade disabled after it produced a stable harmonic buzz on-air in prod.
radio = main

# Guarantee an infallible source for output even when everything upstream
# goes silent.
radio = mksafe(id="radio", radio)

# Track the currently playing metadata so the API can identify the episode.
# All fields are written atomically in a single on_metadata callback into one
# ref. Querying one telnet command returns a consistent snapshot — no races.
current_metadata = ref("")

radio.on_metadata(fun(m) -> begin
  let f = m["filename"]
  let t = m["title"]
  let a = m["artist"]
  current_metadata := "#{f}\t#{t}\t#{a}"
end)

server.register("current.metadata", fun(_) -> current_metadata())

# Output to Icecast
output.icecast(
  %mp3(bitrate=192, samplerate=44100),
  host="icecast",
  port=8000,
  password=environment.get("ICECAST_SOURCE_PASSWORD"),
  mount="/stream",
  name="duckfeed Radio",
  description="24/7 Internet Radio",
  url="https://#{environment.get(default='localhost', 'ICECAST_HOSTNAME')}",
  radio
)
