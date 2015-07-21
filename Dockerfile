FROM neverbland/nodejs-typescript

RUN mkdir /dnsgeo
WORKDIR /dnsgeo
COPY . /dnsgeo

ENV API_GOOGLE $API_GOOGLE

ENTRYPOINT nodejs geo.js
