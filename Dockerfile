FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive DISPLAY=:99 HOME=/home/node
RUN apt-get update && apt-get install -y --no-install-recommends chromium xvfb x11vnc openbox novnc tini gosu ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/microflix
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server-collector ./server-collector
COPY collector-extension ./collector-extension
RUN mkdir -p /var/data && chown -R node:node /var/data /opt/microflix
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "server-collector/start.sh"]
