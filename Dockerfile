FROM denoland/deno:2.1.4 AS build
WORKDIR /app
COPY deno.json package.json ./
RUN deno install
COPY . .
RUN deno task build

FROM denoland/deno:2.1.4
WORKDIR /app
COPY --from=build /app/_fresh ./_fresh
COPY --from=build /app/deno.json .
ENV DENO_DEPLOYMENT_ID=${GIT_SHA:-dev}
ENV PORT=3000
EXPOSE 3000
USER deno
CMD ["run", "-A", "--allow-read=/sys,/proc,/var/run/docker.sock", "--allow-net", "--allow-run", "_fresh/server.js"]