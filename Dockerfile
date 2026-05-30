FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY public/ ./public/
RUN mkdir -p ./downloads
EXPOSE 10000
CMD ["node", "src/server.js"]
