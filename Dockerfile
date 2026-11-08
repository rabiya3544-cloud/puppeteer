FROM node:20-bookworm-slim

# Debian's chromium package pulls in libnss3, gtk, etc. automatically
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libgbm1 \
    xdg-utils \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium
EXPOSE 3000
CMD ["node", "server.js"]
