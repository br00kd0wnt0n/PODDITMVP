FROM node:20-slim

# Install ffmpeg for audio format conversion (AMR → WAV)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 8080
ENV PORT=8080

CMD ["npm", "start"]
