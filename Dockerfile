FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate

EXPOSE 3001

CMD ["sh", "-c", "i=0; until npx prisma db push --skip-generate; do i=$((i+1)); if [ \"$i\" -ge 30 ]; then echo 'PostgreSQL no respondió'; exit 1; fi; echo \"Esperando PostgreSQL... ($i)\"; sleep 2; done; npx tsx prisma/seed.ts && npm start"]
