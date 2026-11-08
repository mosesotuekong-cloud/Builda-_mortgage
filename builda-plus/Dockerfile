# builda+ private demo container. Runs the TypeScript directly with tsx, as `npm start` does locally.
FROM node:22-slim
WORKDIR /app

# Dependencies first so they're cached between builds. Dev dependencies are kept: tsx runs the app.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY db ./db
COPY scripts ./scripts

# Run as the image's unprivileged user, not root.
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/server.ts"]
