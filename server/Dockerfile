FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
COPY server/src ./src
COPY ui/public ./ui/public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/index.js"]
