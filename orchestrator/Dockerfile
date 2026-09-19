FROM node:20-alpine

WORKDIR /app

# Dependencias del sistema para better-sqlite3
RUN apk add --no-cache python3 make g++ libc6-compat

# Copiar package.json primero para cachear dependencias
COPY package.json ./
RUN npm install

# Copiar el resto del código
COPY tsconfig.json ./
COPY src ./src

# Crear directorio para la DB
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

# CMD en formato exec: cada parte como elemento separado del array
CMD ["node", "--import", "file:///app/node_modules/tsx/dist/loader.mjs", "src/index.ts"]
