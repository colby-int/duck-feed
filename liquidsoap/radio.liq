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

# Primary chain: queue first, then library. Switches only at track boundaries.
main = fallback(
  id="main",
  track_sensitive=true,
  [queue, library]
)

# Crossfade disabled after it produced a stable harmonic buzz on-air in prod.
radio = main

# Guarantee an infallible source for output even when queue + library are
# empty.
radio = mksafe(id="radio", radio)

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
