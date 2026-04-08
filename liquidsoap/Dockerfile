FROM savonet/liquidsoap:v2.3.2

COPY radio.liq /etc/liquidsoap/radio.liq

EXPOSE 1234

ENTRYPOINT ["liquidsoap", "/etc/liquidsoap/radio.liq"]
