FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/var/data
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /var/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
EXPOSE 3001
CMD ["npm", "start"]
