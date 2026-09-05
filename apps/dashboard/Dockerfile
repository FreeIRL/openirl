FROM node:22-alpine AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN npm ci --omit=dev --workspace apps/dashboard

FROM node:22-alpine
RUN apk add --no-cache ffmpeg && mkdir /data && chown node:node /data
WORKDIR /app
COPY apps/dashboard/package.json ./
COPY apps/dashboard/src ./src
COPY apps/dashboard/public ./public
COPY --from=dependencies /build/node_modules/hls.js/dist/hls.min.js ./public/vendor/hls.min.js
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "src/server.js"]
