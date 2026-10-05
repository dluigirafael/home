FROM node:alpine
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]