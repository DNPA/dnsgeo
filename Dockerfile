FROM neverbland/nodejs-typescript

RUN mkdir /dnsgeo
WORKDIR /dnsgeo
COPY . /dnsgeo
WORKDIR /dnsgeo/js

RUN apk add build-base python
RUN npm install node-syslog native-dns

ENV API_GOOGLE CHANGE_ME

ENTRYPOINT node geodns.js
