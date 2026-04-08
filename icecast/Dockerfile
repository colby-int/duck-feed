FROM alpine:3.20

RUN apk add --no-cache icecast

# Template is copied to .template; entrypoint renders env vars into icecast.xml at start.
COPY icecast.xml /etc/icecast/icecast.xml.template
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
