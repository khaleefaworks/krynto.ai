FROM node:20-alpine

WORKDIR /app

ARG VITE_API_BASE
ARG VITE_WS_BASE

COPY frontend/package.json frontend/package-lock.json* /app/
RUN npm ci

COPY frontend /app

# Build with env baked in
RUN VITE_API_BASE=${VITE_API_BASE} VITE_WS_BASE=${VITE_WS_BASE} npm run build

EXPOSE 5173

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
