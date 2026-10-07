FROM denoland/deno:latest AS build
WORKDIR /app
COPY deno.json deno.lock* ./
RUN deno install --allow-scripts
COPY . .
RUN deno task build

FROM denoland/deno:latest
WORKDIR /app
COPY --from=build /app/_fresh ./_fresh
COPY --from=build /app/deno.json .
COPY --from=build /app/deno.lock* ./
ENV PORT=3000
EXPOSE 3000
CMD ["serve", "-A", "_fresh/server.js"]