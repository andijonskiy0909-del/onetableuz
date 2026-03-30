FROM node:18-alpine
WORKDIR /app
COPY api/package.json ./api/
RUN cd api && npm install --omit=dev
COPY . .
CMD ["node", "api/src/app.js"]
