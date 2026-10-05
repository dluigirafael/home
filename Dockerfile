FROM node:alpine
WORKDIR /app

ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown
ARG GH_RUN_URL=

ENV GIT_SHA=$GIT_SHA
ENV BUILD_DATE=$BUILD_DATE
ENV GH_RUN_URL=$GH_RUN_URL

COPY . .

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000
CMD ["node", "server.js"]