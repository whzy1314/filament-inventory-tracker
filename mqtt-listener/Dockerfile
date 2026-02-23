FROM node:23-alpine

WORKDIR /app

COPY package.json ./

RUN npm install --only=production

COPY . .

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

RUN addgroup -g 1001 -S nodejs
RUN adduser -S mqttlistener -u 1001

RUN chown -R mqttlistener:nodejs /app
USER mqttlistener

CMD ["npm", "start"]
