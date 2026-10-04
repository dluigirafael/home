FROM node:alpine
WORKDIR /app
COPY package.json server.js index.html styles.css ./
EXPOSE 3000
CMD ["node", "server.js"]