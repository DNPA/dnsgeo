FROM neverbland/nodejs-typescript

RUN mkdir dnsgeo
WORKDIR dnsgeo
ADD .

ENV API_GOOGLE 

ENTRYPOINT nodejs geo.js
