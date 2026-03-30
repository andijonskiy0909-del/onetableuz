FROM node:18-alpine
WORKDIR /app
COPY api/package.json ./api/
COPY bot/package.json ./bot/
RUN cd api && npm install --omit=dev
RUN cd bot && npm install --omit=dev
COPY . .
CMD ["node", "api/src/app.js"]
