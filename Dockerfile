FROM neverbland/nodejs-typescript

RUN mkdir /dnsgeo
WORKDIR /dnsgeo
COPY js /dnsgeo

ENV API_GOOGLE $API_GOOGLE

ENTRYPOINT node geodns.js
