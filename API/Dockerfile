FROM node:20-alpine

WORKDIR /app

# Non-root user (HIPAA: least privilege)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY config/ ./config/
COPY middleware/ ./middleware/
COPY routes/ ./routes/
COPY services/ ./services/
COPY controllers/ ./controllers/
COPY mock-assets/ ./mock-assets/

USER appuser
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
